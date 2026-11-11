import { describe, expect, it } from "vitest";
import { CONFIG } from "../shared/config";
import { readVocab } from "../server/vocab";
import {
  availableFormats,
  buildQuestion,
  cardStatus,
  checkAnswer,
  chooseFormat,
  introductionRank,
  isProduction,
  locateForm,
  publicQuestion,
  qualityFor,
  schedule,
  type CardState,
  type Format,
} from "../shared/vocabSrs";

const P = CONFIG.internal.vocabulary.srs;
const now = new Date("2026-03-01T10:00:00.000Z");
const fresh: CardState = { reps: 0, lapses: 0, ease: P.initial_ease, interval_days: 0, review_count: 0, recognition_passed: false, practice_count: 0, production_count: 0 };
const days = (iso: string) => (Date.parse(iso) - now.getTime()) / 86400000;

describe("SM-2 scheduler", () => {
  it("uses the configured first and second intervals, then multiplies by the ease", () => {
    const a = schedule(fresh, 4, now, P);
    expect(a.interval_days).toBe(P.first_interval_days);
    expect(days(a.due_at)).toBe(P.first_interval_days);
    const b = schedule({ ...fresh, ...a, review_count: 1 }, 4, now, P);
    expect(b.interval_days).toBe(P.second_interval_days);
    const c = schedule({ ...fresh, ...b, review_count: 2 }, 4, now, P);
    expect(c.interval_days).toBe(Math.round(P.second_interval_days * c.ease));
    expect(c.reps).toBe(3);
  });

  it("keeps the ease on quality 4, raises it on 5 and never goes below the minimum", () => {
    expect(schedule(fresh, 4, now, P).ease).toBeCloseTo(P.initial_ease);
    expect(schedule(fresh, 5, now, P).ease).toBeCloseTo(P.initial_ease + 0.1);
    let c = { ...fresh, review_count: 1 };
    for (let i = 0; i < 20; i++) c = { ...c, ...schedule(c, 1, now, P) };
    expect(c.ease).toBe(P.minimum_ease);
  });

  it("treats quality below 3 as a lapse: repetitions reset and the card returns within minutes", () => {
    const learned = { ...fresh, reps: 4, interval_days: 30, review_count: 4 };
    const s = schedule(learned, 2, now, P);
    expect(s.reps).toBe(0);
    expect(s.lapses).toBe(1);
    expect(s.interval_days).toBe(0);
    expect(Date.parse(s.due_at) - now.getTime()).toBe(P.relearn_minutes * 60000);
    // After the lapse the card restarts from the first interval.
    expect(schedule({ ...learned, ...s }, 4, now, P).interval_days).toBe(P.first_interval_days);
  });

  it("does not count a failed first exposure as a lapse", () => {
    expect(schedule(fresh, 1, now, P).lapses).toBe(0);
  });

  it("always grows the interval of a successful mature review", () => {
    const s = schedule({ ...fresh, reps: 5, interval_days: 10, ease: P.minimum_ease, review_count: 5 }, 3, now, P);
    expect(s.interval_days).toBeGreaterThan(10);
  });

  it("maps answers to qualities", () => {
    expect(qualityFor({ correct: true, nearMiss: false, elapsedMs: 1000, typed: false }, P)).toBe(5);
    expect(qualityFor({ correct: true, nearMiss: false, elapsedMs: P.fast_answer_ms.choice + 1, typed: false }, P)).toBe(4);
    expect(qualityFor({ correct: false, nearMiss: true, elapsedMs: 1000, typed: true }, P)).toBe(2);
    expect(qualityFor({ correct: false, nearMiss: false, elapsedMs: 1000, typed: true }, P)).toBe(1);
  });

  it("classifies cards as new, learning or mature", () => {
    expect(cardStatus(fresh, P)).toBe("new");
    expect(cardStatus({ review_count: 3, interval_days: 6 }, P)).toBe("learning");
    expect(cardStatus({ review_count: 9, interval_days: P.mature_interval_days }, P)).toBe("mature");
  });
});

describe("format rotation", () => {
  const all: Format[] = ["meaning_choice", "recall_typed", "cloze_typed", "collocation_choice", "word_formation", "paraphrase_choice", "false_friend_choice", "dictation"];

  it("starts with recognition of meaning and repeats it until passed", () => {
    expect(chooseFormat(fresh, all, P)).toBe("meaning_choice");
    const seenTwice: CardState = { ...fresh, review_count: 2 };
    expect(chooseFormat(seenTwice, all, P)).toBe("meaning_choice");
  });

  it("keeps at least the configured share of production formats once recognition is passed", () => {
    let c: CardState = { ...fresh, recognition_passed: true };
    const seen = new Set<Format>();
    for (let i = 0; i < 40; i++) {
      const f = chooseFormat(c, all, P);
      expect(f).not.toBe("meaning_choice");
      seen.add(f);
      c = { ...c, practice_count: c.practice_count + 1, production_count: c.production_count + (isProduction(f) ? 1 : 0) };
      expect(c.production_count / c.practice_count).toBeGreaterThanOrEqual(P.production_share_min);
    }
    // Every other format takes part in the rotation.
    for (const f of all.filter((x) => x !== "meaning_choice")) expect(seen.has(f)).toBe(true);
  });

  it("falls back to production when no recognition format is available", () => {
    expect(chooseFormat({ ...fresh, recognition_passed: true }, ["meaning_choice", "recall_typed"], P)).toBe("recall_typed");
  });
});

