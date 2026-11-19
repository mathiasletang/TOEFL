import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/app";
import { loadEnv, type Env } from "../server/env";
import type { DB } from "../server/db";
import { getExercise, readContent } from "../server/content";
import { taskLabel as taskLabelOf } from "../server/plan";
import { CONFIG } from "../shared/config";
import {
  PLAN_CATEGORIES,
  addDays,
  blockMinutes,
  buildEstimates,
  categoryOf,
  daysBetween,
  nextCheckpoint,
  parseTask,
  phaseFor,
  segmentsPerSession,
  shadowSegments,
  streak,
  validatePlan,
  weekMix,
  weekdayOf,
} from "../shared/plan";

const PLAN = CONFIG.internal.plan;
const bank = readContent().exercises;
const est = buildEstimates(bank, CONFIG);

describe("plan engine", () => {
  it("has a valid configuration, durations and weekly mix included", () => {
    expect(validatePlan(PLAN, est)).toEqual([]);
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

  it("parses block tasks and assigns categories", () => {
    expect(parseTask("academic_talk")).toEqual({ kind: "task", taskType: "academic_talk" });
    expect(parseTask("focus")).toEqual({ kind: "focus" });
    expect(parseTask("simulation:full:short")).toEqual({ kind: "simulation", scope: "full", length: "short" });
    expect(parseTask("simulation:music")).toBeNull();
    expect([categoryOf("write_an_email"), categoryOf("simulation:writing"), categoryOf("take_an_interview"), categoryOf("conversation"), categoryOf("simulation:reading"), categoryOf("focus"), categoryOf("simulation:full")]).toEqual([
      "writing", "writing", "speaking", "reading_listening", "reading_listening", "focus", null,
    ]);
  });

  it("finds the next checkpoint still ahead", () => {
    const cp = (d: number) => nextCheckpoint(d, "2027-01-09", PLAN.checkpoints);
    expect(cp(58)).toMatchObject({ days_before: 55, in_days: 3, date: "2026-11-15" });
    expect(cp(55)).toMatchObject({ days_before: 55, in_days: 0 });
    expect(cp(54)).toMatchObject({ days_before: 34, in_days: 20 });
    expect(cp(3)).toBeNull();
  });

  it("counts consecutive complete days, today included only once finished", () => {
    const days = new Set(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-08"]);
    expect(streak(days, "2026-11-12")).toBe(3);
    expect(streak(days, "2026-11-13")).toBe(3);
    expect(streak(days, "2026-11-14")).toBe(0);
  });
});

describe("plan dosage", () => {
  it("estimates exercise time from drill_seconds, audio and response windows", () => {
    // drill_seconds: build_a_sentence 35 s; email = its 7-minute limit; discussion = 10 minutes.
    expect(est.perExercise.build_a_sentence!).toBeCloseTo(35 / 60, 5);
    expect(est.perExercise.write_an_email!).toBeCloseTo(7, 5);
    expect(est.perExercise.academic_discussion!).toBeCloseTo(10, 5);
    // Listening adds the audio that plays before the clock starts.
    const talk = bank.find((e) => e.task_type === "academic_talk")!;
    expect(est.perExercise.academic_talk!).toBeGreaterThan((talk.task_type === "academic_talk" ? talk.questions.length * 35 : 0) / 60);
    // Speaking is paced by its response windows: 7 items of 8–12 s, 4 answers of 45 s.
    expect(est.perExercise.listen_and_repeat!).toBeGreaterThan(7 * 8 / 60);
    expect(est.perExercise.take_an_interview!).toBeGreaterThan(3);
    // Simulations use the official module minutes.
    expect(est.minutes("simulation:reading", 1)).toBe(20 + 9);
    expect(est.minutes("simulation:writing", 1)).toBe(6 + 7 + 10);
  });

  it("shows why the old blocks were too short", () => {
    for (const [task, items] of [["build_a_sentence", 10], ["listen_and_repeat", 2], ["academic_discussion", 1]] as const)
      expect(est.minutes(task, items)!).toBeLessThan(11);
  });

  it("keeps every main block between 30 and 40 minutes, correction included", () => {
    for (const phase of Object.values(PLAN.rotations.default!))
      for (const day of Object.values(phase)) {
        const m = blockMinutes(day.main, est);
        expect(day.main.correction_minutes).toBeGreaterThan(0);
        expect(m.total!).toBeGreaterThanOrEqual(PLAN.main_block.min_minutes);
        expect(m.total!).toBeLessThanOrEqual(PLAN.main_block.max_minutes);
      }
  });

  it("weights Writing and Speaking as targeted, with the minimum number of days", () => {
    for (const [phase, week] of Object.entries(PLAN.rotations.default!)) {
      const mix = weekMix(week, est);
      for (const c of PLAN_CATEGORIES) expect(Math.abs(mix.categories[c].share - PLAN.targets.shares[c]), `${phase} ${c}`).toBeLessThanOrEqual(PLAN.targets.tolerance);
      expect(mix.categories.writing.days).toBeGreaterThanOrEqual(3);
      expect(mix.categories.speaking.days).toBeGreaterThanOrEqual(2);
      expect(mix.categories.writing.share + mix.categories.speaking.share).toBeGreaterThan(0.6);
    }
  });

  it("rejects a block that is too short or a week that under-weights Writing", () => {
    const broken = structuredClone(PLAN);
    broken.rotations.default!.diagnostic!.mon!.main = { task: "build_a_sentence", items: 10, mode: "practice", correction_minutes: 2 };
    broken.rotations.default!.foundations!.mon!.main = { task: "read_academic_passage", items: 6, mode: "practice", correction_minutes: 10 };
    const problems = validatePlan(broken, est).join("\n");
    expect(problems).toMatch(/diagnostic\/mon: main block lasts 7\.\d min/);
    expect(problems).toMatch(/foundations: writing on 2 day\(s\) \(at least 3\)/);
    expect(problems).toMatch(/foundations: writing gets .* % of main-block time/);
  });

  it("cuts shadowing segments of at most 25 words from conversations and talks only", () => {
    const segs = shadowSegments(bank, PLAN.shadowing);
    expect(segs.length).toBeGreaterThan(100);
    expect(new Set(segs.map((s) => s.id)).size).toBe(segs.length);
    for (const s of segs) {
      expect(s.words).toBeLessThanOrEqual(25);
      expect(s.words).toBeGreaterThanOrEqual(PLAN.shadowing.min_words);
      expect(["conversation", "academic_talk"]).toContain(s.task_type);
      expect(getExerciseText(s.exercise_id)).toContain(s.text);
    }
    // As many per day as the pool allows for 14 days without repetition.
    expect(segmentsPerSession(segs.length, PLAN.shadowing) * PLAN.shadowing.no_repeat_days).toBeLessThanOrEqual(segs.length);
    expect(segmentsPerSession(10_000, PLAN.shadowing)).toBe(PLAN.shadowing.max_segments);
  });
});

function getExerciseText(id: string): string {
  const ex = bank.find((e) => e.id === id)!;
  return "audio" in ex ? ex.audio.map((a) => a.text.replace(/\s+/g, " ")).join(" ") : "";
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toefl-plan-"));
const baseEnv = loadEnv();
const env: Env = { ...baseEnv, dataDir: tmp, llm: { ...baseEnv.llm, apiKey: "" }, stt: { ...baseEnv.stt, provider: "none" }, tts: { ...baseEnv.tts, provider: "none" } };
let app: FastifyInstance;
let db: DB;
const get = (url: string) => app.inject({ method: "GET", url });
const put = (url: string, payload: object) => app.inject({ method: "PUT", url, payload });
const completeFullSimulation = (userId: string) =>
  db
    .prepare("INSERT INTO simulations (id, user_id, scope, length, status, router_config_json, plan_json, started_at, completed_at) VALUES (?, ?, 'full', 'short', 'completed', '{}', '[]', ?, ?)")
    .run(`sim_${userId}`, userId, new Date().toISOString(), new Date().toISOString());

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
    expect((await get(`/api/users/${other.id}/plan?date=2026-11-12`)).json()).toMatchObject({ status: "no_exam_date", blocks: [] });
  });

  it("proposes the diagnostic first while no full simulation exists", async () => {
    const p = (await get("/api/users/Mathias/plan?date=2026-11-12")).json();
    expect(p).toMatchObject({ status: "active", days_left: 58, phase: { id: "diagnostic" } });
    expect(p.blocks.map((b: { id: string }) => b.id)).toEqual(["vocab", "shadowing", "main"]);
    const main = p.blocks[2];
    expect(main).toMatchObject({ task: PLAN.diagnostic.task, label: PLAN.diagnostic.label, launch: { kind: "simulation", scope: "full", length: "short" } });
    expect(main.diagnostic.replaces).toBe(taskLabelOf(PLAN.rotations.default!.diagnostic!.thu!.main.task));
    expect(p.blocks[1].launch).toEqual({ kind: "shadowing" });
  });

  it("then serves the planned block with its duration and an explicit correction step", async () => {
    completeFullSimulation("Mathias");
    const p = (await get("/api/users/Mathias/plan?date=2026-11-12")).json();
    const thursday = PLAN.rotations.default!.diagnostic!.thu!;
    const main = p.blocks[2];
    const category = categoryOf(thursday.main.task)!;
    expect(main).toMatchObject({ task: thursday.main.task, items: thursday.main.items, mode: thursday.main.mode, category, diagnostic: null, progress: 0 });
    expect(main.minutes.total).toBeGreaterThanOrEqual(30);
    expect(main.minutes.total).toBeLessThanOrEqual(40);
    expect(main.correction).toMatchObject({ kind: PLAN.correction[category].kind, minutes: thursday.main.correction_minutes, review_path: null });
    expect(getExercise(db, main.launch.exercise_id)!.task_type).toBe(thursday.main.task);
    expect(p.optional).toMatchObject({ task: thursday.optional!.task, correction: null });
    // Writing days ask for a rewrite, speaking days for a re-recording.
    const byKind = new Map<string, string>();
    for (let d = 0; d < 7; d++) {
      const b = (await get(`/api/users/Mathias/plan?date=${addDays("2026-11-16", d)}`)).json().blocks[2];
      byKind.set(b.category, b.correction.kind);
    }
    expect(Object.fromEntries(byKind)).toEqual({ writing: "rewrite", speaking: "rerecord", reading_listening: "review", focus: "review" });
  });

  it("links the correction step to today's latest attempt", async () => {
    const p = (await get("/api/users/Mathias/plan")).json();
    const main = p.blocks[2];
    if (main.launch?.kind !== "drill" || main.task === "focus") return;
    const s = (await app.inject({ method: "POST", url: "/api/sessions", payload: { userId: "Mathias", exerciseId: main.launch.exercise_id, mode: "practice" } })).json();
    const a = (await app.inject({ method: "POST", url: `/api/sessions/${s.session.id}/submit`, payload: { response: {}, elapsedMs: 60000 } })).json();
    const after = (await get("/api/users/Mathias/plan")).json();
    expect(after.blocks[2].progress).toBe(main.progress + 1);
    expect(after.blocks[2].correction.review_path).toBe(`review/${a.attempt?.id ?? a.id}`);
  });

  it("compares the real mix of the last 7 days with the targets, focus drills included", async () => {
    const other = ((await get("/api/users")).json() as Array<{ id: string }>).find((u) => u.id !== "Mathias")!.id;
    const drill = async (exerciseId: string, ms: number, origin?: "focus") => {
      const s = (await app.inject({ method: "POST", url: "/api/sessions", payload: { userId: other, exerciseId, mode: "practice", origin } })).json();
      await app.inject({ method: "POST", url: `/api/sessions/${s.session.id}/submit`, payload: { response: {}, elapsedMs: ms } });
    };
    const id = (t: string) => bank.find((e) => e.task_type === t)!.id;
    await drill(id("write_an_email"), 6 * 60000);
    await drill(id("take_an_interview"), 3 * 60000);
    await drill(id("complete_the_words"), 2 * 60000, "focus");
    const w = (await get(`/api/users/${other}/plan`)).json().week;
    const share = (c: string) => w.categories.find((x: { id: string }) => x.id === c);
    expect(w.total_minutes).toBe(11);
    expect(share("writing")).toMatchObject({ minutes: 6, target: 0.35 });
    expect(share("speaking")).toMatchObject({ minutes: 3, target: 0.3 });
    expect(share("focus")).toMatchObject({ minutes: 2, target: 0.15 });
    expect(share("reading_listening")).toMatchObject({ minutes: 0, share: 0, target: 0.2 });
    expect(w.by_section.reading).toBe(2);
    expect((await app.inject({ method: "POST", url: "/api/sessions", payload: { userId: other, exerciseId: id("write_an_email"), mode: "practice", origin: "other" } })).statusCode).toBe(400);
  });

  it("serves shadowing segments that never repeat within 14 days", async () => {
    const first = (await get("/api/users/Mathias/shadowing?date=2026-11-20")).json();
    expect(first.segments.length).toBe(first.per_session);
    expect(first.audio).toBe("browser");
    expect(first.segments.every((s: { words: number; url: string | null }) => s.words <= 25 && s.url === null)).toBe(true);
    // Same day, same session.
    expect((await get("/api/users/Mathias/shadowing?date=2026-11-20")).json().segments).toEqual(first.segments);
    const seen = new Set<string>(first.segments.map((s: { id: string }) => s.id));
    for (let d = 1; d < 14; d++) {
      const s = (await get(`/api/users/Mathias/shadowing?date=${addDays("2026-11-20", d)}`)).json();
      expect(s.repeats).toBe(0);
      for (const seg of s.segments) {
        expect(seen.has(seg.id)).toBe(false);
        seen.add(seg.id);
      }
    }
    // Profiles are independent.
    const other = ((await get("/api/users")).json() as Array<{ id: string }>).find((u) => u.id !== "Mathias")!.id;
    expect((await get(`/api/users/${other}/shadowing?date=2026-11-20`)).json().repeats).toBe(0);
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
    expect(p.optional.done).toBe(true);
    expect(p).toMatchObject({ base_done: false, streak: 2 });
    await tick("2026-11-12", "shadowing");
    p = (await tick("2026-11-12", "main")).json();
    expect(p).toMatchObject({ base_done: true, streak: 3 });
    p = (await tick("2026-11-12", "main", false)).json();
    expect(p).toMatchObject({ base_done: false, streak: 2 });
    expect((await tick("2026-11-12", "breakfast")).statusCode).toBe(400);
  });
});

