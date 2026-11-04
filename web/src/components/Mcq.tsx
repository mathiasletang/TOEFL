import { useEffect } from "react";
import type { PublicMcq } from "../../../shared/publicView";

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
      <legend className="mb-1 text-[15px] font-medium leading-snug text-zinc-900">
        {number != null && <span className="mr-2 text-zinc-400">{number}{total ? `/${total}` : ""}</span>}
        {q.stem}
      </legend>
      <div className="space-y-2" role="radiogroup">
        {q.options.map((o, i) => {
          const chosen = value === i;
          const isAnswer = review?.answer === i;
          const cls = review
            ? isAnswer
              ? "border-green-600 bg-green-50"
              : chosen
                ? "border-red-500 bg-red-50"
                : "border-zinc-200"
            : chosen
              ? "border-accent bg-accent-soft"
              : "border-zinc-200 hover:border-zinc-400";
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => !review && onChange(i)}
              className={`flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left text-[14.5px] leading-snug transition-colors ${cls}`}
            >
              <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${chosen ? "border-accent bg-accent text-white" : "border-zinc-300 text-zinc-500"}`}>
                {"ABCD"[i]}
              </span>
              <span>{o}</span>
            </button>
          );
        })}
      </div>
      {review?.explanation && (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-[13px] leading-relaxed text-zinc-700">
          {review.skill && <span className="chip mr-2">{review.skill.replace(/_/g, " ")}</span>}
          {review.explanation}
        </p>
      )}
    </fieldset>
  );
}
