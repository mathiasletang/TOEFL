import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../server/app";
import { loadEnv, type Env } from "../server/env";
import { USERS, type DB } from "../server/db";
import { listExercises } from "../server/content";
import { bankFor, exerciseIndex, introductionOrder } from "../server/vocabDeck";
import { buildQuestion, isProduction, type Format } from "../shared/vocabSrs";
import { CONFIG } from "../shared/config";
import { deriveCtw } from "../shared/ctw";
import type { LlmCaller } from "../server/ai/evaluate";

const P = CONFIG.internal.vocabulary.srs;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "toefl-vocab-"));
const baseEnv = loadEnv();
const env: Env = { ...baseEnv, dataDir: tmp, llm: { ...baseEnv.llm, provider: "anthropic", apiKey: "" }, stt: { ...baseEnv.stt, provider: "none" }, tts: { ...baseEnv.tts, provider: "none" } };
// The tests never depend on the profile names.
const [A, B] = [USERS[0].id, USERS[1].id];

let llmMode: "ok" | "invalid" = "ok";
const fakeLlm: LlmCaller = async ({ user }) => {
  if (llmMode === "invalid") return "not json";
  const words = /TARGET WORDS: (.*)/.exec(user)![1]!.split("; ");
  return JSON.stringify({ words: words.map((w) => ({ headword: w, used: true, meaning_correct: true, natural: false, comment: "Check the collocation." })), overall_comment: "Clear.", improved_version: "Improved text." });
};

let app: FastifyInstance;
let db: DB;
let plain: FastifyInstance;
let plainDb: DB;

const post = (url: string, payload: unknown = {}, a = app) => a.inject({ method: "POST", url, payload: payload as object });
const get = (url: string, a = app) => a.inject({ method: "GET", url });

interface Next {
  card: { id: string; entry_id: string | null; phase: string; status: string; personal: boolean; review_count: number } | null;
  seed: number;
  question: { format: Format; input: string; options?: string[]; prompt: string } | null;
  summary: { due: number; new_left: number; new_per_day: number; introduced_today: number };
}
async function drill(u: string, exerciseId: string, response: unknown) {
  const s = (await post("/api/sessions", { userId: u, exerciseId, mode: "practice" })).json();
  return post(`/api/sessions/${s.session.id}/submit`, { response, elapsedMs: 1000 });
}
const next = async (u: string) => (await post(`/api/users/${u}/vocab/next`)).json() as Next;

/** Answer the current card correctly or wrongly by rebuilding the question the server built. */
async function answer(u: string, n: Next, correct: boolean) {
  const bank = bankFor(db);
  const entry = bank.byId.get(n.card!.entry_id!)!;
  const q = buildQuestion(entry, n.question!.format, String(n.seed), bank.entries);
  const payload = q.input === "choice" ? { choice: correct ? q.answerIndex : (q.answerIndex! + 1) % 4 } : { text: correct ? q.expected : "zzzz" };
  return post(`/api/users/${u}/vocab/reviews`, { cardId: n.card!.id, format: n.question!.format, seed: n.seed, elapsedMs: 3000, ...payload });
}

