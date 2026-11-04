/** Drill sessions: one exercise, deterministic deadline stored server-side (survives refresh). */
import crypto from "node:crypto";
import type { DB } from "./db";
import { json, nowIso } from "./db";
import { getExercise } from "./content";
import { submitAttempt, DEADLINE_GRACE_MS, type AttemptRecord } from "./attempts";
import { CONFIG } from "../shared/config";
import { drillSeconds, timerStartsAfterAudio, toPublic } from "../shared/publicView";
import { snapshot } from "./analytics";

export interface SessionRow {
  id: string;
  user_id: string;
  kind: string;
  mode: "practice" | "strict";
  exercise_id: string | null;
  status: string;
  time_limit_ms: number | null;
  started_at: string;
  deadline_at: string | null;
  state_json: string;
}

export function getSession(db: DB, id: string): SessionRow | null {
  return (db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined) ?? null;
}

export function sessionView(db: DB, s: SessionRow) {
  const ex = getExercise(db, s.exercise_id!);
  return {
    session: {
      id: s.id,
      mode: s.mode,
      status: s.status,
      exercise_id: s.exercise_id,
      time_limit_ms: s.time_limit_ms,
      started_at: s.started_at,
      deadline_at: s.deadline_at,
      state: json(s.state_json, {}),
    },
    exercise: ex ? toPublic(ex) : null,
    timer_starts_after_audio: ex ? timerStartsAfterAudio(ex.task_type) : false,
    server_now: nowIso(),
  };
}

export function createDrill(db: DB, userId: string, exerciseId: string, mode: "practice" | "strict") {
  const ex = getExercise(db, exerciseId);
  if (!ex) throw new Error("Unknown exercise");
  // Only one active drill per user: abandon any previous one.
  db.prepare("UPDATE sessions SET status = 'abandoned', ended_at = ?, updated_at = ? WHERE user_id = ? AND kind = 'drill' AND status = 'active'").run(nowIso(), nowIso(), userId);
  const secs = drillSeconds(ex, CONFIG.internal.drill_seconds);
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO sessions (id, user_id, kind, mode, exercise_id, status, time_limit_ms, started_at, deadline_at, state_json, updated_at)
     VALUES (?, ?, 'drill', ?, ?, 'active', ?, ?, NULL, '{}', ?)`,
  ).run(id, userId, mode, exerciseId, secs == null ? null : secs * 1000, now, now);
  const s = getSession(db, id)!;
  // Timers start immediately except for listening tasks (they start after the audio).
  if (secs != null && !timerStartsAfterAudio(ex.task_type)) startTimer(db, id);
  return sessionView(db, getSession(db, id)!);
}

export function startTimer(db: DB, id: string) {
  const s = getSession(db, id);
  if (!s || s.status !== "active") throw new Error("session not active");
  if (s.deadline_at || s.time_limit_ms == null) return sessionView(db, s);
  const deadline = new Date(Date.now() + s.time_limit_ms).toISOString();
  db.prepare("UPDATE sessions SET deadline_at = ?, updated_at = ? WHERE id = ?").run(deadline, nowIso(), id);
  return sessionView(db, getSession(db, id)!);
}

export function saveState(db: DB, id: string, state: unknown) {
  const r = db.prepare("UPDATE sessions SET state_json = ?, updated_at = ? WHERE id = ? AND status = 'active'").run(JSON.stringify(state ?? {}), nowIso(), id);
  if (!r.changes) throw new Error("session not active");
}

export function submitDrill(db: DB, id: string, body: { response: unknown; elapsedMs: number; timedOut?: boolean }): AttemptRecord {
  const s = getSession(db, id);
  if (!s) throw new Error("session not found");
  if (s.status !== "active") throw new Error(`session already ${s.status}`);
  const attempt = submitAttempt(db, {
    userId: s.user_id,
    exerciseId: s.exercise_id!,
    response: body.response,
    mode: s.mode,
    sessionId: s.id,
    startedAt: s.started_at,
    elapsedMs: body.elapsedMs,
    timeLimitMs: s.time_limit_ms,
    deadlineAt: s.mode === "strict" ? s.deadline_at : null,
    timedOut: !!body.timedOut,
  });
  snapshot(db, s.user_id, "attempt");
  return attempt;
}

/** Strict drills whose deadline passed while the page was closed are auto-submitted from the autosave. */
export function expireDrillIfNeeded(db: DB, s: SessionRow): AttemptRecord | null {
  if (s.status !== "active" || s.mode !== "strict" || !s.deadline_at) return null;
  if (Date.now() <= Date.parse(s.deadline_at) + DEADLINE_GRACE_MS) return null;
  const state = json<{ response?: unknown; elapsedMs?: number }>(s.state_json, {});
  return submitDrill(db, s.id, { response: state.response ?? null, elapsedMs: s.time_limit_ms ?? state.elapsedMs ?? 0, timedOut: true });
}

export function activeDrill(db: DB, userId: string) {
  const s = db.prepare("SELECT * FROM sessions WHERE user_id = ? AND kind = 'drill' AND status = 'active' ORDER BY started_at DESC LIMIT 1").get(userId) as SessionRow | undefined;
  if (!s) return null;
  const expired = expireDrillIfNeeded(db, s);
  if (expired) return { expired_attempt_id: expired.id };
  return sessionView(db, s);
}
