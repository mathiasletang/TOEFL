/**
 * Section and full-test simulations.
 * Module composition and timing follow the published ETS MST blueprint (config/toefl-2026.json → official.mst).
 * Routing uses an INTERNAL, configurable training threshold: ETS does not publish its cut-off.
 */
import crypto from "node:crypto";
import type { DB } from "./db";
import { json, nowIso } from "./db";
import { CONFIG, type Composition, type MstSection } from "../shared/config";
import { routeModule1, type RouterConfig, type RouteDecision } from "../shared/router";
import { exerciseB, itemCount, type Exercise, type Section, type TaskType } from "../shared/schema";
import { listExercises, getExercise } from "./content";
import { submitAttempt, DEADLINE_GRACE_MS } from "./attempts";
import { sectionEstimates, combine, userTarget, snapshot } from "./analytics";
import { toPublic } from "../shared/publicView";

export type Scope = Section | "full";
export type Length = "full" | "short";
type Pref = "low" | "mid" | "high";

export interface Step {
  index: number;
  section: Section;
  stage: "router" | "module2" | "build" | "email" | "discussion" | "repeat" | "interview";
  label: string;
  minutes: number | null;
  allowBack: boolean;
  exerciseIds: string[];
  candidates?: { lower: string[]; upper: string[]; lowerMinutes: number; upperMinutes: number };
  sessionId?: string | null;
  attemptIds?: string[];
  route?: RouteDecision;
  status: "pending" | "active" | "submitted";
}

export class InsufficientContentError extends Error {
  constructor(public details: string[]) {
    super(`Not enough distinct exercises: ${details.join("; ")}`);
  }
}

const SET_TYPES: TaskType[] = ["read_in_daily_life", "read_academic_passage", "conversation", "announcement", "academic_talk"];

function usage(db: DB, userId: string): Map<string, number> {
  return new Map(
    (db.prepare("SELECT exercise_id, COUNT(*) n FROM attempts WHERE user_id = ? GROUP BY exercise_id").all(userId) as Array<{ exercise_id: string; n: number }>).map((r) => [r.exercise_id, r.n]),
  );
}

function prefTarget(p: Pref): number {
  return p === "low" ? 0.0 : p === "high" ? 1.8 : 0.9;
}

/** Choose exercises whose scored-item counts add up exactly to `count` for one task type. */
function pickForTask(pool: Exercise[], task: TaskType, count: number, used: Set<string>, seen: Map<string, number>, pref: Pref): string[] | null {
  const cands = pool
    .filter((e) => e.task_type === task && !used.has(e.id))
    .sort((a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0) || Math.abs(exerciseB(a) - prefTarget(pref)) - Math.abs(exerciseB(b) - prefTarget(pref)) || a.id.localeCompare(b.id));
  const out: string[] = [];
  const dfs = (start: number, remaining: number): boolean => {
    if (remaining === 0) return true;
    for (let i = start; i < cands.length && i < start + 40; i++) {
      const c = cands[i]!;
      const n = itemCount(c);
      if (n > remaining) continue;
      out.push(c.id);
      if (dfs(i + 1, remaining - n)) return true;
      out.pop();
    }
    return false;
  };
  return dfs(0, count) ? out : null;
}

function pickComposition(pool: Exercise[], comp: Composition, used: Set<string>, seen: Map<string, number>, pref: Pref, label: string): string[] {
  const ids: string[] = [];
  const missing: string[] = [];
  for (const [task, count] of Object.entries(comp) as Array<[TaskType, number]>) {
    const got = pickForTask(pool, task, count, used, seen, pref);
    if (!got) missing.push(`${label}: ${count} × ${task}`);
    else {
      got.forEach((id) => used.add(id));
      ids.push(...got);
    }
  }
  if (missing.length) throw new InsufficientContentError(missing);
  // Present in ETS order within a module.
  const order: TaskType[] = ["complete_the_words", "read_in_daily_life", "read_academic_passage", "listen_choose_response", "conversation", "announcement", "academic_talk"];
  const byId = new Map(pool.map((e) => [e.id, e]));
  return ids.sort((a, b) => order.indexOf(byId.get(a)!.task_type) - order.indexOf(byId.get(b)!.task_type));
}

