import { useState, type ReactNode } from "react";
import { McqQuestion } from "../components/Mcq";
import type { TaskProps, PublicOf } from "./types";
import { IconArrowLeft, IconArrowRight } from "../components/icons";

export type McqValue = { answers: (number | null)[]; questionMs?: number[]; _q?: number };

function useQuestionNav(n: number, value: McqValue | undefined, onChange: (v: McqValue) => void) {
  const v: McqValue = value ?? { answers: Array(n).fill(null), questionMs: Array(n).fill(0), _q: 0 };
  const [enteredAt, setEnteredAt] = useState(() => performance.now());
  const q = v._q ?? 0;
  const go = (next: number) => {
    const questionMs = [...(v.questionMs ?? Array(n).fill(0))];
    questionMs[q] = (questionMs[q] ?? 0) + (performance.now() - enteredAt);
    setEnteredAt(performance.now());
    onChange({ ...v, questionMs, _q: next });
  };
  const answer = (i: number) => {
    const answers = [...v.answers];
    answers[q] = i;
    onChange({ ...v, answers });
  };
  return { v, q, go, answer };
}

function QuestionTabs({ n, q, answers, go, locked }: { n: number; q: number; answers: (number | null)[]; go: (i: number) => void; locked?: boolean }) {
  return (
    <div className="mb-4 flex gap-1.5" role="tablist" aria-label="Questions">
      {Array.from({ length: n }, (_, i) => (
        <button
          key={i}
          role="tab"
          aria-selected={i === q}
          disabled={locked}
          onClick={() => go(i)}
          className={`h-11 min-w-11 rounded-full border px-2 text-xs font-extrabold ${i === q ? "border-accent bg-accent text-on-accent" : answers[i] != null ? "border-ring bg-pill text-muted" : "border-line text-dim"}`}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}

function DailyStimulus({ s }: { s: PublicOf<"read_in_daily_life">["stimulus"] }) {
  const header: ReactNode = s.meta.length ? (
    <div className="mb-3 space-y-0.5 border-b border-line pb-3 text-[13px]">
      {s.meta.map((m) => (
        <div key={m.label}>
          <span className="inline-block w-16 text-dim">{m.label}</span>
          <span className="text-text">{m.value}</span>
        </div>
      ))}
    </div>
  ) : null;
  return (
    <div className={`card p-6 ${s.format === "notice" || s.format === "advertisement" ? "border-dashed border-ring bg-bg" : ""}`}>
      <div className="label mb-2">{s.format.replace(/_/g, " ")}</div>
      {s.title && <h3 className="mb-3 text-[15px] font-semibold text-text">{s.title}</h3>}
      {header}
      {s.body && <div className="whitespace-pre-line text-[15px] leading-relaxed text-text">{s.body}</div>}
      {s.messages && (
        <div className="space-y-2">
          {s.messages.map((m, i) => (
            <div key={i} className="rounded-tile bg-pill px-3 py-2">
              <div className="mb-0.5 text-[11px] text-dim">
                <b className="text-muted">{m.sender}</b> {m.time && <span>· {m.time}</span>}
              </div>
              <div className="text-[14.5px] text-text">{m.text}</div>
            </div>
          ))}
        </div>
      )}
      {s.table && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr>
                {s.table.columns.map((c) => (
                  <th key={c} className="border-b border-ring px-2 py-1.5 text-left font-semibold text-muted">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="border-b border-line px-2 py-1.5 text-text">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {s.footer && <p className="mt-3 text-[13px] italic text-muted">{s.footer}</p>}
    </div>
  );
}

export function ReadInDailyLife({ ex, value, onChange, ctx }: TaskProps<"read_in_daily_life", McqValue>) {
  const { v, q, go, answer } = useQuestionNav(ex.questions.length, value, onChange);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <DailyStimulus s={ex.stimulus} />
      <div>
        <QuestionTabs n={ex.questions.length} q={q} answers={v.answers} go={go} locked={ctx.locked} />
        <McqQuestion q={ex.questions[q]!} value={v.answers[q]} onChange={answer} disabled={ctx.locked} number={q + 1} total={ex.questions.length} />
        <div className="mt-4 flex justify-between">
          <button className="btn" disabled={q === 0 || ctx.locked} onClick={() => go(q - 1)}>
            <IconArrowLeft size={16} /> Previous
          </button>
          <button className="btn" disabled={q === ex.questions.length - 1 || ctx.locked} onClick={() => go(q + 1)}>
            Next <IconArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Passage({ text, highlight }: { text: string; highlight?: string }) {
  const paras = text.split(/\n\s*\n/);
  return (
    <div className="reading space-y-4">
      {paras.map((p, i) => {
        if (!highlight) return <p key={i}>{p}</p>;
        const idx = p.toLowerCase().indexOf(highlight.toLowerCase());
        if (idx < 0) return <p key={i}>{p}</p>;
        return (
          <p key={i}>
            {p.slice(0, idx)}
            <mark className="hl">{p.slice(idx, idx + highlight.length)}</mark>
            {p.slice(idx + highlight.length)}
          </p>
        );
      })}
    </div>
  );
}

export function ReadAcademicPassage({ ex, value, onChange, ctx }: TaskProps<"read_academic_passage", McqValue>) {
  const { v, q, go, answer } = useQuestionNav(ex.questions.length, value, onChange);
  const cur = ex.questions[q]!;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
      <div className="card max-h-[70vh] overflow-y-auto p-6">
        <div className="label mb-1">{ex.discipline}</div>
        <h3 className="mb-4 text-lg font-semibold">{ex.title}</h3>
        <Passage text={ex.passage} highlight={cur.highlight} />
      </div>
      <div>
        <QuestionTabs n={ex.questions.length} q={q} answers={v.answers} go={go} locked={ctx.locked} />
        <McqQuestion q={cur} value={v.answers[q]} onChange={answer} disabled={ctx.locked} number={q + 1} total={ex.questions.length} />
        <div className="mt-4 flex justify-between">
          <button className="btn" disabled={q === 0 || ctx.locked} onClick={() => go(q - 1)}>
            <IconArrowLeft size={16} /> Previous
          </button>
          <button className="btn" disabled={q === ex.questions.length - 1 || ctx.locked} onClick={() => go(q + 1)}>
            Next <IconArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
