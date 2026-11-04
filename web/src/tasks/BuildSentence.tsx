import { useState } from "react";
import type { TaskProps } from "./types";

export type BuildValue = { order: (string | null)[] };

/** Click a chunk to place it in the next empty slot; click a placed chunk to remove it; drag to reorder. */
export function BuildSentence({ ex, value, onChange, ctx }: TaskProps<"build_a_sentence", BuildValue>) {
  const slots = ex.frame.filter((f) => f === null).length;
  const order = value?.order ?? Array(slots).fill(null);
  const [drag, setDrag] = useState<{ from: "bank" | "slot"; chunk: string; slot?: number } | null>(null);
  const used = new Set(order.filter(Boolean) as string[]);
  const bank = ex.chunks.filter((c) => !used.has(c));

  const place = (chunk: string, at?: number) => {
    if (ctx.locked) return;
    const next = order.map((c) => (c === chunk ? null : c));
    const target = at ?? next.findIndex((c) => c == null);
    if (target < 0) return;
    const displaced = next[target];
    next[target] = chunk;
    if (displaced && drag?.from === "slot" && drag.slot != null) next[drag.slot] = displaced;
    onChange({ order: next });
  };
  const remove = (i: number) => {
    if (ctx.locked) return;
    const next = [...order];
    next[i] = null;
    onChange({ order: next });
  };

  let k = 0;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <p className="text-sm text-zinc-500">Make an appropriate sentence. Click the words in order (or drag them into the boxes). Click a placed word to remove it.{ex.chunks.length > slots ? " One word or phrase will not be used." : ""}</p>
      <div className="card space-y-5 p-6">
        <div className="flex gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-600">A</span>
          <p className="rounded-lg bg-zinc-100 px-3 py-2 text-[15px] text-zinc-800">{ex.context}</p>
        </div>
        <div className="flex gap-3">
          <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">B</span>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[15px]">
            {ex.frame.map((f, fi) => {
              if (f !== null) return <span key={fi} className="text-zinc-800">{f}</span>;
              const i = k++;
              const c = order[i];
              return (
                <button
                  key={fi}
                  aria-label={c ? `Slot ${i + 1}: ${c} (click to remove)` : `Empty slot ${i + 1}`}
                  onClick={() => c && remove(i)}
                  draggable={!!c && !ctx.locked}
                  onDragStart={() => c && setDrag({ from: "slot", chunk: c, slot: i })}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (drag) place(drag.chunk, i);
                    setDrag(null);
                  }}
                  className={`min-h-9 min-w-16 rounded-md border px-2.5 py-1 ${c ? "border-zinc-400 bg-white font-medium text-zinc-900 shadow-sm" : "border-dashed border-zinc-300 bg-zinc-50 text-zinc-300"}`}
                >
                  {c ?? " "}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div
        className="flex min-h-14 flex-wrap justify-center gap-2 rounded-lg border border-zinc-200 bg-white p-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => {
          if (drag?.from === "slot" && drag.slot != null) remove(drag.slot);
          setDrag(null);
        }}
        aria-label="Available words"
      >
        {bank.length === 0 && <span className="self-center text-xs text-zinc-400">All words placed</span>}
        {bank.map((c) => (
          <button
            key={c}
            draggable={!ctx.locked}
            onDragStart={() => setDrag({ from: "bank", chunk: c })}
            onClick={() => place(c)}
            disabled={ctx.locked}
            className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-[15px] font-medium text-zinc-800 hover:border-accent hover:bg-accent-soft"
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <button className="btn btn-ghost text-xs" disabled={ctx.locked} onClick={() => onChange({ order: Array(slots).fill(null) })}>
          Clear
        </button>
      </div>
    </div>
  );
}