function mstFor(section: "reading" | "listening", length: Length): MstSection {
  return length === "full" ? CONFIG.official.mst[section] : CONFIG.internal.short_simulation[section];
}

export function planSimulation(db: DB, userId: string, scope: Scope, length: Length): { steps: Step[]; notices: string[] } {
  const pool = listExercises(db);
  const seen = usage(db, userId);
  const used = new Set<string>();
  const steps: Step[] = [];
  const sections: Section[] = scope === "full" ? ["reading", "listening", "writing", "speaking"] : [scope];
  const add = (s: Omit<Step, "index" | "status">) => steps.push({ ...s, index: steps.length, status: "pending" });

  for (const section of sections) {
    if (section === "reading" || section === "listening") {
      const mst = mstFor(section, length);
      const router = pickComposition(pool, mst.router, used, seen, "mid", `${section} Module 1`);
      const lower = pickComposition(pool, mst.lower, used, seen, "low", `${section} Module 2 (lower)`);
      const upper = pickComposition(pool, mst.upper, used, seen, "high", `${section} Module 2 (upper)`);
      const back = section === "reading";
      add({ section, stage: "router", label: "Module 1", minutes: mst.router_minutes, allowBack: back, exerciseIds: router });
      add({ section, stage: "module2", label: "Module 2", minutes: null, allowBack: back, exerciseIds: [], candidates: { lower, upper, lowerMinutes: mst.lower_minutes, upperMinutes: mst.upper_minutes } });
    } else if (section === "writing") {
      const nBuild = length === "full" ? CONFIG.official.writing.build_a_sentence_items : 5;
      const build = pickComposition(pool, { build_a_sentence: nBuild }, used, seen, "mid", "Writing: Build a Sentence");
      add({ section, stage: "build", label: "Build a Sentence", minutes: length === "full" ? CONFIG.internal.writing_build_a_sentence_minutes : 3, allowBack: true, exerciseIds: build });
      add({ section, stage: "email", label: "Write an Email", minutes: 7, allowBack: false, exerciseIds: pickComposition(pool, { write_an_email: 1 }, used, seen, "mid", "Writing: Email") });
      if (length === "full")
        add({ section, stage: "discussion", label: "Academic Discussion", minutes: 10, allowBack: false, exerciseIds: pickComposition(pool, { academic_discussion: 1 }, used, seen, "mid", "Writing: Discussion") });
    } else {
      add({ section, stage: "repeat", label: "Listen and Repeat", minutes: null, allowBack: false, exerciseIds: pickComposition(pool, { listen_and_repeat: CONFIG.official.speaking.listen_and_repeat_items }, used, seen, "mid", "Speaking: Listen and Repeat") });
      if (length === "full")
        add({ section, stage: "interview", label: "Take an Interview", minutes: null, allowBack: false, exerciseIds: pickComposition(pool, { take_an_interview: CONFIG.official.speaking.interview_questions }, used, seen, "mid", "Speaking: Interview") });
    }
  }
  const allIds = steps.flatMap((s) => [...s.exerciseIds, ...(s.candidates?.lower ?? []), ...(s.candidates?.upper ?? [])]);
  const repeats = allIds.filter((id) => (seen.get(id) ?? 0) > 0).length;
  const notices: string[] = [];
  if (repeats) notices.push(`${repeats} of ${allIds.length} exercises in this form were already attempted by this user in earlier sessions. Scores on them may be inflated.`);
  if (length === "short") notices.push("Short simulation: an internal, reduced composition. It is not an official-format test.");
  return { steps, notices };
}

