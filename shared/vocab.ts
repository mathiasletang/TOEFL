/**
 * Vocabulary bank: schema and validation.
 *
 * Everything here is original training content. The "core" tier is an INTERNAL
 * high-yield selection made for this app — it is not an official ETS word list,
 * and CEFR levels are author estimates.
 */
import { z } from "zod";

export const VOCAB_KINDS = ["word", "collocation", "phrasal_verb", "idiom", "formula"] as const;
export type VocabKind = (typeof VOCAB_KINDS)[number];

export const VOCAB_POS = ["noun", "verb", "adjective", "adverb", "preposition", "conjunction", "determiner", "pronoun", "phrase"] as const;
export type VocabPos = (typeof VOCAB_POS)[number];

export const VOCAB_CEFR = ["B2", "C1", "C2"] as const;
export const VOCAB_TIERS = ["core", "extended", "mastery"] as const;
export type VocabTier = (typeof VOCAB_TIERS)[number];
export const VOCAB_REGISTERS = ["formal", "neutral", "informal"] as const;

export const VOCAB_CATEGORIES = [
  "general_academic",
  "biology",
  "ecology",
  "geology",
  "astronomy",
  "psychology",
  "sociology",
  "anthropology",
  "economics",
  "history",
  "art_history",
  "linguistics",
  "environmental_science",
  "technology",
  "campus_daily_life",
  "functional_language",
  "academic_collocations",
  "phrasal_verbs_idioms",
  "false_friends_fr",
  "spelling_traps",
] as const;
export type VocabCategory = (typeof VOCAB_CATEGORIES)[number];

export const VOCAB_CATEGORY_LABEL: Record<VocabCategory, string> = {
  general_academic: "General academic",
  biology: "Biology",
  ecology: "Ecology",
  geology: "Geology",
  astronomy: "Astronomy",
  psychology: "Psychology",
  sociology: "Sociology",
  anthropology: "Anthropology",
  economics: "Economics",
  history: "History",
  art_history: "Art history",
  linguistics: "Linguistics",
  environmental_science: "Environmental science",
  technology: "Technology",
  campus_daily_life: "Campus and daily life",
  functional_language: "Functional language",
  academic_collocations: "Academic collocations",
  phrasal_verbs_idioms: "Phrasal verbs and conversational idioms",
  false_friends_fr: "French–English false friends",
  spelling_traps: "Spelling traps",
};

/** Communicative functions of the functional-language pack. */
export const VOCAB_FUNCTIONS = [
  "cause_consequence",
  "concession",
  "hedging",
  "agreement_disagreement",
  "speech_structuring",
  "email_request",
  "email_complaint",
  "email_apology",
  "email_follow_up",
  "email_recommendation",
] as const;

const id = z.string().regex(/^v_[a-z0-9_]+$/, "vocab ids look like v_category_headword");
const text = z.string().trim().min(1);

export const VocabEntrySchema = z.object({
  id,
  headword: text,
  kind: z.enum(VOCAB_KINDS),
  pos: z.enum(VOCAB_POS),
  cefr: z.enum(VOCAB_CEFR),
  tier: z.enum(VOCAB_TIERS),
  category: z.enum(VOCAB_CATEGORIES),
  /** Required in the functional_language pack. */
  function: z.enum(VOCAB_FUNCTIONS).optional(),
  /** Plain-English definition written for this app. */
  definition: text,
  translation_fr: text,
  example_academic: text,
  example_spoken: text,
  collocations: z.array(text).max(4).default([]),
  /** Derived forms with their part of speech, e.g. { form: "analysis", pos: "noun" }. */
  word_family: z.array(z.object({ form: text, pos: z.enum(VOCAB_POS) })).default([]),
  /** Irregular inflected forms of the headword that the examples may use (e.g. "undertook"). */
  inflections: z.array(text).default([]),
  synonyms: z.array(text).max(4).default([]),
  register: z.enum(VOCAB_REGISTERS),
  /** General American pronunciation between slashes. */
  ipa: z.string().regex(/^\/[^/]+\/$/, "IPA must be written between slashes"),
  false_friend_fr: z.object({ trap: text, correct: text }).optional(),
  spelling_trap: text.optional(),
});
export type VocabEntry = z.infer<typeof VocabEntrySchema>;

export const VocabFileSchema = z.object({
  pack: z.object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    category: z.enum(VOCAB_CATEGORIES),
    description: text,
    /** How the entries were chosen; must not claim to be an official list. */
    selection_note: text,
    copyright_policy: text,
  }),
  entries: z.array(z.unknown()),
});

// ---------------------------------------------------------------- matching helpers

