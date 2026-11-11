import { describe, expect, it } from "vitest";
import { readVocab, syncVocab, listVocab, getVocabEntry } from "../server/vocab";
import { openDb } from "../server/db";
import { CONFIG } from "../shared/config";
import { VOCAB_CATEGORIES, containsPhrase, countVocab, definitionIsCircular, exampleUsesEntry, inflectionsOf, validateVocab } from "../shared/vocab";

const base = {
  id: "v_test_analyze",
  headword: "analyze",
  kind: "word",
  pos: "verb",
  cefr: "B2",
  tier: "core",
  category: "general_academic",
  definition: "to study something carefully in order to understand it",
  translation_fr: "analyser",
  example_academic: "Researchers analyzed twenty years of rainfall records.",
  example_spoken: "Let's analyze what went wrong before we try again.",
  collocations: ["analyze data", "analyze results"],
  word_family: [{ form: "analysis", pos: "noun" }],
  synonyms: ["examine"],
  register: "neutral",
  ipa: "/ˈænəlaɪz/",
};
const messages = (data: unknown[]) => validateVocab(data.map((d) => ({ data: d }))).errors.map((e) => e.message).join("\n");

describe("vocabulary matching helpers", () => {
  it("recognizes regular and irregular inflections", () => {
    expect(inflectionsOf("study").has("studied")).toBe(true);
    expect(inflectionsOf("submit").has("submitted")).toBe(true);
    expect(inflectionsOf("commute").has("commuting")).toBe(true);
    expect(inflectionsOf("criterion").has("criteria")).toBe(true);
    expect(inflectionsOf("undergo").has("underwent")).toBe(true);
  });
  it("matches separable phrasal verbs, expressions with a changed article, and hyphenated compounds", () => {
    expect(containsPhrase("Give me the weekend to mull it over.", "mull over", 4)).toBe(true);
    expect(containsPhrase("We met the deadline with ten minutes to spare.", "meet a deadline", 4)).toBe(true);
    expect(containsPhrase("There's a lot of code-switching at home.", "code-switching", 0)).toBe(true);
    expect(containsPhrase("The file was deleted.", "back to square one", 4)).toBe(false);
  });
  it("accepts a declared family form in an example and detects circular definitions", () => {
    expect(exampleUsesEntry("The analysis took a week.", { headword: "analyze", kind: "word", word_family: [{ form: "analysis", pos: "noun" }], inflections: [] })).toBe(true);
    expect(exampleUsesEntry("The study took a week.", { headword: "analyze", kind: "word", word_family: [], inflections: [] })).toBe(false);
    expect(definitionIsCircular({ headword: "analyze", definition: "to analyze something in detail", inflections: [] })).toBe(true);
    expect(definitionIsCircular({ headword: "carry out", definition: "to do a task that you carry with you", inflections: [] })).toBe(false);
  });
});

describe("vocabulary validator", () => {
  it("accepts a well-formed entry", () => {
    const r = validateVocab([{ data: base }]);
    expect(r.errors).toEqual([]);
    expect(r.entries).toHaveLength(1);
  });
  it("rejects duplicate ids and duplicate headword + part of speech", () => {
    const m = messages([base, { ...base }, { ...base, id: "v_test_analyze_2" }]);
    expect(m).toMatch(/duplicate id/);
    expect(m).toMatch(/duplicate headword \+ part of speech/);
    // Same headword with another part of speech is a different entry.
    const ok = validateVocab([{ data: base }, { data: { ...base, id: "v_test_analyze_n", pos: "noun" } }]);
    expect(ok.errors).toEqual([]);
  });
  it("rejects examples without the word, circular definitions, missing French and too few collocations", () => {
    expect(messages([{ ...base, example_academic: "Researchers studied twenty years of rainfall records." }])).toMatch(/academic example does not contain/);
    expect(messages([{ ...base, example_spoken: "Let's look at what went wrong before we try again." }])).toMatch(/spoken example does not contain/);
    expect(messages([{ ...base, definition: "to analyze something carefully" }])).toMatch(/definition contains the defined word/);
    expect(messages([{ ...base, translation_fr: "  " }])).toMatch(/translation_fr/);
    expect(messages([{ ...base, collocations: ["analyze data"] }])).toMatch(/at least 2 collocations/);
  });
  it("enforces the tier/CEFR convention, pack rules and kinds", () => {
    expect(messages([{ ...base, tier: "mastery" }])).toMatch(/mastery entries are C2/);
    expect(messages([{ ...base, cefr: "C2" }])).toMatch(/core entries are B2 or C1/);
    expect(messages([{ ...base, category: "functional_language" }])).toMatch(/need a `function`/);
    expect(messages([{ ...base, category: "false_friends_fr" }])).toMatch(/need `false_friend_fr`/);
    expect(messages([{ ...base, category: "spelling_traps" }])).toMatch(/need `spelling_trap`/);
    expect(messages([{ ...base, kind: "collocation" }])).toMatch(/needs a multi-word headword/);
    expect(messages([{ ...base, ipa: "ˈænəlaɪz" }])).toMatch(/IPA must be written between slashes/);
    expect(validateVocab([{ data: base, category: "biology" }]).errors[0]!.message).toMatch(/does not match its pack/);
  });
});

describe("vocabulary bank (content/vocab)", () => {
  const v = readVocab();
  const counts = countVocab(v.entries);
  it("loads with no invalid entry and one pack per category", () => {
    expect(v.fileErrors).toEqual([]);
    expect(v.errors).toEqual([]);
    expect(v.packs.map((p) => p.category).sort()).toEqual([...VOCAB_CATEGORIES].sort());
    for (const p of v.packs) expect(p.selection_note).toMatch(/not an official list/);
  });
  it("matches the internal targets for tiers and CEFR shares", () => {
    const T = CONFIG.internal.vocabulary.targets;
    expect(counts.total).toBe(1000);
    expect(counts.by_tier).toMatchObject(T.tier);
    for (const [level, share] of Object.entries(T.cefr_share)) expect(Math.abs((counts.by_cefr[level] ?? 0) / counts.total - share)).toBeLessThanOrEqual(T.share_tolerance);
    expect(CONFIG.internal.vocabulary.tiers.core.note).toMatch(/Not an official list/);
  });
  it("gives every word at least two collocations and every entry both examples, French and IPA", () => {
    for (const e of v.entries) {
      if (e.kind === "word") expect(e.collocations.length, e.id).toBeGreaterThanOrEqual(2);
      expect(e.translation_fr.trim().length, e.id).toBeGreaterThan(0);
      expect(e.ipa, e.id).toMatch(/^\/.+\/$/);
    }
    expect(v.entries.filter((e) => e.false_friend_fr).length).toBeGreaterThanOrEqual(45);
    expect(v.entries.filter((e) => e.spelling_trap).length).toBeGreaterThanOrEqual(45);
  });
  it("syncs into SQLite and deactivates entries that disappear", () => {
    const db = openDb(":memory:");
    syncVocab(db, v);
    const n = () => (db.prepare("SELECT COUNT(*) c FROM vocab_entries WHERE active = 1").get() as { c: number }).c;
    expect(n()).toBe(1000);
    expect(listVocab(db, { tier: "core" })).toHaveLength(400);
    expect(getVocabEntry(db, "v_acad_analyze")?.translation_fr).toBe("analyser");
    syncVocab(db, { ...v, entries: v.entries.slice(1) });
    expect(n()).toBe(999);
    syncVocab(db, v);
    expect(n()).toBe(1000);
    db.close();
  });
});