/** How many disjoint simulation forms the current bank can supply (no exercise reused inside or across forms). */
export function sufficiency(db: DB) {
  const pool = listExercises(db);
  const result: Record<string, { forms: number; blocker: string | null }> = {};
  const seen = new Map<string, number>();
  for (const scope of ["reading", "listening", "writing", "speaking", "full"] as Scope[])
    for (const length of ["full", "short"] as Length[]) {
      const used = new Set<string>();
      let forms = 0;
      let blocker: string | null = null;
      while (forms < 20) {
        try {
          const sections: Section[] = scope === "full" ? ["reading", "listening", "writing", "speaking"] : [scope];
          const trial = new Set(used);
          for (const s of sections) {
            if (s === "reading" || s === "listening") {
              const m = mstFor(s, length);
              pickComposition(pool, m.router, trial, seen, "mid", `${s} Module 1`);
              pickComposition(pool, m.lower, trial, seen, "low", `${s} lower`);
              pickComposition(pool, m.upper, trial, seen, "high", `${s} upper`);
            } else if (s === "writing") {
              pickComposition(pool, { build_a_sentence: length === "full" ? 10 : 5, write_an_email: 1, ...(length === "full" ? { academic_discussion: 1 } : {}) }, trial, seen, "mid", "writing");
            } else pickComposition(pool, { listen_and_repeat: 7, ...(length === "full" ? { take_an_interview: 4 } : {}) }, trial, seen, "mid", "speaking");
          }
          trial.forEach((id) => used.add(id));
          forms++;
        } catch (e) {
          blocker = e instanceof InsufficientContentError ? e.details.join("; ") : String(e);
          break;
        }
      }
      result[`${scope}:${length}`] = { forms, blocker };
    }
  return result;
}

interface SimRow {
  id: string;
  user_id: string;
  scope: Scope;
  length: Length;
  status: string;
  router_config_json: string;
  plan_json: string;
  step_index: number;
  routes_json: string;
  results_json: string | null;
  notices_json: string;
  started_at: string;
  completed_at: string | null;
}

export function routerConfig(threshold?: number, model?: RouterConfig["model"]): RouterConfig {
  const r = CONFIG.internal.routing;
  return {
    officialThreshold: null,
    trainingThreshold: threshold ?? r.training_threshold,
    trainingThetaCut: r.training_theta_cut,
    model: model ?? r.model,
  };
}

export function createSimulation(db: DB, userId: string, scope: Scope, length: Length, cfg: RouterConfig = routerConfig()) {
  const active = db.prepare("SELECT id FROM simulations WHERE user_id = ? AND status = 'active'").get(userId) as { id: string } | undefined;
  if (active) throw new Error(`An active simulation already exists (${active.id}). Finish or abandon it first.`);
  const { steps, notices } = planSimulation(db, userId, scope, length);
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO simulations (id, user_id, scope, length, status, router_config_json, plan_json, step_index, notices_json, started_at) VALUES (?, ?, ?, ?, 'active', ?, ?, 0, ?, ?)",
  ).run(id, userId, scope, length, JSON.stringify(cfg), JSON.stringify(steps), JSON.stringify(notices), nowIso());
  return getSimulation(db, id)!;
}

export function getSimulation(db: DB, id: string) {
  const r = db.prepare("SELECT * FROM simulations WHERE id = ?").get(id) as SimRow | undefined;
  if (!r) return null;
  return {
    id: r.id,
    user_id: r.user_id,
    scope: r.scope,
    length: r.length,
    status: r.status,
    router: json<RouterConfig>(r.router_config_json, routerConfig()),
    steps: json<Step[]>(r.plan_json, []),
    step_index: r.step_index,
    routes: json<Record<string, RouteDecision>>(r.routes_json, {}),
    results: json<unknown>(r.results_json, null),
    notices: json<string[]>(r.notices_json, []),
    started_at: r.started_at,
    completed_at: r.completed_at,
  };
}
export type Simulation = NonNullable<ReturnType<typeof getSimulation>>;

function saveSteps(db: DB, sim: Simulation) {
  db.prepare("UPDATE simulations SET plan_json = ?, step_index = ?, routes_json = ? WHERE id = ?").run(JSON.stringify(sim.steps), sim.step_index, JSON.stringify(sim.routes), sim.id);
}

/** Start the timer of the current step (creates a strict timing session). Idempotent. */
export function startStep(db: DB, simId: string) {
  const sim = getSimulation(db, simId);
  if (!sim || sim.status !== "active") throw new Error("simulation not active");
  const step = sim.steps[sim.step_index]!;
  if (step.sessionId) return currentView(db, simId);
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const deadline = step.minutes != null ? new Date(now.getTime() + step.minutes * 60000).toISOString() : null;
  db.prepare(
    `INSERT INTO sessions (id, user_id, kind, mode, simulation_id, status, time_limit_ms, started_at, deadline_at, state_json, updated_at)
     VALUES (?, ?, 'simulation_module', 'strict', ?, 'active', ?, ?, ?, '{}', ?)`,
  ).run(sessionId, sim.user_id, sim.id, step.minutes != null ? step.minutes * 60000 : null, now.toISOString(), deadline, now.toISOString());
  step.sessionId = sessionId;
  step.status = "active";
  saveSteps(db, sim);
  return currentView(db, simId);
}

