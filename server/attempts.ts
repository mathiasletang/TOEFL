import crypto from "node:crypto";
import { harvestAttempt } from "./vocabDeck";
import type { DB } from "./db";
import { json } from "./db";
import { getExercise } from "./content";
import { CONFIG } from "../shared/config";
import { scoreExercise, type ScoreResult, type RepeatResponse } from "../shared/scoring";
import { deriveCtw } from "../shared/ctw";
import type { Exercise } from "../shared/schema";

/** Seconds of tolerance after a deadline before a submission counts as a timing violation. */
export const DEADLINE_GRACE_MS = 3000;

export interface SubmitInput {
  userId: string;
  exerciseId: string;
  response: unknown;
  mode: "practice" | "strict";
  sessionId?: string | null;
  simulationId?: string | null;
  moduleStage?: string | null;
  startedAt?: string | null;
  elapsedMs: number;
  timeLimitMs?: number | null;
  deadlineAt?: string | null;
  timedOut?: boolean;
}

export interface AttemptRecord {
  id: string;
  user_id: string;
  exercise_id: string;
  task_type: string;
  section: string;
  mode: string;
  simulation_id: string | null;
  module_stage: string | null;
  started_at: string;
  submitted_at: string;
  elapsed_ms: number;
  time_limit_ms: number | null;
  timed_out: boolean;
  timing_violation: boolean;
  raw_score: number | null;
  max_score: number;
  accuracy: number | null;
  pending: boolean;
  result: ScoreResult;
  response: unknown;
  error_tags: string[];
}

/** Fill Listen-and-Repeat / Interview transcripts from stored recordings when the client did not send them. */
export function hydrateSpeechResponse(db: DB, ex: Exercise, response: unknown): unknown {
  if (ex.task_type !== "listen_and_repeat" && ex.task_type !== "take_an_interview") return response;
  const r = (response ?? { items: [] }) as RepeatResponse;
  const items = (r.items ?? []).map((it) => {
    if (!it.recordingId) return it;
    const rec = db.prepare("SELECT transcript, transcript_source, asr_confidence, duration_ms FROM recordings WHERE id = ?").get(it.recordingId) as
      | { transcript: string | null; transcript_source: string | null; asr_confidence: number | null; duration_ms: number | null }
      | undefined;
    if (!rec) return it;
    // Empty browser-recognition output is unreliable: keep the item unscored rather than scoring silence.
    if (rec.transcript_source === "browser" && !rec.transcript?.trim()) return { ...it, transcript: null, transcriptSource: null };
    return {
      ...it,
      transcript: it.transcript ?? rec.transcript,
      transcriptSource: it.transcriptSource ?? (rec.transcript_source as RepeatResponse["items"][number]["transcriptSource"]),
      asrConfidence: it.asrConfidence ?? rec.asr_confidence,
      durationMs: it.durationMs ?? rec.duration_ms,
    };
  });
  return { ...r, items };
}

