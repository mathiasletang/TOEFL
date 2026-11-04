import { describe, expect, it } from "vitest";
import { roundHalf, overallBand, minimumSumFor, minimumMeanFor, cefrForBand, minimalProfiles, isValidBand } from "../shared/bands";

describe("official overall band rounding", () => {
  it("matches the ETS examples", () => {
    expect(roundHalf(5.25)).toBe(5.5);
    expect(roundHalf(5.125)).toBe(5.0);
  });
  it("rounds ties up and everything else to the nearest half", () => {
    expect(roundHalf(4.75)).toBe(5.0);
    expect(roundHalf(4.625)).toBe(4.5);
    expect(roundHalf(5.75)).toBe(6.0);
    expect(roundHalf(5.625)).toBe(5.5);
    expect(roundHalf(6)).toBe(6);
    expect(roundHalf(1)).toBe(1);
  });
  it("computes the overall from four section bands", () => {
    expect(overallBand({ reading: 5, listening: 5, writing: 4.5, speaking: 4.5 })).toBe(5);
    expect(overallBand({ reading: 6, listening: 6, writing: 6, speaking: 5 })).toBe(6);
    expect(overallBand({ reading: 6, listening: 6, writing: 5.5, speaking: 5.5 })).toBe(6);
    expect(overallBand({ reading: 6, listening: 6, writing: 5.5, speaking: 5 })).toBe(5.5);
  });
  it("derives the minimal mean and sum for a target", () => {
    expect(minimumMeanFor(5)).toBe(4.75);
    expect(minimumSumFor(5)).toBe(19);
    expect(minimumSumFor(6)).toBe(23);
    for (const p of minimalProfiles(6)) {
      expect(p.reduce((a, b) => a + b, 0)).toBe(23);
      expect(overallBand({ reading: p[0]!, listening: p[1]!, writing: p[2]!, speaking: p[3]! })).toBe(6);
    }
  });
  it("maps bands to CEFR", () => {
    expect(cefrForBand(6)).toBe("C2");
    expect(cefrForBand(5.5)).toBe("C1");
    expect(cefrForBand(5)).toBe("C1");
    expect(cefrForBand(4.5)).toBe("B2");
  });
  it("validates the 1.0–6.0 half-step scale", () => {
    expect(isValidBand(4.5)).toBe(true);
    expect(isValidBand(4.25)).toBe(false);
    expect(isValidBand(6.5)).toBe(false);
  });
});
