import { describe, expect, it } from "vitest";
import { readVocab, syncVocab, listVocab, getVocabEntry } from "../server/vocab";
import { openDb } from "../server/db";
import { CONFIG } from "../shared/config";
import { VOCAB_CATEGORIES, containsPhrase, countVocab, definitionIsCircular, exampleUsesEntry, frTransparency, inflectionsOf, isTransparent, validateVocab } from "../shared/vocab";

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
    expect(counts.total).toBe(T.tier.core + T.tier.extended + T.tier.mastery);
    expect(counts.total).toBe(1529);
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
    expect(n()).toBe(1529);
    expect(listVocab(db, { tier: "core" })).toHaveLength(400);
    expect((db.prepare("SELECT transparent_fr t FROM vocab_entries WHERE id = 'v_acad_analyze'").get() as { t: number }).t).toBe(1);
    expect(getVocabEntry(db, "v_acad_analyze")?.translation_fr).toBe("analyser");
    syncVocab(db, { ...v, entries: v.entries.slice(1) });
    expect(n()).toBe(1528);
    syncVocab(db, v);
    expect(n()).toBe(1529);
    db.close();
  });
});

describe("recalibration for French speakers", () => {
  const v = readVocab();
  const V = CONFIG.internal.vocabulary;
  const th = V.transparency.threshold;
  const by = (h: string) => v.entries.find((e) => e.headword === h)!;

  it("measures how transparent a word is for a French speaker", () => {
    expect(frTransparency("accretion", "accrétion")).toBe(1);
    expect(frTransparency("analyze", "analyser")).toBe(1); // -yze → -yser
    expect(frTransparency("address", "adresse")).toBeGreaterThanOrEqual(th);
    expect(frTransparency("apartment", "appartement")).toBeGreaterThanOrEqual(th);
    expect(frTransparency("achieve", "atteindre, réaliser, obtenir")).toBeLessThan(th);
    expect(frTransparency("belie", "démentir, masquer")).toBeLessThan(th);
  });

  it("never counts expressions or false friends as transparent", () => {
    expect(isTransparent(by("reach a consensus"), th)).toBe(false);
    expect(isTransparent(by("facile"), th)).toBe(false);
    expect(by("facile").false_friend_fr).toBeTruthy();
    expect(isTransparent(by("subduction"), th)).toBe(true);
    const transparent = v.entries.filter((e) => isTransparent(e, th));
    expect(transparent.length).toBeGreaterThan(350);
    expect(transparent.length).toBeLessThan(450);
  });

  it("has no transparent discipline term at C2, and rejects one", () => {
    const disc = new Set(V.discipline_categories);
    expect(v.entries.filter((e) => disc.has(e.category) && e.cefr === "C2" && isTransparent(e, th))).toEqual([]);
    expect(by("subduction")).toMatchObject({ tier: "extended", cefr: "C1" });
    const bad = { ...by("subduction"), tier: "mastery", cefr: "C2" };
    const msgs = validateVocab([{ data: bad }], { disciplineCategories: V.discipline_categories, transparencyThreshold: th }).errors.map((e) => e.message).join("\n");
    expect(msgs).toMatch(/transparent for French speakers .* is not C2/);
  });

  it("adds 250 productive C2 entries: nuance, hedging, concession, emphasis, discourse markers, collocations", () => {
    const mastery = v.entries.filter((e) => e.tier === "mastery");
    expect(mastery).toHaveLength(V.targets.tier.mastery);
    const productive = mastery.filter((e) => ["general_academic", "functional_language", "academic_collocations"].includes(e.category));
    expect(productive.length).toBeGreaterThanOrEqual(250);
    const fn = (f: string) => mastery.filter((e) => e.function === f).length;
    expect(fn("hedging")).toBeGreaterThanOrEqual(30);
    expect(fn("concession")).toBeGreaterThanOrEqual(25);
    expect(fn("emphasis")).toBeGreaterThanOrEqual(25);
    expect(fn("speech_structuring")).toBeGreaterThanOrEqual(30);
    for (const h of ["belie", "bolster", "it would appear that", "admittedly", "let alone", "the thing is", "draw attention to", "at odds with"]) expect(by(h), h).toMatchObject({ tier: "mastery", cefr: "C2" });
    // Discipline terms now make up a small part of Mastery.
    expect(mastery.filter((e) => V.discipline_categories.includes(e.category)).length).toBeLessThan(60);
  });
});

