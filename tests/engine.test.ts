import { describe, expect, it } from "vitest";
import { timerReducer, initialTimer, remainingMs, formatClock } from "../web/src/lib/timer";
import { routeModule1 } from "../shared/router";
import { estimateTheta } from "../shared/irt";
import { scoreExercise } from "../shared/scoring";
import { validateExercises } from "../shared/validate";
import { CONFIG } from "../shared/config";
import { ExerciseSchema, type Exercise } from "../shared/schema";

const proxy = { repeatProxy: CONFIG.internal.listen_repeat_proxy };

describe("timer state machine", () => {
  it("runs, expires once and can be stopped", () => {
    let s = timerReducer(initialTimer, { type: "start", deadline: 10_000, now: 0 });
    expect(s.status).toBe("running");
    expect(remainingMs(s)).toBe(10_000);
    s = timerReducer(s, { type: "tick", now: 9_999 });
    expect(s.status).toBe("running");
    s = timerReducer(s, { type: "tick", now: 10_000 });
    expect(s.status).toBe("expired");
    expect(remainingMs(s)).toBe(0);
    s = timerReducer(s, { type: "ack_expired" });
    expect(s.expiredFired).toBe(true);
  });
  it("starts expired when resumed after the deadline (refresh)", () => {
    expect(timerReducer(initialTimer, { type: "start", deadline: 5, now: 10 }).status).toBe("expired");
  });
  it("a stopped timer restarts only for a new deadline", () => {
    let s = timerReducer(initialTimer, { type: "start", deadline: 100, now: 0 });
    s = timerReducer(s, { type: "stop", now: 1 });
    expect(timerReducer(s, { type: "start", deadline: 100, now: 2 }).status).toBe("stopped");
    expect(timerReducer(s, { type: "start", deadline: 500, now: 2 }).status).toBe("running");
  });
  it("formats clocks", () => {
    expect(formatClock(420_000)).toBe("7:00");
    expect(formatClock(59_001)).toBe("1:00");
    expect(formatClock(null)).toBe("--:--");
  });
});

describe("internal router", () => {
  const cfg = { officialThreshold: null, trainingThreshold: 0.8, trainingThetaCut: 1.0, model: "percent-correct" as const };
  const resp = (k: number, n: number, b = 0.5) => Array.from({ length: n }, (_, i) => ({ correct: i < k, b }));
  it("routes on the configurable proportion threshold and never claims to be official", () => {
    expect(routeModule1(resp(16, 20), cfg).route).toBe("upper");
    expect(routeModule1(resp(15, 20), cfg).route).toBe("lower");
    expect(routeModule1(resp(15, 20), { ...cfg, trainingThreshold: 0.75 }).route).toBe("upper");
    expect(routeModule1(resp(20, 20), cfg).isOfficial).toBe(false);
  });
  it("irt-lite estimates rise with performance", () => {
    const lo = estimateTheta(resp(5, 20, 1)).theta;
    const hi = estimateTheta(resp(18, 20, 1)).theta;
    expect(hi).toBeGreaterThan(lo);
    expect(routeModule1(resp(20, 20, 1), { ...cfg, model: "irt-lite" }).route).toBe("upper");
    expect(routeModule1(resp(2, 20, 1), { ...cfg, model: "irt-lite" }).route).toBe("lower");
  });
});

const build = ExerciseSchema.parse({
  id: "t_build",
  section: "writing",
  task_type: "build_a_sentence",
  difficulty: "C1",
  source_type: "ets_format_synthetic",
  context: "Is the conference still happening?",
  frame: ["I have no idea", null, null, null, null, null, "."],
  answer: ["whether", "it", "has been", "postponed", "or not"],
  alternatives: [["whether", "or not", "it", "has been", "postponed"]],
  distractors: ["has it been"],
  full_response: "I have no idea whether it has been postponed or not.",
  pattern: "embedded_questions",
  explanation: "x",
}) as Exercise;

