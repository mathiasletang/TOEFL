import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { openDb, USERS, json, nowIso, type DB } from "./db";
import { loadEnv, ROOT, type Env } from "./env";
import { syncContent, readContent, getExercise, listExercises, type LoadedContent } from "./content";
import { syncVocab, readVocab, type LoadedVocab } from "./vocab";
import { countVocab } from "../shared/vocab";
import { getAttempt, rescoreAttempt, reviewPayload } from "./attempts";
import {
  computeProjection,
  taskMetrics,
  weaknesses,
  recommendations,
  pickExercise,
  focusNext,
  readyGate,
  trends,
  recentVsHistorical,
  snapshot,
} from "./analytics";
import { createDrill, startTimer, saveState, submitDrill, activeDrill, getSession, sessionView } from "./sessions";
import {
  createSimulation,
  currentView,
  startStep,
  saveStepState,
  submitStep,
  abandonSimulation,
  refreshResults,
  getSimulation,
  sufficiency,
  routerConfig,
  InsufficientContentError,
} from "./simulation";
import { evaluateAttempt, type LlmCaller } from "./ai/evaluate";
import { transcribe, sttAvailable, ttsAvailable, ttsFile, recordedAsset, audioDir, pickVoice } from "./speech";
import { CONFIG } from "../shared/config";
import { TASK_TYPES, TASK_LABEL, TASK_SECTION, itemCount, type TaskType } from "../shared/schema";
import { toPublic, drillSeconds } from "../shared/publicView";
import type { RepeatResponse } from "../shared/scoring";

export interface AppOptions {
  env?: Env;
  dbFile?: string;
  llmCaller?: LlmCaller;
  serveStatic?: boolean;
  logger?: boolean;
}

const UserId = z.enum(USERS.map((u) => u.id) as [string, ...string[]]);

class HttpError extends Error {
  constructor(public statusCode: number, message: string, public details?: unknown) {
    super(message);
  }
}

function user(db: DB, id: string) {
  if (!UserId.safeParse(id).success) throw new HttpError(404, "Unknown user");
  return db.prepare("SELECT id, display_name, target_band, exam_date, created_at FROM users WHERE id = ?").get(id) as {
    id: string;
    display_name: string;
    target_band: number;
    exam_date: string | null;
  };
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, "Invalid request", r.error.issues);
  return r.data;
}

function exerciseTitle(e: ReturnType<typeof listExercises>[number]): string {
  switch (e.task_type) {
    case "complete_the_words":
      return e.topic;
    case "read_in_daily_life":
      return e.stimulus.title ?? e.stimulus.meta.find((m) => m.label === "Subject")?.value ?? e.stimulus.format.replace(/_/g, " ");
    case "read_academic_passage":
    case "academic_talk":
      return e.title;
    case "conversation":
    case "announcement":
      return e.context.replace(/^Listen to (an? )?/i, "");
    case "listen_choose_response":
      return `Response item ${e.id.split("_").pop()}`;
    case "build_a_sentence":
      return e.pattern.replace(/_/g, " ");
    case "listen_and_repeat":
    case "take_an_interview":
      return e.scenario.split(".")[0]!;
    case "write_an_email":
      return e.subject;
    case "academic_discussion":
      return `${e.course}: ${e.professor.prompt.split(/[.?]/)[0]}`;
  }
}

