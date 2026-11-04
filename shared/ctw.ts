/**
 * Complete the Words — deterministic gap derivation.
 *
 * Rules (ETS 2026 task description + published examples, see docs/PRD_AUDIT.md):
 *  - The first sentence stays intact.
 *  - Starting with the SECOND word of the second sentence, every other word is
 *    truncated (word 2, 4, 6 … counted continuously across sentence boundaries)
 *    until 10 words are truncated. The rest of the paragraph stays intact.
 *  - A truncated word keeps floor(n/2) visible letters; ceil(n/2) letters are missing.
 *  - Exact spelling is required; matching is case-insensitive.
 */

export const CTW_GAP_COUNT = 10;

export interface CtwTextSegment {
  type: "text";
  text: string;
}
export interface CtwGapSegment {
  type: "gap";
  index: number; // 0-based gap index
  full: string;
  visible: string;
  missing: string;
}
export type CtwSegment = CtwTextSegment | CtwGapSegment;

export interface CtwDerivation {
  segments: CtwSegment[];
  gaps: CtwGapSegment[];
  firstSentence: string;
  wordCount: number;
  problems: string[];
}

const WORD_RE = /[A-Za-z0-9][A-Za-z0-9'’\-]*/g;

export function countWords(text: string): number {
  return (text.match(WORD_RE) ?? []).length;
}

/** End index (exclusive) of the first sentence, or -1. */
export function firstSentenceEnd(text: string): number {
  const m = /[.!?](?=\s+["“]?[A-Z])/.exec(text);
  return m ? m.index + 1 : -1;
}

export function splitWord(word: string): { visible: string; missing: string } {
  const v = Math.floor(word.length / 2);
  return { visible: word.slice(0, v), missing: word.slice(v) };
}

export function deriveCtw(passage: string): CtwDerivation {
  const problems: string[] = [];
  const text = passage.replace(/\s+/g, " ").trim();
  const end = firstSentenceEnd(text);
  if (end < 0) problems.push("Could not detect the end of the first sentence.");
  const cut = end < 0 ? 0 : end;

  const segments: CtwSegment[] = [];
  const gaps: CtwGapSegment[] = [];
  let cursor = 0;
  let wordPos = 0; // position of the word among words after the first sentence
  WORD_RE.lastIndex = cut;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text)) && gaps.length < CTW_GAP_COUNT) {
    const isTarget = wordPos % 2 === 1;
    wordPos++;
    if (!isTarget) continue;
    const word = m[0];
    if (!/^[A-Za-z]+$/.test(word)) {
      problems.push(`Gap ${gaps.length + 1} targets "${word}", which contains non-letter characters.`);
    }
    if (word.length < 2) {
      problems.push(`Gap ${gaps.length + 1} targets the one-letter word "${word}" (nothing would stay visible).`);
    }
    if (m.index > cursor) segments.push({ type: "text", text: text.slice(cursor, m.index) });
    const { visible, missing } = splitWord(word);
    const gap: CtwGapSegment = { type: "gap", index: gaps.length, full: word, visible, missing };
    segments.push(gap);
    gaps.push(gap);
    cursor = m.index + word.length;
  }
  if (cursor < text.length) segments.push({ type: "text", text: text.slice(cursor) });
  if (gaps.length !== CTW_GAP_COUNT) problems.push(`Only ${gaps.length} gaps could be derived (need ${CTW_GAP_COUNT}).`);

  const wordCount = countWords(text);
  return { segments, gaps, firstSentence: text.slice(0, cut), wordCount, problems };
}

export function isCtwGapCorrect(gap: Pick<CtwGapSegment, "visible" | "full">, typed: string): boolean {
  return (gap.visible + typed.trim()).toLowerCase() === gap.full.toLowerCase();
}

/** Render with underscores (one per missing letter) — used for audits and text export. */
export function renderCtwDisplay(d: CtwDerivation): string {
  return d.segments.map((s) => (s.type === "text" ? s.text : s.visible + "_".repeat(s.missing.length))).join("");
}
