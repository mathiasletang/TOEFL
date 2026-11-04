import { deriveCtw, countWords } from "./ctw";
import { countSyllables } from "./syllables";
import { sentenceFromOrder } from "./scoring";
import { ExerciseSchema, TASK_SECTION, type Exercise, type McqQuestion } from "./schema";

export interface Issue {
  id: string;
  file?: string;
  level: "error" | "warning";
  message: string;
}

export interface ValidationReport {
  exercises: Exercise[];
  errors: Issue[];
  warnings: Issue[];
}

export function validateExercises(raw: Array<{ data: unknown; file?: string }>): ValidationReport {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const exercises: Exercise[] = [];
  const seen = new Map<string, string | undefined>();

  for (const { data, file } of raw) {
    const rid = (data as { id?: string })?.id ?? "(missing id)";
    const parsed = ExerciseSchema.safeParse(data);
    if (!parsed.success) {
      for (const iss of parsed.error.issues)
        errors.push({ id: rid, file, level: "error", message: `${iss.path.join(".") || "(root)"}: ${iss.message}` });
      continue;
    }
    const ex = parsed.data;
    if (seen.has(ex.id)) {
      errors.push({ id: ex.id, file, level: "error", message: `Duplicate id (also in ${seen.get(ex.id) ?? "?"})` });
      continue;
    }
    seen.set(ex.id, file);
    const before = errors.length;
    const err = (message: string) => errors.push({ id: ex.id, file, level: "error", message });
    const warn = (message: string) => warnings.push({ id: ex.id, file, level: "warning", message });
    checkExercise(ex, err, warn);
    if (errors.length === before) exercises.push(ex);
  }
  return { exercises, errors, warnings };
}

function checkQuestions(qs: McqQuestion[], err: (m: string) => void, passage?: string) {
  const ids = new Set<string>();
  for (const q of qs) {
    if (ids.has(q.id)) err(`Duplicate question id ${q.id}`);
    ids.add(q.id);
    if (q.answer_index < 0 || q.answer_index >= q.options.length)
      err(`${q.id}: answer_index ${q.answer_index} out of range (0–${q.options.length - 1})`);
    const norm = q.options.map((o) => o.trim().toLowerCase());
    if (new Set(norm).size !== norm.length) err(`${q.id}: duplicate options`);
    if (q.skill === "vocabulary" && passage !== undefined) {
      if (!q.highlight) err(`${q.id}: vocabulary question needs a 'highlight' word`);
      else if (passage && !passage.toLowerCase().includes(q.highlight.toLowerCase()))
        err(`${q.id}: highlighted word "${q.highlight}" not found in passage`);
    }
  }
}

function audioText(ex: { audio: Array<{ text: string }> }): string {
  return ex.audio.map((s) => s.text).join(" ");
}

