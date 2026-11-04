import { describe, expect, it } from "vitest";
import { deriveCtw, splitWord, isCtwGapCorrect, renderCtwDisplay } from "../shared/ctw";
import { classifyCtwError } from "../shared/errors";

const PRD =
  "Urban trees provide benefits that extend beyond their visual appeal. They reduce temperatures by shading buildings and streets, while their leaves absorb pollutants from the air. Researchers increasingly recognize that access to green spaces can also improve mental health and encourage physical activity.";

describe("Complete the Words derivation", () => {
  it("keeps the first sentence intact and truncates every second word from the second word of sentence two", () => {
    const d = deriveCtw(PRD);
    expect(d.firstSentence).toBe("Urban trees provide benefits that extend beyond their visual appeal.");
    expect(d.gaps.map((g) => g.full)).toEqual(["reduce", "by", "buildings", "streets", "their", "absorb", "from", "air", "increasingly", "that"]);
    expect(d.problems).toEqual([]);
  });
  it("keeps floor(n/2) letters visible", () => {
    expect(splitWord("reduce")).toEqual({ visible: "red", missing: "uce" });
    expect(splitWord("their")).toEqual({ visible: "th", missing: "eir" });
    expect(splitWord("buildings")).toEqual({ visible: "buil", missing: "dings" });
    expect(splitWord("increasingly")).toEqual({ visible: "increa", missing: "singly" });
    expect(splitWord("air")).toEqual({ visible: "a", missing: "ir" });
  });
  it("renders one underscore per missing letter", () => {
    const out = renderCtwDisplay(deriveCtw(PRD));
    expect(out).toContain("str____,");
    expect(out).toContain("increa______ recognize");
  });
  it("checks answers case-insensitively with exact spelling", () => {
    const g = deriveCtw(PRD).gaps[0]!;
    expect(isCtwGapCorrect(g, "uce")).toBe(true);
    expect(isCtwGapCorrect(g, "UCE")).toBe(true);
    expect(isCtwGapCorrect(g, "use")).toBe(false);
  });
  it("reports passages that cannot yield 10 gaps or that target unusable words", () => {
    expect(deriveCtw("One sentence here. Then a short one.").problems.length).toBeGreaterThan(0);
    const bad = deriveCtw("This first sentence is intact. Then a b c d e f g h i j k l m n o p q r s t u v w.");
    expect(bad.problems.some((p) => p.includes("one-letter"))).toBe(true);
  });
  it("classifies CTW errors heuristically", () => {
    expect(classifyCtwError("increasingly", "")).toBe("no_answer");
    expect(classifyCtwError("their", "there")).toBe("function_word");
    expect(classifyCtwError("buildings", "building")).toBe("inflection");
    expect(classifyCtwError("absorb", "absorv")).toBe("orthography");
    expect(classifyCtwError("increasingly", "increasing")).toBe("derivation");
  });
});