export function submitAttempt(db: DB, input: SubmitInput): AttemptRecord {
  const ex = getExercise(db, input.exerciseId);
  if (!ex) throw new Error(`Unknown exercise ${input.exerciseId}`);
  const response = hydrateSpeechResponse(db, ex, input.response);
  const result = scoreExercise(ex, response, { repeatProxy: CONFIG.internal.listen_repeat_proxy });
  const now = new Date();
  const submittedAt = now.toISOString();
  const startedAt = input.startedAt ?? new Date(now.getTime() - input.elapsedMs).toISOString();
  const violation =
    input.mode === "strict" && input.deadlineAt != null && now.getTime() > Date.parse(input.deadlineAt) + DEADLINE_GRACE_MS && !input.timedOut;

  const id = crypto.randomUUID();
  const errorTags = [...result.errorTags, ...(violation ? ["timing_violation"] : [])];
  db.transaction(() => {
    db.prepare(
      `INSERT INTO attempts (id, user_id, exercise_id, task_type, section, session_id, simulation_id, module_stage, mode, started_at, submitted_at,
        elapsed_ms, time_limit_ms, timed_out, timing_violation, response_json, raw_score, max_score, accuracy, pending, result_json, error_tags_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.userId,
      ex.id,
      ex.task_type,
      ex.section,
      input.sessionId ?? null,
      input.simulationId ?? null,
      input.moduleStage ?? null,
      input.mode,
      startedAt,
      submittedAt,
      Math.max(0, Math.round(input.elapsedMs)),
      input.timeLimitMs ?? null,
      input.timedOut ? 1 : 0,
      violation ? 1 : 0,
      JSON.stringify(response ?? null),
      result.raw,
      result.max,
      result.accuracy,
      result.pending ? 1 : 0,
      JSON.stringify(result),
      JSON.stringify(errorTags),
    );
    writeItemRows(db, id, input.userId, ex, result, submittedAt);
    if (input.sessionId) {
      db.prepare("UPDATE sessions SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?").run(
        input.timedOut ? "expired" : "submitted",
        submittedAt,
        submittedAt,
        input.sessionId,
      );
    }
    // Link recordings made during this attempt.
    const r = response as RepeatResponse | null;
    for (const it of r?.items ?? []) if (it.recordingId) db.prepare("UPDATE recordings SET attempt_id = ? WHERE id = ? AND user_id = ?").run(id, it.recordingId, input.userId);
  })();
  // Missed words join the user's vocabulary deck (Complete the Words gaps, vocabulary questions).
  harvestAttempt(db, input.userId, ex, result);
  return getAttempt(db, id)!;
}

function writeItemRows(db: DB, attemptId: string, userId: string, ex: Exercise, result: ScoreResult, at: string) {
  db.prepare("DELETE FROM item_responses WHERE attempt_id = ?").run(attemptId);
  const ins = db.prepare(
    `INSERT INTO item_responses (attempt_id, user_id, exercise_id, task_type, section, item_key, correct, score, max_score, response, expected, skill, b, error_tag, elapsed_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const it of result.items)
    ins.run(
      attemptId,
      userId,
      ex.id,
      ex.task_type,
      ex.section,
      it.key,
      it.correct == null ? null : it.correct ? 1 : 0,
      it.score,
      it.max,
      it.response,
      it.expected,
      it.skill,
      it.b,
      it.errorTag,
      it.elapsedMs ?? null,
      at,
    );
}

interface AttemptRow {
  id: string;
  user_id: string;
  exercise_id: string;
  task_type: string;
  section: string;
  mode: string;
  simulation_id: string | null;
  module_stage: string | null;
  started_at: string;
  submitted_at: string;
  elapsed_ms: number;
  time_limit_ms: number | null;
  timed_out: number;
  timing_violation: number;
  raw_score: number | null;
  max_score: number;
  accuracy: number | null;
  pending: number;
  result_json: string;
  response_json: string;
  error_tags_json: string;
}

export function getAttempt(db: DB, id: string): AttemptRecord | null {
  const r = db.prepare("SELECT * FROM attempts WHERE id = ?").get(id) as AttemptRow | undefined;
  return r ? rowToAttempt(r) : null;
}

export function rowToAttempt(r: AttemptRow): AttemptRecord {
  return {
    id: r.id,
    user_id: r.user_id,
    exercise_id: r.exercise_id,
    task_type: r.task_type,
    section: r.section,
    mode: r.mode,
    simulation_id: r.simulation_id,
    module_stage: r.module_stage,
    started_at: r.started_at,
    submitted_at: r.submitted_at,
    elapsed_ms: r.elapsed_ms,
    time_limit_ms: r.time_limit_ms,
    timed_out: !!r.timed_out,
    timing_violation: !!r.timing_violation,
    raw_score: r.raw_score,
    max_score: r.max_score,
    accuracy: r.accuracy,
    pending: !!r.pending,
    result: json<ScoreResult>(r.result_json, { raw: null, max: 0, accuracy: null, items: [], errorTags: [], pending: true, notes: [] }),
    response: json<unknown>(r.response_json, null),
    error_tags: json<string[]>(r.error_tags_json, []),
  };
}

/**
 * Re-score an attempt (after transcripts arrive, self-ratings, or AI evaluation).
 * `overrides` lets AI rubric scores replace the null scores of productive items.
 */
export function rescoreAttempt(
  db: DB,
  attemptId: string,
  opts: { response?: unknown; aiScores?: Record<string, { score: number; tags: string[] }> } = {},
): AttemptRecord {
  const a = getAttempt(db, attemptId);
  if (!a) throw new Error("attempt not found");
  const ex = getExercise(db, a.exercise_id)!;
  const response = hydrateSpeechResponse(db, ex, opts.response ?? a.response);
  const result = scoreExercise(ex, response, { repeatProxy: CONFIG.internal.listen_repeat_proxy });
  const ai = opts.aiScores ?? latestAiScores(db, attemptId);
  const extraTags: string[] = [];
  for (const it of result.items) {
    const s = ai[it.key];
    if (s && ex.task_type !== "listen_and_repeat") {
      it.score = s.score;
      it.correct = null;
      it.detail = { ...(typeof it.detail === "object" && it.detail ? it.detail : {}), source: "ai" };
      extraTags.push(...s.tags);
    }
  }
  const scored = result.items.filter((i) => i.score != null);
  result.raw = scored.length ? scored.reduce((x, i) => x + (i.score ?? 0), 0) : null;
  const scoredMax = scored.reduce((x, i) => x + i.max, 0);
  result.accuracy = result.raw == null || scoredMax === 0 ? null : result.raw / scoredMax;
  result.pending = scored.length < result.items.length;
  result.errorTags = [...new Set([...result.errorTags, ...extraTags])];
  const tags = [...result.errorTags, ...(a.timing_violation ? ["timing_violation"] : [])];
  db.transaction(() => {
    db.prepare("UPDATE attempts SET response_json = ?, raw_score = ?, accuracy = ?, pending = ?, result_json = ?, error_tags_json = ? WHERE id = ?").run(
      JSON.stringify(response ?? null),
      result.raw,
      result.accuracy,
      result.pending ? 1 : 0,
      JSON.stringify(result),
      JSON.stringify(tags),
      attemptId,
    );
    writeItemRows(db, attemptId, a.user_id, ex, result, a.submitted_at);
  })();
  return getAttempt(db, attemptId)!;
}

export function latestAiScores(db: DB, attemptId: string): Record<string, { score: number; tags: string[] }> {
  const rows = db
    .prepare("SELECT item_key, rubric_score, result_json FROM ai_evaluations WHERE attempt_id = ? AND status = 'ok' ORDER BY created_at")
    .all(attemptId) as Array<{ item_key: string; rubric_score: number; result_json: string }>;
  const out: Record<string, { score: number; tags: string[] }> = {};
  for (const r of rows) {
    const res = json<{ errors?: Array<{ category?: string }>; missing_requirements?: string[] }>(r.result_json, {});
    const tags = [...new Set((res.errors ?? []).map((e) => e.category).filter((c): c is string => !!c))];
    if ((res.missing_requirements ?? []).length) tags.push("missed_requirement");
    out[r.item_key] = { score: r.rubric_score, tags };
  }
  return out;
}

/** Full review payload: exercise with answers + scored result. Only sent after submission. */
export function reviewPayload(db: DB, attempt: AttemptRecord) {
  const ex = getExercise(db, attempt.exercise_id);
  const extra: Record<string, unknown> = {};
  if (ex?.task_type === "complete_the_words") extra.ctw = deriveCtw(ex.passage);
  const evaluations = db
    .prepare("SELECT id, item_key, provider, model, status, rubric_score, confidence, result_json, error, created_at FROM ai_evaluations WHERE attempt_id = ? ORDER BY created_at")
    .all(attempt.id)
    .map((r) => {
      const row = r as { result_json: string | null } & Record<string, unknown>;
      return { ...row, result: json(row.result_json, null), result_json: undefined };
    });
  const recordings = db
    .prepare("SELECT id, item_key, mime, duration_ms, transcript, transcript_source, asr_confidence, stt_error FROM recordings WHERE attempt_id = ? ORDER BY created_at")
    .all(attempt.id);
  return { attempt, exercise: ex, evaluations, recordings, ...extra };
}
