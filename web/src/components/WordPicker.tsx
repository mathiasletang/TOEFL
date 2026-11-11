import { useState, type MouseEvent, type ReactNode } from "react";
import { api } from "../lib/api";

interface Picked {
  word: string;
  sentence: string | null;
  x: number;
  y: number;
}

/** Word under the pointer and the sentence around it, read from the rendered text. */
function wordAt(e: MouseEvent): { word: string; sentence: string | null } | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const pos = doc.caretPositionFromPoint?.(e.clientX, e.clientY);
  if (pos) {
    node = pos.offsetNode;
    offset = pos.offset;
  } else {
    const range = doc.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? "";
  const isLetter = (c: string | undefined) => !!c && /[A-Za-z'’\-]/.test(c);
  let a = offset;
  let b = offset;
  while (a > 0 && isLetter(text[a - 1])) a--;
  while (b < text.length && isLetter(text[b])) b++;
  const word = text.slice(a, b).replace(/^['’\-]+|['’\-]+$/g, "");
  if (word.length < 2 || !/[A-Za-z]{2}/.test(word)) return null;
  const block = (node.parentElement?.closest("p, li, td, blockquote, h1, h2, h3, [data-sentence-scope]") ?? node.parentElement)?.textContent ?? text;
  const sentences = block.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["”']?|[^.!?]+$/g) ?? [block];
  const re = new RegExp(`(^|[^A-Za-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`);
  const sentence = sentences.find((s) => re.test(s))?.trim() ?? null;
  return { word, sentence: sentence && sentence.length <= 400 ? sentence : null };
}

/** Wraps a correction screen: when enabled, clicking a word offers to add it to the vocabulary deck. */
export function WordPicker({ user, exerciseId, enabled, children }: { user: string; exerciseId: string; enabled: boolean; children: ReactNode }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const onClick = (e: MouseEvent) => {
    if (!enabled) return;
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select, audio, [data-word-popup]")) return;
    const w = wordAt(e);
    setMessage(null);
    setPicked(w ? { ...w, x: e.clientX, y: e.clientY } : null);
  };
  const add = async () => {
    if (!picked) return;
    try {
      const r = await api.post<{ created: boolean; matched: "bank" | "personal"; headword: string }>(`/api/users/${user}/vocab/cards`, { word: picked.word, sentence: picked.sentence, exerciseId });
      setMessage(!r.created ? `“${r.headword}” is already in your deck.` : r.matched === "bank" ? `Added “${r.headword}” (bank entry).` : `Added “${r.headword}” as a personal card with its sentence.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not add the word.");
    }
  };
  return (
    <div onClick={onClick} className={enabled ? "cursor-pointer" : undefined}>
      {children}
      {enabled && picked && (
        <div
          data-word-popup
          className="fixed z-30 w-72 cursor-default rounded-lg border border-zinc-300 bg-white p-3 text-[13px] shadow-lg"
          style={{ left: Math.max(8, Math.min(picked.x - 20, window.innerWidth - 300)), top: Math.min(picked.y + 14, window.innerHeight - 150) }}
        >
          {message ? (
            <div className="flex items-start justify-between gap-2">
              <span>{message}</span>
              <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setPicked(null)}>
                Close
              </button>
            </div>
          ) : (
            <>
              <div className="font-semibold">{picked.word}</div>
              {picked.sentence && <div className="mt-1 line-clamp-3 text-xs text-zinc-500">{picked.sentence}</div>}
              <div className="mt-2 flex gap-2">
                <button className="btn btn-primary py-1 text-xs" onClick={add}>
                  Add to my vocabulary
                </button>
                <button className="btn btn-ghost py-1 text-xs" onClick={() => setPicked(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
