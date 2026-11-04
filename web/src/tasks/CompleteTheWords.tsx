import { useEffect, useRef } from "react";
import type { TaskProps } from "./types";

export type CtwValue = { gaps: string[]; gapMs: number[] };

export function CompleteTheWords({ ex, value, onChange, ctx }: TaskProps<"complete_the_words", CtwValue>) {
  const gapCount = ex.segments.filter((s) => s.type === "gap").length;
  const v: CtwValue = value ?? { gaps: Array(gapCount).fill(""), gapMs: Array(gapCount).fill(0) };
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const focusAt = useRef<{ i: number; t: number } | null>(null);
  const latest = useRef(v);
  latest.current = v;

  useEffect(() => {
    if (!ctx.locked) refs.current[v.gaps.findIndex((g) => !g) >= 0 ? v.gaps.findIndex((g) => !g) : 0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every update goes through `latest` synchronously: focus changes (auto-advance) fire blur
  // handlers before React re-renders, and must not overwrite the letters just typed.
  const emit = (next: CtwValue) => {
    latest.current = next;
    onChange(next);
  };

  const flushTime = () => {
    const f = focusAt.current;
    if (!f) return;
    const gapMs = [...latest.current.gapMs];
    gapMs[f.i] = (gapMs[f.i] ?? 0) + (performance.now() - f.t);
    focusAt.current = null;
    emit({ ...latest.current, gapMs });
  };

  const set = (i: number, text: string, max: number) => {
    const clean = text.replace(/[^A-Za-z]/g, "").slice(0, max);
    const gaps = [...latest.current.gaps];
    gaps[i] = clean;
    emit({ ...latest.current, gaps });
    if (clean.length === max && i < gapCount - 1) refs.current[i + 1]?.focus();
  };

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-500">Fill in the missing letters in the paragraph. {ctx.strict ? "" : "Typing the last letter moves to the next word."}</p>
      <div className="reading card p-6">
        {ex.segments.map((s, k) =>
          s.type === "text" ? (
            <span key={k}>{s.text}</span>
          ) : (
            <span key={k} className="whitespace-nowrap">
              {s.visible}
              <input
                ref={(el) => {
                  refs.current[s.index] = el;
                }}
                aria-label={`Gap ${s.index + 1}: ${s.visible}… (${s.missingLength} letters)`}
                className="ctw-input"
                style={{ width: `${s.missingLength * 1.02 + 0.6}em` }}
                value={v.gaps[s.index] ?? ""}
                maxLength={s.missingLength}
                disabled={ctx.locked}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onFocus={() => (focusAt.current = { i: s.index, t: performance.now() })}
                onBlur={flushTime}
                onChange={(e) => set(s.index, e.target.value, s.missingLength)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !(v.gaps[s.index] ?? "") && s.index > 0) {
                    e.preventDefault();
                    refs.current[s.index - 1]?.focus();
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    refs.current[s.index + 1]?.focus();
                  }
                }}
              />
            </span>
          ),
        )}
      </div>
      <p className="mt-2 text-xs text-zinc-400">
        {v.gaps.filter(Boolean).length}/{gapCount} words attempted · each box shows exactly how many letters are missing
      </p>
    </div>
  );
}
