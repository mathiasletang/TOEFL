import type { PublicExercise } from "../../../shared/publicView";

export type PublicOf<T extends PublicExercise["task_type"]> = Extract<PublicExercise, { task_type: T }>;

export interface TaskCtx {
  userId: string;
  sessionId: string | null;
  strict: boolean;
  /** Called by listening tasks when the stimulus finished playing (starts drill timers). */
  onAudioDone?: () => void;
  /** Speaking tasks call this when every item has been recorded. */
  onComplete?: () => void;
  /** True once time has expired: inputs are frozen. */
  locked?: boolean;
}

export interface TaskProps<T extends PublicExercise["task_type"], R> {
  ex: PublicOf<T>;
  value: R | undefined;
  onChange: (r: R) => void;
  ctx: TaskCtx;
}
