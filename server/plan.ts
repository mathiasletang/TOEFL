/**
 * Daily plan for the Today page: today's blocks with their estimated duration and correction step,
 * launch targets, done flags, streak, next checkpoint, the real weekly mix and shadowing sessions.
 */
import type { DB } from "./db";
import { nowIso } from "./db";
import { pickExercise, focusNext } from "./analytics";
import { deckSummary } from "./vocabDeck";
import { listExercises } from "./content";
import { CONFIG, type PlanBlockConfig, type PlanCategory } from "../shared/config";
import { TASK_LABEL } from "../shared/schema";
import {
  BASE_BLOCKS,
  CATEGORY_LABEL,
  PLAN_CATEGORIES,
  addDays,
  blockMinutes,
  blocksFor,
  buildEstimates,
  categoryOf,
  daysBetween,
  localDate,
  nextCheckpoint,
  parseTask,
  phaseFor,
  segmentsPerSession,
  shadowSegments,
  streak,
  type PlanBlockId,
  type PlanEstimates,
  type ShadowSegment,
} from "../shared/plan";

const PLAN = CONFIG.internal.plan;
const SCOPE_LABEL: Record<string, string> = { reading: "Reading simulation", listening: "Listening simulation", writing: "Writing simulation", speaking: "Speaking simulation", full: "Full test" };

export type Launch =
  | { kind: "drill"; exercise_id: string; mode: "strict" | "practice"; origin: "focus" | null }
  | { kind: "simulation"; scope: string; length: "full" | "short" }
  | { kind: "vocab" }
  | { kind: "shadowing" }
  | null;

// Bank-derived values are computed once per database (content is loaded at startup).
const estimates = new WeakMap<DB, PlanEstimates>();
export function planEstimates(db: DB): PlanEstimates {
  let e = estimates.get(db);
  if (!e) estimates.set(db, (e = buildEstimates(listExercises(db, { activeOnly: true }), CONFIG)));
  return e;
}
const pools = new WeakMap<DB, ShadowSegment[]>();
export function shadowPool(db: DB): ShadowSegment[] {
  let p = pools.get(db);
  if (!p) pools.set(db, (p = shadowSegments(listExercises(db, { activeOnly: true }), PLAN.shadowing)));
  return p;
}

function dayStartIso(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toISOString();
}

export function taskLabel(task: string): string {
  const t = parseTask(task);
  if (!t) return task;
  if (t.kind === "focus") return "Focus weaknesses";
  if (t.kind === "simulation") return `${SCOPE_LABEL[t.scope]}${t.length === "short" ? " (short form)" : ""}`;
  return TASK_LABEL[t.taskType];
}

