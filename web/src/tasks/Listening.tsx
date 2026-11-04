import { useEffect, useRef, useState } from "react";
import { McqQuestion } from "../components/Mcq";
import { playScript, getManifest, AUDIO_MODE_LABEL, type Playback, type Manifest } from "../lib/audio";
import type { AudioScript } from "../../../shared/publicView";
import type { TaskProps, TaskCtx } from "./types";

type Phase = "ready" | "playing" | "done" | "error";

/** Plays a stimulus once (strict) or with replay (practice); remembers "played" in the response so refresh cannot replay it. */
export function useStimulus(exId: string, script: AudioScript, ctx: TaskCtx, played: boolean, markPlayed: () => void) {
  const [phase, setPhase] = useState<Phase>(played ? "done" : "ready");
  const [error, setError] = useState<string | null>(null);
  const [seg, setSeg] = useState(0);
  const [mode, setMode] = useState<Manifest["mode"] | null>(null);
  const pb = useRef<Playback | null>(null);
  useEffect(() => {
    getManifest(exId).then((m) => setMode(m.mode)).catch(() => setMode(null));
    return () => pb.current?.cancel();
  }, [exId]);
  const play = () => {
    if (phase === "playing") return;
    if (ctx.strict && played) return;
    setPhase("playing");
    markPlayed();
    const mine = playScript(exId, script, { onSegment: setSeg });
    pb.current = mine;
    mine.done
      .then((r) => {
        if (pb.current !== mine || r.cancelled) return;
        setPhase("done");
        ctx.onAudioDone?.();
      })
      .catch((e: Error) => {
        if (pb.current !== mine) return;
        setError(e.message);
        setPhase("error");
        ctx.onAudioDone?.();
      });
  };
  // Strict mode starts the audio automatically, once.
  useEffect(() => {
    if (ctx.strict && !played && phase === "ready") play();
    if (played && phase === "ready") ctx.onAudioDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { phase, error, seg, mode, play, canReplay: !ctx.strict && phase === "done" };
}

export function AudioPanel({ s, total, context }: { s: ReturnType<typeof useStimulus>; total: number; context?: string }) {
  return (
    <div className="card flex items-center gap-4 p-4">
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${s.phase === "playing" ? "bg-accent text-white" : "bg-zinc-100 text-zinc-600"}`} aria-hidden>
        {s.phase === "playing" ? (
          <span className="flex h-4 items-end gap-0.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="w-1 animate-pulse bg-white" style={{ height: `${6 + ((i * 5) % 10)}px`, animationDelay: `${i * 120}ms` }} />
            ))}
          </span>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2A4.5 4.5 0 0014 8v8a4.5 4.5 0 002.5-4z" />
          </svg>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {context && <div className="text-[14px] text-zinc-800">{context}</div>}
        <div className="text-xs text-zinc-500">
          {s.phase === "ready" && "Press Play when you are ready. The audio plays once in strict mode."}
          {s.phase === "playing" && `Playing${total > 1 ? ` · part ${s.seg + 1}/${total}` : ""}…`}
          {s.phase === "done" && "Audio finished."}
          {s.phase === "error" && <span className="text-red-700">Audio unavailable: {s.error}</span>}
        </div>
        {s.mode && <div className="mt-0.5 text-[11px] text-zinc-400">{AUDIO_MODE_LABEL[s.mode]}</div>}
      </div>
      {(s.phase === "ready" || s.canReplay) && (
        <button className="btn" onClick={s.play}>
          {s.phase === "ready" ? "▶ Play" : "↻ Replay (practice)"}
        </button>
      )}
    </div>
  );
}

export type ChoiceValue = { answer: number | null; _played?: boolean };

export function ListenChooseResponse({ ex, value, onChange, ctx }: TaskProps<"listen_choose_response", ChoiceValue>) {
  const v: ChoiceValue = value ?? { answer: null };
  const latest = useRef(v);
  latest.current = v;
  const s = useStimulus(ex.id, ex.audio, ctx, !!v._played, () => onChange({ ...latest.current, _played: true }));
  const show = s.phase === "done" || s.phase === "error";
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <AudioPanel s={s} total={1} context="Listen to the speaker, then choose the best response." />
      {show ? (
        <McqQuestion q={{ id: "q1", stem: "Choose the best response.", options: ex.options }} value={v.answer} onChange={(i) => onChange({ ...v, answer: i })} disabled={ctx.locked} />
      ) : (
        <p className="text-center text-sm text-zinc-400">The responses appear after the audio.</p>
      )}
    </div>
  );
}

export type SetValue = { answers: (number | null)[]; _played?: boolean; _q?: number };

export function ListeningSet({ ex, value, onChange, ctx }: TaskProps<"conversation" | "announcement" | "academic_talk", SetValue>) {
  const n = ex.questions.length;
  const v: SetValue = value ?? { answers: Array(n).fill(null), _q: 0 };
  const latest = useRef(v);
  latest.current = v;
  const s = useStimulus(ex.id, ex.audio, ctx, !!v._played, () => onChange({ ...latest.current, _played: true }));
  const q = v._q ?? 0;
  const show = s.phase === "done" || s.phase === "error";
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <AudioPanel s={s} total={ex.audio.length} context={`${ex.context}${"title" in ex && ex.title ? ` — ${ex.title}` : ""}`} />
      {show ? (
        <div className="card p-5">
          <McqQuestion
            q={ex.questions[q]!}
            value={v.answers[q]}
            onChange={(i) => {
              const answers = [...v.answers];
              answers[q] = i;
              onChange({ ...v, answers });
            }}
            disabled={ctx.locked}
            number={q + 1}
            total={n}
          />
          <div className="mt-4 flex justify-between">
            {ctx.strict ? (
              <span className="text-xs text-zinc-400">Listening: no return to previous questions.</span>
            ) : (
              <button className="btn" disabled={q === 0} onClick={() => onChange({ ...v, _q: q - 1 })}>
                ← Previous
              </button>
            )}
            {q < n - 1 && (
              <button className="btn" disabled={ctx.locked} onClick={() => onChange({ ...v, _q: q + 1 })}>
                Next question →
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-center text-sm text-zinc-400">Questions appear after the audio. The transcript is never shown during the attempt.</p>
      )}
    </div>
  );
}
