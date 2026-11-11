/**
 * Training analytics. Every number produced here is an INTERNAL estimate built
 * from this app's own exercises; none of it is an official TOEFL score.
 */
import type { DB } from "./db";
import { vocabErrorStats } from "./vocabDeck";
import { json, nowIso } from "./db";
import { CONFIG, thetaToBand, proportionToBand } from "../shared/config";
import { estimateTheta } from "../shared/irt";
import { roundHalf, minimumSumFor, cefrForBand, overallBand, type SectionBands } from "../shared/bands";
import { SECTIONS, TASK_TYPES, TASK_SECTION, TASK_LABEL, type Section, type TaskType } from "../shared/schema";
import { ERROR_TAG_LABELS } from "../shared/errors";
import { listExercises } from "./content";

export type Confidence = "insufficient" | "low" | "medium";

export interface SectionEstimate {
  section: Section;
  band: number | null;
  range: [number, number] | null;
  confidence: Confidence;
  evidence: string;
  n: number;
  method: string;
  components?: Record<string, { value: number | null; n: number; weight: number }>;
}

export interface Projection {
  generated_at: string;
  target_band: number;
  sections: Record<Section, SectionEstimate>;
  overall: { band: number | null; mean: number | null; range: [number, number] | null; cefr: string | null; confidence: Confidence };
  threshold: { target: number; minimum_mean: number; minimum_sum: number; current_sum: number | null; gap_sum: number | null };
  disclaimer: string;
}

interface ItemRow {
  section: string;
  task_type: string;
  correct: number | null;
  score: number | null;
  max_score: number;
  b: number;
  skill: string | null;
  error_tag: string | null;
  elapsed_ms: number | null;
  created_at: string;
  exercise_id: string;
  attempt_id: string;
}

function items(db: DB, userId: string, where = "", params: unknown[] = []): ItemRow[] {
  return db
    .prepare(
      `SELECT section, task_type, correct, score, max_score, b, skill, error_tag, elapsed_ms, created_at, exercise_id, attempt_id
       FROM item_responses WHERE user_id = ? ${where} ORDER BY created_at DESC, id DESC`,
    )
    .all(userId, ...params) as ItemRow[];
}

