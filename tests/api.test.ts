import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp } from "../server/app";
import { loadEnv, type Env } from "../server/env";
import { getExercise, readContent } from "../server/content";
import type { DB } from "../server/db";
import type { FastifyInstance } from "fastify";
import type { Exercise } from "../shared/schema";
import { deriveCtw } from "../shared/ctw";
import type { LlmCaller } from "../server/ai/evaluate";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toefl-test-"));
const dbFile = path.join(tmp, "test.db");
const baseEnv = loadEnv();
const env: Env = { ...baseEnv, dataDir: tmp, llm: { ...baseEnv.llm, provider: "anthropic", apiKey: "" }, stt: { ...baseEnv.stt, provider: "none" }, tts: { ...baseEnv.tts, provider: "none" } };

let mode: "valid" | "invalid" | "throw" = "valid";
const fakeLlm: LlmCaller = async ({ system }) => {
  if (mode === "throw") throw new Error("simulated provider outage");
  if (mode === "invalid") return '{"task":"write_an_email","rubric_score_0_5":9}';
  if (system.includes("Write an Email"))
    return JSON.stringify({
      task: "write_an_email",
      rubric_score_0_5: 4,
      confidence_0_1: 0.7,
      criterion_scores: { communicative_purpose: 4, elaboration: 4, syntax_vocabulary: 4, social_conventions: 5, language_control: 3 },
      missing_requirements: ["Ask whether another session will be offered."],
      errors: [{ span: "I can not", category: "mechanics", explanation: "one word", correction: "I cannot" }],
      highest_impact_fix: "Answer every requirement explicitly.",
      target_rewrite: "Dear Coordinator, …",
      rewrite_notes: [],
    });
  return JSON.stringify({
    task: "take_an_interview",
    rubric_score_0_5: 3,
    confidence_0_1: 0.5,
    criterion_scores: { relevance_elaboration: 3, fluency: 3, pronunciation_intelligibility: null, prosody: null, grammar: 3, vocabulary: 3 },
    errors: [],
    content_gaps: [],
    highest_impact_fix: "Add an example.",
    target_model_answer: "I would say …",
  });
};

let app: FastifyInstance;
let db: DB;

async function start(caller?: LlmCaller) {
  const built = await buildApp({ env, dbFile, serveStatic: false, llmCaller: caller });
  app = built.app;
  db = built.db;
}

const post = (url: string, payload: unknown = {}) => app.inject({ method: "POST", url, payload: payload as object });
const get = (url: string) => app.inject({ method: "GET", url });
const ex = <T extends Exercise["task_type"]>(id: string) => getExercise(db, id) as Extract<Exercise, { task_type: T }>;

