/**
 * Word/character alignment for Listen and Repeat.
 * Normalisation: lowercase, strip punctuation, expand contractions consistently,
 * keep grammatical morphemes (-s, -ed, -ing), articles, prepositions, auxiliaries.
 */

const CONTRACTIONS: Record<string, string> = {
  "can't": "can not",
  cannot: "can not",
  "won't": "will not",
  "shan't": "shall not",
  "n't": " not",
  "'re": " are",
  "'ve": " have",
  "'ll": " will",
  "'d": " would",
  "'m": " am",
  "let's": "let us",
  "it's": "it is",
  "that's": "that is",
  "there's": "there is",
  "here's": "here is",
  "what's": "what is",
  "who's": "who is",
  "where's": "where is",
  "he's": "he is",
  "she's": "she is",
};

export const FUNCTION_WORDS = new Set(
  (
    "a an the this that these those my your his her its our their some any no every each " +
    "of in on at by for with from to into onto over under about after before during through between among " +
    "and or but so nor yet if because although though while whereas unless since than as " +
    "is are was were be been being am do does did done have has had will would shall should can could may might must " +
    "i you he she it we they me him us them who whom whose which what when where why how " +
    "not there here then also very too just only more most much many such both either neither all"
  ).split(" "),
);

const NUMBER_WORDS: Record<string, string> = {
  "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
  "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten", "11": "eleven", "12": "twelve",
  "15": "fifteen", "20": "twenty", "30": "thirty",
};

export function normalizeWords(text: string): string[] {
  let t = text.toLowerCase().replace(/[’‘]/g, "'");
  for (const [k, v] of Object.entries(CONTRACTIONS)) {
    if (k.startsWith("'") || k === "n't") t = t.split(k).join(v);
    else t = t.replace(new RegExp(`\\b${k.replace(/'/g, "'")}\\b`, "g"), v);
  }
  t = t.replace(/-/g, " ").replace(/[^a-z0-9'\s]/g, " ").replace(/'/g, "");
  return t
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUMBER_WORDS[w] ?? w);
}

export type AlignOp =
  | { op: "match"; ref: string; hyp: string }
  | { op: "sub"; ref: string; hyp: string }
  | { op: "del"; ref: string }
  | { op: "ins"; hyp: string };

export function alignWords(ref: string[], hyp: string[]): AlignOp[] {
  const n = ref.length;
  const m = hyp.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i]![0] = i;
  for (let j = 0; j <= m; j++) d[0]![j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  const ops: AlignOp[] = [];
  let i = n;
  let j = m;
  // Tie-break: match, then deletion/insertion, then substitution — keeps more words aligned
  // and exposes reorderings (a moved word = one deletion + one insertion).
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1] && d[i]![j] === d[i - 1]![j - 1]!) {
      ops.push({ op: "match", ref: ref[i - 1]!, hyp: hyp[j - 1]! });
      i--;
      j--;
    } else if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) {
      ops.push({ op: "del", ref: ref[i - 1]! });
      i--;
    } else if (j > 0 && d[i]![j] === d[i]![j - 1]! + 1) {
      ops.push({ op: "ins", hyp: hyp[j - 1]! });
      j--;
    } else {
      ops.push({ op: "sub", ref: ref[i - 1]!, hyp: hyp[j - 1]! });
      i--;
      j--;
    }
  }
  return ops.reverse();
}