function confidenceFor(n: number, min: number, mediumAt: number): Confidence {
  if (n < min) return "insufficient";
  return n >= mediumAt ? "medium" : "low";
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Receptive sections: Rasch EAP over recent objective items (author-estimated difficulty). */
function receptiveEstimate(db: DB, userId: string, section: "reading" | "listening", scope?: { simulationId?: string }): SectionEstimate {
  const P = CONFIG.internal.projection;
  const rows = scope?.simulationId
    ? (db
        .prepare(
          `SELECT ir.* FROM item_responses ir JOIN attempts a ON a.id = ir.attempt_id WHERE a.simulation_id = ? AND ir.section = ? AND ir.correct IS NOT NULL`,
        )
        .all(scope.simulationId, section) as ItemRow[])
    : items(db, userId, "AND section = ? AND correct IS NOT NULL", [section]).slice(0, P.recent_window_items);
  const n = rows.length;
  const conf = confidenceFor(n, P.min_items_for_estimate, 40);
  const acc = n ? rows.filter((r) => r.correct).length / n : null;
  if (conf === "insufficient")
    return { section, band: null, range: null, confidence: conf, n, method: "irt-lite", evidence: `${n} scored item(s); at least ${P.min_items_for_estimate} needed.` };
  const est = estimateTheta(rows.map((r) => ({ b: r.b, correct: !!r.correct })));
  const band = thetaToBand(est.theta);
  const range: [number, number] = [thetaToBand(est.theta - est.sd), thetaToBand(est.theta + est.sd)];
  return {
    section,
    band,
    range,
    confidence: conf,
    n,
    method: "irt-lite",
    evidence: `${n} items, training accuracy ${(acc! * 100).toFixed(0)}%, ability θ=${est.theta.toFixed(2)}±${est.sd.toFixed(2)} (author-estimated item difficulty).`,
  };
}

function productiveRubrics(db: DB, userId: string, taskType: string, limit: number, simulationId?: string) {
  const rows = (
    simulationId
      ? db.prepare(`SELECT ir.score, ir.max_score FROM item_responses ir JOIN attempts a ON a.id = ir.attempt_id WHERE a.simulation_id = ? AND ir.task_type = ? AND ir.score IS NOT NULL`).all(simulationId, taskType)
      : db.prepare(`SELECT score, max_score FROM item_responses WHERE user_id = ? AND task_type = ? AND score IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT ?`).all(userId, taskType, limit)
  ) as Array<{ score: number; max_score: number }>;
  return rows.map((r) => r.score / r.max_score);
}

/** Writing (20 raw points) and Speaking (55 raw points) — proportion of blueprint raw points from recent evidence. */
function productiveEstimate(db: DB, userId: string, section: "writing" | "speaking", scope?: { simulationId?: string }): SectionEstimate {
  const parts: Array<{ key: string; task: TaskType; weight: number; limit: number }> =
    section === "writing"
      ? [
          { key: "build_a_sentence", task: "build_a_sentence", weight: 10, limit: 30 },
          { key: "write_an_email", task: "write_an_email", weight: 5, limit: 5 },
          { key: "academic_discussion", task: "academic_discussion", weight: 5, limit: 5 },
        ]
      : [
          { key: "listen_and_repeat", task: "listen_and_repeat", weight: 35, limit: 28 },
          { key: "take_an_interview", task: "take_an_interview", weight: 20, limit: 12 },
        ];
  const components: NonNullable<SectionEstimate["components"]> = {};
  let wsum = 0;
  let psum = 0;
  let n = 0;
  for (const p of parts) {
    const vals = productiveRubrics(db, userId, p.task, p.limit, scope?.simulationId);
    const v = mean(vals);
    components[p.key] = { value: v, n: vals.length, weight: p.weight };
    n += vals.length;
    if (v != null) {
      wsum += p.weight;
      psum += p.weight * v;
    }
  }
  const covered = parts.filter((p) => (components[p.key]?.n ?? 0) > 0).length;
  const minN = section === "writing" ? 5 : 7;
  if (wsum === 0 || n < minN)
    return {
      section,
      band: null,
      range: null,
      confidence: "insufficient",
      n,
      method: "raw-proportion",
      components,
      evidence: `${n} scored response(s). Writing/Speaking need scored productive responses (AI evaluation, transcripts or self-ratings).`,
    };
  const p = psum / wsum;
  const band = proportionToBand(p);
  const conf: Confidence = covered === parts.length && n >= minN * 2 ? "medium" : "low";
  const spread = conf === "medium" ? 0.06 : 0.12;
  return {
    section,
    band,
    range: [proportionToBand(Math.max(0, p - spread)), proportionToBand(Math.min(1, p + spread))],
    confidence: conf,
    n,
    method: "raw-proportion",
    components,
    evidence: `${(p * 100).toFixed(0)}% of blueprint raw points on ${covered}/${parts.length} task types${covered < parts.length ? " (missing task types weighted out)" : ""}.`,
  };
}

export function sectionEstimates(db: DB, userId: string, scope?: { simulationId?: string }): Record<Section, SectionEstimate> {
  return {
    reading: receptiveEstimate(db, userId, "reading", scope),
    listening: receptiveEstimate(db, userId, "listening", scope),
    writing: productiveEstimate(db, userId, "writing", scope),
    speaking: productiveEstimate(db, userId, "speaking", scope),
  };
}

export function combine(sections: Record<Section, SectionEstimate>, target: number): Pick<Projection, "overall" | "threshold"> {
  const all = SECTIONS.every((s) => sections[s].band != null);
  const minSum = minimumSumFor(target);
  if (!all)
    return {
      overall: { band: null, mean: null, range: null, cefr: null, confidence: "insufficient" },
      threshold: { target, minimum_mean: target - 0.25, minimum_sum: minSum, current_sum: null, gap_sum: null },
    };
  const b = Object.fromEntries(SECTIONS.map((s) => [s, sections[s].band!])) as SectionBands;
  const sum = b.reading + b.listening + b.writing + b.speaking;
  const lo = SECTIONS.reduce((a, s) => a + sections[s].range![0], 0) / 4;
  const hi = SECTIONS.reduce((a, s) => a + sections[s].range![1], 0) / 4;
  const band = overallBand(b);
  const conf: Confidence = SECTIONS.some((s) => sections[s].confidence === "low") ? "low" : "medium";
  return {
    overall: { band, mean: sum / 4, range: [roundHalf(lo), roundHalf(hi)], cefr: cefrForBand(band), confidence: conf },
    threshold: { target, minimum_mean: target - 0.25, minimum_sum: minSum, current_sum: sum, gap_sum: Math.max(0, minSum - sum) },
  };
}

export function userTarget(db: DB, userId: string): { target: number; examDate: string | null } {
  const u = db.prepare("SELECT target_band, exam_date FROM users WHERE id = ?").get(userId) as { target_band: number; exam_date: string | null } | undefined;
  return { target: u?.target_band ?? CONFIG.internal.default_target_band, examDate: u?.exam_date ?? null };
}

export function computeProjection(db: DB, userId: string): Projection {
  const { target } = userTarget(db, userId);
  const sections = sectionEstimates(db, userId);
  return {
    generated_at: nowIso(),
    target_band: target,
    sections,
    ...combine(sections, target),
    disclaimer: "Internal training estimate from this app's exercises. Not an official TOEFL score; ETS scoring and equating are proprietary.",
  };
}

export function snapshot(db: DB, userId: string, reason: string): void {
  const p = computeProjection(db, userId);
  db.prepare("INSERT INTO progress_snapshots (user_id, created_at, reason, projection_json) VALUES (?, ?, ?, ?)").run(userId, p.generated_at, reason, JSON.stringify(p));
}

// ---------------------------------------------------------------- task metrics

export interface TaskMetric {
  task_type: TaskType;
  label: string;
  section: Section;
  attempts: number;
  items: number;
  recent_accuracy: number | null;
  ewma: number | null;
  trend: number | null; // recent EWMA − earlier EWMA
  mean_seconds_per_item: number | null;
  target_seconds_per_item: number | null;
  last_practiced: string | null;
  days_since: number | null;
  timing_violations_7d: number;
}

const TARGET_SECONDS: Partial<Record<TaskType, number>> = {
  complete_the_words: 13,
  read_in_daily_life: 35,
  read_academic_passage: 45,
  listen_choose_response: 20,
  conversation: 30,
  announcement: 30,
  academic_talk: 35,
  build_a_sentence: 25,
};

export function taskMetrics(db: DB, userId: string): TaskMetric[] {
  const alpha = CONFIG.internal.projection.ewma_alpha;
  const now = Date.now();
  return TASK_TYPES.map((t) => {
    const atts = db
      .prepare("SELECT accuracy, elapsed_ms, submitted_at, max_score, timing_violation, result_json FROM attempts WHERE user_id = ? AND task_type = ? ORDER BY submitted_at ASC")
      .all(userId, t) as Array<{ accuracy: number | null; elapsed_ms: number; submitted_at: string; max_score: number; timing_violation: number; result_json: string }>;
    const scored = atts.filter((a) => a.accuracy != null);
    let ew: number | null = null;
    const ewSeries: number[] = [];
    for (const a of scored) {
      ew = ew == null ? a.accuracy! : alpha * a.accuracy! + (1 - alpha) * ew;
      ewSeries.push(ew);
    }
    const trend = ewSeries.length >= 4 ? ewSeries[ewSeries.length - 1]! - ewSeries[Math.max(0, ewSeries.length - 4)]! : null;
    const its = db
      .prepare("SELECT correct, score, max_score FROM item_responses WHERE user_id = ? AND task_type = ? AND score IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 30")
      .all(userId, t) as Array<{ correct: number | null; score: number; max_score: number }>;
    const recent = its.length ? its.reduce((a, r) => a + r.score / r.max_score, 0) / its.length : null;
    const objective = TARGET_SECONDS[t] != null;
    const perItem = objective
      ? atts.slice(-10).map((a) => {
          const nItems = json<{ items: unknown[] }>(a.result_json, { items: [] }).items.length || 1;
          return a.elapsed_ms / 1000 / nItems;
        })
      : [];
    const last = atts.length ? atts[atts.length - 1]!.submitted_at : null;
    return {
      task_type: t,
      label: TASK_LABEL[t],
      section: TASK_SECTION[t],
      attempts: atts.length,
      items: (db.prepare("SELECT COUNT(*) c FROM item_responses WHERE user_id = ? AND task_type = ?").get(userId, t) as { c: number }).c,
      recent_accuracy: recent,
      ewma: ew,
      trend,
      mean_seconds_per_item: mean(perItem),
      target_seconds_per_item: TARGET_SECONDS[t] ?? null,
      last_practiced: last,
      days_since: last ? (now - Date.parse(last)) / 86400000 : null,
      timing_violations_7d: atts.filter((a) => a.timing_violation && now - Date.parse(a.submitted_at) < 7 * 86400000).length,
    };
  });
}

// ---------------------------------------------------------------- weaknesses

export interface Weakness {
  tag: string;
  label: string;
  errors: number;
  opportunities: number;
  rate: number;
  last_seen: string;
  task_types: TaskType[];
  /** Where the errors were observed besides the 12 tasks (currently: "vocabulary" reviews). */
  sources: string[];
}

export function weaknesses(db: DB, userId: string, days = 30): Weakness[] {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = items(db, userId, "AND created_at >= ?", [since]);
  const bySkill = new Map<string, number>();
  const byTask = new Map<string, number>();
  for (const r of rows) {
    if (r.skill) bySkill.set(r.skill, (bySkill.get(r.skill) ?? 0) + 1);
    byTask.set(r.task_type, (byTask.get(r.task_type) ?? 0) + 1);
  }
  const agg = new Map<string, Weakness>();
  for (const r of rows) {
    if (!r.error_tag) continue;
    const w = agg.get(r.error_tag) ?? { tag: r.error_tag, label: ERROR_TAG_LABELS[r.error_tag] ?? r.error_tag, errors: 0, opportunities: 0, rate: 0, last_seen: r.created_at, task_types: [], sources: [] };
    w.errors++;
    if (!w.task_types.includes(r.task_type as TaskType)) w.task_types.push(r.task_type as TaskType);
    if (r.created_at > w.last_seen) w.last_seen = r.created_at;
    agg.set(r.error_tag, w);
  }
  // AI-reported categories from productive tasks
  const ai = db
    .prepare(
      `SELECT ae.task_type, ae.result_json, ae.created_at FROM ai_evaluations ae WHERE ae.user_id = ? AND ae.status = 'ok' AND ae.created_at >= ?`,
    )
    .all(userId, since) as Array<{ task_type: string; result_json: string; created_at: string }>;
  const aiCount = new Map<string, number>();
  for (const e of ai) {
    aiCount.set(e.task_type, (aiCount.get(e.task_type) ?? 0) + 1);
    const res = json<{ errors?: Array<{ category?: string }>; missing_requirements?: string[] }>(e.result_json, {});
    const cats = new Set((res.errors ?? []).map((x) => x.category).filter((c): c is string => !!c));
    if ((res.missing_requirements ?? []).length) cats.add("missed_requirement");
    for (const c of cats) {
      const w = agg.get(c) ?? { tag: c, label: ERROR_TAG_LABELS[c] ?? c, errors: 0, opportunities: 0, rate: 0, last_seen: e.created_at, task_types: [], sources: [] };
      w.errors++;
      if (!w.task_types.includes(e.task_type as TaskType)) w.task_types.push(e.task_type as TaskType);
      if (e.created_at > w.last_seen) w.last_seen = e.created_at;
      agg.set(c, w);
    }
  }
  for (const w of agg.values()) {
    if (bySkill.has(w.tag)) w.opportunities = bySkill.get(w.tag)!;
    else if (w.task_types.length) {
      w.opportunities = w.task_types.reduce((a, t) => a + (byTask.get(t) ?? 0), 0);
      if (["grammar", "word_choice", "mechanics", "register", "development", "missed_requirement", "word_form", "collocation", "other"].includes(w.tag))
        w.opportunities = w.task_types.reduce((a, t) => a + (aiCount.get(t) ?? 0), 0);
    }
  }
  // Vocabulary reviews: typed answers use the same classes as Complete the Words.
  for (const [tag, v] of vocabErrorStats(db, userId, since)) {
    const w = agg.get(tag) ?? { tag, label: ERROR_TAG_LABELS[tag] ?? tag, errors: 0, opportunities: 0, rate: 0, last_seen: v.last, task_types: [], sources: [] };
    w.errors += v.n;
    w.opportunities += v.opportunities;
    w.sources.push("vocabulary");
    if (v.last > w.last_seen) w.last_seen = v.last;
    agg.set(tag, w);
  }
  for (const w of agg.values()) {
    w.opportunities = Math.max(w.opportunities, w.errors);
    w.rate = w.errors / w.opportunities;
  }
  return [...agg.values()]
    .filter((w) => w.tag !== "timing_violation")
    .sort((a, b) => b.rate * Math.log2(1 + b.errors) - a.rate * Math.log2(1 + a.errors));
}

// ---------------------------------------------------------------- recommendations

export interface Recommendation {
  task_type: TaskType;
  label: string;
  section: Section;
  priority: number;
  factors: { error_frequency: number; recency: number; band_impact: number; speed_deficit: number };
  reason: string;
  exercise_id: string | null;
  focus_tag: string | null;
}

/** Share of a section's scored items that each task contributes in the official blueprint. */
const TASK_SHARE: Record<TaskType, number> = {
  complete_the_words: 20 / 35,
  read_in_daily_life: 7.5 / 35,
  read_academic_passage: 7.5 / 35,
  listen_choose_response: 11.5 / 35,
  conversation: 8 / 35,
  announcement: 6 / 35,
  academic_talk: 9.5 / 35,
  build_a_sentence: 10 / 20,
  write_an_email: 5 / 20,
  academic_discussion: 5 / 20,
  listen_and_repeat: 35 / 55,
  take_an_interview: 20 / 55,
};

export function recommendations(db: DB, userId: string): Recommendation[] {
  const W = CONFIG.internal.recommendation_weights;
  const proj = computeProjection(db, userId);
  const metrics = taskMetrics(db, userId);
  const weak = weaknesses(db, userId);
  const target = proj.target_band;
  const recs = metrics.map((m) => {
    const sec = proj.sections[m.section];
    const errorFreq = m.recent_accuracy == null ? 0.5 : 1 - m.recent_accuracy;
    const recency = m.days_since == null ? 1 : Math.min(1, m.days_since / 7);
    const gap = sec.band == null ? 0.5 : Math.max(0, Math.min(1, (target - sec.band) / 2));
    const bandImpact = Math.min(1, gap * (0.5 + TASK_SHARE[m.task_type]));
    const speed =
      m.mean_seconds_per_item != null && m.target_seconds_per_item
        ? Math.max(0, Math.min(1, m.mean_seconds_per_item / m.target_seconds_per_item - 1))
        : 0;
    const priority = W.error_frequency * errorFreq + W.recency * recency + W.band_impact * bandImpact + W.speed_deficit * speed;
    const tag = weak.find((w) => w.task_types.includes(m.task_type))?.tag ?? null;
    const reasons: string[] = [];
    if (m.attempts === 0) reasons.push("not practised yet");
    else if (m.recent_accuracy != null) reasons.push(`recent score ${(m.recent_accuracy * 100).toFixed(0)}%`);
    if (sec.band != null && sec.band < target) reasons.push(`${m.section} ${sec.band.toFixed(1)} < target ${target.toFixed(1)}`);
    if (speed > 0.15) reasons.push(`${m.mean_seconds_per_item!.toFixed(0)} s/item vs ${m.target_seconds_per_item} s target`);
    if (tag) reasons.push(`recurring: ${ERROR_TAG_LABELS[tag] ?? tag}`);
    if (m.days_since != null && m.days_since > 5) reasons.push(`${Math.floor(m.days_since)} days since last practice`);
    return {
      task_type: m.task_type,
      label: m.label,
      section: m.section,
      priority,
      factors: { error_frequency: errorFreq, recency, band_impact: bandImpact, speed_deficit: speed },
      reason: reasons.join(" · ") || "maintenance",
      exercise_id: null as string | null,
      focus_tag: tag,
    };
  });
  recs.sort((a, b) => b.priority - a.priority);
  for (const r of recs.slice(0, 5)) r.exercise_id = pickExercise(db, userId, r.task_type, r.focus_tag)?.id ?? null;
  return recs;
}

/**
 * Choose the next exercise of a task type: unseen first, then exercises with
 * previously failed items (older than 1 day), then least recently attempted.
 * For Build a Sentence / MCQ sets, a focus tag biases selection toward that pattern/skill.
 */
export function pickExercise(db: DB, userId: string, taskType: TaskType, focusTag: string | null = null, exclude: string[] = []) {
  const all = listExercises(db, { taskType }).filter((e) => !exclude.includes(e.id));
  if (!all.length) return null;
  const stats = new Map(
    (
      db
        .prepare("SELECT exercise_id, COUNT(*) n, MAX(submitted_at) last, MIN(COALESCE(accuracy, 1)) worst FROM attempts WHERE user_id = ? AND task_type = ? GROUP BY exercise_id")
        .all(userId, taskType) as Array<{ exercise_id: string; n: number; last: string; worst: number }>
    ).map((r) => [r.exercise_id, r]),
  );
  const matchesFocus = (e: (typeof all)[number]) => {
    if (!focusTag) return false;
    if (e.task_type === "build_a_sentence") return e.pattern === focusTag;
    if ("questions" in e && Array.isArray(e.questions)) return (e.questions as Array<{ skill?: string }>).some((q) => q.skill === focusTag);
    if (e.task_type === "listen_choose_response") return e.skill === focusTag;
    return false;
  };
  const dayAgo = Date.now() - 86400000;
  const score = (e: (typeof all)[number]) => {
    const s = stats.get(e.id);
    let v = 0;
    if (!s) v += 100;
    else {
      if (s.worst < 0.8 && Date.parse(s.last) < dayAgo) v += 60; // spaced retry of a failed exercise
      v += Math.min(30, (Date.now() - Date.parse(s.last)) / 86400000);
      v -= s.n * 5;
    }
    if (matchesFocus(e)) v += 40;
    return v;
  };
  return [...all].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0]!;
}

