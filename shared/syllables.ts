/** Heuristic English syllable counter (good enough to check length progression). */
export function countSyllablesWord(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function countSyllables(text: string): number {
  return text
    .split(/[\s\-]+/)
    .filter(Boolean)
    .reduce((a, w) => a + countSyllablesWord(w), 0);
}
