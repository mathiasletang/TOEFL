/**
 * Vocabulary practice engine: SM-2-style scheduling, exercise-format rotation
 * and question building/checking. Pure functions — no database, no clock.
 * All parameters are internal training values (config → internal.vocabulary.srs).
 */
import { classifyCtwError } from "./errors";
import { inflectionsOf, type VocabEntry } from "./vocab";

export interface SrsParams {
  initial_ease: number;
  minimum_ease: number;
  first_interval_days: number;
  second_interval_days: number;
  relearn_minutes: number;
  mature_interval_days: number;
  fast_answer_ms: { choice: number; typed: number };
  production_share_min: number;
}

export interface CardState {
  reps: number; // consecutive successful reviews
  lapses: number;
  ease: number;
  interval_days: number;
  review_count: number;
  recognition_passed: boolean;
  /** Reviews done after recognition was passed, and how many of them were production formats. */
  practice_count: number;
  production_count: number;
}

export type CardStatus = "new" | "learning" | "mature";

export const FORMATS = ["study", "meaning_choice", "recall_typed", "cloze_typed", "collocation_choice", "word_formation", "paraphrase_choice", "false_friend_choice", "dictation"] as const;
export type Format = (typeof FORMATS)[number];
export const PRODUCTION_FORMATS: Format[] = ["recall_typed", "cloze_typed", "word_formation", "dictation"];
export const RECOGNITION_FORMATS: Format[] = ["collocation_choice", "paraphrase_choice", "false_friend_choice"];
export const isProduction = (f: Format) => PRODUCTION_FORMATS.includes(f);

export const FORMAT_LABEL: Record<Format, string> = {
  study: "New personal word",
  meaning_choice: "Meaning",
  recall_typed: "Recall",
  cloze_typed: "Gap fill",
  collocation_choice: "Collocation",
  word_formation: "Word formation",
  paraphrase_choice: "Paraphrase",
  false_friend_choice: "False friend",
  dictation: "Dictation",
};

export function cardStatus(c: Pick<CardState, "review_count" | "interval_days">, P: Pick<SrsParams, "mature_interval_days">): CardStatus {
  if (c.review_count === 0) return "new";
  return c.interval_days >= P.mature_interval_days ? "mature" : "learning";
}

/** Answer quality on the SM-2 0–5 scale. Below 3 is a lapse. */
export function qualityFor(a: { correct: boolean; nearMiss: boolean; elapsedMs: number; typed: boolean }, P: Pick<SrsParams, "fast_answer_ms">): number {
  if (!a.correct) return a.nearMiss ? 2 : 1;
  return a.elapsedMs <= (a.typed ? P.fast_answer_ms.typed : P.fast_answer_ms.choice) ? 5 : 4;
}

export interface Scheduled {
  reps: number;
  lapses: number;
  ease: number;
  interval_days: number;
  due_at: string;
}

