import { z } from "zod";

export const SECTIONS = ["reading", "listening", "writing", "speaking"] as const;
export type Section = (typeof SECTIONS)[number];

export const TASK_TYPES = [
  "complete_the_words",
  "read_in_daily_life",
  "read_academic_passage",
  "listen_choose_response",
  "conversation",
  "announcement",
  "academic_talk",
  "listen_and_repeat",
  "take_an_interview",
  "build_a_sentence",
  "write_an_email",
  "academic_discussion",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_SECTION: Record<TaskType, Section> = {
  complete_the_words: "reading",
  read_in_daily_life: "reading",
  read_academic_passage: "reading",
  listen_choose_response: "listening",
  conversation: "listening",
  announcement: "listening",
  academic_talk: "listening",
  listen_and_repeat: "speaking",
  take_an_interview: "speaking",
  build_a_sentence: "writing",
  write_an_email: "writing",
  academic_discussion: "writing",
};

export const TASK_LABEL: Record<TaskType, string> = {
  complete_the_words: "Complete the Words",
  read_in_daily_life: "Read in Daily Life",
  read_academic_passage: "Read an Academic Passage",
  listen_choose_response: "Listen and Choose a Response",
  conversation: "Listen to a Conversation",
  announcement: "Listen to an Announcement",
  academic_talk: "Listen to an Academic Talk",
  listen_and_repeat: "Listen and Repeat",
  take_an_interview: "Take an Interview",
  build_a_sentence: "Build a Sentence",
  write_an_email: "Write an Email",
  academic_discussion: "Write for an Academic Discussion",
};

export const DIFFICULTIES = ["A1", "A2", "B1", "B2", "B2-C1", "C1", "C1-C2", "C2"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Default Rasch difficulty (logits) per CEFR label — an author estimate, not a calibrated value. */
export const DEFAULT_B: Record<Difficulty, number> = {
  A1: -2.5,
  A2: -2.0,
  B1: -1.0,
  B2: -0.25,
  "B2-C1": 0.5,
  C1: 1.0,
  "C1-C2": 1.6,
  C2: 2.2,
};

export const SOURCE_TYPES = ["ets_official", "ets_format_synthetic", "app_generated_reviewed"] as const;

export const QUESTION_SKILLS = [
  "purpose",
  "main_idea",
  "detail",
  "inference",
  "vocabulary",
  "rhetorical_function",
  "organization",
  "reference",
  "speaker_intent",
  "next_action",
  "pragmatic_response",
  "attitude",
] as const;
export type QuestionSkill = (typeof QUESTION_SKILLS)[number];

export const BAS_PATTERNS = [
  "embedded_questions",
  "noun_complement_clauses",
  "relative_clauses",
  "verb_complement_patterns",
  "modals_and_tense",
  "conditionals",
  "passives",
  "comparatives",
  "coordination_and_subordination",
] as const;
export type BasPattern = (typeof BAS_PATTERNS)[number];

const id = z.string().regex(/^[a-z][a-z0-9_]*$/, "ids must be lowercase snake_case");
const nonEmpty = z.string().trim().min(1);

export const McqQuestionSchema = z.object({
  id: id,
  stem: nonEmpty,
  options: z.array(nonEmpty).length(4),
  answer_index: z.number().int(),
  skill: z.enum(QUESTION_SKILLS),
  explanation: nonEmpty,
  /** Optional per-question Rasch difficulty override (logits, author estimate). */
  b: z.number().min(-3).max(3).optional(),
  /** Word or phrase to highlight in the passage (vocabulary questions). */
  highlight: z.string().optional(),
});
export type McqQuestion = z.infer<typeof McqQuestionSchema>;

export const AudioSegmentSchema = z.object({
  speaker: nonEmpty,
  /** Speaker role used for voice selection: "female" | "male" | "neutral". */
  voice: z.enum(["female", "male", "neutral"]).default("neutral"),
  text: nonEmpty,
});
export type AudioSegment = z.infer<typeof AudioSegmentSchema>;

const base = {
  id: id,
  difficulty: z.enum(DIFFICULTIES),
  source_type: z.enum(SOURCE_TYPES),
  source_reference: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  /** Optional exercise-level Rasch difficulty (logits). Defaults from `difficulty`. */
  b: z.number().min(-3).max(3).optional(),
  /** Optional drill time limit override in seconds (internal training pace). */
  drill_seconds: z.number().int().positive().optional(),
};

export const CompleteTheWordsSchema = z.object({
  ...base,
  section: z.literal("reading"),
  task_type: z.literal("complete_the_words"),
  topic: nonEmpty,
  /** The full original paragraph. Gaps are derived deterministically (see shared/ctw.ts). */
  passage: nonEmpty,
});

const DailyStimulusSchema = z.object({
  format: z.enum([
    "notice",
    "email",
    "text_messages",
    "schedule",
    "menu",
    "form",
    "webpage",
    "advertisement",
    "invoice",
    "social_post",
    "memo",
  ]),
  title: z.string().optional(),
  meta: z.array(z.object({ label: nonEmpty, value: nonEmpty })).default([]),
  body: z.string().optional(),
  messages: z.array(z.object({ sender: nonEmpty, time: z.string().optional(), text: nonEmpty })).optional(),
  table: z.object({ columns: z.array(nonEmpty).min(2), rows: z.array(z.array(z.string())).min(1) }).optional(),
  footer: z.string().optional(),
});

export const ReadInDailyLifeSchema = z.object({
  ...base,
  section: z.literal("reading"),
  task_type: z.literal("read_in_daily_life"),
  stimulus: DailyStimulusSchema,
  questions: z.array(McqQuestionSchema).min(2).max(3),
});

export const ReadAcademicPassageSchema = z.object({
  ...base,
  section: z.literal("reading"),
  task_type: z.literal("read_academic_passage"),
  title: nonEmpty,
  discipline: nonEmpty,
  /** Paragraphs separated by a blank line. */
  passage: nonEmpty,
  questions: z.array(McqQuestionSchema).length(5),
});

export const ListenChooseResponseSchema = z.object({
  ...base,
  section: z.literal("listening"),
  task_type: z.literal("listen_choose_response"),
  audio: z.array(AudioSegmentSchema).length(1),
  options: z.array(nonEmpty).length(4),
  answer_index: z.number().int(),
  skill: z.enum(QUESTION_SKILLS),
  explanation: nonEmpty,
});

const listeningSetBase = {
  ...base,
  section: z.literal("listening"),
  /** Context line shown on screen (ETS shows a picture/context, never the transcript). */
  context: nonEmpty,
  audio: z.array(AudioSegmentSchema).min(1),
};

export const ConversationSchema = z.object({
  ...listeningSetBase,
  task_type: z.literal("conversation"),
  questions: z.array(McqQuestionSchema).length(2),
});
export const AnnouncementSchema = z.object({
  ...listeningSetBase,
  task_type: z.literal("announcement"),
  questions: z.array(McqQuestionSchema).length(2),
});
export const AcademicTalkSchema = z.object({
  ...listeningSetBase,
  task_type: z.literal("academic_talk"),
  title: nonEmpty,
  questions: z.array(McqQuestionSchema).length(4),
});

export const ListenAndRepeatSchema = z.object({
  ...base,
  section: z.literal("speaking"),
  task_type: z.literal("listen_and_repeat"),
  scenario: nonEmpty,
  speaker_voice: z.enum(["female", "male", "neutral"]).default("neutral"),
  items: z
    .array(z.object({ index: z.number().int(), text: nonEmpty, response_seconds: z.number().int() }))
    .length(7),
});

export const TakeAnInterviewSchema = z.object({
  ...base,
  section: z.literal("speaking"),
  task_type: z.literal("take_an_interview"),
  scenario: nonEmpty,
  interviewer_voice: z.enum(["female", "male", "neutral"]).default("neutral"),
  response_seconds: z.number().int(),
  questions: z
    .array(
      z.object({
        index: z.number().int(),
        prompt: nonEmpty,
        level: z.enum(["personal_experience", "preference", "general_opinion", "policy_opinion"]),
      }),
    )
    .length(4),
});

export const BuildASentenceSchema = z.object({
  ...base,
  section: z.literal("writing"),
  task_type: z.literal("build_a_sentence"),
  /** What the first speaker says (shown intact). */
  context: nonEmpty,
  /** Response frame: fixed strings and `null` for each slot to fill with one chunk. */
  frame: z.array(z.string().nullable()).min(2),
  /** Correct chunk sequence (one chunk per slot, in order). */
  answer: z.array(nonEmpty).min(3),
  /** Other fully acceptable orders (each must be a permutation of `answer`). */
  alternatives: z.array(z.array(nonEmpty)).default([]),
  distractors: z.array(nonEmpty).max(2).default([]),
  /** Full reconstructed response; must equal frame + answer. */
  full_response: nonEmpty,
  pattern: z.enum(BAS_PATTERNS),
  explanation: nonEmpty,
});

export const WriteAnEmailSchema = z.object({
  ...base,
  section: z.literal("writing"),
  task_type: z.literal("write_an_email"),
  time_limit_seconds: z.literal(420),
  scenario: nonEmpty,
  recipient_name: nonEmpty,
  recipient_role: nonEmpty,
  subject: nonEmpty,
  requirements: z.array(nonEmpty).min(2).max(4),
  exemplar: nonEmpty,
  exemplar_label: nonEmpty,
});

export const AcademicDiscussionSchema = z.object({
  ...base,
  section: z.literal("writing"),
  task_type: z.literal("academic_discussion"),
  time_limit_seconds: z.literal(600),
  course: nonEmpty,
  professor: z.object({ name: nonEmpty, prompt: nonEmpty }),
  students: z.array(z.object({ name: nonEmpty, text: nonEmpty })).length(2),
  exemplar: nonEmpty,
  exemplar_label: nonEmpty,
});

export const ExerciseSchema = z.discriminatedUnion("task_type", [
  CompleteTheWordsSchema,
  ReadInDailyLifeSchema,
  ReadAcademicPassageSchema,
  ListenChooseResponseSchema,
  ConversationSchema,
  AnnouncementSchema,
  AcademicTalkSchema,
  ListenAndRepeatSchema,
  TakeAnInterviewSchema,
  BuildASentenceSchema,
  WriteAnEmailSchema,
  AcademicDiscussionSchema,
]);

export type Exercise = z.infer<typeof ExerciseSchema>;
export type ExerciseOf<T extends TaskType> = Extract<Exercise, { task_type: T }>;
export type CompleteTheWords = ExerciseOf<"complete_the_words">;
export type ReadInDailyLife = ExerciseOf<"read_in_daily_life">;
export type ReadAcademicPassage = ExerciseOf<"read_academic_passage">;
export type ListenChooseResponse = ExerciseOf<"listen_choose_response">;
export type Conversation = ExerciseOf<"conversation">;
export type Announcement = ExerciseOf<"announcement">;
export type AcademicTalk = ExerciseOf<"academic_talk">;
export type ListeningSet = Conversation | Announcement | AcademicTalk;
export type ListenAndRepeat = ExerciseOf<"listen_and_repeat">;
export type TakeAnInterview = ExerciseOf<"take_an_interview">;
export type BuildASentence = ExerciseOf<"build_a_sentence">;
export type WriteAnEmail = ExerciseOf<"write_an_email">;
export type AcademicDiscussion = ExerciseOf<"academic_discussion">;

export const ContentFileSchema = z.object({
  pack: z.object({
    id: id,
    description: nonEmpty,
    copyright_policy: nonEmpty,
  }),
  exercises: z.array(z.unknown()),
});

export const MCQ_SET_TYPES = [
  "read_in_daily_life",
  "read_academic_passage",
  "conversation",
  "announcement",
  "academic_talk",
] as const;

export function isMcqSet(
  ex: Exercise,
): ex is ReadInDailyLife | ReadAcademicPassage | Conversation | Announcement | AcademicTalk {
  return (MCQ_SET_TYPES as readonly string[]).includes(ex.task_type);
}

/** Number of scored items an exercise contributes. */
export function itemCount(ex: Exercise): number {
  switch (ex.task_type) {
    case "complete_the_words":
      return 10;
    case "listen_choose_response":
    case "build_a_sentence":
    case "write_an_email":
    case "academic_discussion":
      return 1;
    case "listen_and_repeat":
      return ex.items.length;
    case "take_an_interview":
      return ex.questions.length;
    default:
      return ex.questions.length;
  }
}

export function exerciseB(ex: Exercise): number {
  return ex.b ?? DEFAULT_B[ex.difficulty];
}
