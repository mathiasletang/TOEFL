import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useConfig } from "../lib/config";
import { pct } from "../lib/format";
import { Notice, Spinner } from "../components/ui";
import { McqQuestion } from "../components/Mcq";
import { Passage } from "./Reading";
import { ERROR_TAG_LABELS } from "../../../shared/errors";
import type { Exercise } from "../../../shared/schema";
import type { ScoreResult, ItemResult } from "../../../shared/scoring";
import type { AlignOp } from "../../../shared/align";
import type { CtwDerivation } from "../../../shared/ctw";

export interface ReviewData {
  attempt: {
    id: string;
    task_type: string;
    mode: string;
    raw_score: number | null;
    max_score: number;
    accuracy: number | null;
    pending: boolean;
    elapsed_ms: number;
    time_limit_ms: number | null;
    timed_out: boolean;
    timing_violation: boolean;
    simulation_id: string | null;
    result: ScoreResult;
    response: unknown;
    error_tags: string[];
  };
  exercise: Exercise;
  evaluations: Array<{ id: string; item_key: string; status: string; rubric_score: number | null; confidence: number | null; result: Record<string, unknown> | null; error: string | null; model: string | null }>;
  recordings: Array<{ id: string; item_key: string; transcript: string | null; transcript_source: string | null; asr_confidence: number | null; stt_error: string | null; duration_ms: number | null }>;
  ctw?: CtwDerivation;
}

const tagLabel = (t: string) => ERROR_TAG_LABELS[t] ?? t.replace(/_/g, " ");

function ScoreHeader({ d }: { d: ReviewData }) {
  const a = d.attempt;
  const productive = ["write_an_email", "academic_discussion", "take_an_interview", "listen_and_repeat"].includes(a.task_type);
  return (
    <div className="card flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
      <div>
        <div className="label">{productive ? "Task score (0–5 rubric)" : "Score"}</div>
        <div className="text-2xl font-semibold tabular-nums">
          {a.raw_score == null ? "—" : `${+a.raw_score.toFixed(2)} / ${a.max_score}`}
          {a.accuracy != null && <span className="ml-2 text-base font-normal text-zinc-500">{pct(a.accuracy)}</span>}
        </div>
      </div>
      <div>
        <div className="label">Time</div>
        <div className="text-sm tabular-nums text-zinc-700">
          {Math.round(a.elapsed_ms / 1000)} s{a.time_limit_ms ? ` / ${Math.round(a.time_limit_ms / 1000)} s` : ""}
          {a.timed_out && <span className="ml-2 chip border-amber-200 bg-amber-50 text-amber-800">auto-submitted</span>}
          {a.timing_violation && <span className="ml-2 chip border-red-200 bg-red-50 text-red-700">late submission</span>}
        </div>
      </div>
      <div>
        <div className="label">Mode</div>
        <div className="text-sm text-zinc-700">{a.simulation_id ? "simulation" : a.mode}</div>
      </div>
      {a.error_tags.length > 0 && (
        <div className="min-w-0 flex-1">
          <div className="label">Tested skills missed</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {a.error_tags.map((t) => (
              <span key={t} className="chip">
                {tagLabel(t)}
              </span>
            ))}
          </div>
        </div>
      )}
      {a.pending && <div className="w-full text-xs text-amber-700">Part of this response is not scored yet (needs AI evaluation, a transcript or a self-rating).</div>}
    </div>
  );
}