function launchFor(db: DB, userId: string, task: string, mode: "strict" | "practice"): Launch {
  const t = parseTask(task);
  if (!t) return null;
  if (t.kind === "simulation") return { kind: "simulation", scope: t.scope, length: t.length };
  const id = t.kind === "focus" ? focusNext(db, userId)?.exercise_id : pickExercise(db, userId, t.taskType)?.id;
  return id ? { kind: "drill", exercise_id: id, mode, origin: t.kind === "focus" ? "focus" : null } : null;
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

/** Where today's work for this block can be corrected: the latest review or simulation result of the day. */
function reviewTarget(db: DB, userId: string, task: string, date: string): string | null {
  const t = parseTask(task);
  const from = dayStartIso(date);
  const to = dayStartIso(addDays(date, 1));
  if (!t) return null;
  if (t.kind === "simulation") {
    const r = db
      .prepare("SELECT id FROM simulations WHERE user_id = ? AND scope = ? AND status = 'completed' AND completed_at >= ? AND completed_at < ? ORDER BY completed_at DESC LIMIT 1")
      .get(userId, t.scope, from, to) as { id: string } | undefined;
    return r ? `sim/${r.id}/results` : null;
  }
  const r = (
    t.kind === "focus"
      ? db
          .prepare(
            "SELECT a.id FROM attempts a JOIN sessions s ON s.id = a.session_id WHERE a.user_id = ? AND s.origin = 'focus' AND a.submitted_at >= ? AND a.submitted_at < ? ORDER BY a.submitted_at DESC LIMIT 1",
          )
          .get(userId, from, to)
      : db
          .prepare("SELECT id FROM attempts WHERE user_id = ? AND task_type = ? AND simulation_id IS NULL AND submitted_at >= ? AND submitted_at < ? ORDER BY submitted_at DESC LIMIT 1")
          .get(userId, t.taskType, from, to)
  ) as { id: string } | undefined;
  return r ? `review/${r.id}` : null;
}

function block(db: DB, userId: string, id: "main" | "optional", b: PlanBlockConfig, date: string, done: Set<string>) {
  const m = blockMinutes(b, planEstimates(db));
  const category = categoryOf(b.task);
  const c = id === "main" && category && b.correction_minutes ? PLAN.correction[category] : null;
  return {
    id,
    task: b.task,
    label: taskLabel(b.task),
    category,
    items: b.items,
    mode: b.mode,
    minutes: { work: m.work == null ? null : Math.round(m.work), correction: m.correction, total: m.total == null ? null : Math.round(m.total) },
    correction: c ? { ...c, minutes: b.correction_minutes!, review_path: reviewTarget(db, userId, b.task, date) } : null,
    progress: progressToday(db, userId, b.task, date),
    launch: launchFor(db, userId, b.task, b.mode),
    done: done.has(id),
  };
}

function doneOn(db: DB, userId: string, date: string): Set<string> {
  return new Set((db.prepare("SELECT block FROM plan_checks WHERE user_id = ? AND date = ?").all(userId, date) as Array<{ block: string }>).map((r) => r.block));
}

export function planStreak(db: DB, userId: string, today: string): number {
  const rows = db.prepare("SELECT date, COUNT(*) n FROM plan_checks WHERE user_id = ? AND block IN (?, ?, ?) GROUP BY date").all(userId, ...BASE_BLOCKS) as Array<{ date: string; n: number }>;
  return streak(new Set(rows.filter((r) => r.n === BASE_BLOCKS.length).map((r) => r.date)), today);
}

export function hasFullSimulation(db: DB, userId: string): boolean {
  return !!db.prepare("SELECT 1 FROM simulations WHERE user_id = ? AND scope = 'full' AND status = 'completed' LIMIT 1").get(userId);
}

/**
 * Real practice mix over the 7 days ending on `date`, from the time recorded on attempts.
 * Drills started from Focus weaknesses count as "focus"; everything else counts in its section.
 */
export function weekActual(db: DB, userId: string, date: string) {
  const rows = db
    .prepare(
      `SELECT a.section, s.origin, SUM(a.elapsed_ms) ms FROM attempts a LEFT JOIN sessions s ON s.id = a.session_id
       WHERE a.user_id = ? AND a.submitted_at >= ? AND a.submitted_at < ? GROUP BY a.section, s.origin`,
    )
    .all(userId, dayStartIso(addDays(date, -6)), dayStartIso(addDays(date, 1))) as Array<{ section: string; origin: string | null; ms: number }>;
  const minutes = Object.fromEntries(PLAN_CATEGORIES.map((c) => [c, 0])) as Record<PlanCategory, number>;
  const bySection: Record<string, number> = { reading: 0, listening: 0, writing: 0, speaking: 0 };
  for (const r of rows) {
    const m = (r.ms ?? 0) / 60000;
    bySection[r.section] = (bySection[r.section] ?? 0) + m;
    const c: PlanCategory = r.origin === "focus" ? "focus" : r.section === "writing" || r.section === "speaking" ? r.section : "reading_listening";
    minutes[c] += m;
  }
  const total = Object.values(minutes).reduce((a, b) => a + b, 0);
  return {
    from: addDays(date, -6),
    to: date,
    total_minutes: Math.round(total),
    by_section: Object.fromEntries(Object.entries(bySection).map(([k, v]) => [k, Math.round(v)])),
    categories: PLAN_CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c], minutes: Math.round(minutes[c]), share: total ? minutes[c] / total : null, target: PLAN.targets.shares[c] })),
    tolerance: PLAN.targets.tolerance,
  };
}