describe("Today page data", () => {
  it("gives the road from the start of the plan to the exam, with phases, checkpoints and done days", async () => {
    // Earlier tests completed the base on 10 and 11 November.
    const p = (await get("/api/users/Mathias/plan?date=2026-11-12")).json();
    expect(p.road.start).toBe("2026-11-10"); // first activity, before the fixed-length phases begin (J-55)
    expect(p.road.exam_date).toBe("2027-01-09");
    expect(p.road.done).toEqual(["2026-11-10", "2026-11-11"]);
    expect(p.road.phases.map((x: { id: string }) => x.id)).toEqual(PLAN.phases.map((x) => x.id));
    expect(p.road.phases[0]).toMatchObject({ from: "2026-11-10", to: addDays("2027-01-09", -PLAN.phases[0]!.to_days) });
    expect(p.road.phases.at(-1).to).toBe("2027-01-08");
    // Phases follow each other without gaps.
    for (let i = 1; i < p.road.phases.length; i++) expect(p.road.phases[i].from).toBe(addDays(p.road.phases[i - 1].to, 1));
    expect(p.road.checkpoints.map((c: { days_before: number }) => c.days_before)).toEqual(PLAN.checkpoints.map((c) => c.days_before));
    expect(p.road.checkpoints[0].date).toBe(addDays("2027-01-09", -PLAN.checkpoints[0]!.days_before));
  });

  it("starts the road at the first fixed-length phase for a profile without activity", async () => {
    await app.inject({ method: "PATCH", url: "/api/users/Virgile", payload: { exam_date: "2027-03-01" } });
    const p = (await get("/api/users/Virgile/plan?date=2026-11-12")).json();
    const first = Math.max(...PLAN.phases.map((x) => x.from_days ?? x.to_days));
    expect(p.road.start).toBe(daysBetween("2026-11-12", "2027-03-01") > first ? "2026-11-12" : addDays("2027-03-01", -first));
    expect(p.road.done).toEqual([]);
  });

  it("lists the current week from Monday with the complete days", async () => {
    const p = (await get("/api/users/Mathias/plan?date=2026-11-12")).json();
    expect(p.week_days).toEqual({ start: "2026-11-09", today: "2026-11-12", done: ["2026-11-10", "2026-11-11"] });
    const sunday = (await get("/api/users/Mathias/plan?date=2026-11-15")).json();
    expect(sunday.week_days.start).toBe("2026-11-09");
  });

  it("tells how much data each section still needs before a band is projected", async () => {
    const d = (await get("/api/users/Virgile/dashboard")).json();
    expect(d.projection.sections.reading.min_n).toBe(CONFIG.internal.projection.min_items_for_estimate);
    expect(d.projection.sections.speaking).toMatchObject({ band: null, n: 0 }); // locked until enough scored responses
    expect(d.projection.sections.listening.min_n).toBe(CONFIG.internal.projection.min_items_for_estimate);
    expect(d.projection.sections.writing.min_n).toBe(5);
    expect(d.projection.sections.speaking.min_n).toBe(7);
    expect(d.projection.disclaimer).toMatch(/Internal training estimate/);
  });
});

