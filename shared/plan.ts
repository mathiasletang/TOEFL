/**
 * Daily plan: phase, weekday rotation, checkpoints and streak. Pure functions on calendar
 * dates (YYYY-MM-DD). The schedule is an internal training plan (config → internal.plan).
 */
import type { AppConfig, PlanBlockConfig } from "./config";
import { TASK_TYPES, type TaskType } from "./schema";

export type PlanConfig = AppConfig["internal"]["plan"];
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const PLAN_BLOCKS = ["vocab", "shadowing", "main", "optional"] as const;
export type PlanBlockId = (typeof PLAN_BLOCKS)[number];
/** Blocks that make up the daily base; a day counts toward the streak when all of them are done. */
export const BASE_BLOCKS: PlanBlockId[] = ["vocab", "shadowing", "main"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s: string) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86400000);
}
export function addDays(d: string, n: number): string {
  return new Date(utc(d) + n * 86400000).toISOString().slice(0, 10);
}
export function weekdayOf(d: string): Weekday {
  return WEEKDAYS[new Date(utc(d)).getUTCDay()]!;
}
/** Local calendar day of a timestamp (the machine running the server). */
export function localDate(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function phaseFor(daysLeft: number, phases: PlanConfig["phases"]) {
  if (daysLeft < 1) return null;
  return phases.find((p) => daysLeft >= p.to_days && (p.from_days == null || daysLeft <= p.from_days)) ?? null;
}

export type ParsedTask =
  | { kind: "task"; taskType: TaskType }
  | { kind: "focus" }
  | { kind: "simulation"; scope: "reading" | "listening" | "writing" | "speaking" | "full"; length: "full" | "short" };

export function parseTask(task: string): ParsedTask | null {
  if (task === "focus") return { kind: "focus" };
  const sim = /^simulation:(reading|listening|writing|speaking|full)(?::(full|short))?$/.exec(task);
  if (sim) return { kind: "simulation", scope: sim[1] as "full", length: (sim[2] as "short" | undefined) ?? "full" };
  return (TASK_TYPES as readonly string[]).includes(task) ? { kind: "task", taskType: task as TaskType } : null;
}

export function rotationFor(cfg: PlanConfig, userId: string) {
  return cfg.rotations[userId] ?? cfg.rotations.default!;
}

export function blocksFor(cfg: PlanConfig, userId: string, phaseId: string, date: string): { main: PlanBlockConfig; optional: PlanBlockConfig | null } | null {
  return rotationFor(cfg, userId)[phaseId]?.[weekdayOf(date)] ?? null;
}

/** The next checkpoint still ahead (or today): the one with the largest days_before ≤ days left. */
export function nextCheckpoint(daysLeft: number, examDate: string, checkpoints: PlanConfig["checkpoints"]) {
  const c = [...checkpoints].sort((a, b) => b.days_before - a.days_before).find((x) => x.days_before <= daysLeft);
  return c ? { ...c, date: addDays(examDate, -c.days_before), in_days: daysLeft - c.days_before } : null;
}

/** Consecutive days with every base block done, ending today (or yesterday if today is not finished yet). */
export function streak(completeDays: Set<string>, today: string): number {
  let d = completeDays.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (completeDays.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** Structural problems in the plan configuration (empty when valid). */
export function validatePlan(cfg: PlanConfig): string[] {
  const out: string[] = [];
  const ps = cfg.phases;
  if (!ps.length) out.push("no phases");
  if (ps[0] && ps[0].from_days != null) out.push("the first phase must be open-ended (from_days: null)");
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!;
    if (p.from_days != null && p.from_days < p.to_days) out.push(`${p.id}: from_days < to_days`);
    if (i > 0 && ps[i - 1]!.to_days - 1 !== p.from_days) out.push(`${p.id}: does not start the day after ${ps[i - 1]!.id} ends`);
  }
  if (ps.length && ps[ps.length - 1]!.to_days !== 1) out.push("the last phase must end at J-1");
  if (!cfg.rotations.default) out.push('rotations: a "default" rotation is required');
  for (const [who, rot] of Object.entries(cfg.rotations))
    for (const p of ps)
      for (const d of WEEKDAYS) {
        const b = rot[p.id]?.[d];
        if (!b) out.push(`${who}/${p.id}/${d}: missing`);
        else
          for (const blk of [b.main, b.optional]) {
            if (!blk) continue;
            if (!parseTask(blk.task)) out.push(`${who}/${p.id}/${d}: unknown task "${blk.task}"`);
            if (!(blk.items >= 1)) out.push(`${who}/${p.id}/${d}: items must be ≥ 1`);
            if (blk.mode !== "strict" && blk.mode !== "practice") out.push(`${who}/${p.id}/${d}: mode must be strict or practice`);
          }
      }
  for (const c of cfg.checkpoints) if (!parseTask(c.task)) out.push(`checkpoint "${c.label}": unknown task "${c.task}"`);
  if (!parseTask(cfg.base.shadowing_task)) out.push(`base: unknown shadowing task "${cfg.base.shadowing_task}"`);
  return out;
}
