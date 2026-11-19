import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/app";
import { loadEnv, type Env } from "../server/env";
import type { DB } from "../server/db";
import { API_VERSION } from "../shared/apiVersion";

/** Everything the Today page reads, for a profile with an exam date (Mathias) and one without (Virgile). */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toefl-today-"));
const baseEnv = loadEnv();
const env: Env = { ...baseEnv, dataDir: tmp, llm: { ...baseEnv.llm, apiKey: "" }, stt: { ...baseEnv.stt, provider: "none" }, tts: { ...baseEnv.tts, provider: "none" } };
let app: FastifyInstance;
let db: DB;
const get = (url: string) => app.inject({ method: "GET", url });
const DATE = "2026-11-19";

beforeAll(async () => {
  ({ app, db } = await buildApp({ env, dbFile: path.join(tmp, "t.db"), serveStatic: false }));
});
afterAll(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function todayData(user: string) {
  const [plan, dash, official, triage, summary] = await Promise.all([
    get(`/api/users/${user}/plan?date=${DATE}`),
    get(`/api/users/${user}/dashboard`),
    get(`/api/users/${user}/official-scores`),
    get(`/api/users/${user}/vocab/triage?limit=1`),
    get(`/api/users/${user}/vocab/summary`),
  ]);
  for (const r of [plan, dash, official, triage, summary]) expect(r.statusCode, r.body).toBe(200);
  return { plan: plan.json(), dash: dash.json(), official: official.json(), triage: triage.json() };
}

describe("Today page data for both profiles", () => {
  it("reports the API version the web app expects", async () => {
    expect((await get("/api/health")).json().api_version).toBe(API_VERSION);
  });

  it("with an exam date (Mathias): active plan, week, road, projections and official scores", async () => {
    const { plan, dash, official, triage } = await todayData("Mathias");
    expect(plan).toMatchObject({ status: "active", exam_date: "2027-01-09", streak: 0, week_days: { start: "2026-11-16", today: DATE, done: [] } });
    expect(plan.blocks.map((b: { id: string }) => b.id)).toEqual(["vocab", "shadowing", "main"]);
    expect(plan.road).toMatchObject({ exam_date: "2027-01-09", done: [] });
    expect(plan.road.phases.length).toBeGreaterThan(0);
    expect(Object.keys(dash.projection.sections).sort()).toEqual(["listening", "reading", "speaking", "writing"]);
    for (const s of Object.values(dash.projection.sections) as Array<{ min_n: number }>) expect(s.min_n).toBeGreaterThan(0);
    expect(dash.projection.disclaimer).toMatch(/Internal training estimate/);
    expect(official.scores).toEqual([]);
    expect(triage.entries).toHaveLength(1);
  });

  it("without an exam date (Virgile): the same fields, no plan and no road", async () => {
    const { plan, dash, official, triage } = await todayData("Virgile");
    expect(plan).toMatchObject({ status: "no_exam_date", exam_date: null, days_left: null, phase: null, blocks: [], streak: 0 });
    expect(plan.week_days).toEqual({ start: "2026-11-16", today: DATE, done: [] });
    expect(plan.road).toBeUndefined();
    expect(Object.keys(dash.projection.sections)).toHaveLength(4);
    expect(official.scores).toEqual([]);
    expect(triage.entries).toHaveLength(1);
  });

  it("switches Virgile to the full plan once an exam date is set, and back when it is cleared", async () => {
    const patch = (exam_date: string | null) => app.inject({ method: "PATCH", url: "/api/users/Virgile", payload: { exam_date } });
    expect((await patch("2027-03-01")).statusCode).toBe(200);
    let p = (await get(`/api/users/Virgile/plan?date=${DATE}`)).json();
    expect(p).toMatchObject({ status: "active", week_days: { start: "2026-11-16" } });
    expect(p.road.exam_date).toBe("2027-03-01");
    expect((await patch(null)).statusCode).toBe(200);
    p = (await get(`/api/users/Virgile/plan?date=${DATE}`)).json();
    expect(p.status).toBe("no_exam_date");
    expect(p.week_days.done).toEqual([]);
    expect(p.road).toBeUndefined();
  });

  it("keeps the week and the official scores for a past exam date or exam day", async () => {
    for (const [date, status] of [["2027-01-09", "exam_day"], ["2027-02-01", "past"]] as const) {
      const p = (await get(`/api/users/Mathias/plan?date=${date}`)).json();
      expect(p.status).toBe(status);
      expect(p.week_days.today).toBe(date);
    }
    expect((await get("/api/users/Mathias/official-scores")).statusCode).toBe(200);
  });
});
