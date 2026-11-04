/**
 * "Play" view of an exercise: everything needed to take the task, nothing that
 * reveals the answer on screen. Audio scripts are included ONLY because the
 * browser speech-synthesis fallback needs them; the UI never renders them
 * during an attempt.
 */
import { deriveCtw } from "./ctw";
import type { AudioSegment, Exercise, TaskType } from "./schema";

export interface PublicMcq {
  id: string;
  stem: string;
  options: string[];
  highlight?: string;
}

export type AudioScript = Array<{ key: string; speaker: string; voice: AudioSegment["voice"]; text: string }>;

interface PublicBase {
  id: string;
  task_type: TaskType;
  section: Exercise["section"];
  difficulty: Exercise["difficulty"];
  source_type: Exercise["source_type"];
}

export type PublicExercise = PublicBase &
  (
    | { task_type: "complete_the_words"; topic: string; segments: Array<{ type: "text"; text: string } | { type: "gap"; index: number; visible: string; missingLength: number }> }
    | { task_type: "read_in_daily_life"; stimulus: Extract<Exercise, { task_type: "read_in_daily_life" }>["stimulus"]; questions: PublicMcq[] }
    | { task_type: "read_academic_passage"; title: string; discipline: string; passage: string; questions: PublicMcq[] }
    | { task_type: "listen_choose_response"; audio: AudioScript; options: string[] }
    | { task_type: "conversation" | "announcement" | "academic_talk"; context: string; title?: string; audio: AudioScript; questions: PublicMcq[] }
    | { task_type: "listen_and_repeat"; scenario: string; items: Array<{ index: number; response_seconds: number }>; audio: AudioScript }
    | { task_type: "take_an_interview"; scenario: string; response_seconds: number; questions: Array<{ index: number; level: string }>; audio: AudioScript }
    | { task_type: "build_a_sentence"; context: string; frame: (string | null)[]; chunks: string[] }
    | { task_type: "write_an_email"; time_limit_seconds: number; scenario: string; recipient_name: string; recipient_role: string; subject: string; requirements: string[] }
    | { task_type: "academic_discussion"; time_limit_seconds: number; course: string; professor: { name: string; prompt: string }; students: Array<{ name: string; text: string }> }
  );

function mcq(qs: Array<{ id: string; stem: string; options: string[]; highlight?: string }>): PublicMcq[] {
  return qs.map((q) => ({ id: q.id, stem: q.stem, options: q.options, ...(q.highlight ? { highlight: q.highlight } : {}) }));
}

/** Deterministic shuffle for Build a Sentence chunks (stable per exercise). */
function stableShuffle(items: string[], seed: string): string[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  // Never present the chunks already in the correct order.
  if (out.join("\u0000") === items.join("\u0000") && out.length > 1) out.push(out.shift()!);
  return out;
}

export function toPublic(ex: Exercise): PublicExercise {
  const base = { id: ex.id, section: ex.section, difficulty: ex.difficulty, source_type: ex.source_type };
  switch (ex.task_type) {
    case "complete_the_words": {
      const d = deriveCtw(ex.passage);
      return {
        ...base,
        task_type: ex.task_type,
        topic: ex.topic,
        segments: d.segments.map((s) => (s.type === "text" ? s : { type: "gap" as const, index: s.index, visible: s.visible, missingLength: s.missing.length })),
      };
    }
    case "read_in_daily_life":
      return { ...base, task_type: ex.task_type, stimulus: ex.stimulus, questions: mcq(ex.questions) };
    case "read_academic_passage":
      return { ...base, task_type: ex.task_type, title: ex.title, discipline: ex.discipline, passage: ex.passage, questions: mcq(ex.questions) };
    case "listen_choose_response":
      return { ...base, task_type: ex.task_type, audio: ex.audio.map((s, i) => ({ key: `seg${i}`, ...s })), options: ex.options };
    case "conversation":
    case "announcement":
    case "academic_talk":
      return {
        ...base,
        task_type: ex.task_type,
        context: ex.context,
        ...(ex.task_type === "academic_talk" ? { title: ex.title } : {}),
        audio: ex.audio.map((s, i) => ({ key: `seg${i}`, ...s })),
        questions: mcq(ex.questions),
      };
    case "listen_and_repeat":
      return {
        ...base,
        task_type: ex.task_type,
        scenario: ex.scenario,
        items: ex.items.map((i) => ({ index: i.index, response_seconds: i.response_seconds })),
        audio: ex.items.map((i) => ({ key: `item${i.index}`, speaker: "Speaker", voice: ex.speaker_voice, text: i.text })),
      };
    case "take_an_interview":
      return {
        ...base,
        task_type: ex.task_type,
        scenario: ex.scenario,
        response_seconds: ex.response_seconds,
        questions: ex.questions.map((q) => ({ index: q.index, level: q.level })),
        audio: ex.questions.map((q) => ({ key: `q${q.index}`, speaker: "Interviewer", voice: ex.interviewer_voice, text: q.prompt })),
      };
    case "build_a_sentence":
      return { ...base, task_type: ex.task_type, context: ex.context, frame: ex.frame, chunks: stableShuffle([...ex.answer, ...ex.distractors], ex.id) };
    case "write_an_email":
      return {
        ...base,
        task_type: ex.task_type,
        time_limit_seconds: ex.time_limit_seconds,
        scenario: ex.scenario,
        recipient_name: ex.recipient_name,
        recipient_role: ex.recipient_role,
        subject: ex.subject,
        requirements: ex.requirements,
      };
    case "academic_discussion":
      return { ...base, task_type: ex.task_type, time_limit_seconds: ex.time_limit_seconds, course: ex.course, professor: ex.professor, students: ex.students };
  }
}

/** Training time limit (seconds) for a drill. Official values for Email / Discussion. */
export function drillSeconds(ex: Exercise, cfg: Record<string, number>): number | null {
  if (ex.drill_seconds) return ex.drill_seconds;
  switch (ex.task_type) {
    case "complete_the_words":
      return cfg.complete_the_words ?? 150;
    case "read_in_daily_life":
      return (cfg.read_in_daily_life_base ?? 30) + ex.questions.length * (cfg.read_in_daily_life_per_question ?? 35);
    case "read_academic_passage":
      return (cfg.read_academic_passage_base ?? 60) + ex.questions.length * (cfg.read_academic_passage_per_question ?? 45);
    case "listen_choose_response":
      return cfg.listen_choose_response ?? 25;
    case "conversation":
    case "announcement":
    case "academic_talk":
      return ex.questions.length * (cfg.listening_per_question ?? 35);
    case "build_a_sentence":
      return cfg.build_a_sentence ?? 35;
    case "write_an_email":
    case "academic_discussion":
      return ex.time_limit_seconds;
    case "listen_and_repeat":
    case "take_an_interview":
      return null; // paced by per-item response windows
  }
}

/** Listening timers start after the audio has played; the client adds measured audio time. */
export function timerStartsAfterAudio(t: TaskType): boolean {
  return t === "listen_choose_response" || t === "conversation" || t === "announcement" || t === "academic_talk";
}
