import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/app";
import { loadEnv, type Env } from "../server/env";
import type { DB } from "../server/db";
import { blocksToCheck, bonusAvailable, currentStep, orderedSteps, progressSegments, reachedCount, resumeScreen, saveFor, type SavedSession, type SessionBlock, type SessionPlan } from "../shared/session";

const block = (id: SessionBlock["id"], done = false, extra: Partial<SessionBlock> = {}): SessionBlock => ({ id, label: id, done, ...extra });
const plan = (done: Partial<Record<SessionBlock["id"], boolean>> = {}, optional = true): SessionPlan => ({
  date: "2026-11-19",
  status: "active",
  // The API lists blocks in this order too; the session sorts them anyway.
  blocks: [block("shadowing", !!done.shadowing), block("vocab", !!done.vocab), block("main", !!done.main, { launch: { kind: "drill" }, items: 3, progress: 0 })],
  optional: optional ? block("optional", !!done.optional, { launch: { kind: "drill" }, items: 2, progress: 0 }) : null,
});

describe("session flow (pure)", () => {
  it("chains vocabulary, shadowing and the main block, then offers the bonus round", () => {
    const seen: string[] = [];
    let p = plan();
    for (;;) {
      const s = resumeScreen(p, null);
      if (s.screen !== "upnext") break;
      seen.push(s.step.id);
      p = { ...p, blocks: p.blocks.map((b) => (b.id === s.step.id ? { ...b, done: true } : b)) };
    }
    expect(seen).toEqual(["vocab", "shadowing", "main"]);
    expect(resumeScreen(p, null)).toEqual({ screen: "end", bonusAvailable: true });
    // Accepting the bonus round presents it next; once done, the end screen no longer offers it.
    const accepted: SavedSession = { date: p.date, step: null, screen: "end", bonus: true };
    expect(resumeScreen(p, accepted)).toMatchObject({ screen: "upnext", step: { id: "optional" } });
    p = { ...p, optional: { ...p.optional!, done: true } };
    expect(resumeScreen(p, accepted)).toEqual({ screen: "end", bonusAvailable: false });
  });

  it("never offers the bonus before the base is done, nor when the plan has none", () => {
    expect(currentStep(plan({ vocab: true }), true)!.id).toBe("shadowing");
    expect(bonusAvailable(plan({ vocab: true, shadowing: true }))).toBe(false);
    expect(bonusAvailable(plan({ vocab: true, shadowing: true, main: true }, false))).toBe(false);
    expect(orderedSteps(plan()).map((b) => b.id)).toEqual(["vocab", "shadowing", "main", "optional"]);
  });

  it("resumes the step that was running, in place, after leaving", () => {
    const p = plan({ vocab: true });
    const leftDuring: SavedSession = { date: p.date, step: "shadowing", screen: "run", bonus: false };
    expect(resumeScreen(p, leftDuring)).toMatchObject({ screen: "run", step: { id: "shadowing" } });
    // Left on "Up next": back on "Up next".
    expect(resumeScreen(p, { ...leftDuring, screen: "upnext" })).toMatchObject({ screen: "upnext", step: { id: "shadowing" } });
    // The saved step was finished in the meantime: the next one is presented.
    expect(resumeScreen(plan({ vocab: true, shadowing: true }), leftDuring)).toMatchObject({ screen: "upnext", step: { id: "main" } });
    // A session saved on another day is ignored.
    expect(resumeScreen(p, { ...leftDuring, date: "2026-11-18" })).toMatchObject({ screen: "upnext", step: { id: "shadowing" } });
    expect(saveFor(p, { screen: "run", step: p.blocks[0]! }, false)).toEqual({ date: p.date, step: "shadowing", screen: "run", bonus: false });
    expect(resumeScreen({ ...p, status: "no_exam_date", blocks: [] }, null)).toEqual({ screen: "unavailable" });
  });

  it("ticks a block whose exercises are all done, even if the session was left before ticking it", () => {
    const p = plan({ vocab: true, shadowing: true });
    expect(blocksToCheck(p)).toEqual([]);
    const reached = { ...p, blocks: p.blocks.map((b) => (b.id === "main" ? { ...b, progress: 3 } : b)) };
    expect(blocksToCheck(reached)).toEqual(["main"]);
    expect(reachedCount({ ...block("main"), launch: { kind: "simulation" }, items: 1, progress: 1 })).toBe(true);
    expect(reachedCount({ ...block("vocab"), launch: { kind: "vocab" }, progress: 99 })).toBe(false);
    expect(progressSegments(p, false, "main").map((s) => s.state)).toEqual(["done", "done", "current"]);
    expect(progressSegments(p, true, "main")).toHaveLength(4);
  });
});

// ---------------------------------------------------------------- against the API

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toefl-session-"));
const baseEnv = loadEnv();
const env: Env = { ...baseEnv, dataDir: tmp, llm: { ...baseEnv.llm, apiKey: "" }, stt: { ...baseEnv.stt, provider: "none" }, tts: { ...baseEnv.tts, provider: "none" } };
let app: FastifyInstance;
let db: DB;