export async function buildApp(opts: AppOptions = {}): Promise<{ app: FastifyInstance; db: DB; env: Env; content: LoadedContent; vocab: LoadedVocab }> {
  const env = opts.env ?? loadEnv();
  const db = openDb(opts.dbFile ?? path.join(env.dataDir, "toefl.db"));
  const content = syncContent(db, readContent());
  const vocab = syncVocab(db, readVocab());
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 25 * 1024 * 1024 });

  app.addContentTypeParser(/^audio\/.*/, { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.setErrorHandler((err: Error & { statusCode?: number; details?: unknown }, _req, reply) => {
    const code = err instanceof HttpError ? err.statusCode : err instanceof InsufficientContentError ? 409 : (err.statusCode ?? 400);
    reply.status(code).send({ error: err.message, details: err instanceof InsufficientContentError ? err.details : err.details });
  });

  // ------------------------------------------------------------- system
  app.get("/api/health", async () => ({
    ok: true,
    exercises: content.exercises.length,
    errors: content.errors.length + content.fileErrors.length,
    vocab_entries: vocab.entries.length,
    vocab_errors: vocab.errors.length + vocab.fileErrors.length,
  }));

  app.get("/api/config", async () => ({
    providers: {
      llm: { configured: env.llm.provider === "anthropic" && !!env.llm.apiKey, provider: env.llm.provider, model: env.llm.model, language: env.llm.language },
      stt: { configured: sttAvailable(env), provider: env.stt.provider, model: env.stt.model },
      tts: { configured: ttsAvailable(env), provider: env.tts.provider, model: env.tts.model },
    },
    routing: { ...CONFIG.internal.routing, official_threshold: null },
    official: CONFIG.official,
    target_options: CONFIG.internal.target_options,
    content: {
      exercises: content.exercises.length,
      invalid: content.errors.length,
      warnings: content.warnings.length,
      file_errors: content.fileErrors,
      by_task: Object.fromEntries(TASK_TYPES.map((t) => [t, content.exercises.filter((e) => e.task_type === t).length])),
    },
    vocabulary: { ...countVocab(vocab.entries), invalid: vocab.errors.length, file_errors: vocab.fileErrors },
  }));

  // ------------------------------------------------------------- users
  app.get("/api/users", async () =>
    USERS.map((u) => {
      const row = user(db, u.id);
      const c = db.prepare("SELECT COUNT(*) n, MAX(submitted_at) last FROM attempts WHERE user_id = ?").get(u.id) as { n: number; last: string | null };
      return { ...row, attempts: c.n, last_activity: c.last };
    }),
  );

  app.patch<{ Params: { id: string } }>("/api/users/:id", async (req) => {
    user(db, req.params.id);
    const body = parse(
      z.object({ target_band: z.number().refine((v) => CONFIG.internal.target_options.includes(v), "unsupported target").optional(), exam_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }),
      req.body,
    );
    if (body.target_band != null) db.prepare("UPDATE users SET target_band = ? WHERE id = ?").run(body.target_band, req.params.id);
    if (body.exam_date !== undefined) db.prepare("UPDATE users SET exam_date = ? WHERE id = ?").run(body.exam_date, req.params.id);
    snapshot(db, req.params.id, "settings");
    return user(db, req.params.id);
  });

  app.get<{ Params: { id: string } }>("/api/users/:id/dashboard", async (req) => {
    const u = user(db, req.params.id);
    const projection = computeProjection(db, u.id);
    const metrics = taskMetrics(db, u.id);
    const recs = recommendations(db, u.id);
    const weak = weaknesses(db, u.id);
    const last = db
      .prepare("SELECT id, scope, length, completed_at, results_json FROM simulations WHERE user_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1")
      .get(u.id) as { id: string; scope: string; length: string; completed_at: string; results_json: string } | undefined;
    const lastFull = db
      .prepare("SELECT id, scope, length, completed_at, results_json FROM simulations WHERE user_id = ? AND status = 'completed' AND scope = 'full' ORDER BY completed_at DESC LIMIT 1")
      .get(u.id) as { id: string; scope: string; length: string; completed_at: string; results_json: string } | undefined;
    const activeSim = db.prepare("SELECT id, scope, length FROM simulations WHERE user_id = ? AND status = 'active'").get(u.id) ?? null;
    const days = u.exam_date ? Math.ceil((Date.parse(u.exam_date + "T00:00:00") - Date.now()) / 86400000) : null;
    const totals = db.prepare("SELECT COUNT(*) attempts, COALESCE(SUM(elapsed_ms),0) ms FROM attempts WHERE user_id = ?").get(u.id) as { attempts: number; ms: number };
    return {
      user: u,
      projection,
      days_remaining: days,
      metrics,
      weaknesses: weak.slice(0, 8),
      recommendations: recs.slice(0, 5),
      last_simulation: last ? { ...last, results: json(last.results_json, null), results_json: undefined } : null,
      last_full_simulation: lastFull ? { ...lastFull, results: json(lastFull.results_json, null), results_json: undefined } : null,
      active_simulation: activeSim,
      active_drill: activeDrill(db, u.id),
      trends: trends(db, u.id),
      totals,
    };
  });

  app.get<{ Params: { id: string } }>("/api/users/:id/progress", async (req) => {
    const u = user(db, req.params.id);
    const attempts = db
      .prepare("SELECT id, exercise_id, task_type, section, mode, simulation_id, submitted_at, elapsed_ms, raw_score, max_score, accuracy, pending, timed_out, timing_violation, error_tags_json FROM attempts WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 100")
      .all(u.id)
      .map((r) => ({ ...(r as Record<string, unknown>), error_tags: json((r as { error_tags_json: string }).error_tags_json, []), error_tags_json: undefined }));
    return {
      projection: computeProjection(db, u.id),
      metrics: taskMetrics(db, u.id),
      weaknesses: weaknesses(db, u.id),
      recommendations: recommendations(db, u.id),
      trends: trends(db, u.id, 120),
      recent_vs_historical: recentVsHistorical(db, u.id),
      ready_gate: readyGate(db, u.id),
      attempts,
      simulations: db.prepare("SELECT id, scope, length, status, started_at, completed_at, results_json FROM simulations WHERE user_id = ? ORDER BY started_at DESC LIMIT 30").all(u.id).map((r) => {
        const row = r as { results_json: string | null } & Record<string, unknown>;
        return { ...row, results: json(row.results_json, null), results_json: undefined };
      }),
    };
  });

  // ------------------------------------------------------------- exercises
  app.get<{ Querystring: { taskType?: string; userId?: string } }>("/api/exercises", async (req) => {
    const t = req.query.taskType;
    if (t && !(TASK_TYPES as readonly string[]).includes(t)) throw new HttpError(400, "Unknown task type");
    const stats = new Map<string, { n: number; best: number | null; last: string }>();
    if (req.query.userId) {
      user(db, req.query.userId);
      for (const r of db.prepare("SELECT exercise_id, COUNT(*) n, MAX(accuracy) best, MAX(submitted_at) last FROM attempts WHERE user_id = ? GROUP BY exercise_id").all(req.query.userId) as Array<{ exercise_id: string; n: number; best: number | null; last: string }>)
        stats.set(r.exercise_id, r);
    }
    return listExercises(db, { taskType: t }).map((e) => ({
      id: e.id,
      task_type: e.task_type,
      label: TASK_LABEL[e.task_type],
      section: e.section,
      difficulty: e.difficulty,
      title: exerciseTitle(e),
      items: itemCount(e),
      source_type: e.source_type,
      drill_seconds: drillSeconds(e, CONFIG.internal.drill_seconds),
      attempts: stats.get(e.id)?.n ?? 0,
      best: stats.get(e.id)?.best ?? null,
      last: stats.get(e.id)?.last ?? null,
    }));
  });

  app.get("/api/task-types", async () =>
    TASK_TYPES.map((t) => ({ task_type: t, label: TASK_LABEL[t], section: TASK_SECTION[t], count: content.exercises.filter((e) => e.task_type === t).length })),
  );

  app.get<{ Params: { id: string } }>("/api/exercises/:id/public", async (req) => {
    const ex = getExercise(db, req.params.id);
    if (!ex) throw new HttpError(404, "Unknown exercise");
    return toPublic(ex);
  });

  app.get<{ Params: { id: string }; Querystring: { taskType: string; focus?: string; exclude?: string } }>("/api/users/:id/next", async (req) => {
    user(db, req.params.id);
    if (!(TASK_TYPES as readonly string[]).includes(req.query.taskType)) throw new HttpError(400, "Unknown task type");
    const ex = pickExercise(db, req.params.id, req.query.taskType as TaskType, req.query.focus ?? null, (req.query.exclude ?? "").split(",").filter(Boolean));
    return { exercise_id: ex?.id ?? null };
  });

  app.get<{ Params: { id: string } }>("/api/users/:id/focus", async (req) => {
    user(db, req.params.id);
    return focusNext(db, req.params.id) ?? { exercise_id: null, reason: "No exercises available." };
  });

  // ------------------------------------------------------------- drill sessions
  app.post("/api/sessions", async (req) => {
    const body = parse(z.object({ userId: UserId, exerciseId: z.string(), mode: z.enum(["practice", "strict"]) }), req.body);
    return createDrill(db, body.userId, body.exerciseId, body.mode);
  });
  app.get<{ Params: { id: string } }>("/api/users/:id/active-session", async (req) => {
    user(db, req.params.id);
    return { active: activeDrill(db, req.params.id) };
  });
  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req) => {
    const s = getSession(db, req.params.id);
    if (!s) throw new HttpError(404, "Unknown session");
    return sessionView(db, s);
  });
  app.post<{ Params: { id: string } }>("/api/sessions/:id/start-timer", async (req) => startTimer(db, req.params.id));
  app.put<{ Params: { id: string } }>("/api/sessions/:id/state", async (req) => {
    saveState(db, req.params.id, (req.body as { state?: unknown })?.state ?? {});
    return { ok: true, saved_at: nowIso() };
  });
  app.post<{ Params: { id: string } }>("/api/sessions/:id/submit", async (req) => {
    const body = parse(z.object({ response: z.unknown(), elapsedMs: z.number().min(0), timedOut: z.boolean().optional() }), req.body);
    const attempt = submitDrill(db, req.params.id, body);
    return reviewPayload(db, attempt);
  });
  app.post<{ Params: { id: string } }>("/api/sessions/:id/abandon", async (req) => {
    db.prepare("UPDATE sessions SET status = 'abandoned', ended_at = ?, updated_at = ? WHERE id = ? AND status = 'active'").run(nowIso(), nowIso(), req.params.id);
    return { ok: true };
  });

  // ------------------------------------------------------------- attempts
  app.get<{ Params: { id: string } }>("/api/attempts/:id", async (req) => {
    const a = getAttempt(db, req.params.id);
    if (!a) throw new HttpError(404, "Unknown attempt");
    return reviewPayload(db, a);
  });

  app.post<{ Params: { id: string } }>("/api/attempts/:id/self-rate", async (req) => {
    const a = getAttempt(db, req.params.id);
    if (!a) throw new HttpError(404, "Unknown attempt");
    if (a.task_type !== "listen_and_repeat" && a.task_type !== "take_an_interview") throw new HttpError(400, "Self-rating is only available for speaking tasks");
    const body = parse(z.object({ ratings: z.record(z.string(), z.number().int().min(0).max(5)) }), req.body);
    const r = (a.response ?? { items: [] }) as RepeatResponse;
    const items = [...(r.items ?? [])];
    for (const [key, rating] of Object.entries(body.ratings)) {
      const index = Number(key.replace(/\D/g, ""));
      const i = items.findIndex((x) => x.index === index);
      if (i >= 0) items[i] = { ...items[i]!, selfRating: rating };
      else items.push({ index, selfRating: rating });
    }
    const updated = rescoreAttempt(db, a.id, { response: { ...r, items } });
    snapshot(db, a.user_id, "self_rating");
    return reviewPayload(db, updated);
  });

  app.post<{ Params: { id: string } }>("/api/attempts/:id/evaluate", async (req) => {
    const a = getAttempt(db, req.params.id);
    if (!a) throw new HttpError(404, "Unknown attempt");
    const out = await evaluateAttempt(db, env, a.id, opts.llmCaller);
    if (a.simulation_id) refreshResults(db, a.simulation_id);
    return { ...out, review: reviewPayload(db, out.attempt) };
  });

  app.post<{ Params: { id: string } }>("/api/attempts/:id/rescore", async (req) => {
    const a = getAttempt(db, req.params.id);
    if (!a) throw new HttpError(404, "Unknown attempt");
    const updated = rescoreAttempt(db, a.id);
    if (a.simulation_id) refreshResults(db, a.simulation_id);
    return reviewPayload(db, updated);
  });

  // ------------------------------------------------------------- recordings
  app.post<{ Querystring: { userId: string; exerciseId: string; itemKey: string; sessionId?: string; durationMs?: string } }>("/api/recordings", async (req) => {
    const q = req.query;
    user(db, q.userId);
    if (!getExercise(db, q.exerciseId)) throw new HttpError(404, "Unknown exercise");
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw new HttpError(400, "Empty audio body");
    const mime = (req.headers["content-type"] ?? "audio/webm").split(";")[0]!;
    const id = crypto.randomUUID();
    const dir = audioDir(env, path.join("recordings", q.userId));
    const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : mime.includes("wav") ? "wav" : "webm";
    const file = path.join(dir, `${id}.${ext}`);
    fs.writeFileSync(file, buf);
    let transcript: string | null = null;
    let confidence: number | null = null;
    let sttError: string | null = null;
    if (sttAvailable(env)) {
      try {
        const t = await transcribe(env, buf, mime);
        transcript = t.text;
        confidence = t.confidence;
      } catch (e) {
        sttError = (e as Error).message;
      }
    }
    db.prepare(
      "INSERT INTO recordings (id, user_id, exercise_id, item_key, session_id, path, mime, bytes, duration_ms, transcript, transcript_source, asr_confidence, stt_error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, q.userId, q.exerciseId, q.itemKey, q.sessionId ?? null, file, mime, buf.length, q.durationMs ? Number(q.durationMs) : null, transcript, transcript != null ? "server_stt" : null, confidence, sttError, nowIso());
    return { id, transcript, transcript_source: transcript != null ? "server_stt" : null, asr_confidence: confidence, stt_error: sttError, stt_configured: sttAvailable(env) };
  });

  app.post<{ Params: { id: string } }>("/api/recordings/:id/transcript", async (req) => {
    const body = parse(z.object({ transcript: z.string(), confidence: z.number().min(0).max(1).nullable().optional() }), req.body);
    const rec = db.prepare("SELECT transcript_source FROM recordings WHERE id = ?").get(req.params.id) as { transcript_source: string | null } | undefined;
    if (!rec) throw new HttpError(404, "Unknown recording");
    if (rec.transcript_source === "server_stt") return { ok: true, kept: "server_stt" };
    db.prepare("UPDATE recordings SET transcript = ?, transcript_source = 'browser', asr_confidence = ? WHERE id = ?").run(body.transcript, body.confidence ?? null, req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/recordings/:id/transcribe", async (req) => {
    const rec = db.prepare("SELECT path, mime FROM recordings WHERE id = ?").get(req.params.id) as { path: string; mime: string } | undefined;
    if (!rec) throw new HttpError(404, "Unknown recording");
    if (!sttAvailable(env)) throw new HttpError(409, "Speech-to-text is not configured.");
    const t = await transcribe(env, fs.readFileSync(rec.path), rec.mime);
    db.prepare("UPDATE recordings SET transcript = ?, transcript_source = 'server_stt', asr_confidence = ?, stt_error = NULL WHERE id = ?").run(t.text, t.confidence, req.params.id);
    return { transcript: t.text, asr_confidence: t.confidence };
  });

  app.get<{ Params: { id: string } }>("/api/recordings/:id/audio", async (req, reply) => {
    const rec = db.prepare("SELECT path, mime FROM recordings WHERE id = ?").get(req.params.id) as { path: string; mime: string } | undefined;
    if (!rec || !fs.existsSync(rec.path)) throw new HttpError(404, "Recording not found");
    return sendFile(reply, rec.path, rec.mime);
  });

  // ------------------------------------------------------------- stimulus audio
  const segmentFor = (exerciseId: string, key: string) => {
    const ex = getExercise(db, exerciseId);
    if (!ex) return null;
    const pub = toPublic(ex) as { audio?: Array<{ key: string; speaker: string; voice: "female" | "male" | "neutral"; text: string }> };
    const audio = pub.audio ?? [];
    const seg = audio.find((a) => a.key === key);
    if (!seg) return null;
    const speakers = [...new Set(audio.map((a) => a.speaker))];
    return { seg, speakerIndex: speakers.indexOf(seg.speaker) };
  };

  app.get<{ Params: { exerciseId: string } }>("/api/audio-manifest/:exerciseId", async (req) => {
    const ex = getExercise(db, req.params.exerciseId);
    if (!ex) throw new HttpError(404, "Unknown exercise");
    const pub = toPublic(ex) as { audio?: Array<{ key: string }> };
    const keys = (pub.audio ?? []).map((a) => a.key);
    const recorded = keys.every((k) => recordedAsset(ex.id, k));
    const mode = recorded ? "recorded" : ttsAvailable(env) ? "tts" : "browser";
    return { mode, urls: Object.fromEntries(keys.map((k) => [k, mode === "browser" ? null : `/api/audio/${ex.id}/${k}`])) };
  });

  app.get<{ Params: { exerciseId: string; key: string } }>("/api/audio/:exerciseId/:key", async (req, reply) => {
    const rec = recordedAsset(req.params.exerciseId, req.params.key);
    if (rec) return sendFile(reply, rec.path, rec.mime);
    const s = segmentFor(req.params.exerciseId, req.params.key);
    if (!s) throw new HttpError(404, "Unknown audio segment");
    if (!ttsAvailable(env)) throw new HttpError(404, "No recorded asset and no TTS provider; use the browser fallback.");
    const f = await ttsFile(env, db, { exerciseId: req.params.exerciseId, key: req.params.key, text: s.seg.text, voice: pickVoice(env, s.seg.voice, s.speakerIndex) });
    return sendFile(reply, f.path, f.mime);
  });

  // ------------------------------------------------------------- simulations
  app.get("/api/simulations/sufficiency", async () => sufficiency(db));

  app.post("/api/simulations", async (req) => {
    const body = parse(
      z.object({
        userId: UserId,
        scope: z.enum(["reading", "listening", "writing", "speaking", "full"]),
        length: z.enum(["full", "short"]),
        threshold: z.number().min(0.3).max(1).optional(),
        model: z.enum(["percent-correct", "irt-lite"]).optional(),
      }),
      req.body,
    );
    const sim = createSimulation(db, body.userId, body.scope, body.length, routerConfig(body.threshold, body.model));
    return currentView(db, sim.id);
  });

  app.get<{ Params: { id: string } }>("/api/users/:id/simulations", async (req) => {
    user(db, req.params.id);
    return db.prepare("SELECT id, scope, length, status, started_at, completed_at FROM simulations WHERE user_id = ? ORDER BY started_at DESC LIMIT 50").all(req.params.id);
  });

  app.get<{ Params: { id: string } }>("/api/simulations/:id/current", async (req) => {
    const v = currentView(db, req.params.id);
    if (!v) throw new HttpError(404, "Unknown simulation");
    return v;
  });
  app.post<{ Params: { id: string } }>("/api/simulations/:id/start-step", async (req) => startStep(db, req.params.id));
  app.put<{ Params: { id: string } }>("/api/simulations/:id/state", async (req) => {
    saveStepState(db, req.params.id, (req.body as { state?: unknown })?.state ?? {});
    return { ok: true, saved_at: nowIso() };
  });
  app.post<{ Params: { id: string } }>("/api/simulations/:id/submit-step", async (req) => {
    const body = parse(
      z.object({ responses: z.record(z.string(), z.unknown()), elapsedMs: z.record(z.string(), z.number()).optional(), timedOut: z.boolean().optional() }),
      req.body,
    );
    submitStep(db, req.params.id, body);
    return currentView(db, req.params.id);
  });
  app.post<{ Params: { id: string } }>("/api/simulations/:id/abandon", async (req) => {
    abandonSimulation(db, req.params.id);
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>("/api/simulations/:id/results", async (req) => {
    const sim = getSimulation(db, req.params.id);
    if (!sim) throw new HttpError(404, "Unknown simulation");
    const results = refreshResults(db, sim.id);
    const attempts = db
      .prepare("SELECT id, exercise_id, task_type, section, module_stage, raw_score, max_score, accuracy, pending, timed_out FROM attempts WHERE simulation_id = ? ORDER BY submitted_at")
      .all(sim.id);
    return { simulation: { id: sim.id, scope: sim.scope, length: sim.length, status: sim.status, started_at: sim.started_at, completed_at: sim.completed_at, router: sim.router, steps: sim.steps.map((s) => ({ section: s.section, stage: s.stage, label: s.label, route: s.route ?? null })) }, results, attempts };
  });

  // ------------------------------------------------------------- static web
  const dist = path.join(ROOT, "web", "dist");
  if ((opts.serveStatic ?? true) && fs.existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.status(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }

  return { app, db, env, content, vocab };
}

function sendFile(reply: FastifyReply, file: string, mime: string) {
  reply.header("Content-Type", mime);
  reply.header("Cache-Control", "private, max-age=3600");
  return reply.send(fs.createReadStream(file));
}
