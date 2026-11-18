/**
 * Daily plan: phase, weekday rotation, checkpoints and streak. Pure functions on calendar
 * dates (YYYY-MM-DD). The schedule is an internal training plan (config → internal.plan).
 */
import type { AppConfig, PlanBlockConfig, PlanCategory } from "./config";
import { TASK_SECTION, TASK_TYPES, type Exercise, type TaskType } from "./schema";
import { drillSeconds } from "./publicView";
import { countWords } from "./ctw";

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

// ---------------------------------------------------------------- durations

export const PLAN_CATEGORIES: PlanCategory[] = ["writing", "speaking", "reading_listening", "focus"];
export const CATEGORY_LABEL: Record<PlanCategory, string> = { writing: "Writing", speaking: "Speaking", reading_listening: "Reading + Listening", focus: "Focus weaknesses" };

/** Category of a block task; full tests belong to no single category. */
export function categoryOf(task: string): PlanCategory | null {
  const t = parseTask(task);
  if (!t) return null;
  if (t.kind === "focus") return "focus";
  const section = t.kind === "simulation" ? t.scope : TASK_SECTION[t.taskType];
  if (section === "full") return null;
  return section === "writing" || section === "speaking" ? section : "reading_listening";
}

/**
 * Estimated working time of one exercise, in seconds: the drill time limit (drill_seconds),
 * plus listening audio, which plays before the clock starts; speaking tasks are paced by
 * their prompts and response windows.
 */
export function exerciseSeconds(ex: Exercise, cfg: AppConfig): number {
  const wps = cfg.internal.plan.estimates.audio_words_per_minute / 60;
  switch (ex.task_type) {
    case "listen_and_repeat":
      return ex.items.reduce((a, it) => a + it.response_seconds + countWords(it.text) / wps, 0);
    case "take_an_interview":
      return ex.questions.reduce((a, q) => a + ex.response_seconds + countWords(q.prompt) / wps, 0);
    default: {
      const audio = "audio" in ex ? countWords(ex.audio.map((a) => a.text).join(" ")) / wps : 0;
      return (drillSeconds(ex, cfg.internal.drill_seconds as unknown as Record<string, number>) ?? 0) + audio;
    }
  }
}

export interface PlanEstimates {
  /** Mean minutes per exercise, by task type (from the exercise bank). */
  perExercise: Partial<Record<TaskType, number>>;
  /** Minutes for `items` units of a block task (a task type, focus, or a simulation). */
  minutes: (task: string, items: number) => number | null;
}

export function buildEstimates(exercises: Exercise[], cfg: AppConfig): PlanEstimates {
  const sums: Partial<Record<TaskType, [number, number]>> = {};
  for (const ex of exercises) {
    const v = (sums[ex.task_type] ??= [0, 0]);
    v[0] += exerciseSeconds(ex, cfg) / 60;
    v[1]++;
  }
  const perExercise: Partial<Record<TaskType, number>> = {};
  for (const [t, [total, n]] of Object.entries(sums) as Array<[TaskType, [number, number]]>) perExercise[t] = total / n;
  const known = Object.values(perExercise);
  // Focus draws from every task type: use the mean of the per-task means.
  const focus = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  const o = cfg.official;
  const short = cfg.internal.short_simulation;
  const section = (scope: "reading" | "listening" | "writing" | "speaking", length: "full" | "short"): number => {
    if (scope === "reading" || scope === "listening") {
      const m = length === "short" ? short[scope] : o.mst[scope];
      return m.router_minutes + Math.max(m.lower_minutes, m.upper_minutes);
    }
    if (scope === "writing") return cfg.internal.writing_build_a_sentence_minutes + o.writing.email_seconds / 60 + o.writing.discussion_seconds / 60;
    return (perExercise.listen_and_repeat ?? 0) + (perExercise.take_an_interview ?? 0);
  };
  return {
    perExercise,
    minutes(task, items) {
      const t = parseTask(task);
      if (!t) return null;
      if (t.kind === "focus") return focus * items;
      if (t.kind === "task") return perExercise[t.taskType] == null ? null : perExercise[t.taskType]! * items;
      const one = t.scope === "full" ? (["reading", "listening", "writing", "speaking"] as const).reduce((a, s) => a + section(s, t.length), 0) : section(t.scope, t.length);
      return one * items;
    },
  };
}

export function blockMinutes(b: PlanBlockConfig, est: PlanEstimates) {
  const work = est.minutes(b.task, b.items);
  const correction = b.correction_minutes ?? 0;
  return { work, correction, total: work == null ? null : work + correction };
}

/** Main-block minutes per category over one week of a phase, with shares and day counts. */
export function weekMix(week: Record<string, { main: PlanBlockConfig }>, est: PlanEstimates) {
  const out = Object.fromEntries(PLAN_CATEGORIES.map((c) => [c, { minutes: 0, days: 0, share: 0 }])) as Record<PlanCategory, { minutes: number; days: number; share: number }>;
  let total = 0;
  for (const d of WEEKDAYS) {
    const b = week[d]?.main;
    if (!b) continue;
    const c = categoryOf(b.task);
    const m = blockMinutes(b, est).total ?? 0;
    total += m;
    if (c) {
      out[c].minutes += m;
      out[c].days++;
    }
  }
  for (const c of PLAN_CATEGORIES) out[c].share = total ? out[c].minutes / total : 0;
  return { total, categories: out };
}