const IRREGULAR: Record<string, string[]> = {
  be: ["am", "is", "are", "was", "were", "been", "being"],
  have: ["has", "had", "having"],
  do: ["does", "did", "done", "doing"],
  go: ["goes", "went", "gone", "going"],
  come: ["came", "coming"],
  get: ["got", "gotten", "getting"],
  give: ["gave", "given", "giving"],
  take: ["took", "taken", "taking"],
  make: ["made", "making"],
  put: ["putting"],
  run: ["ran", "running"],
  bring: ["brought"],
  fall: ["fell", "fallen"],
  hold: ["held"],
  keep: ["kept"],
  set: ["setting"],
  break: ["broke", "broken"],
  catch: ["caught"],
  draw: ["drew", "drawn"],
  find: ["found"],
  leave: ["left", "leaving"],
  stand: ["stood"],
  think: ["thought"],
  write: ["wrote", "written", "writing"],
  see: ["saw", "seen"],
  speak: ["spoke", "spoken"],
  bear: ["bore", "borne"],
  deal: ["dealt"],
  feel: ["felt"],
  grow: ["grew", "grown"],
  know: ["knew", "known"],
  lead: ["led"],
  lose: ["lost", "losing"],
  pay: ["paid"],
  rise: ["rose", "risen", "rising"],
  seek: ["sought"],
  sell: ["sold"],
  send: ["sent"],
  shed: ["shedding"],
  spread: ["spreading"],
  stick: ["stuck"],
  strike: ["struck"],
  throw: ["threw", "thrown"],
  undergo: ["underwent", "undergone"],
  undertake: ["undertook", "undertaken"],
  understand: ["understood"],
  withdraw: ["withdrew", "withdrawn"],
  cut: ["cutting"],
  let: ["letting"],
  hit: ["hitting"],
  hang: ["hung"],
  wear: ["wore", "worn"],
  build: ["built"],
  lay: ["laid"],
  lie: ["lay", "lain", "lying"],
  meet: ["met"],
  read: ["reading"],
  say: ["said"],
  tell: ["told"],
  win: ["won", "winning"],
  begin: ["began", "begun", "beginning"],
  drive: ["drove", "driven", "driving"],
  choose: ["chose", "chosen", "choosing"],
  arise: ["arose", "arisen", "arising"],
  forgo: ["forwent", "forgone"],
  overcome: ["overcame", "overcoming"],
  foresee: ["foresaw", "foreseen"],
  mislead: ["misled"],
  uphold: ["upheld"],
  withhold: ["withheld"],
  shrink: ["shrank", "shrunk"],
  sink: ["sank", "sunk"],
  spend: ["spent"],
  bind: ["bound"],
  wind: ["wound"],
  shake: ["shook", "shaken", "shaking"],
  swing: ["swung"],
  sweep: ["swept"],
  weigh: ["weighed"],
  phenomenon: ["phenomena"],
  criterion: ["criteria"],
  hypothesis: ["hypotheses"],
  analysis: ["analyses"],
  thesis: ["theses"],
  stratum: ["strata"],
  stimulus: ["stimuli"],
  fungus: ["fungi"],
  nucleus: ["nuclei"],
  genus: ["genera"],
  datum: ["data"],
  basis: ["bases"],
  crisis: ["crises"],
  emphasis: ["emphases"],
  nebula: ["nebulae"],
  larva: ["larvae"],
  taxon: ["taxa"],
  bacterium: ["bacteria"],
  medium: ["media"],
  curriculum: ["curricula"],
  syllabus: ["syllabi"],
  alumnus: ["alumni"],
  corpus: ["corpora"],
  matrix: ["matrices"],
  index: ["indices"],
  appendix: ["appendices"],
  axis: ["axes"],
  synthesis: ["syntheses"],
  parenthesis: ["parentheses"],
  diagnosis: ["diagnoses"],
  symbiosis: ["symbioses"],
  metamorphosis: ["metamorphoses"],
  schema: ["schemata"],
  life: ["lives"],
  half: ["halves"],
  leaf: ["leaves"],
  shelf: ["shelves"],
  person: ["people"],
  good: ["better", "best"],
  bad: ["worse", "worst"],
};

const VOWELS = "aeiou";