type ApiBlock = SessionBlock & { launch: { kind: string; exercise_id?: string; mode?: string; origin?: string | null } | null };
type ApiPlan = SessionPlan & { base_done: boolean; streak: number; week_days: { done: string[] }; road?: { done: string[] }; blocks: ApiBlock[]; optional?: ApiBlock | null };
const getPlan = async (user: string) => (await app.inject({ method: "GET", url: `/api/users/${user}/plan` })).json() as ApiPlan;
const check = (user: string, date: string, b: string) => app.inject({ method: "PUT", url: `/api/users/${user}/plan/checks`, payload: { date, block: b, done: true } });

/** One exercise of a drill block, as the runner does it: start a drill session and submit it. */
async function oneDrill(user: string, b: ApiBlock) {
  const l = b.launch!;
  const s = (await app.inject({ method: "POST", url: "/api/sessions", payload: { userId: user, exerciseId: l.exercise_id, mode: l.mode, origin: l.origin ?? null } })).json();
  await app.inject({ method: "POST", url: `/api/sessions/${s.session.id}/submit`, payload: { response: {}, elapsedMs: 30000 } });
}

/** Runs the session against the API: ticks reached blocks, then completes the current step. Stops after `stopAfter` steps. */
async function run(user: string, saved: SavedSession | null, stopAfter = Infinity) {
  const order: string[] = [];
  let state = saved;
  for (let guard = 0; guard < 60; guard++) {
    let p = await getPlan(user);
    for (const id of blocksToCheck(p)) await check(user, p.date, id);
    p = await getPlan(user);
    const s = resumeScreen(p, state);
    if (s.screen !== "upnext" && s.screen !== "run") return { order, state, screen: s, plan: p };
    if (order.length >= stopAfter) return { order, state: saveFor(p, { screen: "run", step: s.step }, !!state?.bonus), screen: s, plan: p };
    const step = [...p.blocks, ...(p.optional ? [p.optional] : [])].find((b) => b.id === s.step.id)!;
    if (!order.includes(step.id)) order.push(step.id);
    state = saveFor(p, { screen: "run", step }, !!state?.bonus);
    if (step.launch?.kind === "drill") await oneDrill(user, step);
    // Vocabulary, shadowing and simulations tick their block when the component reports the end.
    else await check(user, p.date, step.id);
  }
  throw new Error("session did not finish");
}

beforeAll(async () => {
  ({ app, db } = await buildApp({ env, dbFile: path.join(tmp, "s.db"), serveStatic: false }));
  // Past the diagnostic, so the main block is the planned one.
  db.prepare("INSERT INTO simulations (id, user_id, scope, length, status, router_config_json, plan_json, started_at, completed_at) VALUES ('sim_m', 'Mathias', 'full', 'short', 'completed', '{}', '[]', ?, ?)").run(
    new Date(Date.now() - 86400000 * 3).toISOString(),
    new Date(Date.now() - 86400000 * 3).toISOString(),
  );
});
afterAll(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("session flow (API)", () => {
  it("resumes after leaving in the middle, keeps the progress and ticks every block in the plan", async () => {
    const before = await getPlan("Mathias");
    if (before.status !== "active") return; // the exam date has passed on this machine's clock
    // First sitting: vocabulary, then leave during shadowing.
    const first = await run("Mathias", null, 1);
    expect(first.order).toEqual(["vocab"]);
    expect(first.screen).toMatchObject({ screen: "upnext", step: { id: "shadowing" } });
    expect(first.plan.blocks.find((b) => b.id === "vocab")!.done).toBe(true);
    // Back later: the same step resumes, and the rest follows in order.
    const resumed = resumeScreen(await getPlan("Mathias"), first.state);
    expect(resumed).toMatchObject({ screen: "run", step: { id: "shadowing" } });
    const second = await run("Mathias", first.state);
    expect(second.order).toEqual(["shadowing", "main"]);
    const p = second.plan as ApiPlan;
    expect(p.blocks.every((b) => b.done)).toBe(true);
    expect(p.base_done).toBe(true);
    expect(p.streak).toBe(1);
    expect(p.week_days.done).toContain(p.date);
    expect(p.road?.done ?? [p.date]).toContain(p.date);
    expect(second.screen).toEqual({ screen: "end", bonusAvailable: !!p.optional && !p.optional.done });
  });

  it("counts the exercises of a drill block done before leaving", async () => {
    const p = await getPlan("Mathias");
    const main = p.blocks.find((b) => b.id === "main")!;
    if (p.status !== "active" || main.launch?.kind !== "drill") return;
    expect(main.progress).toBeGreaterThanOrEqual(main.items ?? 0);
  });

  it("runs the bonus round once accepted and ticks it", async () => {
    const p = await getPlan("Mathias");
    if (p.status !== "active" || !p.optional) return;
    const r = await run("Mathias", { date: p.date, step: null, screen: "end", bonus: true });
    expect(r.order).toEqual(["optional"]);
    expect(r.plan.optional!.done).toBe(true);
    expect(r.screen).toEqual({ screen: "end", bonusAvailable: false });
  });

  it("serves the diagnostic simulation as the main block for a profile without one, and ticks it", async () => {
    await app.inject({ method: "PATCH", url: "/api/users/Virgile", payload: { exam_date: "2099-01-01" } });
    const p = await getPlan("Virgile");
    const main = p.blocks.find((b) => b.id === "main")!;
    expect(main.launch?.kind).toBe("simulation");
    const r = await run("Virgile", null);
    expect(r.order).toEqual(["vocab", "shadowing", "main"]);
    expect(r.plan.base_done).toBe(true);
  });
});
