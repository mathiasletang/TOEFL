import { useEffect } from "react";
import type { PublicMcq } from "../../../shared/publicView";
import { IconCheck, IconX } from "./icons";

/** One multiple-choice question; keys 1–4 / A–D select an option. */
export function McqQuestion({
  q,
  value,
  onChange,
  disabled,
  number,
  total,
  review,
}: {
  q: PublicMcq;
  value: number | null | undefined;
  onChange: (i: number) => void;
  disabled?: boolean;
  number?: number;
  total?: number;
  review?: { answer: number; explanation?: string; skill?: string };
}) {
  useEffect(() => {
    if (disabled || review) return;
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      const idx = ["1", "2", "3", "4"].indexOf(k) >= 0 ? Number(k) - 1 : ["a", "b", "c", "d"].indexOf(k);
      if (idx >= 0 && idx < q.options.length) {
        e.preventDefault();
        onChange(idx);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [q, onChange, disabled, review]);

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="mb-1 text-[15px] font-bold leading-snug text-text">
        {number != null && <span className="mr-2 text-dim">{number}{total ? `/${total}` : ""}</span>}
        {q.stem}
      </legend>
      <div className="space-y-2" role="radiogroup">
        {q.options.map((o, i) => {
          const chosen = value === i;
          const isAnswer = review?.answer === i;
          const cls = review
            ? isAnswer
              ? "border-ok bg-ok-soft"
              : chosen
                ? "border-bad bg-bad-soft"
                : "border-line bg-bg"
            : chosen
              ? "border-accent bg-pill ring-1 ring-accent"
              : "border-line bg-bg hover:border-ring hover:bg-pill";
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => !review && onChange(i)}
              className={`flex min-h-11 w-full items-start gap-3 rounded-btn border px-4 py-3 text-left text-[14.5px] leading-snug text-text transition-colors ${cls}`}
            >
              <span className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-extrabold ${chosen ? "border-accent bg-accent text-on-accent" : "border-ring text-dim"}`}>
                {"ABCD"[i]}
              </span>
              <span className="min-w-0 flex-1">{o}</span>
              {review && isAnswer && (
                <span className="flex items-center gap-1 text-[12px] font-extrabold text-ok">
                  <IconCheck size={16} /> Correct answer
                </span>
              )}
              {review && chosen && !isAnswer && (
                <span className="flex items-center gap-1 text-[12px] font-extrabold text-bad">
                  <IconX size={16} /> Your answer
                </span>
              )}
            </button>
          );
        })}
      </div>
      {review?.explanation && (
        <p className="rounded-tile bg-pill px-4 py-3 text-[13px] leading-relaxed text-muted">
          {review.skill && <span className="chip mr-2">{review.skill.replace(/_/g, " ")}</span>}
          {review.explanation}
        </p>
      )}
    </fieldset>
  );
}