beforeAll(async () => {
  await start(fakeLlm);
});
afterAll(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function correctResponse(e: Exercise): unknown {
  switch (e.task_type) {
    case "complete_the_words":
      return { gaps: deriveCtw(e.passage).gaps.map((g) => g.missing) };
    case "listen_choose_response":
      return { answer: e.answer_index };
    case "build_a_sentence":
      return { order: e.answer };
    case "read_in_daily_life":
    case "read_academic_passage":
    case "conversation":
    case "announcement":
    case "academic_talk":
      return { answers: e.questions.map((q) => q.answer_index) };
    default:
      return null;
  }
}

describe("content", () => {
  it("every seeded exercise passes validation", () => {
    const c = readContent();
    expect(c.fileErrors).toEqual([]);
    expect(c.errors).toEqual([]);
    expect(c.exercises.length).toBeGreaterThanOrEqual(140);
  });
  it("public views never expose answers", async () => {
    for (const id of ["r_daily_001", "l_response_001", "w_build_001", "r_ctw_001"]) {
      const body = (await get(`/api/exercises/${id}/public`)).body;
      expect(body).not.toContain("answer_index");
      expect(body).not.toContain("explanation");
      expect(body).not.toContain('"answer"');
    }
    expect((await get("/api/exercises/r_ctw_001/public")).body).not.toContain("increasingly");
  });
});

describe("drills, users and persistence", () => {
  it("scores a strict drill and keeps users separate", async () => {
    const s = (await post("/api/sessions", { userId: "Mathias", exerciseId: "w_build_001", mode: "strict" })).json();
    expect(s.session.deadline_at).toBeTruthy();
    const r = (await post(`/api/sessions/${s.session.id}/submit`, { response: correctResponse(ex("w_build_001")), elapsedMs: 12000 })).json();
    expect(r.attempt.raw_score).toBe(1);
    expect(r.exercise.explanation).toBeTruthy();
    const m = (await get("/api/users/Mathias/progress")).json();
    const u = (await get("/api/users/Virgile/progress")).json();
    expect(m.attempts.length).toBe(1);
    expect(u.attempts.length).toBe(0);
  });

  it("rejects unknown users", async () => {
    expect((await get("/api/users/Eve/dashboard")).statusCode).toBe(404);
    expect((await post("/api/sessions", { userId: "Eve", exerciseId: "w_build_001", mode: "strict" })).statusCode).toBe(400);
  });

  it("auto-submits an expired strict drill from its autosave (refresh/interruption)", async () => {
    const s = (await post("/api/sessions", { userId: "Virgile", exerciseId: "r_ctw_002", mode: "strict" })).json();
    const gaps = deriveCtw(ex<"complete_the_words">("r_ctw_002").passage).gaps.map((g) => g.missing);
    await app.inject({ method: "PUT", url: `/api/sessions/${s.session.id}/state`, payload: { state: { response: { gaps: gaps.slice(0, 4) }, elapsedMs: 50000 } } });
    db.prepare("UPDATE sessions SET deadline_at = ? WHERE id = ?").run(new Date(Date.now() - 60000).toISOString(), s.session.id);
    const act = (await get("/api/users/Virgile/active-session")).json();
    expect(act.active.expired_attempt_id).toBeTruthy();
    const a = (await get(`/api/attempts/${act.active.expired_attempt_id}`)).json();
    expect(a.attempt.timed_out).toBe(true);
    expect(a.attempt.raw_score).toBe(4);
  });

  it("flags a late strict submission as a timing violation", async () => {
    const s = (await post("/api/sessions", { userId: "Virgile", exerciseId: "w_build_003", mode: "strict" })).json();
    db.prepare("UPDATE sessions SET deadline_at = ? WHERE id = ?").run(new Date(Date.now() - 30000).toISOString(), s.session.id);
    const r = (await post(`/api/sessions/${s.session.id}/submit`, { response: { order: [] }, elapsedMs: 70000 })).json();
    expect(r.attempt.timing_violation).toBe(true);
    expect(r.attempt.error_tags).toContain("timing_violation");
  });

  it("persists attempts across a server restart", async () => {
    await app.close();
    db.close();
    await start(fakeLlm);
    const m = (await get("/api/users/Mathias/progress")).json();
    expect(m.attempts.length).toBe(1);
    const dash = (await get("/api/users/Mathias/dashboard")).json();
    expect(dash.metrics.find((x: { task_type: string }) => x.task_type === "build_a_sentence").attempts).toBe(1);
  });

  it("updates the target band and recomputes the threshold", async () => {
    const r = await app.inject({ method: "PATCH", url: "/api/users/Virgile", payload: { target_band: 5.5, exam_date: "2027-01-15" } });
    expect(r.statusCode).toBe(200);
    const d = (await get("/api/users/Virgile/dashboard")).json();
    expect(d.projection.threshold.minimum_sum).toBe(21);
    expect((await app.inject({ method: "PATCH", url: "/api/users/Virgile", payload: { target_band: 4.25 } })).statusCode).toBe(400);
    await app.inject({ method: "PATCH", url: "/api/users/Virgile", payload: { target_band: 6 } });
  });
});

describe("AI evaluation", () => {
  async function emailAttempt() {
    const s = (await post("/api/sessions", { userId: "Mathias", exerciseId: "w_email_001", mode: "practice" })).json();
    return (await post(`/api/sessions/${s.session.id}/submit`, { response: { text: "Dear Coordinator, I can not attend the workshop." }, elapsedMs: 300000 })).json().attempt.id as string;
  }
  it("stores a schema-valid evaluation and scores the attempt", async () => {
    mode = "valid";
    const id = await emailAttempt();
    const r = (await post(`/api/attempts/${id}/evaluate`)).json();
    expect(r.status).toBe("ok");
    expect(r.attempt.raw_score).toBe(4);
    expect(r.attempt.error_tags).toContain("missed_requirement");
    expect(r.review.evaluations[0].result.highest_impact_fix).toBeTruthy();
  });
  it("rejects invalid model output without inventing a score", async () => {
    mode = "invalid";
    const id = await emailAttempt();
    const r = (await post(`/api/attempts/${id}/evaluate`)).json();
    expect(r.status).toBe("error");
    expect(r.evaluations[0].status).toBe("invalid_output");
    expect(r.attempt.raw_score).toBeNull();
  });
  it("reports provider errors without inventing a score", async () => {
    mode = "throw";
    const id = await emailAttempt();
    const r = (await post(`/api/attempts/${id}/evaluate`)).json();
    expect(r.evaluations[0].status).toBe("provider_error");
    expect(r.attempt.raw_score).toBeNull();
    mode = "valid";
  });
  it("returns 'unavailable' when no provider is configured", async () => {
    await app.close();
    db.close();
    await start(undefined);
    const id = await emailAttempt();
    const r = (await post(`/api/attempts/${id}/evaluate`)).json();
    expect(r.status).toBe("unavailable");
    expect(r.attempt.raw_score).toBeNull();
    const cfg = (await get("/api/config")).json();
    expect(cfg.providers.llm.configured).toBe(false);
    await app.close();
    db.close();
    await start(fakeLlm);
  });
});

describe("speaking recordings", () => {
  it("stores audio, accepts a browser transcript and scores Listen and Repeat", async () => {
    const lr = ex<"listen_and_repeat">("s_repeat_002");
    const s = (await post("/api/sessions", { userId: "Virgile", exerciseId: lr.id, mode: "strict" })).json();
    expect(s.session.time_limit_ms).toBeNull();
    const items = [];
    for (const it of lr.items) {
      const up = await app.inject({ method: "POST", url: `/api/recordings?userId=Virgile&exerciseId=${lr.id}&itemKey=item${it.index}&sessionId=${s.session.id}&durationMs=4000`, payload: Buffer.from("fake-webm"), headers: { "content-type": "audio/webm" } });
      const rec = up.json();
      expect(rec.id).toBeTruthy();
      expect(rec.transcript).toBeNull();
      if (it.index <= 5) await post(`/api/recordings/${rec.id}/transcript`, { transcript: it.index === 5 ? "visitors should" : it.text, confidence: 0.92 });
      items.push({ index: it.index, recordingId: rec.id, durationMs: 4000 });
    }
    const r = (await post(`/api/sessions/${s.session.id}/submit`, { response: { items }, elapsedMs: 80000 })).json();
    const scores = r.attempt.result.items.map((i: { score: number | null }) => i.score);
    expect(scores.slice(0, 4)).toEqual([5, 5, 5, 5]);
    expect(scores[4]).toBeLessThan(3);
    expect(scores[5]).toBeNull();
    expect(r.attempt.pending).toBe(true);
    const audio = await get(`/api/recordings/${items[0]!.recordingId}/audio`);
    expect(audio.statusCode).toBe(200);
    const rated = (await post(`/api/attempts/${r.attempt.id}/self-rate`, { ratings: { item6: 4, item7: 3 } })).json();
    expect(rated.attempt.pending).toBe(false);
    expect(rated.attempt.raw_score).toBe(5 * 4 + scores[4] + 4 + 3);
  });

  it("evaluates interview answers that have transcripts", async () => {
    const iv = ex<"take_an_interview">("s_interview_002");
    const s = (await post("/api/sessions", { userId: "Virgile", exerciseId: iv.id, mode: "strict" })).json();
    const items = [];
    for (const q of iv.questions) {
      const rec = (await app.inject({ method: "POST", url: `/api/recordings?userId=Virgile&exerciseId=${iv.id}&itemKey=q${q.index}&durationMs=40000`, payload: Buffer.from("x"), headers: { "content-type": "audio/webm" } })).json();
      await post(`/api/recordings/${rec.id}/transcript`, { transcript: "I usually take the bus because it is cheap and reliable.", confidence: null });
      items.push({ index: q.index, recordingId: rec.id });
    }
    const a = (await post(`/api/sessions/${s.session.id}/submit`, { response: { items }, elapsedMs: 200000 })).json();
    const r = (await post(`/api/attempts/${a.attempt.id}/evaluate`)).json();
    expect(r.status).toBe("ok");
    expect(r.attempt.raw_score).toBe(12);
  });
});

describe("adaptive simulation", () => {
  async function runRouter(userId: string, allCorrect: boolean) {
    const v = (await post("/api/simulations", { userId, scope: "reading", length: "full" })).json();
    const id = v.simulation.id as string;
    expect(v.step.stage).toBe("router");
    const started = (await post(`/api/simulations/${id}/start-step`)).json();
    expect(started.session.deadline_at).toBeTruthy();
    const ids: string[] = started.exercises.map((e: { id: string }) => e.id);
    const types = started.exercises.map((e: { task_type: string }) => e.task_type);
    expect(types.filter((t: string) => t === "complete_the_words").length).toBe(1);
    const responses = Object.fromEntries(ids.map((x) => [x, allCorrect ? correctResponse(getExercise(db, x)!) : null]));
    const after = (await post(`/api/simulations/${id}/submit-step`, { responses })).json();
    return { id, after };
  }

  it("follows the official Module 1 composition and routes upward on a strong Module 1", async () => {
    const { id, after } = await runRouter("Mathias", true);
    expect(after.step.stage).toBe("module2");
    expect(after.step.label).toBe("Module 2");
    const res = (await get(`/api/simulations/${id}/results`)).json();
    const route = res.simulation.steps.find((s: { stage: string }) => s.stage === "router").route;
    expect(route.route).toBe("upper");
    expect(route.isOfficial).toBe(false);
    const started = (await post(`/api/simulations/${id}/start-step`)).json();
    expect(started.exercises.map((e: { task_type: string }) => e.task_type).sort()).toEqual(["complete_the_words", "read_academic_passage"]);
    const done = (await post(`/api/simulations/${id}/submit-step`, { responses: {} })).json();
    expect(done.simulation.status).toBe("completed");
    const final = (await get(`/api/simulations/${id}/results`)).json();
    expect(final.results.sections.reading.band).not.toBeNull();
  });

  it("routes to the lower module on a weak Module 1 and refuses a second active simulation", async () => {
    const { id, after } = await runRouter("Virgile", false);
    expect(after.simulation.status).toBe("active");
    expect((await post("/api/simulations", { userId: "Virgile", scope: "listening", length: "short" })).statusCode).toBe(400);
    const started = (await post(`/api/simulations/${id}/start-step`)).json();
    expect(started.exercises.map((e: { task_type: string }) => e.task_type)).toContain("read_in_daily_life");
    await post(`/api/simulations/${id}/abandon`);
  });

  it("reports content sufficiency for every simulation type", async () => {
    const s = (await get("/api/simulations/sufficiency")).json();
    expect(s["reading:full"].forms).toBeGreaterThanOrEqual(2);
    expect(s["listening:full"].forms).toBeGreaterThanOrEqual(2);
    expect(s["full:full"].forms).toBeGreaterThanOrEqual(2);
  });

  it("auto-submits an expired module from its autosave", async () => {
    const v = (await post("/api/simulations", { userId: "Virgile", scope: "listening", length: "short" })).json();
    const id = v.simulation.id;
    await post(`/api/simulations/${id}/start-step`);
    await app.inject({ method: "PUT", url: `/api/simulations/${id}/state`, payload: { state: { responses: {} } } });
    db.prepare("UPDATE sessions SET deadline_at = ? WHERE simulation_id = ? AND status = 'active'").run(new Date(Date.now() - 60000).toISOString(), id);
    const cur = (await get(`/api/simulations/${id}/current`)).json();
    expect(cur.step.stage).toBe("module2");
    const res = (await get(`/api/simulations/${id}/results`)).json();
    expect(res.attempts.every((a: { timed_out: number }) => a.timed_out === 1)).toBe(true);
    await post(`/api/simulations/${id}/abandon`);
  });
});

describe("analytics", () => {
  it("builds weaknesses and recommendations from stored data only", async () => {
    for (const id of ["w_build_004", "w_build_005", "w_build_006"]) {
      const s = (await post("/api/sessions", { userId: "Mathias", exerciseId: id, mode: "strict" })).json();
      await post(`/api/sessions/${s.session.id}/submit`, { response: { order: [] }, elapsedMs: 20000 });
    }
    const p = (await get("/api/users/Mathias/progress")).json();
    expect(p.weaknesses[0].tag).toBe("embedded_questions");
    expect(p.recommendations.length).toBe(12);
    const f = (await get("/api/users/Mathias/focus")).json();
    expect(f.task_type).toBe("build_a_sentence");
    const fe = getExercise(db, f.exercise_id) as Extract<Exercise, { task_type: "build_a_sentence" }>;
    expect(fe.pattern).toBe("embedded_questions");
    expect(p.ready_gate.ready).toBe(false);
  });
});

describe("profile rename migration", () => {
  it("moves User_1's history to Virgile with a 5.0 target on an existing database", async () => {
    const { openDb } = await import("../server/db");
    const Sqlite = (await import("node:sqlite")).DatabaseSync;
    const file = path.join(os.tmpdir(), `toefl-rename-${Date.now()}.db`);
    // Build a database as it was before the rename: only migrations 001–002 applied, with User_1 data.
    const raw = new Sqlite(file);
    raw.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (const m of ["001_init.sql", "002_vocab.sql"]) {
      raw.exec(fs.readFileSync(path.join("server", "migrations", m), "utf8"));
      raw.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(m, "2026-11-01T00:00:00Z");
    }
    raw.exec("INSERT INTO users (id, display_name, target_band, exam_date) VALUES ('User_1', 'User_1', 6.0, '2026-12-28'), ('Mathias', 'Mathias', 6.0, NULL)");
    raw.exec("INSERT INTO progress_snapshots (user_id, created_at, reason, projection_json) VALUES ('User_1', '2026-11-02T00:00:00Z', 'attempt', '{}')");
    raw.close();
    const migrated = openDb(file);
    const users = migrated.prepare("SELECT id, target_band, exam_date FROM users ORDER BY id").all();
    expect(users).toEqual([
      { id: "Mathias", target_band: 6, exam_date: null },
      { id: "Virgile", target_band: 5, exam_date: "2026-12-28" },
    ]);
    expect((migrated.prepare("SELECT COUNT(*) c FROM progress_snapshots WHERE user_id = 'Virgile'").get() as { c: number }).c).toBe(1);
    migrated.close();
    fs.rmSync(file, { force: true });
  });
});
