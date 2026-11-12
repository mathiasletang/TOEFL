/** Daily plan for the Dashboard: today's blocks, launch targets, done flags, streak, next checkpoint. */
import type { DB } from "./db";
import { nowIso } from "./db";
import { pickExercise, focusNext } from "./analytics";
import { deckSummary } from "./vocabDeck";
import { CONFIG, type PlanBlockConfig } from "../shared/config";
import { TASK_LABEL } from "../shared/schema";
import { BASE_BLOCKS, addDays, blocksFor, daysBetween, localDate, nextCheckpoint, parseTask, phaseFor, streak, type PlanBlockId } from "../shared/plan";

const PLAN = CONFIG.internal.plan;
const SCOPE_LABEL: Record<string, string> = { reading: "Reading simulation", listening: "Listening simulation", writing: "Writing simulation", speaking: "Speaking simulation", full: "Full test" };

export type Launch =
  | { kind: "drill"; exercise_id: string; mode: "strict" | "practice" }
  | { kind: "simulation"; scope: string; length: "full" | "short" }
  | { kind: "vocab" }
  | null;

function dayStartIso(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toISOString();
}

export function taskLabel(task: string): string {
  const t = parseTask(task);
  if (!t) return task;
  if (t.kind === "focus") return "Focus weaknesses";
  if (t.kind === "simulation") return `${SCOPE_LABEL[t.scope]}${t.length === "short" ? " (short)" : ""}`;
  return TASK_LABEL[t.taskType];
}

function launchFor(db: DB, userId: string, task: string, mode: "strict" | "practice"): Launch {
  const t = parseTask(task);
  if (!t) return null;
  if (t.kind === "simulation") return { kind: "simulation", scope: t.scope, length: t.length };
  const id = t.kind === "focus" ? focusNext(db, userId)?.exercise_id : pickExercise(db, userId, t.taskType)?.id;
  return id ? { kind: "drill", exercise_id: id, mode } : null;
}

/** Drill attempts of this task made today (simulations excluded); null for focus and simulations. */
function progressToday(db: DB, userId: string, task: string, date: string): number | null {
  const t = parseTask(task);
  if (t?.kind !== "task") return null;
  const r = db
    .prepare("SELECT COUNT(*) n FROM attempts WHERE user_id = ? AND task_type = ? AND simulation_id IS NULL AND submitted_at >= ? AND submitted_at < ?")
    .get(userId, t.taskType, dayStartIso(date), dayStartIso(addDays(date, 1))) as { n: number };
  return r.n;
}

function block(db: DB, userId: string, id: "main" | "optional", b: PlanBlockConfig, date: string, done: Set<string>) {
  return { id, task: b.task, label: taskLabel(b.task), items: b.items, mode: b.mode, progress: progressToday(db, userId, b.task, date), launch: launchFor(db, userId, b.task, b.mode), done: done.has(id) };
}

function doneOn(db: DB, userId: string, date: string): Set<string> {
  return new Set((db.prepare("SELECT block FROM plan_checks WHERE user_id = ? AND date = ?").all(userId, date) as Array<{ block: string }>).map((r) => r.block));
}

export function planStreak(db: DB, userId: string, today: string): number {
  const rows = db.prepare("SELECT date, COUNT(*) n FROM plan_checks WHERE user_id = ? AND block IN (?, ?, ?) GROUP BY date").all(userId, ...BASE_BLOCKS) as Array<{ date: string; n: number }>;
  return streak(new Set(rows.filter((r) => r.n === BASE_BLOCKS.length).map((r) => r.date)), today);
}

export function dailyPlan(db: DB, userId: string, date = localDate()) {
  const u = db.prepare("SELECT target_band, exam_date FROM users WHERE id = ?").get(userId) as { target_band: number; exam_date: string | null };
  const done = doneOn(db, userId, date);
  const base = { date, exam_date: u.exam_date, target_band: u.target_band, streak: planStreak(db, userId, date) };
  if (!u.exam_date) return { ...base, status: "no_exam_date" as const, days_left: null, phase: null, blocks: [], checkpoint: null };
  const daysLeft = daysBetween(date, u.exam_date);
  const phase = phaseFor(daysLeft, PLAN.phases);
  if (!phase) return { ...base, status: daysLeft === 0 ? ("exam_day" as const) : ("past" as const), days_left: daysLeft, phase: null, blocks: [], checkpoint: null };
  const rot = blocksFor(PLAN, userId, phase.id, date)!;
  const v = deckSummary(db, userId);
  const blocks = [
    { id: "vocab" as const, label: "Vocabulary reviews", detail: `${v.due} due · ${v.new_left} new`, launch: { kind: "vocab" } as Launch, done: done.has("vocab") },
    {
      id: "shadowing" as const,
      label: "Shadowing",
      detail: `${PLAN.base.shadowing_minutes} min, repeating aloud after the audio`,
      launch: launchFor(db, userId, PLAN.base.shadowing_task, "practice"),
      done: done.has("shadowing"),
    },
    block(db, userId, "main", rot.main, date, done),
  ];
  return {
    ...base,
    status: "active" as const,
    days_left: daysLeft,
    phase: { id: phase.id, label: phase.label, goal: phase.goal, from_days: phase.from_days, to_days: phase.to_days },
    blocks,
    optional: rot.optional ? block(db, userId, "optional", rot.optional, date, done) : null,
    checkpoint: nextCheckpoint(daysLeft, u.exam_date, PLAN.checkpoints),
    base_done: BASE_BLOCKS.every((b) => done.has(b)),
  };
}

export function setPlanCheck(db: DB, userId: string, date: string, blockId: PlanBlockId, isDone: boolean): void {
  if (isDone) db.prepare("INSERT OR IGNORE INTO plan_checks (user_id, date, block, done_at) VALUES (?, ?, ?, ?)").run(userId, date, blockId, nowIso());
  else db.prepare("DELETE FROM plan_checks WHERE user_id = ? AND date = ? AND block = ?").run(userId, date, blockId);
}
