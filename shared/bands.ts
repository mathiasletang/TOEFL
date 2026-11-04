import type { Section } from "./schema";

export const BAND_MIN = 1.0;
export const BAND_MAX = 6.0;

/** Round to the nearest 0.5, ties upward (ETS: 5.25 → 5.5, 5.125 → 5.0, 4.75 → 5.0). */
export function roundHalf(x: number): number {
  return Math.floor(x * 2 + 0.5 + 1e-9) / 2;
}

export function clampBand(x: number): number {
  return Math.min(BAND_MAX, Math.max(BAND_MIN, x));
}

export function isValidBand(x: number): boolean {
  return x >= BAND_MIN && x <= BAND_MAX && Number.isInteger(x * 2);
}

export type SectionBands = Record<Section, number>;

export function overallBand(b: SectionBands): number {
  const mean = (b.reading + b.listening + b.writing + b.speaking) / 4;
  return roundHalf(mean);
}

/** Lowest section mean that rounds to `target`: target − 0.25. */
export function minimumMeanFor(target: number): number {
  return target - 0.25;
}

/** Lowest sum of the four section bands that rounds to `target`. */
export function minimumSumFor(target: number): number {
  return minimumMeanFor(target) * 4;
}

export function cefrForBand(band: number): string {
  if (band >= 6) return "C2";
  if (band >= 5) return "C1";
  if (band >= 4) return "B2";
  if (band >= 3) return "B1";
  if (band >= 2) return "A2";
  return "A1";
}

/** Every combination of four section bands is a multiset; list minimal combos reaching a target. */
export function minimalProfiles(target: number): number[][] {
  const out: number[][] = [];
  const need = minimumSumFor(target);
  const vals: number[] = [];
  for (let v = BAND_MIN; v <= BAND_MAX + 1e-9; v += 0.5) vals.push(v);
  for (const r of vals)
    for (const l of vals)
      for (const w of vals)
        for (const s of vals) if (r + l + w + s === need) out.push([r, l, w, s]);
  return out;
}

export function formatBand(x: number | null | undefined): string {
  return x == null || Number.isNaN(x) ? "—" : x.toFixed(1);
}