/** Structural problems in the plan configuration (empty when valid). With estimates, durations and the weekly mix are checked too. */
export function validatePlan(cfg: PlanConfig, est?: PlanEstimates): string[] {
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
  const { min_minutes, max_minutes } = cfg.main_block;
  for (const [who, rot] of Object.entries(cfg.rotations))
    for (const p of ps) {
      for (const d of WEEKDAYS) {
        const b = rot[p.id]?.[d];
        const where = `${who}/${p.id}/${d}`;
        if (!b) {
          out.push(`${where}: missing`);
          continue;
        }
        for (const [kind, blk] of [["main", b.main], ["optional", b.optional]] as const) {
          if (!blk) continue;
          if (!parseTask(blk.task)) out.push(`${where}: unknown task "${blk.task}"`);
          if (!(blk.items >= 1)) out.push(`${where}: items must be ≥ 1`);
          if (blk.mode !== "strict" && blk.mode !== "practice") out.push(`${where}: mode must be strict or practice`);
          if (kind === "main") {
            if (!categoryOf(blk.task)) out.push(`${where}: a main block must belong to one category (no full test)`);
            if (!(blk.correction_minutes! > 0)) out.push(`${where}: a main block needs correction_minutes`);
            const m = est ? blockMinutes(blk, est).total : null;
            if (est && (m == null || m < min_minutes || m > max_minutes)) out.push(`${where}: main block lasts ${m == null ? "?" : m.toFixed(1)} min (expected ${min_minutes}–${max_minutes})`);
          }
        }
      }
      if (!est || !rot[p.id]) continue;
      const mix = weekMix(rot[p.id]!, est);
      for (const c of PLAN_CATEGORIES) {
        const got = mix.categories[c];
        const want = cfg.targets.shares[c];
        if (Math.abs(got.share - want) > cfg.targets.tolerance + 1e-9) out.push(`${who}/${p.id}: ${c} gets ${(got.share * 100).toFixed(1)} % of main-block time (target ${(want * 100).toFixed(0)} % ± ${(cfg.targets.tolerance * 100).toFixed(0)})`);
        const minDays = cfg.targets.min_days[c];
        if (minDays != null && got.days < minDays) out.push(`${who}/${p.id}: ${c} on ${got.days} day(s) (at least ${minDays})`);
      }
    }
  for (const c of cfg.checkpoints) if (!parseTask(c.task)) out.push(`checkpoint "${c.label}": unknown task "${c.task}"`);
  if (!parseTask(cfg.diagnostic.task)) out.push(`diagnostic: unknown task "${cfg.diagnostic.task}"`);
  return out;
}

// ---------------------------------------------------------------- shadowing

export interface ShadowSegment {
  id: string;
  exercise_id: string;
  task_type: TaskType;
  text: string;
  voice: "female" | "male" | "neutral";
  speaker_index: number;
  words: number;
}

/**
 * Short shadowing segments cut from listening scripts: whole sentences of at most `max_words`
 * words; longer sentences are split at commas, semicolons, colons or dashes. Pieces under
 * `min_words` are dropped. Ids are stable as long as the scripts do not change.
 */
export function shadowSegments(exercises: Exercise[], cfg: PlanConfig["shadowing"]): ShadowSegment[] {
  const out: ShadowSegment[] = [];
  for (const ex of exercises) {
    if (!cfg.sources.includes(ex.task_type) || !("audio" in ex)) continue;
    const speakers = [...new Set(ex.audio.map((a) => a.speaker))];
    ex.audio.forEach((seg, si) => {
      const sentences = seg.text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+["”’]?|[^.!?]+$/g) ?? [];
      let k = 0;
      const push = (words: string[]) => {
        if (words.length >= cfg.min_words && words.length <= cfg.max_words)
          out.push({ id: `${ex.id}:${si}:${k++}`, exercise_id: ex.id, task_type: ex.task_type, text: words.join(" "), voice: seg.voice, speaker_index: speakers.indexOf(seg.speaker), words: words.length });
      };
      for (const sentence of sentences) {
        const words = sentence.trim().split(" ");
        if (words.length <= cfg.max_words) {
          push(words);
          continue;
        }
        let cur: string[] = [];
        for (const part of sentence.trim().split(/(?<=[,;:—])\s+/)) {
          const pw = part.split(" ");
          if (cur.length + pw.length <= cfg.max_words) cur.push(...pw);
          else {
            push(cur);
            cur = pw.length <= cfg.max_words ? pw : [];
          }
        }
        push(cur);
      }
    });
  }
  return out;
}

/** Segments per session: as many as the pool allows without repeating within the no-repeat window. */
export function segmentsPerSession(poolSize: number, cfg: PlanConfig["shadowing"]): number {
  return Math.max(1, Math.min(cfg.max_segments, Math.floor(poolSize / cfg.no_repeat_days)));
}