function checkExercise(ex: Exercise, err: (m: string) => void, warn: (m: string) => void) {
  if (TASK_SECTION[ex.task_type] !== ex.section) err(`section "${ex.section}" does not match task type ${ex.task_type}`);
  if (ex.drill_seconds != null && (ex.drill_seconds < 20 || ex.drill_seconds > 1800))
    err(`drill_seconds ${ex.drill_seconds} outside 20–1800`);

  switch (ex.task_type) {
    case "complete_the_words": {
      const d = deriveCtw(ex.passage);
      d.problems.forEach(err);
      if (ex.passage.includes("\n")) err("Complete the Words passage must be a single paragraph");
      if (d.wordCount < 70 || d.wordCount > 100) err(`passage has ${d.wordCount} words (ETS: about 70–100)`);
      if (countWords(d.firstSentence) < 6) warn("first (intact) sentence is very short");
      break;
    }
    case "read_in_daily_life": {
      const s = ex.stimulus;
      if (!s.body && !s.messages?.length && !s.table) err("stimulus needs body, messages or table");
      if (s.table) s.table.rows.forEach((r, i) => r.length !== s.table!.columns.length && err(`table row ${i} has ${r.length} cells, expected ${s.table!.columns.length}`));
      const text = [s.title, s.body, ...(s.messages ?? []).map((m) => m.text), ...(s.table?.rows.flat() ?? []), s.footer, ...s.meta.map((m) => m.value)].filter(Boolean).join(" ");
      const wc = countWords(text);
      if (wc < 15 || wc > 170) err(`stimulus has ${wc} words (ETS: about 15–150)`);
      else if (wc > 150) warn(`stimulus has ${wc} words (ETS: about 15–150)`);
      checkQuestions(ex.questions, err, text);
      break;
    }
    case "read_academic_passage": {
      const wc = countWords(ex.passage);
      if (wc < 150 || wc > 300) err(`passage has ${wc} words (ETS: about 200)`);
      else if (wc < 170 || wc > 260) warn(`passage has ${wc} words (ETS: about 200)`);
      checkQuestions(ex.questions, err, ex.passage);
      break;
    }
    case "listen_choose_response": {
      if (ex.answer_index < 0 || ex.answer_index > 3) err(`answer_index ${ex.answer_index} out of range`);
      const norm = ex.options.map((o) => o.trim().toLowerCase());
      if (new Set(norm).size !== 4) err("duplicate options");
      const wc = countWords(audioText(ex));
      if (wc > 30) warn(`prompt has ${wc} words — a single utterance is expected`);
      break;
    }
    case "conversation": {
      const speakers = new Set(ex.audio.map((s) => s.speaker));
      if (speakers.size !== 2) err(`conversation must have exactly 2 speakers (found ${speakers.size})`);
      if (ex.audio.length < 4) err("conversation script too short (need at least 4 turns)");
      for (let i = 1; i < ex.audio.length; i++)
        if (ex.audio[i]!.speaker === ex.audio[i - 1]!.speaker) warn(`turns ${i} and ${i + 1} have the same speaker`);
      checkQuestions(ex.questions, err);
      break;
    }
    case "announcement": {
      const wc = countWords(audioText(ex));
      if (wc < 35 || wc > 100) err(`announcement has ${wc} words (ETS: about 40–85)`);
      else if (wc < 40 || wc > 85) warn(`announcement has ${wc} words (ETS: about 40–85)`);
      checkQuestions(ex.questions, err);
      break;
    }
    case "academic_talk": {
      const wc = countWords(audioText(ex));
      if (wc < 90 || wc > 280) err(`talk has ${wc} words (ETS: about 100–250)`);
      else if (wc < 100 || wc > 250) warn(`talk has ${wc} words (ETS: about 100–250)`);
      checkQuestions(ex.questions, err);
      break;
    }
    case "listen_and_repeat": {
      ex.items.forEach((it, i) => {
        if (it.index !== i + 1) err(`item ${i + 1} has index ${it.index}`);
        if (it.response_seconds < 8 || it.response_seconds > 12)
          err(`item ${it.index}: response window ${it.response_seconds}s outside ETS range 8–12 s`);
      });
      const syl = ex.items.map((it) => countSyllables(it.text));
      for (let i = 1; i < syl.length; i++)
        if (syl[i]! < syl[i - 1]! - 1) err(`item ${i + 1} (${syl[i]} syllables) is shorter than item ${i} (${syl[i - 1]})`);
      for (let i = 1; i < ex.items.length; i++)
        if (ex.items[i]!.response_seconds < ex.items[i - 1]!.response_seconds)
          err(`item ${i + 1} has a shorter response window than item ${i}`);
      if (syl[6]! > 32) warn(`last item has ${syl[6]} syllables (research prototype range ≈ 6–29)`);
      if (syl[0]! > 10) warn(`first item has ${syl[0]} syllables (expected a very short opener)`);
      break;
    }
    case "take_an_interview": {
      if (ex.response_seconds !== 45) err(`response_seconds must be 45 (ETS), got ${ex.response_seconds}`);
      ex.questions.forEach((q, i) => q.index !== i + 1 && err(`question ${i + 1} has index ${q.index}`));
      const order = ["personal_experience", "preference", "general_opinion", "policy_opinion"];
      ex.questions.forEach((q, i) => q.level !== order[i] && warn(`question ${i + 1} level ${q.level}; expected progression ${order.join(" → ")}`));
      break;
    }
    case "build_a_sentence": {
      const slots = ex.frame.filter((f) => f === null).length;
      if (slots !== ex.answer.length) err(`frame has ${slots} slots but answer has ${ex.answer.length} chunks`);
      if (ex.answer.length + ex.distractors.length > 9) err("too many chunks (max 9 including distractors)");
      const key = (a: string[]) => [...a].sort().join("\u0000");
      for (const alt of ex.alternatives) {
        if (key(alt) !== key(ex.answer)) err(`alternative [${alt.join(" | ")}] is not a permutation of the answer chunks`);
        if (alt.every((c, i) => c === ex.answer[i])) err("alternative duplicates the main answer");
      }
      for (const d of ex.distractors) if (ex.answer.includes(d)) err(`distractor "${d}" is also an answer chunk`);
      const rebuilt = sentenceFromOrder(ex.frame, ex.answer);
      if (rebuilt !== ex.full_response.trim())
        err(`frame + answer gives "${rebuilt}" but full_response is "${ex.full_response}"`);
      for (const alt of ex.alternatives) {
        const s = sentenceFromOrder(ex.frame, alt);
        if (s === rebuilt) err("alternative produces the same sentence as the answer");
      }
      break;
    }
    case "write_an_email": {
      if (countWords(ex.exemplar) < 80) warn("exemplar is short for a high-band email");
      break;
    }
    case "academic_discussion": {
      const wc = countWords(ex.exemplar);
      if (wc < 100) err(`exemplar has ${wc} words; ETS says an effective response has at least 100`);
      break;
    }
  }
}