describe("first productive C2 batch", () => {
  const v = readVocab();
  const P = { batch: "c2_productive_1", ...CONFIG.internal.vocabulary.productive.batches.c2_productive_1! };
  const batch = v.entries.filter((e) => e.tags.includes(P.batch));
  const head = (h: string) => v.entries.find((e) => e.headword === h)!;

  it("has 300 entries split by sub-theme as planned", () => {
    expect(batch).toHaveLength(300);
    for (const [theme, n] of Object.entries(P.themes)) expect(batch.filter((e) => e.tags.includes(theme)).length, theme).toBe(n);
  });

  it("gives every entry an Interview answer, an Academic Discussion sentence and a usage note", () => {
    for (const e of batch) {
      expect(e.tier, e.id).toBe("mastery");
      expect(e.cefr, e.id).toBe("C2");
      expect(e.example_interview && exampleUsesEntry(e.example_interview, e), e.id).toBeTruthy();
      expect(e.example_discussion && exampleUsesEntry(e.example_discussion, e), e.id).toBeTruthy();
      expect(e.usage_note?.length, e.id).toBeGreaterThan(20);
      expect(isTransparent(e, CONFIG.internal.vocabulary.transparency.threshold), e.id).toBe(false);
    }
    expect(head("dismiss out of hand").tags).toContain("precise_collocations");
    expect(head("mind you").tags).toContain("spoken_markers");
  });

  it("uses four genuinely different examples for each entry", () => {
    // Word-overlap (Jaccard) between any two of the academic, spoken, interview and discussion examples.
    const words = (t: string) => new Set(t.toLowerCase().match(/[a-z']+/g) ?? []);
    const overlap = (a: string, b: string) => {
      const A = words(a);
      const B = words(b);
      return [...A].filter((w) => B.has(w)).length / new Set([...A, ...B]).size;
    };
    for (const e of batch) {
      const ex = [e.example_academic, e.example_spoken, e.example_interview!, e.example_discussion!];
      for (let i = 0; i < ex.length; i++) for (let k = i + 1; k < ex.length; k++) expect(overlap(ex[i]!, ex[k]!), `${e.id} examples ${i}/${k}`).toBeLessThan(0.6);
    }
  });

  it("rejects a batch entry without its extra fields, and duplicates through inflected forms", () => {
    const base = { ...head("rebut") };
    const opts = { productive: { [P.batch]: { tiers: P.tiers, themes: Object.keys(P.themes) } } };
    const missing = { ...base, example_interview: undefined, usage_note: undefined };
    expect(validateVocab([{ data: missing }], opts).errors.map((e) => e.message).join("\n")).toMatch(/example_interview[\s\S]*usage_note/);
    const twoThemes = { ...base, tags: [P.batch, "emphasis", "argument_verbs"] };
    expect(validateVocab([{ data: twoThemes }], opts).errors.map((e) => e.message).join("\n")).toMatch(/exactly one sub-theme/);
    const inflected = { ...base, id: "v_acad_rebuts", headword: "rebuts", tags: [], example_academic: "The second paper rebuts the first one point by point.", example_spoken: "She rebuts every criticism calmly." };
    expect(validateVocab([{ data: base }, { data: inflected }]).errors.map((e) => e.message).join("\n")).toMatch(/"rebuts" is an inflected form of "rebut"/);
  });
});

describe("second productive C2 batch", () => {
  const v = readVocab();
  const P = { batch: "c2_productive_2", ...CONFIG.internal.vocabulary.productive.batches.c2_productive_2! };
  const batch = v.entries.filter((e) => e.tags.includes(P.batch));
  const head = (h: string) => v.entries.find((e) => e.headword === h)!;
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z']+/g) ?? []);
  const overlap = (a: string, b: string) => {
    const A = words(a);
    const B = words(b);
    return [...A].filter((w) => B.has(w)).length / new Set([...A, ...B]).size;
  };

  it("has 200 entries, 25 per sub-theme, none shared with the first batch", () => {
    expect(batch).toHaveLength(200);
    expect(Object.values(P.themes).reduce((a, b) => a + b, 0)).toBe(200);
    for (const [theme, n] of Object.entries(P.themes)) expect(batch.filter((e) => e.tags.includes(theme)).length, theme).toBe(n);
    expect(batch.filter((e) => e.tags.includes("c2_productive_1"))).toEqual([]);
  });

  it("stays in the Extended and Mastery tiers, with both task examples, a usage note and no transparent word", () => {
    for (const e of batch) {
      expect(P.tiers, e.id).toContain(e.tier);
      expect(e.example_interview && exampleUsesEntry(e.example_interview, e), e.id).toBeTruthy();
      expect(e.example_discussion && exampleUsesEntry(e.example_discussion, e), e.id).toBeTruthy();
      expect(e.usage_note?.length, e.id).toBeGreaterThan(20);
      expect(isTransparent(e, CONFIG.internal.vocabulary.transparency.threshold), e.id).toBe(false);
    }
    expect(batch.filter((e) => e.tier === "mastery").length).toBeGreaterThanOrEqual(80);
    expect(head("the ball is in your court").tags).toContain("campus_idioms");
    expect(head("I wish to draw your attention to").function).toBe("email_complaint");
    expect(head("there are two reasons for this").function).toBe("speech_structuring");
  });

  it("uses four genuinely different examples for each entry", () => {
    for (const e of batch) {
      const ex = [e.example_academic, e.example_spoken, e.example_interview!, e.example_discussion!];
      for (let i = 0; i < ex.length; i++) for (let k = i + 1; k < ex.length; k++) expect(overlap(ex[i]!, ex[k]!), `${e.id} examples ${i}/${k}`).toBeLessThan(0.6);
    }
  });

  it("rejects an entry tagged for both batches, or outside the batch tiers", () => {
    const base = { ...head("plummet") };
    const opts = {
      productive: Object.fromEntries(
        Object.entries(CONFIG.internal.vocabulary.productive.batches).map(([k, b]) => [k, { tiers: b.tiers, themes: Object.keys(b.themes) }]),
      ),
    };
    expect(validateVocab([{ data: base }], opts).errors).toEqual([]);
    const both = { ...base, tags: ["c2_productive_1", "argument_verbs", P.batch, "trends_quantity"] };
    expect(validateVocab([{ data: both }], opts).errors.map((e) => e.message).join("\n")).toMatch(/one productive batch only/);
    const core = { ...base, tier: "core", cefr: "B2" };
    expect(validateVocab([{ data: core }], opts).errors.map((e) => e.message).join("\n")).toMatch(/c2_productive_2 entries belong to the extended or mastery tier/);
  });
});