export function dailyPlan(db: DB, userId: string, date = localDate()) {
  const u = db.prepare("SELECT target_band, exam_date FROM users WHERE id = ?").get(userId) as { target_band: number; exam_date: string | null };
  const done = doneOn(db, userId, date);
  const base = {
    date,
    exam_date: u.exam_date,
    target_band: u.target_band,
    streak: planStreak(db, userId, date),
    week: weekActual(db, userId, date),
    week_days: planWeekDays(db, userId, date),
  };
  if (!u.exam_date) return { ...base, status: "no_exam_date" as const, days_left: null, phase: null, blocks: [], checkpoint: null };
  const daysLeft = daysBetween(date, u.exam_date);
  const phase = phaseFor(daysLeft, PLAN.phases);
  if (!phase) return { ...base, status: daysLeft === 0 ? ("exam_day" as const) : ("past" as const), days_left: daysLeft, phase: null, blocks: [], checkpoint: null };
  const rot = blocksFor(PLAN, userId, phase.id, date)!;
  const v = deckSummary(db, userId);
  const sh = PLAN.shadowing;
  const planned = block(db, userId, "main", rot.main, date, done);
  // Until a full simulation exists, the day's main block is the diagnostic.
  const diagnostic = !hasFullSimulation(db, userId);
  const main = diagnostic
    ? {
        ...block(db, userId, "main", { task: PLAN.diagnostic.task, items: 1, mode: "strict" }, date, done),
        label: PLAN.diagnostic.label,
        diagnostic: { note: PLAN.diagnostic.note, replaces: planned.label },
      }
    : { ...planned, diagnostic: null };
  const blocks = [
    { id: "vocab" as const, label: "Vocabulary reviews", detail: `${v.due} due · ${v.new_left} new`, launch: { kind: "vocab" } as Launch, done: done.has("vocab") },
    {
      id: "shadowing" as const,
      label: "Shadowing",
      detail: `${sh.minutes} min · ${segmentsPerSession(shadowPool(db).length, sh)} short segments from conversations and talks`,
      launch: { kind: "shadowing" } as Launch,
      done: done.has("shadowing"),
    },
    main,
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
    road: planRoad(db, userId, date, u.exam_date),
  };
}

/** Days on which every base block was done, between two dates (inclusive). */
export function baseDoneDates(db: DB, userId: string, from: string, to: string): string[] {
  const rows = db
    .prepare("SELECT date FROM plan_checks WHERE user_id = ? AND block IN (?, ?, ?) AND date >= ? AND date <= ? GROUP BY date HAVING COUNT(*) = ? ORDER BY date")
    .all(userId, ...BASE_BLOCKS, from, to, BASE_BLOCKS.length) as Array<{ date: string }>;
  return rows.map((r) => r.date);
}

/**
 * The road from the start of the plan to the exam: the plan starts with the first phase that has a
 * fixed length (or earlier if the profile was already training), never after today.
 * Phases and checkpoints are converted to calendar dates; `done` lists the days with the full base.
 */
/** The current week (Monday to Sunday) with the days on which the full base was done. */
export function planWeekDays(db: DB, userId: string, today: string) {
  const start = addDays(today, -((new Date(`${today}T12:00:00`).getDay() + 6) % 7));
  return { start, today, done: baseDoneDates(db, userId, start, today) };
}