beforeAll(async () => {
  const built = await buildApp({ env, dbFile: path.join(tmp, "a.db"), serveStatic: false, llmCaller: fakeLlm });
  app = built.app;
  db = built.db;
  const second = await buildApp({ env, dbFile: path.join(tmp, "b.db"), serveStatic: false });
  plain = second.app;
  plainDb = second.db;
});
afterAll(async () => {
  await app.close();
  await plain.close();
  db.close();
  plainDb.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("vocabulary bank routes", () => {
  it("lists the bank with filters, search and per-user status", async () => {
    const all = (await get(`/api/users/${A}/vocab/entries`)).json();
    expect(all.total).toBe(1329);
    const cognates = (await get(`/api/users/${A}/vocab/entries?transparent=1`)).json();
    const others = (await get(`/api/users/${A}/vocab/entries?transparent=0`)).json();
    expect(cognates.total + others.total).toBe(1329);
    expect(cognates.entries.every((e: { transparent: boolean; transparent_fr: number }) => e.transparent && e.transparent_fr >= CONFIG.internal.vocabulary.transparency.threshold)).toBe(true);
    expect(others.entries.some((e: { transparent: boolean }) => e.transparent)).toBe(false);
    const core = (await get(`/api/users/${A}/vocab/entries?tier=core`)).json();
    expect(core.total).toBe(400);
    expect(core.entries.every((e: { tier: string; status: string }) => e.tier === "core" && e.status === "new")).toBe(true);
    const c2 = (await get(`/api/users/${A}/vocab/entries?cefr=C2&category=geology`)).json();
    expect(c2.total).toBeGreaterThan(0);
    expect(c2.entries.every((e: { cefr: string; category: string }) => e.cefr === "C2" && e.category === "geology")).toBe(true);
    const found = (await get(`/api/users/${A}/vocab/entries?q=erosion`)).json();
    expect(found.entries.some((e: { headword: string }) => e.headword === "erosion")).toBe(true);
    expect((await get("/api/users/Nobody/vocab/entries")).statusCode).toBe(404);
  });

  it("returns the full entry with the exercises where the word appears", async () => {
    const idx = exerciseIndex(db);
    expect(idx.size).toBeGreaterThan(50);
    const [entryId, exIds] = [...idx.entries()].find(([id]) => bankFor(db).entryForms.has(id))!;
    const d = (await get(`/api/users/${A}/vocab/entries/${entryId}`)).json();
    expect(d.entry.id).toBe(entryId);
    expect(d.entry.definition).toBeTruthy();
    expect(d.exercises.map((e: { id: string }) => e.id)).toEqual(exIds);
    expect(d.exercises[0].title).toBeTruthy();
    expect(d.card).toBeNull();
    expect(d.audio).toBe("browser");
    // The index really is a form match on the exercise text.
    const forms = bankFor(db).entryForms.get(entryId)!;
    const ex = listExercises(db).find((e) => e.id === exIds[0])!;
    expect(JSON.stringify(ex).toLowerCase().split(/[^a-z']+/).some((t) => forms.has(t))).toBe(true);
    expect((await get(`/api/users/${A}/vocab/entries/nope`)).statusCode).toBe(404);
    expect((await get(`/api/vocab/audio/${entryId}/headword`)).statusCode).toBe(404); // no TTS provider → browser fallback
  });

  it("exposes module metadata labelled as internal", async () => {
    const m = (await get("/api/vocab/meta")).json();
    expect(m.new_per_day_default).toBe(25);
    expect(Math.max(...m.new_per_day_options)).toBe(40);
    expect(m.note).toMatch(/internal/i);
    expect(m.tiers.core.note).toMatch(/not an official list/i);
  });
});

describe("daily session", () => {
  it("defaults to 25 new words a day and is adjustable per profile", async () => {
    expect((await get(`/api/users/${A}/vocab/summary`)).json()).toMatchObject({ due: 0, new_left: 25, new_per_day: 25 });
    const r = await app.inject({ method: "PATCH", url: `/api/users/${A}`, payload: { vocab_new_per_day: 3 } });
    expect(r.json().vocab_new_per_day).toBe(3);
    expect((await get(`/api/users/${A}/vocab/summary`)).json().new_left).toBe(3);
    expect((await get(`/api/users/${B}/vocab/summary`)).json().new_left).toBe(25);
    expect((await app.inject({ method: "PATCH", url: `/api/users/${B}`, payload: { vocab_new_per_day: 40 } })).json().vocab_new_per_day).toBe(40);
    await app.inject({ method: "PATCH", url: `/api/users/${B}`, payload: { vocab_new_per_day: 25 } });
    expect((await app.inject({ method: "PATCH", url: `/api/users/${A}`, payload: { vocab_new_per_day: -1 } })).statusCode).toBe(400);
    expect((await get(`/api/users/${A}/dashboard`)).json().vocabulary).toMatchObject({ due: 0, new_left: 3 });
  });

  it("introduces words in the order of the profile's target, French cognates last", async () => {
    const bank = bankFor(db);
    for (const [u, target, firstCategory] of [[A, 5, null], [B, 6, "functional_language"]] as const) {
      await app.inject({ method: "PATCH", url: `/api/users/${u}`, payload: { target_band: target } });
      const n = await next(u);
      const first = introductionOrder(bank, target)[0]!;
      expect(n.card!.entry_id).toBe(first.id);
      if (firstCategory) expect(first.category).toBe(firstCategory);
      else expect(first.tier).toBe("core");
      expect(bank.transparent.has(first.id)).toBe(false);
      expect(n.card!.phase).toBe("new");
      expect(n.question!.format).toBe("meaning_choice");
    }
    for (const target of [5, 6]) {
      const order = introductionOrder(bank, target);
      const firstTransparent = order.findIndex((e) => bank.transparent.has(e.id));
      expect(order.slice(firstTransparent).every((e) => bank.transparent.has(e.id))).toBe(true);
    }
    // 6.0: discipline terms never enter by introduction; the groups come in the configured order.
    const order6 = introductionOrder(bank, 6).filter((e) => !bank.transparent.has(e.id));
    expect(order6.some((e) => CONFIG.internal.vocabulary.discipline_categories.includes(e.category))).toBe(false);
    const groupOf = (c: string) => ["functional_language", "academic_collocations", "phrasal_verbs_idioms", "false_friends_fr"].indexOf(c);
    const seq = order6.map((e) => (groupOf(e.category) >= 0 ? groupOf(e.category) : e.category === "general_academic" && e.cefr !== "B2" ? 4 : 5));
    expect(seq.every((g, i) => i === 0 || g >= seq[i - 1]!)).toBe(true);
    // 5.0: core first, then B2 → C1 → C2 (discipline terms included).
    const order5 = introductionOrder(bank, 5).filter((e) => !bank.transparent.has(e.id));
    const nCore = order5.filter((e) => e.tier === "core").length;
    expect(order5.slice(0, nCore).every((e) => e.tier === "core")).toBe(true);
    expect(order5.slice(nCore).map((e) => e.cefr).join("").replace(/(B2)+/, "B").replace(/(C1)+/, "1").replace(/(C2)+/, "2")).toBe("B12");
    expect(order5.some((e) => CONFIG.internal.vocabulary.discipline_categories.includes(e.category))).toBe(true);
  });

  it("never sends the answer key, checks answers on the server and schedules the card", async () => {
    const n = await next(A);
    expect(Object.keys(n.question!).filter((k) => ["answerIndex", "expected"].includes(k))).toEqual([]);
    expect(n.question!.options).toHaveLength(4);
    // A wrong first exposure: the card stays in recognition and returns within minutes.
    const wrong = (await answer(A, n, false)).json();
    expect(wrong).toMatchObject({ correct: false, error_tag: "vocab_meaning", error_label: "Vocabulary: word meaning" });
    expect(wrong.card.lapses).toBe(0);
    expect(Date.parse(wrong.card.due_at) - Date.now()).toBeLessThanOrEqual(P.relearn_minutes * 60000);
    expect(wrong.entry.headword).toBeTruthy();
    // Replaying the same answer is refused.
    expect((await answer(A, n, true)).statusCode).toBe(409);
    expect((await post(`/api/users/${B}/vocab/reviews`, { cardId: n.card!.id, format: "meaning_choice", seed: 1, choice: 0 })).statusCode).toBe(404);
  });

  it("stops introducing new words at the daily limit and serves due reviews first", async () => {
    // A has a limit of 3 and one word introduced (failed). Introduce the two others correctly.
    for (let i = 0; i < 2; i++) {
      const n = await next(A);
      expect(n.card!.phase).toBe("new");
      const r = (await answer(A, n, true)).json();
      expect(r).toMatchObject({ correct: true, quality: 5 });
      expect(r.card.interval_days).toBe(P.first_interval_days);
      expect(r.card.status).toBe("learning");
    }
    // The word missed a moment ago comes back before the session ends.
    const again = await next(A);
    expect(again.card).toMatchObject({ phase: "review", review_count: 1 });
    expect(again.question!.format).toBe("meaning_choice");
    expect((await answer(A, again, true)).json().correct).toBe(true);
    const done = await next(A);
    expect(done.card).toBeNull();
    expect(done.summary).toMatchObject({ due: 0, new_left: 0, introduced_today: 3 });
    // Make everything due: reviews come back, oldest first, and no new word is offered before them.
    db.prepare("UPDATE vocab_cards SET due_at = '2020-01-01T00:00:00.000Z' WHERE user_id = ? AND review_count > 0").run(A);
    const due = await next(A);
    expect(due.card!.phase).toBe("review");
    expect(due.summary.due).toBe(3);
  });

  it("moves to production formats once recognition is passed (at least 60 % of reviews)", async () => {
    let production = 0;
    let total = 0;
    for (let round = 0; round < 6; round++) {
      for (;;) {
        const n = await next(A);
        if (!n.card) break;
        const passed = (db.prepare("SELECT recognition_passed p FROM vocab_cards WHERE id = ?").get(n.card.id) as { p: number }).p;
        if (passed) {
          expect(n.question!.format).not.toBe("meaning_choice");
          total++;
          if (isProduction(n.question!.format)) production++;
        } else expect(n.question!.format).toBe("meaning_choice");
        expect((await answer(A, n, true)).json().correct).toBe(true);
      }
      db.prepare("UPDATE vocab_cards SET due_at = '2020-01-01T00:00:00.000Z' WHERE user_id = ? AND review_count > 0").run(A);
    }
    expect(total).toBeGreaterThan(10);
    expect(production / total).toBeGreaterThanOrEqual(P.production_share_min);
    const c = db.prepare("SELECT MIN(1.0 * production_count / practice_count) share FROM vocab_cards WHERE user_id = ? AND practice_count >= 3").get(A) as { share: number };
    expect(c.share).toBeGreaterThanOrEqual(P.production_share_min);
  });

  it("feeds typed errors into the existing error profile", async () => {
    db.prepare("UPDATE vocab_cards SET due_at = '2020-01-01T00:00:00.000Z' WHERE user_id = ? AND review_count > 0").run(A);
    let typedWrong = 0;
    for (let i = 0; i < 12 && typedWrong === 0; i++) {
      const n = await next(A);
      if (!n.card) break;
      if (n.question!.input === "typed") {
        const r = (await answer(A, n, false)).json();
        expect(r).toMatchObject({ correct: false, error_tag: "semantic_context" });
        expect(r.card.lapses).toBe(1);
        typedWrong++;
      } else await answer(A, n, true);
    }
    expect(typedWrong).toBe(1);
    const weak = (await get(`/api/users/${A}/progress`)).json().weaknesses as Array<{ tag: string; errors: number; sources: string[] }>;
    expect(weak.find((w) => w.tag === "semantic_context")).toMatchObject({ errors: 1, sources: ["vocabulary"] });
    expect(weak.find((w) => w.tag === "vocab_meaning")!.sources).toEqual(["vocabulary"]);
  });

  it("reports states by tier, 30-day retention and failing words", async () => {
    const s = (await get(`/api/users/${A}/vocab/stats`)).json();
    expect(s.by_tier.core.total).toBe(400);
    expect(s.by_tier.core.learning + s.by_tier.core.mature).toBe(3);
    expect(s.by_status.total).toBe(1329);
    expect(s.by_status.new).toBe(1326);
    expect(s.by_status.known).toBe(0);
    expect(s.window_days).toBe(30);
    expect(s.retention.reviews).toBeGreaterThan(10);
    expect(s.retention.rate).toBeGreaterThan(0.5);
    expect(s.retention.rate).toBeLessThan(1);
    expect(s.production_share).toBeGreaterThanOrEqual(P.production_share_min - 0.1);
    expect(s.failing).toEqual([]);
    const id = (db.prepare("SELECT id FROM vocab_cards WHERE user_id = ? ORDER BY interval_days LIMIT 1").get(A) as { id: string }).id;
    db.prepare("UPDATE vocab_cards SET interval_days = 1 WHERE user_id = ?").run(A);
    db.prepare("UPDATE vocab_cards SET lapses = ? WHERE id = ?").run(P.leech_lapses, id);
    db.prepare("UPDATE vocab_cards SET interval_days = ? WHERE id = ?").run(P.mature_interval_days, id);
    const s2 = (await get(`/api/users/${A}/vocab/stats`)).json();
    expect(s2.failing).toHaveLength(1);
    expect(s2.failing[0].card_id).toBe(id);
    expect(s2.by_status.mature).toBe(1);
    expect((await get(`/api/users/${A}/vocab/entries?status=mature`)).json().total).toBe(1);
  });
});

describe("harvest and personal cards", () => {
  it("adds a clicked word: bank entry when it exists, personal card with its sentence otherwise", async () => {
    const bank = (await post(`/api/users/${B}/vocab/cards`, { word: "Deposited,", sentence: "The river deposited silt." })).json();
    expect(bank).toMatchObject({ created: true, matched: "bank", headword: "deposit" });
    expect((await post(`/api/users/${B}/vocab/cards`, { word: "deposits" })).json()).toMatchObject({ created: false, matched: "bank" });
    const personal = (await post(`/api/users/${B}/vocab/cards`, { word: "Zeugma", sentence: "The   poet used a zeugma in the last line.", exerciseId: null })).json();
    expect(personal).toMatchObject({ created: true, matched: "personal", headword: "zeugma" });
    const list = (await get(`/api/users/${B}/vocab/entries?tier=personal`)).json();
    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]).toMatchObject({ headword: "zeugma", definition: "The poet used a zeugma in the last line.", status: "new", in_deck: true });
    const detail = (await get(`/api/users/${B}/vocab/entries/${list.entries[0].id}`)).json();
    expect(detail.personal).toMatchObject({ headword: "zeugma", source_sentence: "The poet used a zeugma in the last line." });
    expect((await post(`/api/users/${B}/vocab/cards`, {})).statusCode).toBe(400);
    expect((await post(`/api/users/${B}/vocab/cards`, { entryId: "nope" })).statusCode).toBe(404);
  });

  it("serves added words before the scheduled ones, personal cards with study → gap fill", async () => {
    // B already has one scheduled card waiting from the earlier test; added words jump the queue.
    const n1 = await next(B);
    expect(bankFor(db).byId.get(n1.card!.entry_id!)!.headword).toBe("deposit");
    await answer(B, n1, true);
    const n2 = await next(B);
    expect(n2.card).toMatchObject({ personal: true, entry_id: null });
    expect(n2.question).toMatchObject({ format: "study", input: "none", prompt: "zeugma" });
    const r = (await post(`/api/users/${B}/vocab/reviews`, { cardId: n2.card!.id, format: "study", seed: 0 })).json();
    expect(r).toMatchObject({ correct: true, headword: "zeugma", entry: null });
    db.prepare("UPDATE vocab_cards SET due_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(n2.card!.id);
    const n3 = await next(B);
    expect(n3.card!.id).toBe(n2.card!.id);
    expect(n3.question!.format).toBe("cloze_typed");
    expect(n3.question!.prompt).toBe("The poet used a z_____ in the last line.");
    const ok = (await post(`/api/users/${B}/vocab/reviews`, { cardId: n3.card!.id, format: "cloze_typed", seed: 1, text: "zeugma" })).json();
    expect(ok.correct).toBe(true);
  });

  it("harvests missed Complete-the-Words gaps and missed vocabulary questions", async () => {
    const before = (db.prepare("SELECT COUNT(*) n FROM vocab_cards WHERE user_id = ?").get(B) as { n: number }).n;
    const ctw = listExercises(db, { taskType: "complete_the_words" })[0]!;
    if (ctw.task_type !== "complete_the_words") throw new Error("unexpected");
    const gaps = deriveCtw(ctw.passage).gaps;
    const r = await drill(B, ctw.id, { gaps: gaps.map(() => "") });
    expect(r.statusCode).toBe(200);
    const harvested = db.prepare("SELECT headword, entry_id, origin, source_sentence, source_exercise_id FROM vocab_cards WHERE user_id = ? AND origin = 'harvest_ctw'").all(B) as Array<{ headword: string; entry_id: string | null; source_sentence: string | null; source_exercise_id: string }>;
    expect(harvested.length).toBeGreaterThan(0);
    expect(harvested.length).toBeLessThanOrEqual(gaps.length);
    expect(harvested.every((c) => c.source_exercise_id === ctw.id)).toBe(true);
    // Function words are never harvested; personal cards keep the sentence the word came from.
    expect(harvested.some((c) => ["the", "of", "and", "that", "with"].includes(c.headword))).toBe(false);
    const personal = harvested.filter((c) => !c.entry_id);
    expect(personal.every((c) => !!c.source_sentence && ctw.passage.includes(c.source_sentence!))).toBe(true);

    const reading = listExercises(db).find((e) => "questions" in e && e.questions.some((q) => "skill" in q && q.skill === "vocabulary" && q.highlight))!;
    if (!("questions" in reading)) throw new Error("unexpected");
    const wrong = reading.questions.map((q) => ("answer_index" in q ? (q.answer_index + 1) % 4 : 0));
    await drill(B, reading.id, { answers: wrong });
    const q = db.prepare("SELECT headword, source_exercise_id FROM vocab_cards WHERE user_id = ? AND origin = 'harvest_question'").all(B) as Array<{ headword: string; source_exercise_id: string }>;
    expect(q.length).toBeGreaterThan(0);
    expect(q.every((c) => c.source_exercise_id === reading.id)).toBe(true);
    // A perfect attempt harvests nothing.
    const total = (db.prepare("SELECT COUNT(*) n FROM vocab_cards WHERE user_id = ?").get(B) as { n: number }).n;
    expect(total).toBeGreaterThan(before);
    await drill(B, ctw.id, { gaps: gaps.map((g) => g.missing) });
    expect((db.prepare("SELECT COUNT(*) n FROM vocab_cards WHERE user_id = ?").get(B) as { n: number }).n).toBe(total);
  });
});

describe("production challenge", () => {
  it("proposes words reviewed today and checks their presence, with AI feedback when a provider is configured", async () => {
    const c = (await get(`/api/users/${A}/vocab/challenge`)).json();
    expect(c.words).toHaveLength(P.challenge_words);
    expect(c).toMatchObject({ seconds: 45, ai_configured: true, stt_configured: false });
    const [w1, w2, w3] = c.words as Array<{ card_id: string; headword: string }>;
    const text = `First, ${w1!.headword} matters here. I also think ${w2!.headword} is relevant.`;
    const r = (await post(`/api/users/${A}/vocab/challenge`, { cardIds: [w1!.card_id, w2!.card_id, w3!.card_id], mode: "written", text, textSource: "typed" })).json();
    expect(r.words.map((w: { present: boolean }) => w.present)).toEqual([true, true, false]);
    expect(r.feedback.words).toHaveLength(3);
    expect(r.feedback.improved_version).toBe("Improved text.");
    expect(r.feedback_error).toBeNull();
    llmMode = "invalid";
    const bad = (await post(`/api/users/${A}/vocab/challenge`, { cardIds: [w1!.card_id], mode: "written", text, textSource: "typed" })).json();
    expect(bad.feedback).toBeNull();
    expect(bad.feedback_error).toBeTruthy();
    llmMode = "ok";
    expect((await post(`/api/users/${B}/vocab/challenge`, { cardIds: [w1!.card_id], mode: "written", text, textSource: "typed" })).statusCode).toBe(404);
    expect((await get(`/api/users/${A}/vocab/stats`)).json().challenges).toBe(2);
  });

  it("falls back to self-evaluation without a provider or without a transcript", async () => {
    const n = (await post(`/api/users/${A}/vocab/next`, {}, plain)).json() as Next;
    const bank = bankFor(plainDb);
    const q = buildQuestion(bank.byId.get(n.card!.entry_id!)!, "meaning_choice", "0", bank.entries);
    await post(`/api/users/${A}/vocab/reviews`, { cardId: n.card!.id, format: "meaning_choice", seed: 0, choice: q.answerIndex }, plain);
    const c = (await get(`/api/users/${A}/vocab/challenge`, plain)).json();
    expect(c.ai_configured).toBe(false);
    expect(c.words).toHaveLength(1);
    const word = c.words[0] as { card_id: string; headword: string };
    const written = (await post(`/api/users/${A}/vocab/challenge`, { cardIds: [word.card_id], mode: "written", text: `I used ${word.headword} here.`, textSource: "typed" }, plain)).json();
    expect(written).toMatchObject({ feedback: null, feedback_error: null, ai_configured: false, self_rating: null });
    expect(written.words[0].present).toBe(true);
    // Spoken answer with no transcript at all: presence cannot be verified.
    const spoken = (await post(`/api/users/${A}/vocab/challenge`, { cardIds: [word.card_id], mode: "spoken", text: "", textSource: "none" }, plain)).json();
    expect(spoken.words[0].present).toBeNull();
    expect(spoken.text_source).toBe("none");
    const rated = (await post(`/api/vocab/challenges/${spoken.id}/self-rate`, { rating: 4 }, plain)).json();
    expect(rated.self_rating).toBe(4);
    expect((await post(`/api/vocab/challenges/${spoken.id}/self-rate`, { rating: 9 }, plain)).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/users/${A}/vocab/challenge/transcribe`, payload: Buffer.from("x"), headers: { "content-type": "audio/webm" } })).statusCode).toBe(409);
  });
});

describe("triage", () => {
  // Runs on the second database, where this profile has no card yet.
  const T = CONFIG.internal.vocabulary.triage;
  const tri = (entryId: string, decision: "known" | "learn") => post(`/api/users/${B}/vocab/triage`, { entryId, decision }, plain);
  const nextB = async () => (await post(`/api/users/${B}/vocab/next`, {}, plain)).json() as Next;
  const answerB = async (n: Next, correct: boolean) => {
    const bank = bankFor(plainDb);
    const q = buildQuestion(bank.byId.get(n.card!.entry_id!)!, n.question!.format, String(n.seed), bank.entries);
    const payload = q.input === "choice" ? { choice: correct ? q.answerIndex : (q.answerIndex! + 1) % 4 } : { text: correct ? q.expected : "zzzz" };
    return (await post(`/api/users/${B}/vocab/reviews`, { cardId: n.card!.id, format: n.question!.format, seed: n.seed, elapsedMs: 3000, ...payload }, plain)).json();
  };
  let known: string[] = [];

  it("lists upcoming words in introduction order", async () => {
    const t = (await get(`/api/users/${B}/vocab/triage`, plain)).json();
    const order = introductionOrder(bankFor(plainDb), 6);
    expect(t.entries).toHaveLength(T.batch_size);
    expect(t.entries.map((e: { id: string }) => e.id)).toEqual(order.slice(0, T.batch_size).map((e) => e.id));
    expect(t).toMatchObject({ remaining: order.length, total: order.length, done: 0, known: 0, learn: 0, verify_every: T.verify_every });
    known = t.entries.slice(0, 2 * T.verify_every).map((e: { id: string }) => e.id);
  });

  it("schedules a production check for one known word in ten", async () => {
    const flags: boolean[] = [];
    for (const id of known) flags.push((await tri(id, "known")).json().verify_scheduled);
    expect(flags.filter(Boolean)).toHaveLength(2);
    expect(flags[T.verify_every - 1]).toBe(true);
    expect(flags[2 * T.verify_every - 1]).toBe(true);
    const t = (await get(`/api/users/${B}/vocab/triage`, plain)).json();
    expect(t).toMatchObject({ known: known.length, to_verify: 2, done: known.length });
    // Triage resumes after the last sorted word.
    expect(t.entries[0].id).toBe(introductionOrder(bankFor(plainDb), 6)[known.length]!.id);
    expect(t.entries.some((e: { id: string }) => known.includes(e.id))).toBe(false);
  });

  it("never introduces a known word, and queues words to learn first", async () => {
    const t = (await get(`/api/users/${B}/vocab/triage`, plain)).json();
    const learnId = t.entries[3].id;
    expect((await tri(learnId, "learn")).json().card).toMatchObject({ triage: "learn", status: "new" });
    const n = await nextB();
    expect(n.card!.entry_id).toBe(learnId);
    expect(known).not.toContain(n.card!.entry_id);
    expect((await tri(learnId, "known")).statusCode).toBe(200); // not reviewed yet: can still be re-sorted
    await answerB(await nextB(), true);
    const s = (await get(`/api/users/${B}/vocab/summary`, plain)).json();
    expect(s.known).toBe(known.length + 1);
    // A word already studied cannot be triaged.
    const studied = (plainDb.prepare("SELECT entry_id FROM vocab_cards WHERE user_id = ? AND review_count > 0").get(B) as { entry_id: string }).entry_id;
    expect((await tri(studied, "known")).statusCode).toBe(409);
    expect((await get(`/api/users/${B}/vocab/entries?status=known`, plain)).json().total).toBe(known.length + 1);
  });

  it("undoes a triage decision", async () => {
    const last = known[known.length - 2]!;
    expect((await plain.inject({ method: "DELETE", url: `/api/users/${B}/vocab/triage/${last}` })).statusCode).toBe(200);
    expect((await plain.inject({ method: "DELETE", url: `/api/users/${B}/vocab/triage/${last}` })).statusCode).toBe(409);
    known = known.filter((k) => k !== last);
  });

  it("checks known words in production: a pass keeps them out, a failure puts them back", async () => {
    plainDb.prepare("UPDATE vocab_cards SET verify_due_at = '2020-01-01T00:00:00.000Z' WHERE user_id = ? AND verify_due_at IS NOT NULL").run(B);
    expect((await get(`/api/users/${B}/vocab/summary`, plain)).json().verify_due).toBe(2);
    const first = await nextB();
    expect(first.card!.phase).toBe("verify");
    expect(isProduction(first.question!.format)).toBe(true);
    expect(CONFIG.internal.vocabulary.triage.verify_formats).toContain(first.question!.format);
    expect(["recall_typed", "cloze_typed"]).toContain(first.question!.format);
    // A recognition format is refused for a check.
    expect((await post(`/api/users/${B}/vocab/reviews`, { cardId: first.card!.id, format: "meaning_choice", seed: 0, choice: 0 }, plain)).statusCode).toBe(400);
    const pass = await answerB(first, true);
    expect(pass).toMatchObject({ correct: true, verification: "passed", card: { status: "known", triage: "known", verify_due_at: null } });
    expect(pass.card.verified_at).toBeTruthy();
    const second = await nextB();
    expect(second.card!.phase).toBe("verify");
    const fail = await answerB(second, false);
    expect(fail).toMatchObject({ correct: false, verification: "failed", card: { triage: "learn", status: "learning", review_count: 1 } });
    expect((await get(`/api/users/${B}/vocab/summary`, plain)).json().verify_due).toBe(0);
  });

  it("moves a known word back to learning when it is missed or added on purpose", async () => {
    const id = known[0]!;
    const r = (await post(`/api/users/${B}/vocab/cards`, { entryId: id }, plain)).json();
    expect(r.card).toMatchObject({ triage: "learn", status: "new" });
  });
});

describe("discipline terms through harvest", () => {
  it("adds discipline terms of a listening script or academic passage when questions are missed", async () => {
    const disc = new Set(CONFIG.internal.vocabulary.discipline_categories);
    const discCards = () =>
      (db.prepare("SELECT v.category, c.origin FROM vocab_cards c JOIN vocab_entries v ON v.id = c.entry_id WHERE c.user_id = ? AND c.origin = 'harvest_text'").all(B) as Array<{ category: string; origin: string }>);
    const before = discCards().length;
    // l_talk_002 mentions "predator" and "conservation" (ecology / environmental science entries).
    const talk = listExercises(db, { taskType: "academic_talk" }).find((e) => e.id === "l_talk_002")!;
    if (!("questions" in talk)) throw new Error("unexpected");
    const s = (await post("/api/sessions", { userId: B, exerciseId: talk.id, mode: "practice" })).json();
    await post(`/api/sessions/${s.session.id}/submit`, { response: { answers: talk.questions.map(() => null) }, elapsedMs: 1000 });
    const after = discCards();
    expect(after.length).toBeGreaterThan(before);
    expect(after.length - before).toBeLessThanOrEqual(CONFIG.internal.vocabulary.harvest.discipline_terms_per_text);
    expect(after.every((c) => disc.has(c.category))).toBe(true);
  });
});