export function focusNext(db: DB, userId: string) {
  const weak = weaknesses(db, userId);
  for (const w of weak.slice(0, 5)) {
    for (const t of w.task_types) {
      const ex = pickExercise(db, userId, t, w.tag);
      if (ex) return { exercise_id: ex.id, task_type: t, weakness: w, reason: `Targets “${w.label}” (${w.errors}/${w.opportunities} errors in the last 30 days).` };
    }
  }
  const rec = recommendations(db, userId)[0];
  if (rec?.exercise_id) return { exercise_id: rec.exercise_id, task_type: rec.task_type, weakness: null, reason: `No recurring error pattern yet — highest-priority task: ${rec.label} (${rec.reason}).` };
  return null;
}

// ---------------------------------------------------------------- ready gate

export function readyGate(db: DB, userId: string) {
  const G = CONFIG.internal.ready_gate;
  const { target } = userTarget(db, userId);
  const sims = db
    .prepare("SELECT id, results_json FROM simulations WHERE user_id = ? AND scope = 'full' AND length = 'full' AND status = 'completed' ORDER BY completed_at DESC LIMIT ?")
    .all(userId, G.last_full_simulations) as Array<{ id: string; results_json: string | null }>;
  const results = sims.map((s) => json<{ overall?: { band: number | null }; sections?: Record<Section, { band: number | null }>; routes?: Record<string, { proportion: number }> }>(s.results_json, {}));
  const checks: Array<{ id: string; label: string; status: "pass" | "fail" | "insufficient"; detail: string }> = [];
  const minOverall = Math.max(G.minimum_projected_overall, target);
  if (results.length < G.last_full_simulations)
    checks.push({ id: "sims", label: `Last ${G.last_full_simulations} full simulations ≥ ${minOverall.toFixed(1)}`, status: "insufficient", detail: `${results.length} completed full simulation(s)` });
  else {
    const bands = results.map((r) => r.overall?.band ?? null);
    const ok = bands.every((b) => b != null && b >= minOverall);
    checks.push({ id: "sims", label: `Last ${G.last_full_simulations} full simulations ≥ ${minOverall.toFixed(1)}`, status: ok ? "pass" : "fail", detail: bands.map((b) => (b == null ? "unscored" : b.toFixed(1))).join(", ") });
    const minSec = Math.max(G.minimum_projected_section, target - 0.5);
    const secs = results.flatMap((r) => SECTIONS.map((s) => r.sections?.[s]?.band ?? null));
    checks.push({
      id: "sections",
      label: `No section below ${minSec.toFixed(1)} in those simulations`,
      status: secs.every((b) => b != null && b >= minSec) ? "pass" : "fail",
      detail: `lowest: ${secs.some((b) => b == null) ? "unscored section present" : Math.min(...(secs as number[])).toFixed(1)}`,
    });
    for (const s of ["reading", "listening"] as const) {
      const props = results.map((r) => r.routes?.[s]?.proportion).filter((p): p is number => p != null);
      const thr = G.router_training_accuracy[s];
      checks.push({ id: `router_${s}`, label: `${s} Module 1 accuracy ≥ ${(thr * 100).toFixed(0)}%`, status: props.length && props.every((p) => p >= thr) ? "pass" : "fail", detail: props.map((p) => `${(p * 100).toFixed(0)}%`).join(", ") || "—" });
    }
  }
  const rub = (t: TaskType, lim: number) =>
    (db.prepare("SELECT score FROM item_responses WHERE user_id = ? AND task_type = ? AND score IS NOT NULL ORDER BY created_at DESC LIMIT ?").all(userId, t, lim) as Array<{ score: number }>).map((r) => r.score);
  const rubricChecks: Array<[string, TaskType, number, number]> = [
    ["Email median rubric", "write_an_email", G.email_median_rubric, 5],
    ["Discussion median rubric", "academic_discussion", G.discussion_median_rubric, 5],
    ["Listen & Repeat median rubric", "listen_and_repeat", G.repeat_median_rubric, 21],
    ["Interview median rubric", "take_an_interview", G.interview_median_rubric, 8],
  ];
  for (const [label, t, thr, lim] of rubricChecks) {
    const v = rub(t, lim);
    const med = median(v);
    checks.push({ id: t, label: `${label} ≥ ${thr}`, status: v.length < 3 ? "insufficient" : med! >= thr ? "pass" : "fail", detail: med == null ? "no scored responses" : `median ${med.toFixed(1)} over ${v.length}` });
  }
  const viol = (db.prepare("SELECT COUNT(*) c FROM attempts WHERE user_id = ? AND timing_violation = 1 AND submitted_at >= ?").get(userId, new Date(Date.now() - 7 * 86400000).toISOString()) as { c: number }).c;
  checks.push({ id: "timing", label: "No timing violations in the last 7 days", status: viol <= G.max_timing_violations_last_7_days ? "pass" : "fail", detail: `${viol} violation(s)` });
  return { ready: checks.every((c) => c.status === "pass"), target, checks, note: "READY gate thresholds are internal training criteria scaled to your target, not ETS rules." };
}