describe("official ETS scores", () => {
  const url = "/api/users/Mathias/official-scores";
  const post = (payload: object) => app.inject({ method: "POST", url, payload });

  it("stores the four section bands and computes the overall band", async () => {
    expect((await get(url)).json().scores).toEqual([]);
    const r = await post({ taken_on: "2026-06-01", reading: 5.5, listening: 5.5, writing: 5, speaking: 5 });
    expect(r.statusCode).toBe(200);
    const s = r.json().scores;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ taken_on: "2026-06-01", reading: 5.5, listening: 5.5, writing: 5, speaking: 5, overall: 5.5 }); // mean 5.25 rounds up
    await post({ taken_on: "2026-09-15", reading: 6, listening: 5.5, writing: 5, speaking: 4.5 });
    expect((await get(url)).json().scores.map((x: { taken_on: string }) => x.taken_on)).toEqual(["2026-09-15", "2026-06-01"]); // latest first
  });

  it("rejects bands off the half-band scale, out of range, or a future date", async () => {
    expect((await post({ taken_on: "2026-06-01", reading: 5.25, listening: 5, writing: 5, speaking: 5 })).statusCode).toBe(400);
    expect((await post({ taken_on: "2026-06-01", reading: 6.5, listening: 5, writing: 5, speaking: 5 })).statusCode).toBe(400);
    expect((await post({ taken_on: "2026-06-01", reading: 5, listening: 5, writing: 5 })).statusCode).toBe(400);
    expect((await post({ taken_on: "2999-01-01", reading: 5, listening: 5, writing: 5, speaking: 5 })).statusCode).toBe(400);
    expect((await post({ taken_on: "01/06/2026", reading: 5, listening: 5, writing: 5, speaking: 5 })).statusCode).toBe(400);
  });

  it("keeps profiles apart and deletes one score", async () => {
    expect((await get("/api/users/Virgile/official-scores")).json().scores).toEqual([]);
    const [latest] = (await get(url)).json().scores;
    expect((await app.inject({ method: "DELETE", url: `/api/users/Virgile/official-scores/${latest.id}` })).statusCode).toBe(404);
    const after = (await app.inject({ method: "DELETE", url: `${url}/${latest.id}` })).json().scores;
    expect(after.map((x: { taken_on: string }) => x.taken_on)).toEqual(["2026-06-01"]);
    expect((await get("/api/users/Nobody/official-scores")).statusCode).toBe(404);
  });
});
