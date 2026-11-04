import { useEffect, useRef, useState } from "react";
import { playScript, type Playback } from "../lib/audio";
import { Recording, recordingSupported, browserRecognitionSupported, getMicrophone } from "../lib/recorder";
import { api } from "../lib/api";
import { loadConfig } from "../lib/config";
import { formatClock } from "../lib/timer";
import { Notice } from "../components/ui";
import type { AudioScript } from "../../../shared/publicView";
import type { TaskCtx, TaskProps } from "./types";

export interface SpeechItem {
  index: number;
  recordingId?: string | null;
  transcript?: string | null;
  transcriptSource?: "server_stt" | "browser" | null;
  asrConfidence?: number | null;
  durationMs?: number | null;
  interrupted?: boolean;
  uploadError?: string | null;
}
export type SpeechValue = { items: SpeechItem[]; _cursor?: number; _inProgress?: number | null };

interface Item {
  index: number;
  seconds: number;
  key: string;
}

type Stage = "intro" | "listening" | "gap" | "recording" | "saving" | "finished" | "error";

/**
 * Shared engine for Listen and Repeat and Take an Interview:
 * play the prompt once → microphone starts automatically (no preparation) → hard response window → next item.
 */
function useSpeechRunner(opts: {
  exId: string;
  audio: AudioScript;
  items: Item[];
  value: SpeechValue | undefined;
  onChange: (v: SpeechValue) => void;
  ctx: TaskCtx;
  gapMs: number;
}) {
  const { exId, audio, items, ctx } = opts;
  const init = (): SpeechValue => {
    const v = opts.value ?? { items: [], _cursor: 0, _inProgress: null };
    // An item interrupted by a refresh is not replayed (strict, like the real test): mark it and move on.
    if (v._inProgress != null && !v.items.some((i) => i.index === items[v._inProgress!]!.index)) {
      return { items: [...v.items, { index: items[v._inProgress]!.index, interrupted: true }], _cursor: v._inProgress + 1, _inProgress: null };
    }
    return v;
  };
  const [val, setVal] = useState<SpeechValue>(init);
  const valRef = useRef(val);
  const commit = (v: SpeechValue) => {
    valRef.current = v;
    setVal(v);
    opts.onChange(v);
  };
  const cursor = val._cursor ?? 0;
  const [stage, setStage] = useState<Stage>(cursor >= items.length ? "finished" : "intro");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploads = useRef<Promise<void>[]>([]);
  const playback = useRef<Playback | null>(null);
  const rec = useRef<Recording | null>(null);
  const stopRequested = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      playback.current?.cancel();
      stopRequested.current?.();
    };
  }, []);

  useEffect(() => {
    if (cursor >= items.length && stage !== "finished") setStage("finished");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  const upload = (item: Item, r: Awaited<ReturnType<Recording["stop"]>>) => {
    const p = (async () => {
      const qs = new URLSearchParams({ userId: ctx.userId, exerciseId: exId, itemKey: item.key, durationMs: String(Math.round(r.durationMs)) });
      if (ctx.sessionId) qs.set("sessionId", ctx.sessionId);
      const patch: SpeechItem = { index: item.index, durationMs: Math.round(r.durationMs) };
      try {
        const res = await api.upload<{ id: string; transcript: string | null; transcript_source: "server_stt" | null; asr_confidence: number | null; stt_error: string | null }>(
          `/api/recordings?${qs}`,
          r.blob,
        );
        patch.recordingId = res.id;
        if (res.transcript != null) {
          patch.transcript = res.transcript;
          patch.transcriptSource = "server_stt";
          patch.asrConfidence = res.asr_confidence;
        } else if (r.transcript != null) {
          patch.transcript = r.transcript;
          patch.transcriptSource = "browser";
          patch.asrConfidence = r.confidence;
          await api.post(`/api/recordings/${res.id}/transcript`, { transcript: r.transcript, confidence: r.confidence });
        }
        if (res.stt_error) patch.uploadError = `Transcription failed: ${res.stt_error}`;
      } catch (e) {
        patch.uploadError = (e as Error).message;
      }
      const cur = valRef.current;
      commit({ ...cur, items: cur.items.map((x) => (x.index === item.index ? { ...x, ...patch } : x)) });
    })();
    uploads.current.push(p);
  };

  const runFrom = async (start: number) => {
    const cfg = await loadConfig().catch(() => null);
    const useBrowserSR = !cfg?.providers.stt.configured && browserRecognitionSupported();
    for (let i = start; i < items.length; i++) {
      if (!alive.current) return;
      const item = items[i]!;
      commit({ ...valRef.current, _cursor: i, _inProgress: i });
      setStage("listening");
      playback.current = playScript(exId, audio.filter((a) => a.key === item.key));
      try {
        await playback.current.done;
      } catch (e) {
        setError((e as Error).message);
        setStage("error");
        return;
      }
      if (!alive.current) return;
      setStage("gap");
      await new Promise((r) => setTimeout(r, opts.gapMs));
      let recording: Recording;
      try {
        recording = await Recording.start(useBrowserSR);
      } catch (e) {
        setError(`Microphone unavailable: ${(e as Error).message}`);
        setStage("error");
        return;
      }
      rec.current = recording;
      setStage("recording");
      const deadline = performance.now() + item.seconds * 1000;
      await new Promise<void>((resolve) => {
        const tick = window.setInterval(() => {
          const left = deadline - performance.now();
          setRemaining(Math.max(0, left));
          if (left <= 0) finish();
        }, 100);
        const finish = () => {
          window.clearInterval(tick);
          stopRequested.current = null;
          resolve();
        };
        stopRequested.current = finish;
      });
      const result = await recording.stop();
      rec.current = null;
      setRemaining(null);
      const cur = valRef.current;
      commit({ items: [...cur.items.filter((x) => x.index !== item.index), { index: item.index, durationMs: Math.round(result.durationMs) }], _cursor: i + 1, _inProgress: null });
      upload(item, result);
    }
    setStage("saving");
    await Promise.all(uploads.current);
    if (!alive.current) return;
    setStage("finished");
    ctx.onComplete?.();
  };

  const begin = async () => {
    setError(null);
    if (!recordingSupported()) {
      setError("This browser cannot record audio (MediaRecorder/getUserMedia unavailable). Use a recent Chrome, Edge or Firefox.");
      setStage("error");
      return;
    }
    try {
      await getMicrophone();
    } catch (e) {
      setError(`Microphone permission is required: ${(e as Error).message}`);
      setStage("error");
      return;
    }
    void runFrom(cursor);
  };

  return { val, cursor, stage, remaining, error, begin, stopEarly: () => stopRequested.current?.() };
}

function RecordingPanel({ stage, remaining, seconds, label, onStop, allowStop }: { stage: Stage; remaining: number | null; seconds: number; label: string; onStop: () => void; allowStop: boolean }) {
  return (
    <div className="card flex flex-col items-center gap-4 p-8 text-center">
      <div className="label">{label}</div>
      {stage === "listening" && <div className="text-lg font-medium text-zinc-800">Listen…</div>}
      {stage === "gap" && <div className="text-lg font-medium text-zinc-500">Get ready</div>}
      {stage === "recording" && (
        <>
          <div className="flex items-center gap-2 text-lg font-semibold text-red-700">
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-600" /> Recording
          </div>
          <div className="font-mono text-4xl font-semibold tabular-nums">{formatClock(remaining)}</div>
          <div className="h-1.5 w-64 overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full bg-red-600" style={{ width: `${((remaining ?? 0) / (seconds * 1000)) * 100}%` }} />
          </div>
          {allowStop && (
            <button className="btn" onClick={onStop}>
              Stop early (practice)
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function ListenAndRepeat({ ex, value, onChange, ctx }: TaskProps<"listen_and_repeat", SpeechValue>) {
  const items = ex.items.map((i) => ({ index: i.index, seconds: i.response_seconds, key: `item${i.index}` }));
  const r = useSpeechRunner({ exId: ex.id, audio: ex.audio, items, value, onChange, ctx, gapMs: 400 });
  const cur = items[Math.min(r.cursor, items.length - 1)]!;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="card p-5">
        <div className="label mb-1">Scenario</div>
        <p className="text-[15px] text-zinc-800">{ex.scenario}</p>
      </div>
      <div className="flex justify-center gap-1.5" aria-label="Progress">
        {items.map((it, i) => (
          <span key={it.index} className={`h-1.5 w-8 rounded-full ${i < r.cursor ? "bg-zinc-800" : i === r.cursor && r.stage !== "intro" ? "bg-accent" : "bg-zinc-200"}`} />
        ))}
      </div>
      {r.stage === "intro" && (
        <div className="card space-y-3 p-6 text-center">
          <p className="text-sm text-zinc-600">
            You will hear {items.length} sentences, one at a time, <b>once each</b>. Recording starts automatically after each sentence. Repeat it exactly. Response windows: {items.map((i) => i.seconds).join(", ")} s. No preparation time.
          </p>
          <button className="btn btn-primary" onClick={r.begin}>
            {r.cursor > 0 ? `Resume at sentence ${r.cursor + 1}` : "Start — allow microphone"}
          </button>
        </div>
      )}
      {["listening", "gap", "recording"].includes(r.stage) && (
        <RecordingPanel stage={r.stage} remaining={r.remaining} seconds={cur.seconds} label={`Sentence ${cur.index} of ${items.length}`} onStop={r.stopEarly} allowStop={!ctx.strict} />
      )}
      {r.stage === "saving" && <Notice>Saving recordings and transcripts…</Notice>}
      {r.stage === "finished" && <Notice tone="ok">All sentences recorded.</Notice>}
      {r.stage === "error" && <Notice tone="warn">{r.error}</Notice>}
    </div>
  );
}

export function TakeAnInterview({ ex, value, onChange, ctx }: TaskProps<"take_an_interview", SpeechValue>) {
  const items = ex.questions.map((q) => ({ index: q.index, seconds: ex.response_seconds, key: `q${q.index}` }));
  const r = useSpeechRunner({ exId: ex.id, audio: ex.audio, items, value, onChange, ctx, gapMs: 150 });
  const cur = items[Math.min(r.cursor, items.length - 1)]!;
  const qText = ex.audio.find((a) => a.key === cur.key)?.text;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="card p-5">
        <div className="label mb-1">Interview</div>
        <p className="text-[15px] text-zinc-800">{ex.scenario}</p>
      </div>
      {r.stage === "intro" && (
        <div className="card space-y-3 p-6 text-center">
          <p className="text-sm text-zinc-600">
            The interviewer asks {items.length} questions. Recording starts <b>immediately</b> after each question; you have {ex.response_seconds} seconds per answer. No preparation time.
          </p>
          <button className="btn btn-primary" onClick={r.begin}>
            {r.cursor > 0 ? `Resume at question ${r.cursor + 1}` : "Start — allow microphone"}
          </button>
        </div>
      )}
      {["listening", "gap", "recording"].includes(r.stage) && (
        <>
          <RecordingPanel stage={r.stage} remaining={r.remaining} seconds={cur.seconds} label={`Question ${cur.index} of ${items.length}`} onStop={r.stopEarly} allowStop={!ctx.strict} />
          {!ctx.strict && r.stage === "recording" && qText && <Notice>Practice mode — question text: {qText}</Notice>}
        </>
      )}
      {r.stage === "saving" && <Notice>Saving recordings and transcripts…</Notice>}
      {r.stage === "finished" && <Notice tone="ok">All answers recorded.</Notice>}
      {r.stage === "error" && <Notice tone="warn">{r.error}</Notice>}
    </div>
  );
}
