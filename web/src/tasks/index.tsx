import type { PublicExercise } from "../../../shared/publicView";
import type { TaskCtx } from "./types";
import { CompleteTheWords } from "./CompleteTheWords";
import { ReadInDailyLife, ReadAcademicPassage } from "./Reading";
import { ListenChooseResponse, ListeningSet } from "./Listening";
import { ListenAndRepeat, TakeAnInterview } from "./Speaking";
import { BuildSentence } from "./BuildSentence";
import { WriteEmail, AcademicDiscussion } from "./Writing";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function TaskView({ ex, value, onChange, ctx }: { ex: PublicExercise; value: any; onChange: (v: any) => void; ctx: TaskCtx }) {
  const p = { value, onChange, ctx } as const;
  switch (ex.task_type) {
    case "complete_the_words":
      return <CompleteTheWords ex={ex} {...p} />;
    case "read_in_daily_life":
      return <ReadInDailyLife ex={ex} {...p} />;
    case "read_academic_passage":
      return <ReadAcademicPassage ex={ex} {...p} />;
    case "listen_choose_response":
      return <ListenChooseResponse ex={ex} {...p} />;
    case "conversation":
    case "announcement":
    case "academic_talk":
      return <ListeningSet ex={ex} {...p} />;
    case "listen_and_repeat":
      return <ListenAndRepeat ex={ex} {...p} />;
    case "take_an_interview":
      return <TakeAnInterview ex={ex} {...p} />;
    case "build_a_sentence":
      return <BuildSentence ex={ex} {...p} />;
    case "write_an_email":
      return <WriteEmail ex={ex} {...p} />;
    case "academic_discussion":
      return <AcademicDiscussion ex={ex} {...p} />;
  }
}

/** Strip UI-only fields (prefixed with "_") before submission. */
export function cleanResponse(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !k.startsWith("_")));
}

export function isSpeaking(t: PublicExercise["task_type"]) {
  return t === "listen_and_repeat" || t === "take_an_interview";
}
