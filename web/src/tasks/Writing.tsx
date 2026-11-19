import type { TaskProps } from "./types";
import { countWords } from "../../../shared/ctw";

export type TextValue = { text: string };

function Editor({ value, onChange, locked, minWords, rows }: { value: string; onChange: (s: string) => void; locked?: boolean; minWords?: number; rows: number }) {
  const wc = countWords(value);
  return (
    <div>
      <textarea
        className="block w-full resize-y rounded-btn border border-ring bg-bg p-4 text-[15px] leading-relaxed text-text focus:border-accent focus:outline-none"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={locked}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        data-gramm="false"
        aria-label="Your response"
      />
      <div className="mt-1 flex justify-between text-xs text-dim">
        <span>Spell-check and autocorrect are off, as in the test.</span>
        <span className={minWords && wc < minWords ? "text-text" : ""}>
          {wc} words{minWords ? ` · ETS: an effective response has ≥ ${minWords}` : ""}
        </span>
      </div>
    </div>
  );
}

export function WriteEmail({ ex, value, onChange, ctx }: TaskProps<"write_an_email", TextValue>) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      <div className="space-y-4">
        <div className="card p-6">
          <div className="label mb-1">Situation</div>
          <p className="text-[15px] leading-relaxed text-text">{ex.scenario}</p>
        </div>
        <div className="card p-6">
          <div className="label mb-2">In your email, do the following</div>
          <ul className="list-disc space-y-1.5 pl-5 text-[14.5px] text-text">
            {ex.requirements.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-dim">Write as much as you can, in complete sentences.</p>
        </div>
      </div>
      <div className="card p-5">
        <div className="mb-3 space-y-1 border-b border-line pb-3 text-[13.5px]">
          <div>
            <span className="inline-block w-16 text-dim">To</span>
            {ex.recipient_name} <span className="text-dim">— {ex.recipient_role}</span>
          </div>
          <div>
            <span className="inline-block w-16 text-dim">Subject</span>
            {ex.subject}
          </div>
        </div>
        <Editor value={value?.text ?? ""} onChange={(text) => onChange({ text })} locked={ctx.locked} rows={14} />
      </div>
    </div>
  );
}

export function AcademicDiscussion({ ex, value, onChange, ctx }: TaskProps<"academic_discussion", TextValue>) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-3">
        <div className="card p-6">
          <div className="label mb-1">{ex.course}</div>
          <div className="mb-1 text-sm font-semibold text-text">{ex.professor.name}</div>
          <p className="text-[14.5px] leading-relaxed text-text">{ex.professor.prompt}</p>
        </div>
        {ex.students.map((s) => (
          <div key={s.name} className="card ml-6 p-4">
            <div className="mb-1 text-sm font-semibold text-muted">{s.name}</div>
            <p className="text-[14px] leading-relaxed text-muted">{s.text}</p>
          </div>
        ))}
        <p className="text-xs text-dim">Express and support your opinion and make a contribution to the discussion.</p>
      </div>
      <div className="card p-5">
        <Editor value={value?.text ?? ""} onChange={(text) => onChange({ text })} locked={ctx.locked} minWords={100} rows={16} />
      </div>
    </div>
  );
}