/** Regular inflections of one word (plural / 3rd person / past / -ing / comparative). */
export function inflectionsOf(word: string): Set<string> {
  const w = word.toLowerCase();
  const out = new Set<string>([w, `${w}s`, `${w}es`, `${w}ed`, `${w}d`, `${w}ing`, `${w}'s`, `${w}er`, `${w}est`, `${w}r`, `${w}st`]);
  if (w.endsWith("e")) {
    out.add(`${w.slice(0, -1)}ing`);
    out.add(`${w.slice(0, -1)}ed`);
  }
  if (w.endsWith("y") && w.length > 2 && !VOWELS.includes(w[w.length - 2]!)) {
    const stem = w.slice(0, -1);
    for (const s of ["ies", "ied", "ier", "iest"]) out.add(stem + s);
  }
  if (w.endsWith("ie")) out.add(`${w.slice(0, -2)}ying`);
  const last = w[w.length - 1]!;
  if (w.length >= 3 && !VOWELS.includes(last) && !"wxy".includes(last) && VOWELS.includes(w[w.length - 2]!)) {
    out.add(`${w}${last}ed`);
    out.add(`${w}${last}ing`);
    out.add(`${w}${last}er`);
  }
  for (const f of IRREGULAR[w] ?? []) out.add(f);
  return out;
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\- ]+/g, " ")
    .split(/[\s\-]+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

/** Placeholder tokens allowed in multi-word headwords ("take sth into account"). */
const ARTICLES = new Set(["a", "an", "the"]);
const SLOTS = new Set(["sth", "sb", "something", "someone", "somebody", "one's", "x", "y"]);

/**
 * True when `text` contains `phrase` — every word of the phrase, in order, each in any
 * regular or declared inflection. `maxGap` words may separate consecutive words
 * (separable phrasal verbs, collocations with a modifier in between).
 */
export function containsPhrase(text: string, phrase: string, maxGap: number, extraForms: string[] = []): boolean {
  const hay = tokenize(text);
  const all = tokenize(phrase).filter((t) => !SLOTS.has(t));
  // Articles inside an expression may change in use ("make a decision" → "made the decision").
  const content = all.filter((t) => !ARTICLES.has(t));
  const needle = content.length ? content : all;
  if (!needle.length) return false;
  const sets = needle.map((t) => inflectionsOf(t));
  if (needle.length === 1) for (const f of extraForms) for (const t of tokenize(f)) sets[0]!.add(t);
  const from = (pos: number, k: number): boolean => {
    if (k === sets.length) return true;
    const limit = k === 0 ? hay.length : Math.min(hay.length, pos + maxGap + 1);
    for (let i = pos; i < limit; i++) if (sets[k]!.has(hay[i]!) && from(i + 1, k + 1)) return true;
    return false;
  };
  return from(0, 0);
}

function gapFor(kind: VocabKind): number {
  return kind === "word" ? 0 : kind === "formula" ? 1 : 4;
}

/** The headword, an irregular inflection or a declared family form appears in the example. */
export function exampleUsesEntry(example: string, e: Pick<VocabEntry, "headword" | "kind" | "word_family" | "inflections">): boolean {
  const gap = gapFor(e.kind);
  if (containsPhrase(example, e.headword, gap, e.inflections)) return true;
  if (e.inflections.some((f) => containsPhrase(example, f, gap))) return true;
  return e.word_family.some((f) => containsPhrase(example, f.form, gap));
}

/** A definition must not use the word it defines (for multi-word items: the whole expression). */
export function definitionIsCircular(e: Pick<VocabEntry, "headword" | "definition" | "inflections">): boolean {
  return containsPhrase(e.definition, e.headword, 0, e.inflections);
}

// ---------------------------------------------------------------- validation

export interface VocabIssue {
  id: string;
  file?: string;
  level: "error" | "warning";
  message: string;
}

export interface VocabReport {
  entries: VocabEntry[];
  errors: VocabIssue[];
  warnings: VocabIssue[];
}

const FRENCH_HINT = /[a-zàâçéèêëîïôûùüÿœ]/i;

export function validateVocab(raw: Array<{ data: unknown; file?: string; category?: VocabCategory }>): VocabReport {
  const errors: VocabIssue[] = [];
  const warnings: VocabIssue[] = [];
  const entries: VocabEntry[] = [];
  const ids = new Map<string, string | undefined>();
  const heads = new Map<string, string>();

  for (const { data, file, category } of raw) {
    const rid = (data as { id?: string })?.id ?? "(missing id)";
    const parsed = VocabEntrySchema.safeParse(data);
    if (!parsed.success) {
      for (const iss of parsed.error.issues) errors.push({ id: rid, file, level: "error", message: `${iss.path.join(".") || "(root)"}: ${iss.message}` });
      continue;
    }
    const e = parsed.data;
    const before = errors.length;
    const err = (message: string) => errors.push({ id: e.id, file, level: "error", message });
    const warn = (message: string) => warnings.push({ id: e.id, file, level: "warning", message });

    if (ids.has(e.id)) err(`duplicate id (also in ${ids.get(e.id) ?? "?"})`);
    const key = `${e.headword.toLowerCase()}|${e.pos}`;
    if (heads.has(key)) err(`duplicate headword + part of speech "${e.headword}" (${e.pos}) — already defined as ${heads.get(key)}`);

    if (category && e.category !== category) err(`category "${e.category}" does not match its pack (${category})`);
    if (e.category === "functional_language" && !e.function) err("functional_language entries need a `function`");
    if (e.category !== "functional_language" && e.function) err("`function` is only used in the functional_language pack");

    // Tier ↔ CEFR coherence (internal convention): core = B2/C1, extended = C1 (B2 allowed), mastery = C2.
    if (e.tier === "mastery" && e.cefr !== "C2") err(`mastery entries are C2 (found ${e.cefr})`);
    if (e.tier === "extended" && e.cefr === "C2") err("extended entries are C1 (B2 for common discipline words)");
    if (e.tier === "core" && e.cefr === "C2") err("core entries are B2 or C1");

    // A hyphenated compound ("avant-garde") is one word; an expression has spaces.
    const multi = e.headword.trim().split(/\s+/).length > 1;
    if (e.kind === "word" && multi) err(`kind "word" but the headword has several words`);
    if (e.kind !== "word" && !multi) err(`kind "${e.kind}" needs a multi-word headword`);
    if (e.kind !== "word" && e.pos !== "phrase" && e.kind !== "phrasal_verb") warn(`multi-word ${e.kind} usually has pos "phrase"`);
    if (e.kind === "phrasal_verb" && e.pos !== "verb") err(`phrasal verbs have pos "verb"`);

    if (!exampleUsesEntry(e.example_academic, e)) err(`academic example does not contain "${e.headword}" or a declared form`);
    if (!exampleUsesEntry(e.example_spoken, e)) err(`spoken example does not contain "${e.headword}" or a declared form`);
    if (e.example_academic.trim().toLowerCase() === e.example_spoken.trim().toLowerCase()) err("the two examples are identical");
    if (definitionIsCircular(e)) err(`definition contains the defined ${multi ? "expression" : "word"}`);
    if (!FRENCH_HINT.test(e.translation_fr)) err("French translation is empty");

    if (e.kind === "word" && e.collocations.length < 2) err(`a word needs at least 2 collocations (found ${e.collocations.length})`);
    if (new Set(e.collocations.map((c) => c.toLowerCase())).size !== e.collocations.length) err("duplicate collocations");
    if (e.kind === "word") for (const c of e.collocations) if (!containsPhrase(c, e.headword, 0, [...e.inflections, ...e.word_family.map((f) => f.form)])) warn(`collocation "${c}" does not contain the headword`);
    if (e.synonyms.some((s) => s.toLowerCase() === e.headword.toLowerCase())) err("a synonym repeats the headword");
    if (e.word_family.some((f) => f.form.toLowerCase() === e.headword.toLowerCase() && f.pos === e.pos)) err("word family repeats the headword itself");

    if (e.category === "false_friends_fr" && !e.false_friend_fr) err("false_friends_fr entries need `false_friend_fr`");
    if (e.category === "spelling_traps" && !e.spelling_trap) err("spelling_traps entries need `spelling_trap`");

    for (const [name, ex] of [["academic", e.example_academic], ["spoken", e.example_spoken]] as const) {
      const n = tokenize(ex).length;
      if (n < 5) err(`${name} example is too short (${n} words)`);
      if (n > 40) warn(`${name} example is long (${n} words)`);
    }
    if (tokenize(e.definition).length < 3) err("definition is too short");

    if (errors.length === before) {
      ids.set(e.id, file);
      heads.set(key, e.id);
      entries.push(e);
    }
  }
  return { entries, errors, warnings };
}

export interface VocabCounts {
  total: number;
  by_tier: Record<string, number>;
  by_cefr: Record<string, number>;
  by_kind: Record<string, number>;
  by_category: Record<string, { total: number; core: number; extended: number; mastery: number; B2: number; C1: number; C2: number }>;
}

export function countVocab(entries: VocabEntry[]): VocabCounts {
  const inc = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);
  const c: VocabCounts = { total: entries.length, by_tier: {}, by_cefr: {}, by_kind: {}, by_category: {} };
  for (const e of entries) {
    inc(c.by_tier, e.tier);
    inc(c.by_cefr, e.cefr);
    inc(c.by_kind, e.kind);
    const row = (c.by_category[e.category] ??= { total: 0, core: 0, extended: 0, mastery: 0, B2: 0, C1: 0, C2: 0 });
    row.total++;
    row[e.tier]++;
    row[e.cefr]++;
  }
  return c;
}