export function planRoad(db: DB, userId: string, today: string, examDate: string) {
  const first = PLAN.phases.reduce((m, p) => Math.max(m, p.from_days ?? p.to_days), 0);
  const activity = db
    .prepare("SELECT MIN(d) d FROM (SELECT MIN(date) d FROM plan_checks WHERE user_id = ? UNION ALL SELECT MIN(substr(submitted_at, 1, 10)) FROM attempts WHERE user_id = ?)")
    .get(userId, userId) as { d: string | null };
  const start = [addDays(examDate, -first), today, activity.d].filter((d): d is string => !!d).sort()[0]!;
  const end = addDays(examDate, -1);
  return {
    start,
    exam_date: examDate,
    done: baseDoneDates(db, userId, start, today),
    phases: PLAN.phases
      .map((p) => ({ id: p.id, label: p.label, from: p.from_days == null ? start : addDays(examDate, -p.from_days), to: addDays(examDate, -p.to_days) }))
      .map((p) => ({ ...p, from: p.from < start ? start : p.from, to: p.to > end ? end : p.to }))
      .filter((p) => p.from <= p.to),
    checkpoints: PLAN.checkpoints.map((c) => ({ date: addDays(examDate, -c.days_before), label: c.label, days_before: c.days_before })).filter((c) => c.date >= start),
  };
}

export function setPlanCheck(db: DB, userId: string, date: string, blockId: PlanBlockId, isDone: boolean): void {
  if (isDone) db.prepare("INSERT OR IGNORE INTO plan_checks (user_id, date, block, done_at) VALUES (?, ?, ?, ?)").run(userId, date, blockId, nowIso());
  else db.prepare("DELETE FROM plan_checks WHERE user_id = ? AND date = ? AND block = ?").run(userId, date, blockId);
}

// ---------------------------------------------------------------- shadowing

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The day's shadowing segments. Chosen once per day and stored, never one served in the previous
 * `no_repeat_days` days; least recently served first. Only if the pool is too small are recent
 * segments reused (oldest first), and the session says how many.
 */
export function shadowingSession(db: DB, userId: string, date: string) {
  const sh = PLAN.shadowing;
  const pool = shadowPool(db);
  const byId = new Map(pool.map((s) => [s.id, s]));
  const n = segmentsPerSession(pool.length, sh);
  let rows = db.prepare("SELECT segment_id FROM shadowing_log WHERE user_id = ? AND date = ? ORDER BY position").all(userId, date) as Array<{ segment_id: string }>;
  let repeats = 0;
  if (!rows.length && pool.length) {
    const since = addDays(date, -(sh.no_repeat_days - 1));
    const last = new Map(
      (db.prepare("SELECT segment_id, MAX(date) d FROM shadowing_log WHERE user_id = ? AND date < ? GROUP BY segment_id").all(userId, date) as Array<{ segment_id: string; d: string }>).map((r) => [
        r.segment_id,
        r.d,
      ]),
    );
    const order = (a: ShadowSegment, b: ShadowSegment) => (last.get(a.id) ?? "").localeCompare(last.get(b.id) ?? "") || hash(userId + a.id) - hash(userId + b.id);
    const fresh = pool.filter((s) => (last.get(s.id) ?? "") < since).sort(order);
    const picked = fresh.slice(0, n);
    if (picked.length < n) {
      const reused = pool.filter((s) => !picked.includes(s)).sort(order).slice(0, n - picked.length);
      repeats = reused.length;
      picked.push(...reused);
    }
    const ins = db.prepare("INSERT INTO shadowing_log (user_id, date, segment_id, position) VALUES (?, ?, ?, ?)");
    db.transaction(() => picked.forEach((s, i) => ins.run(userId, date, s.id, i)))();
    rows = picked.map((s) => ({ segment_id: s.id }));
  }
  return {
    date,
    minutes: sh.minutes,
    instruction: sh.instruction,
    no_repeat_days: sh.no_repeat_days,
    pool: pool.length,
    per_session: n,
    repeats,
    segments: rows.flatMap((r) => {
      const s = byId.get(r.segment_id);
      return s ? [{ ...s, source: TASK_LABEL[s.task_type] }] : [];
    }),
  };
}