describe("objective scoring", () => {
  it("accepts the main answer and declared alternatives only", () => {
    expect(scoreExercise(build, { order: ["whether", "it", "has been", "postponed", "or not"] }, proxy).raw).toBe(1);
    expect(scoreExercise(build, { order: ["whether", "or not", "it", "has been", "postponed"] }, proxy).raw).toBe(1);
    const wrong = scoreExercise(build, { order: ["whether", "has it been", "postponed", "or not", null] }, proxy);
    expect(wrong.raw).toBe(0);
    expect(wrong.errorTags).toEqual(["embedded_questions"]);
  });
  it("scores MCQ sets item by item with skill tags", () => {
    const ex = ExerciseSchema.parse({
      id: "t_ann",
      section: "listening",
      task_type: "announcement",
      difficulty: "B2",
      source_type: "ets_format_synthetic",
      context: "c",
      audio: [{ speaker: "A", text: "Some words here for the announcement." }],
      questions: [
        { id: "q1", stem: "s", options: ["a", "b", "c", "d"], answer_index: 2, skill: "purpose", explanation: "e" },
        { id: "q2", stem: "s", options: ["a", "b", "c", "d"], answer_index: 0, skill: "detail", explanation: "e" },
      ],
    }) as Exercise;
    const r = scoreExercise(ex, { answers: [2, 3] }, proxy);
    expect(r.raw).toBe(1);
    expect(r.max).toBe(2);
    expect(r.errorTags).toEqual(["detail"]);
  });
  it("leaves speaking items unscored without transcript, and uses self-ratings when given", () => {
    const lr = ExerciseSchema.parse({
      id: "t_lr",
      section: "speaking",
      task_type: "listen_and_repeat",
      difficulty: "B2",
      source_type: "ets_format_synthetic",
      scenario: "s",
      items: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ index: i, text: "word ".repeat(i + 2).trim() + ".", response_seconds: 8 + Math.min(4, Math.floor(i / 2)) })),
    }) as Exercise;
    const none = scoreExercise(lr, { items: [] }, proxy);
    expect(none.raw).toBeNull();
    expect(none.pending).toBe(true);
    const some = scoreExercise(lr, { items: [{ index: 1, selfRating: 4 }, { index: 2, transcript: "word word word word", transcriptSource: "server_stt" }] }, proxy);
    expect(some.items[0]!.score).toBe(4);
    expect(some.items[1]!.score).toBe(5);
    expect(some.raw).toBe(9);
  });
});

describe("content validator", () => {
  const base = { section: "reading", difficulty: "B2", source_type: "ets_format_synthetic" };
  it("rejects broken answer keys, bad CTW passages, inconsistent sentences, bad windows and duplicates", () => {
    const r = validateExercises([
      { data: { ...base, id: "a", task_type: "read_in_daily_life", stimulus: { format: "notice", body: "Twenty words are needed here so this notice body contains enough words to pass the minimum length check easily ok." }, questions: [{ id: "q1", stem: "s", options: ["a", "b", "c", "d"], answer_index: 7, skill: "detail", explanation: "e" }, { id: "q2", stem: "s", options: ["a", "a", "c", "d"], answer_index: 0, skill: "detail", explanation: "e" }] } },
      { data: { ...base, id: "b", task_type: "complete_the_words", topic: "t", passage: "Too short. Nothing else here." } },
      { data: { ...base, id: "c", section: "writing", task_type: "build_a_sentence", context: "c", frame: ["I", null, null, null, "."], answer: ["x", "y", "z"], full_response: "I x z y.", pattern: "passives", explanation: "e" } },
      { data: { ...base, id: "d", section: "speaking", task_type: "listen_and_repeat", scenario: "s", items: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ index: i, text: "a b c.", response_seconds: 20 })) } },
      { data: { ...base, id: "e", section: "writing", task_type: "build_a_sentence", context: "c", frame: ["I", null, null, null, "."], answer: ["x", "y", "z"], full_response: "I x y z.", pattern: "passives", explanation: "e" } },
      { data: { ...base, id: "e", section: "writing", task_type: "build_a_sentence", context: "c", frame: ["I", null, null, null, "."], answer: ["x", "y", "z"], full_response: "I x y z.", pattern: "passives", explanation: "e" } },
      { data: { ...base, id: "f", task_type: "not_a_task" } },
    ]);
    const msgs = r.errors.map((e) => `${e.id}: ${e.message}`).join("\n");
    expect(msgs).toMatch(/a: q1: answer_index 7 out of range/);
    expect(msgs).toMatch(/a: q2: duplicate options/);
    expect(msgs).toMatch(/b: .*gaps/);
    expect(msgs).toMatch(/c: frame \+ answer gives/);
    expect(msgs).toMatch(/d: item 1: response window 20s/);
    expect(msgs).toMatch(/e: Duplicate id/);
    expect(msgs).toMatch(/f: /);
    expect(r.exercises.map((e) => e.id)).toEqual(["e"]);
  });
});
