import { describe, expect, it } from "vitest";
import { repeatMetrics, repeatRubricProxy, normalizeWords } from "../shared/align";
import { CONFIG } from "../shared/config";

const cfg = CONFIG.internal.listen_repeat_proxy;

describe("Listen and Repeat alignment", () => {
  it("normalises punctuation, case and contractions consistently", () => {
    expect(normalizeWords("Don't touch the Lab's door!")).toEqual(["do", "not", "touch", "the", "labs", "door"]);
    expect(normalizeWords("can't")).toEqual(["can", "not"]);
  });
  it("gives zero error for an exact repetition", () => {
    const m = repeatMetrics("Welcome to the library.", "welcome to the library");
    expect(m.wer).toBe(0);
    expect(m.cer).toBe(0);
    expect(repeatRubricProxy(m, null, cfg).rubric).toBe(5);
  });
  it("counts deletions, insertions and substitutions", () => {
    const m = repeatMetrics("Please return reserved books to the desk", "please return the books to desk now");
    expect(m.deletions + m.substitutions + m.insertions).toBeGreaterThan(0);
    expect(m.wer).toBeCloseTo((m.substitutions + m.deletions + m.insertions) / 7);
    expect(m.missingWords).toContain("the");
  });
  it("detects word-order problems", () => {
    const m = repeatMetrics("students can borrow laptops", "students can laptops borrow");
    expect(m.orderScore).toBeLessThan(1);
  });
  it("maps metrics onto the internal 0–5 proxy", () => {
    const ref = "Students who are preparing group presentations can reserve the media room through the library website.";
    expect(repeatRubricProxy(repeatMetrics(ref, ref), 0.95, cfg).rubric).toBe(5);
    expect(repeatRubricProxy(repeatMetrics(ref, ref), 0.5, cfg).rubric).toBe(4); // low acoustic confidence blocks a 5
    expect(repeatRubricProxy(repeatMetrics(ref, "students who are preparing group presentations can reserve the media room through the website"), null, cfg).rubric).toBe(4);
    expect(repeatRubricProxy(repeatMetrics(ref, "students preparing presentations reserve the room"), null, cfg).rubric).toBeLessThanOrEqual(3);
    expect(repeatRubricProxy(repeatMetrics(ref, ""), null, cfg).rubric).toBe(0);
  });
});
