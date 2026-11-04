import type { TaskType } from "../../../shared/schema";

export const pct = (x: number | null | undefined, digits = 0) => (x == null ? "—" : `${(x * 100).toFixed(digits)}%`);
export const band = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(1));
export const ago = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const d = (Date.now() - Date.parse(iso)) / 1000;
  if (d < 90) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} d ago`;
};
export const secs = (ms: number | null | undefined) => (ms == null ? "—" : ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);

export const SECTION_ORDER = ["reading", "listening", "writing", "speaking"] as const;
export const SECTION_LABEL: Record<string, string> = { reading: "Reading", listening: "Listening", writing: "Writing", speaking: "Speaking" };

export const TASK_ORDER: TaskType[] = [
  "complete_the_words",
  "read_in_daily_life",
  "read_academic_passage",
  "listen_choose_response",
  "conversation",
  "announcement",
  "academic_talk",
  "build_a_sentence",
  "write_an_email",
  "academic_discussion",
  "listen_and_repeat",
  "take_an_interview",
];

export const TASK_HINT: Record<TaskType, string> = {
  complete_the_words: "10 truncated words · exact spelling · target ≤13 s/gap",
  read_in_daily_life: "Notices, messages, schedules · 2–3 questions",
  read_academic_passage: "~200 words · 5 questions",
  listen_choose_response: "One spoken line · 4 written replies",
  conversation: "Two speakers · 2 questions",
  announcement: "40–85 words · 2 questions",
  academic_talk: "100–250 words · 4 questions",
  build_a_sentence: "Order the chunks · ≤25 s",
  write_an_email: "7:00 · all requirements",
  academic_discussion: "10:00 · ≥100 words",
  listen_and_repeat: "7 sentences · heard once · 8–12 s each",
  take_an_interview: "4 questions · no preparation · 45 s each",
};