export function saveStepState(db: DB, simId: string, state: unknown) {
  const sim = getSimulation(db, simId);
  const step = sim?.steps[sim.step_index];
  if (!sim || !step?.sessionId) throw new Error("no active step");
  db.prepare("UPDATE sessions SET state_json = ?, updated_at = ? WHERE id = ? AND status = 'active'").run(JSON.stringify(state ?? {}), nowIso(), step.sessionId);
}

export interface StepSubmission {
  responses: Record<string, unknown>;
  elapsedMs?: Record<string, number>;
  timedOut?: boolean;
}

export function submitStep(db: DB, simId: string, sub: StepSubmission) {
  const sim = getSimulation(db, simId);
  if (!sim || sim.status !== "active") throw new Error("simulation not active");
  const step = sim.steps[sim.step_index]!;
  if (!step.sessionId) throw new Error("step not started");
  const session = db.prepare("SELECT started_at, deadline_at, status FROM sessions WHERE id = ?").get(step.sessionId) as { started_at: string; deadline_at: string | null; status: string };
  if (session.status !== "active") throw new Error("step already submitted");
  const attemptIds: string[] = [];
  const total = Date.now() - Date.parse(session.started_at);
  for (const exId of step.exerciseIds) {
    const a = submitAttempt(db, {
      userId: sim.user_id,
      exerciseId: exId,
      response: sub.responses?.[exId] ?? null,
      mode: "strict",
      sessionId: null,
      simulationId: sim.id,
      moduleStage: `${step.section}:${step.stage}`,
      elapsedMs: sub.elapsedMs?.[exId] ?? Math.round(total / step.exerciseIds.length),
      timeLimitMs: step.minutes != null ? step.minutes * 60000 : null,
      deadlineAt: session.deadline_at,
      timedOut: !!sub.timedOut,
    });
    attemptIds.push(a.id);
  }
  const now = nowIso();
  db.prepare("UPDATE sessions SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?").run(sub.timedOut ? "expired" : "submitted", now, now, step.sessionId);
  step.attemptIds = attemptIds;
  step.status = "submitted";

  if (step.stage === "router") {
    const rows = db
      .prepare(`SELECT correct, b FROM item_responses WHERE attempt_id IN (${attemptIds.map(() => "?").join(",")}) AND correct IS NOT NULL`)
      .all(...attemptIds) as Array<{ correct: number; b: number }>;
    const decision = routeModule1(rows.map((r) => ({ correct: !!r.correct, b: r.b })), sim.router);
    step.route = decision;
    sim.routes[step.section] = decision;
    const next = sim.steps[sim.step_index + 1]!;
    next.exerciseIds = decision.route === "upper" ? next.candidates!.upper : next.candidates!.lower;
    next.minutes = decision.route === "upper" ? next.candidates!.upperMinutes : next.candidates!.lowerMinutes;
  }
  sim.step_index++;
  if (sim.step_index >= sim.steps.length) {
    saveSteps(db, sim);
    finalize(db, sim.id);
  } else saveSteps(db, sim);
  return getSimulation(db, simId)!;
}

/** Auto-submit an expired step from its last autosaved state (refresh/interruption safety). */
export function expireIfNeeded(db: DB, simId: string): boolean {
  const sim = getSimulation(db, simId);
  if (!sim || sim.status !== "active") return false;
  const step = sim.steps[sim.step_index];
  if (!step?.sessionId) return false;
  const s = db.prepare("SELECT deadline_at, status, state_json FROM sessions WHERE id = ?").get(step.sessionId) as { deadline_at: string | null; status: string; state_json: string };
  if (s.status !== "active" || !s.deadline_at || Date.now() <= Date.parse(s.deadline_at) + DEADLINE_GRACE_MS) return false;
  const state = json<{ responses?: Record<string, unknown>; elapsedMs?: Record<string, number> }>(s.state_json, {});
  submitStep(db, simId, { responses: state.responses ?? {}, elapsedMs: state.elapsedMs, timedOut: true });
  return true;
}

