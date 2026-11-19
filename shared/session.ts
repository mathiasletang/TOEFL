/**
 * Session mode: today's plan chained step by step (vocabulary → shadowing → main block, then the
 * bonus round if accepted). Pure functions shared by the web runner and the tests.
 *
 * Progress lives on the server (plan checks, drill and simulation sessions, attempts of the day);
 * the browser only remembers which screen was open, so leaving and coming back resumes in place.
 */
export type SessionStepId = "vocab" | "shadowing" | "main" | "optional";

export interface SessionBlock {
  id: SessionStepId;
  label: string;
  done: boolean;
  items?: number | null;
  progress?: number | null;
  mode?: "strict" | "practice";
  launch?: { kind: string } | null;
}
export interface SessionPlan {
  date: string;
  status: string;
  blocks: SessionBlock[];
  optional?: SessionBlock | null;
}
/** What the browser keeps between visits (per profile). */
export interface SavedSession {
  date: string;
  step: SessionStepId | null;
  screen: "upnext" | "run" | "end";
  bonus: boolean;
}
export type SessionScreen =
  | { screen: "upnext"; step: SessionBlock }
  | { screen: "run"; step: SessionBlock }
  | { screen: "end"; bonusAvailable: boolean }
  | { screen: "unavailable" };

const ORDER: SessionStepId[] = ["vocab", "shadowing", "main"];

/** Base steps in session order, then the bonus round when the plan has one. */
export function orderedSteps(plan: SessionPlan): SessionBlock[] {
  const base = ORDER.map((id) => plan.blocks.find((b) => b.id === id)).filter((b): b is SessionBlock => !!b);
  return plan.optional ? [...base, plan.optional] : base;
}

export function baseDone(plan: SessionPlan): boolean {
  const base = orderedSteps(plan).filter((b) => b.id !== "optional");
  return base.length > 0 && base.every((b) => b.done);
}

/** The bonus round is offered once the base is done, if the plan has one that is not done yet. */
export function bonusAvailable(plan: SessionPlan): boolean {
  return baseDone(plan) && !!plan.optional && !plan.optional.done;
}

/** First base step not done; the bonus round only once the base is done and the bonus was accepted. */
export function currentStep(plan: SessionPlan, bonus: boolean): SessionBlock | null {
  const next = orderedSteps(plan).find((b) => b.id !== "optional" && !b.done);
  if (next) return next;
  return bonus && bonusAvailable(plan) ? plan.optional! : null;
}

/**
 * A drill block whose count of exercises is reached today, or a simulation block completed today,
 * counts as done even if it was not ticked yet (e.g. the session was left right after it).
 */
export function reachedCount(b: SessionBlock): boolean {
  const kind = b.launch?.kind;
  if (kind !== "drill" && kind !== "simulation") return false;
  return b.progress != null && b.progress >= (kind === "simulation" ? 1 : (b.items ?? Infinity));
}

/** Blocks the runner must tick in the plan before deciding where to resume. */
export function blocksToCheck(plan: SessionPlan): SessionStepId[] {
  return orderedSteps(plan)
    .filter((b) => !b.done && reachedCount(b))
    .map((b) => b.id);
}

/**
 * Where to (re)start. A saved "run" screen of today's current step resumes that step directly;
 * otherwise the current step is presented on the "Up next" screen; with nothing left, the end screen.
 */
export function resumeScreen(plan: SessionPlan, saved: SavedSession | null): SessionScreen {
  if (plan.status !== "active" || !plan.blocks.length) return { screen: "unavailable" };
  const today = saved?.date === plan.date ? saved : null;
  const step = currentStep(plan, !!today?.bonus);
  if (!step) return { screen: "end", bonusAvailable: bonusAvailable(plan) };
  if (today?.screen === "run" && today.step === step.id) return { screen: "run", step };
  return { screen: "upnext", step };
}

/** The state to save for a screen. */
export function saveFor(plan: SessionPlan, screen: SessionScreen, bonus: boolean): SavedSession {
  return {
    date: plan.date,
    step: screen.screen === "run" || screen.screen === "upnext" ? screen.step.id : null,
    screen: screen.screen === "unavailable" ? "end" : screen.screen,
    bonus,
  };
}

/** Segments of the progress bar: one per base step, plus the bonus round once accepted. */
export function progressSegments(plan: SessionPlan, bonus: boolean, current: SessionStepId | null) {
  return orderedSteps(plan)
    .filter((b) => b.id !== "optional" || bonus || b.done)
    .map((b) => ({ id: b.id, label: b.label, state: b.done ? ("done" as const) : b.id === current ? ("current" as const) : ("todo" as const) }));
}