export function trends(db: DB, userId: string, days = 60) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = db
    .prepare("SELECT created_at, projection_json FROM progress_snapshots WHERE user_id = ? AND created_at >= ? ORDER BY created_at")
    .all(userId, since) as Array<{ created_at: string; projection_json: string }>;
  // One point per day (last snapshot of the day)
  const byDay = new Map<string, Projection>();
  for (const r of rows) byDay.set(r.created_at.slice(0, 10), json<Projection>(r.projection_json, null as unknown as Projection));
  const daily = db
    .prepare(
      `SELECT substr(submitted_at,1,10) day, section, COUNT(*) attempts, AVG(accuracy) acc FROM attempts WHERE user_id = ? AND submitted_at >= ? GROUP BY day, section ORDER BY day`,
    )
    .all(userId, since) as Array<{ day: string; section: string; attempts: number; acc: number | null }>;
  return {
    projections: [...byDay.entries()].map(([day, p]) => ({
      day,
      overall: p?.overall?.band ?? null,
      reading: p?.sections?.reading?.band ?? null,
      listening: p?.sections?.listening?.band ?? null,
      writing: p?.sections?.writing?.band ?? null,
      speaking: p?.sections?.speaking?.band ?? null,
    })),
    daily,
  };
}

/** Recent (last 14 days) vs earlier accuracy per task type. */
export function recentVsHistorical(db: DB, userId: string) {
  const cut = new Date(Date.now() - 14 * 86400000).toISOString();
  return TASK_TYPES.map((t) => {
    const q = (op: string) =>
      db.prepare(`SELECT AVG(score / max_score) v, COUNT(*) n FROM item_responses WHERE user_id = ? AND task_type = ? AND score IS NOT NULL AND created_at ${op} ?`).get(userId, t, cut) as { v: number | null; n: number };
    const recent = q(">=");
    const earlier = q("<");
    return { task_type: t, label: TASK_LABEL[t], recent: recent.v, recent_n: recent.n, earlier: earlier.v, earlier_n: earlier.n };
  });
}
