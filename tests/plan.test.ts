import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/app";
import { loadEnv, type Env } from "../server/env";
import type { DB } from "../server/db";
import { getExercise } from "../server/content";
import { CONFIG } from "../shared/config";
import { addDays, daysBetween, nextCheckpoint, parseTask, phaseFor, streak, validatePlan, weekdayOf } from "../shared/plan";

const PLAN = CONFIG.internal.plan;

describe("plan engine", () => {
  it("has a valid configuration", () => {
    expect(validatePlan(PLAN)).toEqual([]);
  });

  it("detects broken configurations", () => {
    const broken = structuredClone(PLAN);
    broken.phases[1]!.from_days = 50;
    broken.rotations.default!.diagnostic!.mon!.main.task = "juggling";
    delete broken.rotations.default!.exam_mode!.sun;
    const problems = validatePlan(broken).join("\n");
    expect(problems).toMatch(/foundations: does not start/);
    expect(problems).toMatch(/unknown task "juggling"/);
    expect(problems).toMatch(/exam_mode\/sun: missing/);
  });

  it("maps days before the exam to the four phases", () => {
    const id = (d: number) => phaseFor(d, PLAN.phases)?.id ?? null;
    expect([id(200), id(55), id(54), id(34), id(33), id(13), id(12), id(1), id(0), id(-3)]).toEqual([
      "diagnostic", "diagnostic", "foundations", "foundations", "intensification", "intensification", "exam_mode", "exam_mode", null, null,
    ]);
  });

  it("works on calendar days", () => {
    expect(daysBetween("2026-11-12", "2027-01-09")).toBe(58);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekdayOf("2026-11-12")).toBe("thu");
    expect(weekdayOf("2027-01-09")).toBe("sat");
  });

  it("parses block tasks", () => {
    expect(parseTask("academic_talk")).toEqual({ kind: "task", taskType: "academic_talk" });
    expect(parseTask("focus")).toEqual({ kind: "focus" });
    expect(parseTask("simulation:full:short")).toEqual({ kind: "simulation", scope: "full", length: "short" });
    expect(parseTask("simulation:reading")).toEqual({ kind: "simulation", scope: "reading", length: "full" });
    expect(parseTask("simulation:music")).toBeNull();
  });

  it("finds the next checkpoint still ahead", () => {
    const cp = (d: number) => nextCheckpoint(d, "2027-01-09", PLAN.checkpoints);
    expect(cp(58)).toMatchObject({ days_before: 55, in_days: 3, date: "2026-11-15" });
    expect(cp(58)!.date).toBe(addDays("2027-01-09", -55));
    expect(cp(55)).toMatchObject({ days_before: 55, in_days: 0 });
    expect(cp(54)).toMatchObject({ days_before: 34, in_days: 20 });
    expect(cp(3)).toBeNull();
  });

  it("counts consecutive complete days, today included only once finished", () => {
    const days = new Set(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-08"]);
    expect(streak(days, "2026-11-12")).toBe(3);
    expect(streak(days, "2026-11-13")).toBe(3); // today not finished yet: the streak is not broken
    expect(streak(days, "2026-11-14")).toBe(0);
    expect(streak(new Set(), "2026-11-12")).toBe(0);
  });
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toefl-plan-"));
const baseEnv = loadEnv();
const env: Env = { ...baseEnv, dataDir: tmp, llm: { ...baseEnv.llm, apiKey: "" }, stt: { ...baseEnv.stt, provider: "none" }, tts: { ...baseEnv.tts, provider: "none" } };
let app: FastifyInstance;
let db: DB;
const get = (url: string) => app.inject({ method: "GET", url });
const put = (url: string, payload: object) => app.inject({ method: "PUT", url, payload });

beforeAll(async () => {
  ({ app, db } = await buildApp({ env, dbFile: path.join(tmp, "p.db"), serveStatic: false }));
});
afterAll(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("daily plan routes", () => {
  it("seeds Mathias's exam date and leaves the other profile without one", async () => {
    const users = (await get("/api/users")).json() as Array<{ id: string; exam_date: string | null; target_band: number }>;
    expect(users.find((u) => u.id === "Mathias")!.exam_date).toBe("2027-01-09");
    const other = users.find((u) => u.id !== "Mathias")!;
    expect(other).toMatchObject({ exam_date: null, target_band: 5 });
    const p = (await get(`/api/users/${other.id}/plan?date=2026-11-12`)).json();
    expect(p).toMatchObject({ status: "no_exam_date", blocks: [], phase: null });
  });

  it("builds today's plan: phase, days left, base, optional block and checkpoint", async () => {
    const p = (await get("/api/users/Mathias/plan?date=2026-11-12")).json();
    expect(p).toMatchObject({ status: "active", days_left: 58, phase: { id: "diagnostic" }, streak: 0, base_done: false });
    expect(p.blocks.map((b: { id: string }) => b.id)).toEqual(["vocab", "shadowing", "main"]);
    const thursday = PLAN.rotations.default!.diagnostic!.thu!;
    expect(p.blocks[2]).toMatchObject({ task: thursday.main.task, items: thursday.main.items, mode: thursday.main.mode, progress: 0, done: false });
    expect(p.blocks[2].launch).toMatchObject({ kind: "drill", mode: thursday.main.mode });
    expect(p.blocks[1].launch).toMatchObject({ kind: "drill", mode: "practice" });
    expect(p.blocks[0].launch).toEqual({ kind: "vocab" });
    expect(p.optional).toMatchObject({ task: thursday.optional!.task });
    expect(p.checkpoint).toMatchObject({ days_before: 55, in_days: 3, date: "2026-11-15" });
    // The launched exercise really is of the planned task type.
    expect(getExercise(db, p.blocks[2].launch.exercise_id)!.task_type).toBe(thursday.main.task);
  });

  it("launches simulations directly in exam mode", async () => {
    const saturday = "2027-01-02"; // J-7, exam mode
    expect(weekdayOf(saturday)).toBe("sat");
    const p = (await get(`/api/users/Mathias/plan?date=${saturday}`)).json();
    expect(p.phase.id).toBe("exam_mode");
    expect(p.blocks[2].launch).toEqual({ kind: "simulation", scope: "full", length: "full" });
    expect(p.blocks[2].progress).toBeNull();
    expect(p.checkpoint).toMatchObject({ days_before: 5, in_days: 2 });
  });

  it("reports exam day and a past exam", async () => {
    expect((await get("/api/users/Mathias/plan?date=2027-01-09")).json().status).toBe("exam_day");
    expect((await get("/api/users/Mathias/plan?date=2027-02-01")).json().status).toBe("past");
    expect((await get("/api/users/Mathias/plan?date=2027-13-01")).statusCode).toBe(400);
  });

  it("stores done flags per block and counts the streak on complete base days", async () => {
    const tick = (date: string, block: string, done = true) => put("/api/users/Mathias/plan/checks", { date, block, done });
    for (const d of ["2026-11-10", "2026-11-11"]) for (const b of ["vocab", "shadowing", "main"]) await tick(d, b);
    await tick("2026-11-12", "vocab");
    let p = (await tick("2026-11-12", "optional")).json();
    expect(p.blocks.find((b: { id: string }) => b.id === "vocab").done).toBe(true);
    expect(p.optional.done).toBe(true);
    expect(p).toMatchObject({ base_done: false, streak: 2 }); // today unfinished: yesterday's streak holds
    await tick("2026-11-12", "shadowing");
    p = (await tick("2026-11-12", "main")).json();
    expect(p).toMatchObject({ base_done: true, streak: 3 });
    p = (await tick("2026-11-12", "main", false)).json();
    expect(p).toMatchObject({ base_done: false, streak: 2 });
    expect((await tick("2026-11-12", "breakfast")).statusCode).toBe(400);
    // Another profile is unaffected.
    const other = ((await get("/api/users")).json() as Array<{ id: string }>).find((u) => u.id !== "Mathias")!.id;
    await app.inject({ method: "PATCH", url: `/api/users/${other}`, payload: { exam_date: "2027-03-20" } });
    const o = (await get(`/api/users/${other}/plan?date=2026-11-12`)).json();
    expect(o).toMatchObject({ status: "active", days_left: 128, phase: { id: "diagnostic" }, streak: 0 });
  });

  it("counts today's drills toward the main block", async () => {
    const p = (await get("/api/users/Mathias/plan")).json();
    const main = p.blocks[2];
    if (main.launch?.kind !== "drill") return; // simulation day: nothing to count
    const s = (await app.inject({ method: "POST", url: "/api/sessions", payload: { userId: "Mathias", exerciseId: main.launch.exercise_id, mode: "practice" } })).json();
    await app.inject({ method: "POST", url: `/api/sessions/${s.session.id}/submit`, payload: { response: {}, elapsedMs: 1000 } });
    const after = (await get("/api/users/Mathias/plan")).json();
    if (main.task !== "focus") expect(after.blocks[2].progress).toBe(main.progress + 1);
  });
});