/** SM-2: a lapse resets the repetitions and brings the card back after a short relearning delay. */
export function schedule(c: Pick<CardState, "reps" | "lapses" | "ease" | "interval_days" | "review_count">, quality: number, now: Date, P: SrsParams): Scheduled {
  const ease = Math.max(P.minimum_ease, c.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  if (quality < 3) {
    return { reps: 0, lapses: c.lapses + (c.review_count > 0 ? 1 : 0), ease, interval_days: 0, due_at: new Date(now.getTime() + P.relearn_minutes * 60000).toISOString() };
  }
  const interval = c.reps === 0 ? P.first_interval_days : c.reps === 1 ? P.second_interval_days : Math.max(c.interval_days + 1, Math.round(c.interval_days * ease));
  return { reps: c.reps + 1, lapses: c.lapses, ease, interval_days: interval, due_at: new Date(now.getTime() + interval * 86400000).toISOString() };
}

/**
 * Format rotation. First exposure is recognition of meaning only. Afterwards at least
 * `production_share_min` of a card's reviews are production formats.
 */
export function chooseFormat(c: Pick<CardState, "recognition_passed" | "practice_count" | "production_count">, available: Format[], P: Pick<SrsParams, "production_share_min">): Format {
  if (!c.recognition_passed) return available.includes("meaning_choice") ? "meaning_choice" : "study";
  const prod = PRODUCTION_FORMATS.filter((f) => available.includes(f));
  const rec = RECOGNITION_FORMATS.filter((f) => available.includes(f));
  const recognitionAllowed = rec.length > 0 && c.production_count / (c.practice_count + 1) >= P.production_share_min;
  if (!recognitionAllowed && prod.length) return prod[c.production_count % prod.length]!;
  if (rec.length) return rec[(c.practice_count - c.production_count) % rec.length]!;
  return prod[0] ?? (available.includes("study") ? "study" : "recall_typed");
}

/** Order in which new bank entries are introduced: core first, then by the profile's target. */
export function introductionRank(e: Pick<VocabEntry, "tier" | "cefr">, target: number): number {
  const cefr = target >= 6 ? { C1: 0, C2: 1, B2: 2 } : { B2: 0, C1: 1, C2: 2 };
  if (e.tier === "core") return e.cefr === "B2" ? 0 : 1;
  return 10 + cefr[e.cefr];
}

// ---------------------------------------------------------------- questions

/** What the engine needs from a card's content. Personal cards only have a headword and a sentence. */
export type Studyable = Pick<VocabEntry, "id" | "headword" | "kind"> &
  Partial<Pick<VocabEntry, "pos" | "category" | "definition" | "translation_fr" | "example_academic" | "example_spoken" | "collocations" | "word_family" | "synonyms" | "false_friend_fr" | "inflections">> & { personal?: boolean };

export interface Question {
  format: Format;
  input: "choice" | "typed" | "none";
  instruction: string;
  /** Main prompt (word, definition, sentence with a blank, …). */
  prompt: string;
  detail?: string;
  options?: string[];
  /** Text to speak for dictation (never rendered). */
  speak?: string;
  firstLetter?: string;
  // Answer key — removed before a question is sent to the browser.
  answerIndex?: number;
  expected?: string;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled<T>(xs: T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Find the headword (in any inflection) inside a sentence. Single words and hyphenated compounds only. */
export function locateForm(sentence: string | undefined, e: Pick<Studyable, "headword" | "inflections">): { start: number; end: number; surface: string } | null {
  if (!sentence || /\s/.test(e.headword.trim())) return null;
  const head = e.headword.toLowerCase();
  const forms = inflectionsOf(head);
  for (const f of e.inflections ?? []) forms.add(f.toLowerCase());
  const re = /[A-Za-z][A-Za-z'’\-]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence))) {
    const w = m[0].toLowerCase().replace(/['’]s$/, "");
    if (w === head || forms.has(w)) return { start: m.index, end: m.index + w.length, surface: sentence.slice(m.index, m.index + w.length) };
  }
  return null;
}

function blank(sentence: string, loc: { start: number; end: number }, shown = ""): string {
  return `${sentence.slice(0, loc.start)}${shown}_____${sentence.slice(loc.end)}`;
}

function sentenceFor(e: Studyable, r: () => number) {
  const order = r() < 0.5 ? [e.example_academic, e.example_spoken] : [e.example_spoken, e.example_academic];
  for (const s of order) {
    const loc = locateForm(s, e);
    if (s && loc) return { sentence: s, loc };
  }
  return null;
}

/** Collocations with the headword replaced by a blank (only those that contain it). */
function blankedCollocations(e: Studyable): string[] {
  return (e.collocations ?? []).flatMap((c) => {
    const loc = locateForm(c, e);
    return loc ? [blank(c, loc)] : [];
  });
}

export function availableFormats(e: Studyable, opts: { audio: boolean }): Format[] {
  const out: Format[] = [];
  const located = !!locateForm(e.example_academic, e) || !!locateForm(e.example_spoken, e);
  if (e.personal) {
    out.push("study");
    if (located) out.push("cloze_typed");
    if (opts.audio) out.push("dictation");
    return out;
  }
  out.push("meaning_choice", "recall_typed");
  if (located) out.push("cloze_typed");
  if (e.kind === "word" && blankedCollocations(e).length >= 2) out.push("collocation_choice");
  if (e.kind === "word" && located && (e.word_family ?? []).length > 0) out.push("word_formation");
  if (e.kind === "word" && located && (e.synonyms ?? []).length > 0) out.push("paraphrase_choice");
  if (e.false_friend_fr) out.push("false_friend_choice");
  if (opts.audio) out.push("dictation");
  return out;
}

function withOptions(q: Omit<Question, "options" | "answerIndex">, correct: string, distractors: string[], r: () => number): Question {
  const seen = new Set([correct.toLowerCase()]);
  const ds: string[] = [];
  for (const d of distractors) {
    if (ds.length === 3) break;
    if (!seen.has(d.toLowerCase())) {
      seen.add(d.toLowerCase());
      ds.push(d);
    }
  }
  const options = shuffled([correct, ...ds], r);
  return { ...q, options, answerIndex: options.indexOf(correct) };
}

/**
 * Build one question. Deterministic for a given (entry, format, seed), so the server can
 * rebuild the same question to check an answer without ever sending the key to the browser.
 */
export function buildQuestion(e: Studyable, format: Format, seed: string, pool: VocabEntry[]): Question {
  const r = rng(`${e.id}|${format}|${seed}`);
  const others = shuffled(pool.filter((o) => o.id !== e.id && o.headword.toLowerCase() !== e.headword.toLowerCase()), r);
  const samePos = [...others.filter((o) => o.pos === e.pos && o.category === e.category), ...others.filter((o) => o.pos === e.pos && o.category !== e.category), ...others.filter((o) => o.pos !== e.pos)];
  const pick = sentenceFor(e, r);

  switch (format) {
    case "study":
      return { format, input: "none", instruction: "A word you added. Read it in its sentence, then continue.", prompt: e.headword, detail: e.example_academic };
    case "meaning_choice":
      return withOptions({ format, input: "choice", instruction: "Choose the correct meaning.", prompt: e.headword, detail: e.pos }, e.definition!, samePos.map((o) => o.definition), r);
    case "recall_typed":
      return { format, input: "typed", instruction: e.personal ? "Type the word you saved from this sentence." : "Type the English word or expression.", prompt: e.definition ?? (pick ? blank(pick.sentence, pick.loc) : e.example_academic ?? ""), detail: e.translation_fr ? `French: ${e.translation_fr}` : undefined, expected: e.headword };
    case "cloze_typed": {
      if (!pick) return buildQuestion(e, "recall_typed", seed, pool);
      const first = pick.loc.surface[0]!;
      return { format, input: "typed", instruction: "Complete the word. The first letter is given.", prompt: blank(pick.sentence, pick.loc, first), firstLetter: first, expected: pick.loc.surface };
    }
    case "collocation_choice":
      return withOptions(
        { format, input: "choice", instruction: "Which word completes all of these combinations?", prompt: blankedCollocations(e).join("   ·   ") },
        e.headword,
        samePos.filter((o) => o.kind === "word" && !(e.synonyms ?? []).some((s) => s.toLowerCase() === o.headword.toLowerCase())).map((o) => o.headword),
        r,
      );
    case "word_formation": {
      const fam = e.word_family ?? [];
      if (!pick || !fam.length) return buildQuestion(e, "recall_typed", seed, pool);
      const base = fam[Math.floor(r() * fam.length)]!;
      return { format, input: "typed", instruction: `Write the correct form of “${base.form}” (${base.pos}) to complete the sentence.`, prompt: blank(pick.sentence, pick.loc), detail: `Needed: ${e.pos}`, expected: pick.loc.surface };
    }
    case "paraphrase_choice": {
      const syn = e.synonyms ?? [];
      const loc = locateForm(e.example_academic, e) ? { sentence: e.example_academic!, loc: locateForm(e.example_academic, e)! } : pick;
      if (!loc || !syn.length) return buildQuestion(e, "recall_typed", seed, pool);
      const banned = new Set(syn.map((s) => s.toLowerCase()));
      const sentence = `${loc.sentence.slice(0, loc.loc.start)}[${loc.loc.surface}]${loc.sentence.slice(loc.loc.end)}`;
      return withOptions(
        { format, input: "choice", instruction: "Which option is closest in meaning to the word in brackets, in this sentence?", prompt: sentence },
        syn[Math.floor(r() * syn.length)]!,
        samePos.flatMap((o) => o.synonyms).filter((s) => !banned.has(s.toLowerCase())),
        r,
      );
    }
    case "false_friend_choice":
      return withOptions(
        { format, input: "choice", instruction: "False friend: choose the correct French translation.", prompt: e.headword, detail: e.example_spoken },
        e.translation_fr!,
        [e.false_friend_fr!.trap, ...samePos.map((o) => o.translation_fr)],
        r,
      );
    case "dictation":
      return { format, input: "typed", instruction: "Listen and type what you hear.", prompt: "", speak: e.headword, expected: e.headword };
  }
}

/** The part of a question that may be sent to the browser. */
export function publicQuestion(q: Question): Omit<Question, "answerIndex" | "expected"> {
  const { answerIndex: _a, expected: _e, ...rest } = q;
  return rest;
}

export function normalizeTyped(s: string): string {
  return s.toLowerCase().replace(/[’‘]/g, "'").replace(/[.,;:!?"“”]/g, "").replace(/\s+/g, " ").trim();
}

export interface Checked {
  correct: boolean;
  nearMiss: boolean;
  expected: string;
  given: string;
  errorTag: string | null;
}

const CHOICE_TAG: Partial<Record<Format, string>> = {
  meaning_choice: "vocab_meaning",
  collocation_choice: "vocab_collocation",
  paraphrase_choice: "vocab_paraphrase",
  false_friend_choice: "vocab_false_friend",
};

/** Typed answers reuse the Complete-the-Words error classes (orthography, inflection, derivation…). */
export function checkAnswer(q: Question, response: { choice?: number | null; text?: string | null }): Checked {
  if (q.input === "none") return { correct: true, nearMiss: false, expected: q.prompt, given: "", errorTag: null };
  if (q.input === "choice") {
    const expected = q.options![q.answerIndex!]!;
    const given = response.choice == null ? "" : (q.options![response.choice] ?? "");
    const correct = response.choice === q.answerIndex;
    return { correct, nearMiss: false, expected, given, errorTag: correct ? null : (CHOICE_TAG[q.format] ?? "vocab_meaning") };
  }
  const expected = q.expected!;
  const given = (response.text ?? "").trim();
  const correct = normalizeTyped(given) === normalizeTyped(expected);
  if (correct) return { correct, nearMiss: false, expected, given, errorTag: null };
  const tag = /\s/.test(expected.trim()) ? (given ? "semantic_context" : "no_answer") : classifyCtwError(expected, given);
  return { correct, nearMiss: tag === "orthography", expected, given, errorTag: tag };
}
