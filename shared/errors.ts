import { FUNCTION_WORDS, levenshtein } from "./align";

/** Error classes for Complete the Words (PRD). Classification is an automatic heuristic. */
export const CTW_ERROR_CLASSES = [
  "no_answer",
  "orthography",
  "inflection",
  "derivation",
  "function_word",
  "semantic_context",
] as const;
export type CtwErrorClass = (typeof CTW_ERROR_CLASSES)[number];

const INFLECTIONS = ["ing", "ies", "ied", "es", "ed", "er", "est", "s", "d"];
const DERIVATIONS = [
  "ically", "ation", "ition", "ment", "ness", "ity", "ive", "ous", "ful", "less", "able", "ible",
  "ally", "ly", "al", "ic", "ism", "ist", "ize", "ise", "ence", "ance", "ent", "ant", "ion", "ure", "y",
];

function stem(w: string, suffixes: string[], rounds = 2): string {
  let cur = w;
  for (let r = 0; r < rounds; r++) {
    const s = suffixes.find((x) => cur.length > x.length + 2 && cur.endsWith(x));
    if (!s) break;
    cur = cur.slice(0, -s.length);
  }
  return cur;
}

const INFL_SUFFIXES = ["s", "es", "ed", "d", "ing", "er", "est", "ies", "ied"];
/** Same lexeme with a different inflectional ending (e.g. building/buildings, reduce/reduced, study/studies). */
function isInflectionPair(a: string, b: string): boolean {
  const base = (w: string) => [w, ...INFL_SUFFIXES.filter((s) => w.endsWith(s) && w.length > s.length + 2).map((s) => w.slice(0, -s.length)), w.replace(/ie[sd]$/, "y"), w.replace(/e$/, "")];
  const A = new Set(base(a));
  return base(b).some((x) => x.length >= 3 && A.has(x));
}

export function classifyCtwError(full: string, candidate: string): CtwErrorClass {
  const target = full.toLowerCase();
  const cand = candidate.toLowerCase();
  if (!cand.trim()) return "no_answer";
  if (FUNCTION_WORDS.has(target)) return "function_word";
  if (isInflectionPair(target, cand)) return "inflection";
  const dist = levenshtein(target, cand);
  if (dist <= Math.max(1, Math.floor(target.length / 4))) {
    // Short edit — but a different word-class ending signals a derivation problem.
    const ts = stem(target, DERIVATIONS);
    const cs = stem(cand, DERIVATIONS);
    if (ts !== target && ts === cs) return "derivation";
    return "orthography";
  }
  const ts = stem(stem(target, INFLECTIONS), DERIVATIONS);
  const cs = stem(stem(cand, INFLECTIONS), DERIVATIONS);
  if (ts.length >= 3 && (cs.startsWith(ts) || ts.startsWith(cs))) return "derivation";
  return "semantic_context";
}

export const ERROR_TAG_LABELS: Record<string, string> = {
  no_answer: "No answer",
  orthography: "Spelling",
  inflection: "Inflection (-s/-ed/-ing)",
  derivation: "Word formation",
  function_word: "Function words",
  semantic_context: "Meaning in context",
  purpose: "Purpose",
  main_idea: "Main idea",
  detail: "Detail",
  inference: "Inference",
  vocabulary: "Vocabulary in context",
  rhetorical_function: "Rhetorical function",
  organization: "Organisation",
  reference: "Reference",
  speaker_intent: "Speaker intent",
  next_action: "Next action",
  pragmatic_response: "Pragmatic response",
  attitude: "Attitude",
  embedded_questions: "Embedded questions",
  noun_complement_clauses: "Noun complement clauses",
  relative_clauses: "Relative clauses",
  verb_complement_patterns: "Verb complement patterns",
  modals_and_tense: "Modals & tense",
  conditionals: "Conditionals",
  passives: "Passives",
  comparatives: "Comparatives",
  coordination_and_subordination: "Coordination & subordination",
  repeat_missing_function_words: "Repeat: dropped function words",
  repeat_missing_content_words: "Repeat: dropped content words",
  repeat_substitutions: "Repeat: substituted words",
  repeat_word_order: "Repeat: word order",
  repeat_truncation: "Repeat: sentence cut short",
  missed_requirement: "Missed email requirement",
  grammar: "Grammar",
  word_choice: "Word choice",
  mechanics: "Spelling & punctuation",
  register: "Register",
  development: "Development",
  timing_violation: "Timing",
};