export function currentView(db: DB, simId: string) {
  expireIfNeeded(db, simId);
  const sim = getSimulation(db, simId);
  if (!sim) return null;
  const step = sim.status === "active" ? sim.steps[sim.step_index] : undefined;
  let session: { deadline_at: string | null; started_at: string; state: unknown } | null = null;
  if (step?.sessionId) {
    const s = db.prepare("SELECT deadline_at, started_at, state_json FROM sessions WHERE id = ?").get(step.sessionId) as { deadline_at: string | null; started_at: string; state_json: string };
    session = { deadline_at: s.deadline_at, started_at: s.started_at, state: json(s.state_json, {}) };
  }
  const exercises = step && step.exerciseIds.length ? step.exerciseIds.map((id) => toPublic(getExercise(db, id)!)) : [];
  return {
    simulation: {
      id: sim.id,
      scope: sim.scope,
      length: sim.length,
      status: sim.status,
      step_index: sim.step_index,
      steps: sim.steps.map((s) => ({ index: s.index, section: s.section, stage: s.stage, label: s.label, minutes: s.minutes, status: s.status, items: s.exerciseIds.length })),
      notices: sim.notices,
      router: { trainingThreshold: sim.router.trainingThreshold, model: sim.router.model, officialThreshold: null, warning: CONFIG.internal.routing.ui_warning },
      started_at: sim.started_at,
    },
    step: step ? { index: step.index, section: step.section, stage: step.stage, label: step.label, minutes: step.minutes, allowBack: step.allowBack, started: !!step.sessionId } : null,
    session,
    exercises,
    server_now: nowIso(),
  };
}

export function abandonSimulation(db: DB, simId: string) {
  const sim = getSimulation(db, simId);
  if (!sim) throw new Error("not found");
  db.prepare("UPDATE simulations SET status = 'abandoned', completed_at = ? WHERE id = ?").run(nowIso(), simId);
  db.prepare("UPDATE sessions SET status = 'abandoned', ended_at = ? WHERE simulation_id = ? AND status = 'active'").run(nowIso(), simId);
}

export function computeSimResults(db: DB, simId: string) {
  const sim = getSimulation(db, simId)!;
  const est = sectionEstimates(db, sim.user_id, { simulationId: simId });
  const scopeSections: Section[] = sim.scope === "full" ? ["reading", "listening", "writing", "speaking"] : [sim.scope];
  const sections = Object.fromEntries(scopeSections.map((s) => [s, est[s]])) as Record<Section, (typeof est)[Section]>;
  const { target } = userTarget(db, sim.user_id);
  const combined = sim.scope === "full" ? combine(est, target) : null;
  const pending = (db.prepare("SELECT COUNT(*) c FROM attempts WHERE simulation_id = ? AND pending = 1").get(simId) as { c: number }).c;
  const raw = db
    .prepare("SELECT section, SUM(raw_score) raw, SUM(max_score) max FROM attempts WHERE simulation_id = ? GROUP BY section")
    .all(simId) as Array<{ section: string; raw: number | null; max: number }>;
  return {
    sections,
    overall: combined?.overall ?? null,
    threshold: combined?.threshold ?? null,
    routes: sim.routes,
    raw,
    pending_attempts: pending,
    notices: sim.notices,
    disclaimer: "Internal training estimate. Routing threshold and band mapping are app parameters, not ETS values.",
  };
}

function finalize(db: DB, simId: string) {
  const results = computeSimResults(db, simId);
  db.prepare("UPDATE simulations SET status = 'completed', completed_at = ?, results_json = ? WHERE id = ?").run(nowIso(), JSON.stringify(results), simId);
  const sim = getSimulation(db, simId)!;
  snapshot(db, sim.user_id, `simulation:${sim.scope}`);
}

/** Recompute stored results (e.g. after AI evaluations complete). */
export function refreshResults(db: DB, simId: string) {
  const sim = getSimulation(db, simId);
  if (!sim || sim.status !== "completed") return sim?.results ?? null;
  const results = computeSimResults(db, simId);
  db.prepare("UPDATE simulations SET results_json = ? WHERE id = ?").run(JSON.stringify(results), simId);
  return results;
}