describe("introduction order", () => {
  const rank = (tier: "core" | "extended" | "mastery", cefr: "B2" | "C1" | "C2", target: number) => introductionRank({ tier, cefr }, target);
  it("puts the core tier first for every target", () => {
    for (const t of [5, 5.5, 6]) {
      expect(rank("core", "C1", t)).toBeLessThan(rank("extended", "B2", t));
      expect(rank("core", "C1", t)).toBeLessThan(rank("mastery", "C2", t));
    }
  });
  it("goes B2 → C1 for a 5.0 target and C1 → C2 for a 6.0 target", () => {
    expect(rank("extended", "B2", 5)).toBeLessThan(rank("extended", "C1", 5));
    expect(rank("extended", "C1", 5)).toBeLessThan(rank("mastery", "C2", 5));
    expect(rank("extended", "C1", 6)).toBeLessThan(rank("mastery", "C2", 6));
    expect(rank("mastery", "C2", 6)).toBeLessThan(rank("extended", "B2", 6));
  });
});

describe("questions on the real bank", () => {
  const bank = readVocab().entries;
  const erosion = bank.find((e) => e.headword === "erosion")!;

  it("builds every available format for every entry, with a checkable key", () => {
    for (const e of bank) {
      const formats = availableFormats(e, { audio: true });
      expect(formats).toContain("meaning_choice");
      expect(formats.filter(isProduction).length).toBeGreaterThanOrEqual(2);
      for (const f of formats) {
        const q = buildQuestion(e, f, "3", bank);
        expect(q.format).toBe(f);
        if (q.input === "choice") {
          expect(new Set(q.options!.map((o) => o.toLowerCase())).size).toBe(4);
          expect(checkAnswer(q, { choice: q.answerIndex }).correct).toBe(true);
        } else {
          expect(checkAnswer(q, { text: q.expected }).correct).toBe(true);
        }
      }
    }
  });

  it("is deterministic for a seed and never sends the key to the browser", () => {
    const a = buildQuestion(erosion, "collocation_choice", "7", bank);
    expect(buildQuestion(erosion, "collocation_choice", "7", bank)).toEqual(a);
    expect(a.prompt).not.toMatch(/erosion/i);
    const pub = publicQuestion(a) as Record<string, unknown>;
    expect(pub.answerIndex).toBeUndefined();
    expect(pub.expected).toBeUndefined();
  });

  it("gives the first letter in the gap fill and blanks the inflected form", () => {
    const q = buildQuestion(erosion, "cloze_typed", "1", bank);
    expect(q.firstLetter).toBe("e");
    expect(q.prompt).toContain("e_____");
    expect(q.prompt).not.toMatch(/erosion/i);
    expect(locateForm("The rivers deposited silt.", { headword: "deposit", inflections: [] })?.surface).toBe("deposited");
  });

  it("classifies typed errors with the Complete-the-Words classes", () => {
    const q = buildQuestion(erosion, "recall_typed", "1", bank);
    expect(checkAnswer(q, { text: " Erosion " })).toMatchObject({ correct: true, errorTag: null });
    expect(checkAnswer(q, { text: "errosion" })).toMatchObject({ correct: false, nearMiss: true, errorTag: "orthography" });
    expect(checkAnswer(q, { text: "erosions" })).toMatchObject({ correct: false, errorTag: "inflection" });
    expect(checkAnswer(q, { text: "erosive" })).toMatchObject({ correct: false, errorTag: "derivation" });
    expect(checkAnswer(q, { text: "" })).toMatchObject({ correct: false, errorTag: "no_answer" });
    expect(checkAnswer(q, { text: "landslide" })).toMatchObject({ correct: false, errorTag: "semantic_context" });
  });

  it("tags wrong choices by format", () => {
    const q = buildQuestion(erosion, "meaning_choice", "1", bank);
    expect(checkAnswer(q, { choice: (q.answerIndex! + 1) % 4 })).toMatchObject({ correct: false, errorTag: "vocab_meaning" });
    const ff = bank.find((e) => e.false_friend_fr)!;
    const fq = buildQuestion(ff, "false_friend_choice", "1", bank);
    expect(fq.options).toContain(ff.false_friend_fr!.trap);
    expect(checkAnswer(fq, { choice: fq.options!.indexOf(ff.false_friend_fr!.trap) })).toMatchObject({ correct: false, errorTag: "vocab_false_friend" });
  });

  it("offers only study, gap fill and dictation for a personal card", () => {
    const personal = { id: "c1", headword: "quagmire", kind: "word" as const, example_academic: "The project became a quagmire of delays.", personal: true };
    expect(availableFormats(personal, { audio: true })).toEqual(["study", "cloze_typed", "dictation"]);
    expect(chooseFormat(fresh, availableFormats(personal, { audio: true }), P)).toBe("study");
    expect(buildQuestion(personal, "cloze_typed", "0", bank).expected).toBe("quagmire");
  });
});