function CtwReview({ d }: { d: ReviewData }) {
  const items = d.attempt.result.items;
  const segs = d.ctw?.segments ?? [];
  const timed = items.filter((i) => i.elapsedMs);
  return (
    <div className="space-y-4">
      <div className="reading card p-6">
        {segs.map((s, k) => {
          if (s.type === "text") return <span key={k}>{s.text}</span>;
          const it = items[s.index]!;
          return it.correct ? (
            <span key={k} className="rounded bg-green-50 px-0.5 text-green-800">
              {s.full}
            </span>
          ) : (
            <span key={k} className="whitespace-nowrap">
              <span className="rounded bg-red-50 px-0.5 text-red-700 line-through decoration-red-300">{it.response || `${s.visible}…`}</span>{" "}
              <span className="rounded bg-green-50 px-0.5 font-semibold text-green-800">{s.full}</span>
            </span>
          );
        })}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-zinc-500">
            <th className="py-1">#</th>
            <th>Your word</th>
            <th>Correct</th>
            <th>Error type</th>
            <th className="text-right">Time</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-t border-zinc-100">
              <td className="py-1.5 text-zinc-400">{i + 1}</td>
              <td className={it.correct ? "text-green-700" : "text-red-700"}>{it.response}</td>
              <td>{it.expected}</td>
              <td className="text-zinc-600">{it.errorTag ? tagLabel(it.errorTag) : "—"}</td>
              <td className="text-right tabular-nums text-zinc-500">{it.elapsedMs ? `${(it.elapsedMs / 1000).toFixed(1)} s` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {timed.length > 0 && (
        <p className="text-xs text-zinc-500">
          Mean {(timed.reduce((a, i) => a + (i.elapsedMs ?? 0), 0) / timed.length / 1000).toFixed(1)} s per gap (focus time). Strategy target ≤ 13 s: grammar first, then meaning, then spelling.
        </p>
      )}
    </div>
  );
}

function transcriptOf(ex: Exercise): Array<{ speaker: string; text: string }> {
  return "audio" in ex ? (ex.audio as Array<{ speaker: string; text: string }>) : [];
}

function McqSetReview({ d }: { d: ReviewData }) {
  const ex = d.exercise as Extract<Exercise, { questions: Array<{ options: string[] }> }>;
  const answers = ((d.attempt.response as { answers?: (number | null)[] }) ?? {}).answers ?? [];
  const qs = ex.questions as Array<{ id: string; stem: string; options: string[]; answer_index: number; explanation: string; skill: string; highlight?: string }>;
  const tr = transcriptOf(ex);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        {ex.task_type === "read_academic_passage" && (
          <div className="card max-h-[60vh] overflow-y-auto p-5">
            <h3 className="mb-3 font-semibold">{ex.title}</h3>
            <Passage text={ex.passage} />
          </div>
        )}
        {ex.task_type === "read_in_daily_life" && (
          <div className="card p-5 text-[14.5px] leading-relaxed text-zinc-800">
            {ex.stimulus.title && <h3 className="mb-2 font-semibold">{ex.stimulus.title}</h3>}
            {ex.stimulus.body && <p className="whitespace-pre-line">{ex.stimulus.body}</p>}
            {ex.stimulus.messages?.map((m, i) => (
              <p key={i}>
                <b>{m.sender}:</b> {m.text}
              </p>
            ))}
            {ex.stimulus.table && (
              <table className="mt-2 w-full text-[13px]">
                <tbody>
                  {[ex.stimulus.table.columns, ...ex.stimulus.table.rows].map((r, i) => (
                    <tr key={i} className={i === 0 ? "font-semibold" : ""}>
                      {r.map((c, j) => (
                        <td key={j} className="border-b border-zinc-100 py-1 pr-2">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {ex.stimulus.footer && <p className="mt-2 italic">{ex.stimulus.footer}</p>}
          </div>
        )}
        {tr.length > 0 && (
          <div className="card p-5">
            <div className="label mb-2">Transcript</div>
            <div className="space-y-1.5 text-[14px] leading-relaxed text-zinc-800">
              {tr.map((s, i) => (
                <p key={i}>
                  {tr.length > 1 && <b className="text-zinc-500">{s.speaker}: </b>}
                  {s.text}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="space-y-6">
        {qs.map((q, i) => (
          <McqQuestion key={q.id} q={q} value={answers[i]} onChange={() => {}} number={i + 1} total={qs.length} review={{ answer: q.answer_index, explanation: q.explanation, skill: q.skill }} />
        ))}
      </div>
    </div>
  );
}

function ChoiceReview({ d }: { d: ReviewData }) {
  const ex = d.exercise as Extract<Exercise, { task_type: "listen_choose_response" }>;
  const a = ((d.attempt.response as { answer?: number | null }) ?? {}).answer ?? null;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="card p-4">
        <div className="label mb-1">You heard</div>
        <p className="text-[15px]">“{ex.audio[0]!.text}”</p>
      </div>
      <McqQuestion q={{ id: "q1", stem: "Best response", options: ex.options }} value={a} onChange={() => {}} review={{ answer: ex.answer_index, explanation: ex.explanation, skill: ex.skill }} />
    </div>
  );
}

function BuildReview({ d }: { d: ReviewData }) {
  const ex = d.exercise as Extract<Exercise, { task_type: "build_a_sentence" }>;
  const it = d.attempt.result.items[0]!;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="card space-y-3 p-5">
        <p className="text-sm text-zinc-500">A: {ex.context}</p>
        <div>
          <div className="label">Your sentence</div>
          <p className={`text-[16px] ${it.correct ? "text-green-700" : "text-red-700"}`}>{it.response}</p>
        </div>
        {!it.correct && (
          <div>
            <div className="label">Correct</div>
            <p className="text-[16px] text-green-800">{ex.full_response}</p>
          </div>
        )}
        {ex.distractors.length > 0 && <p className="text-xs text-zinc-500">Unused distractor: {ex.distractors.map((x) => `“${x}”`).join(", ")}</p>}
      </div>
      <Notice>
        <span className="chip mr-2">{tagLabel(ex.pattern)}</span>
        {ex.explanation}
      </Notice>
    </div>
  );
}

function Diff({ ops }: { ops: AlignOp[] }) {
  return (
    <p className="flex flex-wrap gap-x-1.5 gap-y-1 text-[15px]">
      {ops.map((o, i) =>
        o.op === "match" ? (
          <span key={i}>{o.ref}</span>
        ) : o.op === "sub" ? (
          <span key={i} title={`said “${o.hyp}”`}>
            <span className="text-red-600 line-through">{o.hyp}</span> <span className="rounded bg-amber-100 px-0.5">{o.ref}</span>
          </span>
        ) : o.op === "del" ? (
          <span key={i} className="rounded bg-red-100 px-0.5 text-red-800" title="missing">
            {o.ref}
          </span>
        ) : (
          <span key={i} className="text-zinc-400" title="extra word">
            +{o.hyp}
          </span>
        ),
      )}
    </p>
  );
}

function SelfRate({ items, onSubmit }: { items: string[]; onSubmit: (r: Record<string, number>) => Promise<void> }) {
  const [r, setR] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  return (
    <div className="card space-y-3 p-4">
      <div className="text-sm font-medium">Self-rating (no transcript available)</div>
      <p className="text-xs text-zinc-500">Listen to your recording, compare with the reference, and rate with the ETS descriptors: 5 exact; 4 minor changes, meaning intact; 3 essentials kept with inaccuracies; 2 fragmentary; 1 very little; 0 nothing usable. Self-ratings are labelled as such in your statistics.</p>
      {items.map((k) => (
        <div key={k} className="flex items-center gap-2 text-sm">
          <span className="w-20 text-zinc-500">{k}</span>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <button key={n} className={`h-7 w-7 rounded border text-xs ${r[k] === n ? "border-accent bg-accent text-white" : "border-zinc-300"}`} onClick={() => setR({ ...r, [k]: n })}>
              {n}
            </button>
          ))}
        </div>
      ))}
      <button
        className="btn btn-primary"
        disabled={busy || Object.keys(r).length === 0}
        onClick={async () => {
          setBusy(true);
          await onSubmit(r);
          setBusy(false);
        }}
      >
        Save self-rating
      </button>
    </div>
  );
}

function RepeatReview({ d, reload }: { d: ReviewData; reload: (r: ReviewData) => void }) {
  const ex = d.exercise as Extract<Exercise, { task_type: "listen_and_repeat" }>;
  const items = d.attempt.result.items;
  const recs = new Map(d.recordings.map((r) => [r.item_key, r]));
  const unscored = items.filter((i) => i.score == null).map((i) => i.key);
  return (
    <div className="space-y-3">
      <Notice>
        Scores are an internal rubric proxy from word alignment (WER, content/function-word recall, order). Pronunciation and prosody are <b>not</b> judged from text;
        intelligibility is only reported when the recognizer supplies an acoustic confidence.
      </Notice>
      {ex.items.map((ref, i) => {
        const it = items[i]!;
        const det = (it.detail ?? {}) as { metrics?: { wer: number; cer: number; ops: AlignOp[]; contentRecall: number; functionRecall: number }; proxy?: { rubric: number; intelligibility: number | null; notes: string[] }; source?: string; interrupted?: boolean };
        const rec = recs.get(it.key);
        return (
          <div key={ref.index} className="card space-y-2 p-4">
            <div className="flex items-center justify-between">
              <span className="label">
                Sentence {ref.index} · {ref.response_seconds} s
              </span>
              <span className="text-sm font-semibold tabular-nums">{it.score == null ? "unscored" : `${it.score}/5`}</span>
            </div>
            <p className="text-[15px] text-zinc-900">{ref.text}</p>
            {det.metrics ? (
              <>
                <Diff ops={det.metrics.ops} />
                <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
                  <span>WER {pct(det.metrics.wer)}</span>
                  <span>CER {pct(det.metrics.cer)}</span>
                  <span>content words {pct(det.metrics.contentRecall)}</span>
                  <span>function words {pct(det.metrics.functionRecall)}</span>
                  {det.proxy?.intelligibility != null && <span>ASR confidence {pct(det.proxy.intelligibility)}</span>}
                  <span>transcript: {det.source === "server_stt" ? "speech-to-text" : det.source === "browser" ? "browser recognition (approximate)" : det.source}</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-zinc-500">{det.source === "self_rating" ? "Self-rated." : det.interrupted ? "Interrupted (page reload) — not recorded." : rec?.stt_error ? `Transcription failed: ${rec.stt_error}` : "No transcript."}</p>
            )}
            {rec && <audio controls preload="none" src={`/api/recordings/${rec.id}/audio`} className="h-8 w-full" />}
          </div>
        );
      })}
      {unscored.length > 0 && (
        <SelfRate items={unscored} onSubmit={async (ratings) => reload(await api.post<ReviewData>(`/api/attempts/${d.attempt.id}/self-rate`, { ratings }))} />
      )}
    </div>
  );
}

function Criteria({ scores }: { scores: Record<string, number | null> }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
      {Object.entries(scores).map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-2 text-[13px]">
          <span className="text-zinc-600">{k.replace(/_/g, " ")}</span>
          <span className="font-semibold tabular-nums">{v == null ? "n/a" : `${v}/5`}</span>
        </div>
      ))}
    </div>
  );
}

function EvaluationCard({ ev, title }: { ev: ReviewData["evaluations"][number]; title?: string }) {
  if (ev.status !== "ok" || !ev.result)
    return (
      <Notice tone="warn">
        {title && <b>{title}: </b>}AI evaluation failed ({ev.status.replace(/_/g, " ")}): {ev.error}. No score was invented.
      </Notice>
    );
  const r = ev.result as {
    rubric_score_0_5: number;
    confidence_0_1: number;
    criterion_scores: Record<string, number | null>;
    missing_requirements?: string[];
    underdeveloped_claims?: string[];
    content_gaps?: string[];
    errors: Array<{ span: string; category: string; explanation: string; correction: string }>;
    highest_impact_fix: string;
    target_rewrite?: string;
    target_model_answer?: string;
    rewrite_notes?: string[];
    position_detected?: string;
  };
  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold">{title ?? "AI estimate"}</div>
        <div className="text-xs text-zinc-500">
          TOEFL-aligned estimator · {ev.model} · confidence {pct(r.confidence_0_1)} · not an ETS score
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-3xl font-semibold tabular-nums">{r.rubric_score_0_5}/5</div>
        <div className="text-xs text-zinc-500">task-level rubric (0–5), not a 1–6 section band</div>
      </div>
      <Criteria scores={r.criterion_scores} />
      <div className="rounded-md border border-accent/30 bg-accent-soft p-3 text-[14px] text-zinc-900">
        <div className="label mb-1 text-accent">Highest-impact fix</div>
        {r.highest_impact_fix}
      </div>
      {!!r.missing_requirements?.length && (
        <div>
          <div className="label mb-1 text-red-700">Missed requirements</div>
          <ul className="list-disc pl-5 text-[14px]">{r.missing_requirements.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      {!!r.underdeveloped_claims?.length && (
        <div>
          <div className="label mb-1">Underdeveloped claims</div>
          <ul className="list-disc pl-5 text-[14px]">{r.underdeveloped_claims.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      {!!r.content_gaps?.length && (
        <div>
          <div className="label mb-1">Content gaps</div>
          <ul className="list-disc pl-5 text-[14px]">{r.content_gaps.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      {r.errors.length > 0 && (
        <div>
          <div className="label mb-1">Language errors</div>
          <table className="w-full text-[13.5px]">
            <tbody>
              {r.errors.map((e, i) => (
                <tr key={i} className="border-t border-zinc-100 align-top">
                  <td className="py-1.5 pr-2 text-red-700 line-through decoration-red-300">{e.span}</td>
                  <td className="py-1.5 pr-2 font-medium text-green-800">{e.correction}</td>
                  <td className="py-1.5 pr-2">
                    <span className="chip">{tagLabel(e.category)}</span>
                  </td>
                  <td className="py-1.5 text-zinc-600">{e.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(r.target_rewrite || r.target_model_answer) && (
        <details className="rounded-md border border-zinc-200 p-3" open>
          <summary className="cursor-pointer text-sm font-medium">Improved model response (your target level)</summary>
          <p className="mt-2 whitespace-pre-line text-[14.5px] leading-relaxed text-zinc-800">{r.target_rewrite ?? r.target_model_answer}</p>
          {!!r.rewrite_notes?.length && <ul className="mt-2 list-disc pl-5 text-xs text-zinc-600">{r.rewrite_notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </details>
      )}
    </div>
  );
}

function useAutoEvaluate(d: ReviewData, reload: (r: ReviewData) => void) {
  const cfg = useConfig();
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);
  const run = async () => {
    setState("running");
    setMessage(null);
    try {
      const out = await api.post<{ status: string; message?: string; review: ReviewData }>(`/api/attempts/${d.attempt.id}/evaluate`);
      if (out.message) setMessage(out.message);
      reload(out.review);
    } catch (e) {
      setMessage((e as Error).message);
    }
    setState("done");
  };
  useEffect(() => {
    if (!cfg?.providers.llm.configured || started.current) return;
    if (d.evaluations.some((e) => e.status === "ok")) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);
  return { cfg, state, message, run };
}

function AiStatus({ ae, hasOk }: { ae: ReturnType<typeof useAutoEvaluate>; hasOk: boolean }) {
  if (!ae.cfg) return null;
  if (!ae.cfg.providers.llm.configured)
    return (
      <Notice tone="warn">
        AI evaluation is not configured, so no rubric score is shown. Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> and restart to enable it. Your response is saved and can be evaluated later from Progress → history.
      </Notice>
    );
  return (
    <div className="flex items-center gap-3">
      {ae.state === "running" ? (
        <Spinner label="Evaluating with the TOEFL-aligned rubric estimator…" />
      ) : (
        <button className="btn" onClick={ae.run}>
          {hasOk ? "Re-evaluate" : "Evaluate with AI"}
        </button>
      )}
      {ae.message && <span className="text-xs text-amber-700">{ae.message}</span>}
    </div>
  );
}

function WritingReview({ d, reload }: { d: ReviewData; reload: (r: ReviewData) => void }) {
  const ex = d.exercise as Extract<Exercise, { task_type: "write_an_email" | "academic_discussion" }>;
  const ae = useAutoEvaluate(d, reload);
  const text = ((d.attempt.response as { text?: string }) ?? {}).text ?? "";
  const latest = [...d.evaluations].reverse().find((e) => e.item_key === "response");
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="card p-5">
          <div className="label mb-2">Your response</div>
          <p className="whitespace-pre-line text-[14.5px] leading-relaxed">{text || <i className="text-zinc-400">(empty)</i>}</p>
        </div>
        {ex.task_type === "write_an_email" && (
          <div className="card p-5">
            <div className="label mb-1">Requirements</div>
            <ul className="list-disc pl-5 text-[14px]">{ex.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        )}
        <details className="card p-5">
          <summary className="cursor-pointer text-sm font-medium">{ex.exemplar_label}</summary>
          <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-zinc-700">{ex.exemplar}</p>
        </details>
      </div>
      <div className="space-y-4">
        <AiStatus ae={ae} hasOk={!!latest && latest.status === "ok"} />
        {latest && <EvaluationCard ev={latest} />}
      </div>
    </div>
  );
}

function InterviewReview({ d, reload }: { d: ReviewData; reload: (r: ReviewData) => void }) {
  const ex = d.exercise as Extract<Exercise, { task_type: "take_an_interview" }>;
  const ae = useAutoEvaluate(d, reload);
  const recs = new Map(d.recordings.map((r) => [r.item_key, r]));
  const items: ItemResult[] = d.attempt.result.items;
  const unscored = items.filter((i) => i.score == null && !recs.get(i.key)?.transcript).map((i) => i.key);
  return (
    <div className="space-y-4">
      <AiStatus ae={ae} hasOk={d.evaluations.some((e) => e.status === "ok")} />
      <Notice>Interview feedback is based on the transcript and response duration. Pronunciation and prosody cannot be judged from text and are marked n/a.</Notice>
      {ex.questions.map((q) => {
        const key = `q${q.index}`;
        const rec = recs.get(key);
        const ev = [...d.evaluations].reverse().find((e) => e.item_key === key);
        return (
          <div key={key} className="space-y-3">
            <div className="card space-y-2 p-4">
              <div className="label">
                Question {q.index} · {q.level.replace(/_/g, " ")}
              </div>
              <p className="text-[15px] font-medium">{q.prompt}</p>
              {rec ? (
                <>
                  <p className="text-[14px] text-zinc-700">
                    {rec.transcript ? `“${rec.transcript}”` : <i className="text-zinc-400">{rec.stt_error ? `Transcription failed: ${rec.stt_error}` : "No transcript"}</i>}
                  </p>
                  <audio controls preload="none" src={`/api/recordings/${rec.id}/audio`} className="h-8 w-full" />
                </>
              ) : (
                <p className="text-xs text-zinc-400">Not recorded.</p>
              )}
            </div>
            {ev && <EvaluationCard ev={ev} title={`Question ${q.index}`} />}
          </div>
        );
      })}
      {unscored.length > 0 && <SelfRate items={unscored} onSubmit={async (ratings) => reload(await api.post<ReviewData>(`/api/attempts/${d.attempt.id}/self-rate`, { ratings }))} />}
    </div>
  );
}

export function ReviewView({ data, onReload }: { data: ReviewData; onReload: (r: ReviewData) => void }) {
  const t = data.exercise.task_type;
  return (
    <div className="space-y-6">
      <ScoreHeader d={data} />
      {t === "complete_the_words" && <CtwReview d={data} />}
      {(t === "read_in_daily_life" || t === "read_academic_passage" || t === "conversation" || t === "announcement" || t === "academic_talk") && <McqSetReview d={data} />}
      {t === "listen_choose_response" && <ChoiceReview d={data} />}
      {t === "build_a_sentence" && <BuildReview d={data} />}
      {t === "listen_and_repeat" && <RepeatReview d={data} reload={onReload} />}
      {t === "take_an_interview" && <InterviewReview d={data} reload={onReload} />}
      {(t === "write_an_email" || t === "academic_discussion") && <WritingReview d={data} reload={onReload} />}
    </div>
  );
}