export function levenshtein(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

export interface RepeatMetrics {
  refWords: string[];
  hypWords: string[];
  ops: AlignOp[];
  substitutions: number;
  deletions: number;
  insertions: number;
  wer: number;
  cer: number;
  contentRecall: number;
  functionRecall: number;
  orderScore: number;
  missingWords: string[];
  insertedWords: string[];
  substitutedPairs: Array<{ ref: string; hyp: string }>;
}

export function repeatMetrics(reference: string, hypothesis: string): RepeatMetrics {
  const refWords = normalizeWords(reference);
  const hypWords = normalizeWords(hypothesis);
  const ops = alignWords(refWords, hypWords);
  const substitutions = ops.filter((o) => o.op === "sub").length;
  const deletions = ops.filter((o) => o.op === "del").length;
  const insertions = ops.filter((o) => o.op === "ins").length;
  const wer = refWords.length === 0 ? 0 : (substitutions + deletions + insertions) / refWords.length;
  const refChars = refWords.join(" ");
  const cer = refChars.length === 0 ? 0 : levenshtein(refChars, hypWords.join(" ")) / refChars.length;

  const matched = ops.filter((o): o is Extract<AlignOp, { op: "match" }> => o.op === "match").map((o) => o.ref);
  const refContent = refWords.filter((w) => !FUNCTION_WORDS.has(w));
  const refFunction = refWords.filter((w) => FUNCTION_WORDS.has(w));
  const matchedContent = matched.filter((w) => !FUNCTION_WORDS.has(w)).length;
  const matchedFunction = matched.filter((w) => FUNCTION_WORDS.has(w)).length;
  const contentRecall = refContent.length ? matchedContent / refContent.length : 1;
  const functionRecall = refFunction.length ? matchedFunction / refFunction.length : 1;

  // Words that were said but not aligned in order (a deletion whose word appears as an insertion elsewhere).
  const deleted = ops.filter((o) => o.op === "del").map((o) => (o as { ref: string }).ref);
  const inserted = ops.filter((o) => o.op === "ins").map((o) => (o as { hyp: string }).hyp);
  const pool = [...inserted];
  let misplaced = 0;
  for (const w of deleted) {
    const k = pool.indexOf(w);
    if (k >= 0) {
      misplaced++;
      pool.splice(k, 1);
    }
  }
  const orderScore = refWords.length ? 1 - misplaced / refWords.length : 1;

  return {
    refWords,
    hypWords,
    ops,
    substitutions,
    deletions,
    insertions,
    wer,
    cer,
    contentRecall,
    functionRecall,
    orderScore,
    missingWords: deleted,
    insertedWords: inserted,
    substitutedPairs: ops.filter((o): o is Extract<AlignOp, { op: "sub" }> => o.op === "sub").map((o) => ({ ref: o.ref, hyp: o.hyp })),
  };
}

export interface RepeatProxyConfig {
  score_5_max_wer: number;
  score_4_max_wer: number;
  score_3_min_content_recall: number;
  score_2_min_content_recall: number;
  score_1_min_recall: number;
  weights: { wer: number; content_recall: number; function_recall: number; order: number; intelligibility: number };
}

export interface RepeatProxy {
  rubric: number; // 0–5 internal proxy
  accuracy: number; // 0–1 weighted accuracy
  intelligibility: number | null;
  notes: string[];
}

/**
 * Internal rubric proxy. Thresholds are app parameters (PRD), not ETS values.
 * `intelligibility` is an ASR-confidence proxy (0–1) or null when no audio evidence exists.
 */
export function repeatRubricProxy(m: RepeatMetrics, intelligibility: number | null, cfg: RepeatProxyConfig): RepeatProxy {
  const notes: string[] = [];
  const w = cfg.weights;
  const parts: Array<[number, number]> = [
    [w.wer, Math.max(0, 1 - m.wer)],
    [w.content_recall, m.contentRecall],
    [w.function_recall, m.functionRecall],
    [w.order, m.orderScore],
  ];
  if (intelligibility != null) parts.push([w.intelligibility, intelligibility]);
  else notes.push("Intelligibility not assessed: no acoustic confidence available for this recording.");
  const wsum = parts.reduce((a, [wt]) => a + wt, 0);
  const accuracy = parts.reduce((a, [wt, v]) => a + wt * v, 0) / wsum;

  const anyMatch = m.ops.some((o) => o.op === "match");
  const hypRatio = m.refWords.length ? m.hypWords.length / m.refWords.length : 0;
  let rubric = 0;
  if (m.hypWords.length === 0 || !anyMatch) rubric = 0;
  else if (m.wer <= cfg.score_5_max_wer && (intelligibility == null || intelligibility >= 0.9)) rubric = 5;
  else if (m.wer <= cfg.score_4_max_wer && m.contentRecall >= 0.85) rubric = 4;
  else if (m.contentRecall >= cfg.score_3_min_content_recall && hypRatio >= 0.6) rubric = 3;
  else if (m.contentRecall >= cfg.score_2_min_content_recall) rubric = 2;
  else rubric = 1;
  if (rubric === 5 && intelligibility == null) notes.push("Score 5 is based on word accuracy only.");
  return { rubric, accuracy, intelligibility, notes };
}
