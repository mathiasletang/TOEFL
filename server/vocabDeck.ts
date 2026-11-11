/**
 * Per-user vocabulary deck on top of the vocabulary bank: cards, the daily queue,
 * review processing, statistics, automatic harvesting and the production challenge.
 * Scheduling is internal training logic (config → internal.vocabulary.srs).
 */
import crypto from "node:crypto";
import type { DB } from "./db";
import { nowIso } from "./db";
import { listVocab } from "./vocab";
import { listExercises } from "./content";
import { CONFIG } from "../shared/config";
import { FUNCTION_WORDS } from "../shared/align";
import { containsPhrase, inflectionsOf, tokenize, type VocabEntry } from "../shared/vocab";
import type { Exercise } from "../shared/schema";
import type { ScoreResult } from "../shared/scoring";
import {
  availableFormats,
  buildQuestion,
  cardStatus,
  checkAnswer,
  chooseFormat,
  introductionRank,
  isProduction,
  publicQuestion,
  qualityFor,
  schedule,
  FORMATS,
  type CardStatus,
  type Format,
  type Studyable,
} from "../shared/vocabSrs";

const P = CONFIG.internal.vocabulary.srs;

export class VocabError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- bank lookup

export interface Bank {
  entries: VocabEntry[];
  byId: Map<string, VocabEntry>;
  byHeadword: Map<string, string>;
  /** Inflected form of a single-word headword → entry id. */
  forms: Map<string, string>;
  entryForms: Map<string, Set<string>>;
}

const banks = new WeakMap<DB, Bank>();
const gapFor = (kind: VocabEntry["kind"]) => (kind === "word" ? 0 : kind === "formula" ? 1 : 4);

export function bankFor(db: DB): Bank {
  let b = banks.get(db);
  if (b) return b;
  const entries = listVocab(db);
  b = { entries, byId: new Map(), byHeadword: new Map(), forms: new Map(), entryForms: new Map() };
  for (const e of entries) {
    b.byId.set(e.id, e);
    const head = e.headword.toLowerCase();
    if (!b.byHeadword.has(head)) b.byHeadword.set(head, e.id);
    if (/\s/.test(head)) continue;
    const gradable = e.pos === "adjective" || e.pos === "adverb";
    const forms = new Set<string>([head, ...e.inflections.map((f) => f.toLowerCase())]);
    // Comparative endings are only kept for adjectives/adverbs ("mode" must not match "modest").
    const stem = head.replace(/y$/, "i");
    const last = head[head.length - 1]!;
    const comparative = new Set([`${head}er`, `${head}est`, `${head}r`, `${head}st`, `${stem}er`, `${stem}est`, `${head}${last}er`]);
    for (const f of inflectionsOf(head)) if (gradable || !comparative.has(f)) forms.add(f);
    b.entryForms.set(e.id, forms);
  }
  for (const [id, forms] of b.entryForms) for (const f of forms) if (!b.forms.has(f)) b.forms.set(f, id);
  for (const [head, id] of b.byHeadword) if (!/\s/.test(head)) b.forms.set(head, id);
  banks.set(db, b);
  return b;
}

export function cleanWord(raw: string): string {
  return raw.toLowerCase().replace(/[’‘]/g, "'").replace(/^[^a-z]+|[^a-z]+$/g, "").replace(/'s$/, "").replace(/\s+/g, " ");
}

export function resolveWord(bank: Bank, word: string): VocabEntry | null {
  const w = cleanWord(word);
  const id = bank.byHeadword.get(w) ?? bank.forms.get(w);
  return id ? bank.byId.get(id)! : null;
}

// ---------------------------------------------------------------- exercise index

function exerciseTexts(ex: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === "string") {
      if (n.length >= 12 && /\s/.test(n)) out.push(n);
    } else if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") Object.values(n).forEach(walk);
  };
  walk(ex);
  return out;
}

const exerciseIndexes = new WeakMap<DB, Map<string, string[]>>();

/** Bank entry → exercises whose text contains one of its forms. Built automatically, no manual tagging. */
export function exerciseIndex(db: DB): Map<string, string[]> {
  let idx = exerciseIndexes.get(db);
  if (idx) return idx;
  idx = new Map();
  const bank = bankFor(db);
  const multi = bank.entries.filter((e) => !bank.entryForms.has(e.id)).map((e) => ({ e, first: inflectionsOf(tokenize(e.headword).find((t) => t.length > 3) ?? tokenize(e.headword)[0] ?? "") }));
  for (const ex of listExercises(db, { activeOnly: true })) {
    const text = exerciseTexts(ex).join(" . ");
    const tokens = new Set(tokenize(text));
    const hit = new Set<string>();
    for (const t of tokens) {
      const id = bank.forms.get(t);
      if (id && bank.entryForms.get(id)!.has(t)) hit.add(id);
    }
    for (const [id, forms] of bank.entryForms) if (!hit.has(id)) for (const f of forms) if (tokens.has(f)) hit.add(id);
    for (const { e, first } of multi) {
      let maybe = false;
      for (const f of first) if (tokens.has(f)) maybe = true;
      if (maybe && containsPhrase(text, e.headword, gapFor(e.kind), e.inflections)) hit.add(e.id);
    }
    for (const id of hit) idx.set(id, [...(idx.get(id) ?? []), ex.id]);
  }
  exerciseIndexes.set(db, idx);
  return idx;
}

// ---------------------------------------------------------------- cards

export interface CardRow {
  id: string;
  user_id: string;
  entry_id: string | null;
  headword: string;
  source_sentence: string | null;
  source_exercise_id: string | null;
  origin: string;
  reps: number;
  lapses: number;
  ease: number;
  interval_days: number;
  due_at: string | null;
  review_count: number;
  recognition_passed: number;
  practice_count: number;
  production_count: number;
  introduced_at: string | null;
  last_reviewed_at: string | null;
  created_at: string;
}

export type CardOrigin = "scheduled" | "manual" | "harvest_ctw" | "harvest_question";

export function getCard(db: DB, id: string): CardRow | null {
  return (db.prepare("SELECT * FROM vocab_cards WHERE id = ?").get(id) as CardRow | undefined) ?? null;
}

function insertCard(db: DB, userId: string, f: { entryId: string | null; headword: string; sentence?: string | null; exerciseId?: string | null; origin: CardOrigin }): CardRow {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO vocab_cards (id, user_id, entry_id, headword, source_sentence, source_exercise_id, origin, ease, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    id,
    userId,
    f.entryId,
    f.headword,
    f.sentence ?? null,
    f.exerciseId ?? null,
    f.origin,
    P.initial_ease,
    nowIso(),
  );
  return getCard(db, id)!;
}

export interface AddedWord {
  card: CardRow;
  created: boolean;
  matched: "bank" | "personal";
}

/** Add a word to the user's deck: the matching bank entry when there is one, otherwise a personal card. */
export function addWord(db: DB, userId: string, w: { entryId?: string; word?: string; sentence?: string | null; exerciseId?: string | null; origin: CardOrigin }): AddedWord | null {
  const bank = bankFor(db);
  const entry = w.entryId ? (bank.byId.get(w.entryId) ?? null) : w.word ? resolveWord(bank, w.word) : null;
  if (w.entryId && !entry) throw new VocabError(404, "Unknown vocabulary entry");
  const headword = entry ? entry.headword : cleanWord(w.word ?? "");
  if (!headword || headword.length > 60) return null;
  const existing = (
    entry
      ? db.prepare("SELECT * FROM vocab_cards WHERE user_id = ? AND entry_id = ?").get(userId, entry.id)
      : db.prepare("SELECT * FROM vocab_cards WHERE user_id = ? AND entry_id IS NULL AND headword = ?").get(userId, headword)
  ) as CardRow | undefined;
  if (existing) {
    // A word missed again in an exercise comes back at the front of the queue.
    if (w.origin.startsWith("harvest") && existing.review_count > 0 && (existing.due_at ?? "") > nowIso()) db.prepare("UPDATE vocab_cards SET due_at = ? WHERE id = ?").run(nowIso(), existing.id);
    return { card: getCard(db, existing.id)!, created: false, matched: entry ? "bank" : "personal" };
  }
  const sentence = w.sentence ? w.sentence.replace(/\s+/g, " ").trim().slice(0, 400) : null;
  return { card: insertCard(db, userId, { entryId: entry?.id ?? null, headword, sentence, exerciseId: w.exerciseId, origin: w.origin }), created: true, matched: entry ? "bank" : "personal" };
}

function sentenceWith(texts: string[], word: string): string | null {
  for (const t of texts) for (const s of t.match(/[^.!?]+[.!?]+["”']?|[^.!?]+$/g) ?? [t]) if (containsPhrase(s, word, 0)) return s.trim();
  return null;
}

/** Automatic harvest: missed Complete-the-Words gaps and missed vocabulary questions join the deck. */
export function harvestAttempt(db: DB, userId: string, ex: Exercise, result: ScoreResult): AddedWord[] {
  const bank = bankFor(db);
  const out: AddedWord[] = [];
  const add = (word: string, origin: CardOrigin, texts: string[]) => {
    const w = cleanWord(word);
    if (!w || FUNCTION_WORDS.has(w)) return;
    if (w.length < 4 && !resolveWord(bank, w)) return;
    const added = addWord(db, userId, { word: w, sentence: sentenceWith(texts, w), exerciseId: ex.id, origin });
    if (added) out.push(added);
  };
  if (ex.task_type === "complete_the_words") {
    for (const it of result.items) if (it.correct === false && it.expected) add(it.expected, "harvest_ctw", [ex.passage]);
  } else if ("questions" in ex) {
    const texts = exerciseTexts({ ...ex, questions: undefined });
    for (const q of ex.questions) {
      if (!("skill" in q) || q.skill !== "vocabulary" || !q.highlight) continue;
      if (result.items.find((it) => it.key === q.id)?.correct === false) add(q.highlight, "harvest_question", texts);
    }
  }
  return out;
}

// ---------------------------------------------------------------- queue

function dayStart(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function newPerDay(db: DB, userId: string): number {
  const r = db.prepare("SELECT vocab_new_per_day n FROM users WHERE id = ?").get(userId) as { n: number | null } | undefined;
  return r?.n ?? P.new_per_day_default;
}

function userTargetBand(db: DB, userId: string): number {
  return (db.prepare("SELECT target_band t FROM users WHERE id = ?").get(userId) as { t: number } | undefined)?.t ?? CONFIG.internal.default_target_band;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Bank entries in introduction order for a target band (stable; mixed across categories inside a rank). */
export function introductionOrder(bank: Bank, target: number): VocabEntry[] {
  return [...bank.entries].sort((a, b) => introductionRank(a, target) - introductionRank(b, target) || hash(a.id) - hash(b.id) || a.id.localeCompare(b.id));
}

export interface DeckSummary {
  due: number;
  new_left: number;
  new_per_day: number;
  introduced_today: number;
  reviewed_today: number;
  learned: number;
  next_due_at: string | null;
}

export function deckSummary(db: DB, userId: string, now = new Date()): DeckSummary {
  const bank = bankFor(db);
  const iso = now.toISOString();
  const start = dayStart(now);
  const c = db
    .prepare(
      `SELECT COALESCE(SUM(review_count > 0 AND due_at <= ?), 0) due, COALESCE(SUM(introduced_at >= ?), 0) today, COALESCE(SUM(review_count = 0), 0) queued,
         COALESCE(SUM(entry_id IS NOT NULL), 0) bank_cards, COALESCE(SUM(review_count > 0), 0) learned, MIN(CASE WHEN review_count > 0 AND due_at > ? THEN due_at END) next_due
       FROM vocab_cards WHERE user_id = ?`,
    )
    .get(iso, start, iso, userId) as { due: number; today: number; queued: number; bank_cards: number; learned: number; next_due: string | null };
  const reviewed = (db.prepare("SELECT COUNT(*) n FROM vocab_reviews WHERE user_id = ? AND created_at >= ?").get(userId, start) as { n: number }).n;
  const perDay = newPerDay(db, userId);
  const available = c.queued + Math.max(0, bank.entries.length - c.bank_cards);
  return { due: c.due, new_left: Math.min(Math.max(0, perDay - c.today), available), new_per_day: perDay, introduced_today: c.today, reviewed_today: reviewed, learned: c.learned, next_due_at: c.next_due };
}

function studyable(bank: Bank, card: CardRow): Studyable {
  const entry = card.entry_id ? bank.byId.get(card.entry_id) : null;
  if (entry) return entry;
  return { id: card.id, headword: card.headword, kind: /\s/.test(card.headword) ? "collocation" : "word", example_academic: card.source_sentence ?? undefined, personal: true };
}

function cardState(card: CardRow) {
  return { ...card, recognition_passed: !!card.recognition_passed };
}

export function cardView(card: CardRow, now = new Date()) {
  return {
    id: card.id,
    entry_id: card.entry_id,
    personal: !card.entry_id,
    origin: card.origin,
    status: cardStatus(card, P) as CardStatus,
    due: card.review_count > 0 && (card.due_at ?? "") <= now.toISOString(),
    due_at: card.due_at,
    interval_days: card.interval_days,
    ease: card.ease,
    lapses: card.lapses,
    review_count: card.review_count,
    source_sentence: card.source_sentence,
    source_exercise_id: card.source_exercise_id,
  };
}

/** Next card of the daily session: due reviews first, then new words up to the daily limit. */
export function nextCard(db: DB, userId: string, opts: { audio: boolean }, now = new Date()) {
  const bank = bankFor(db);
  const iso = now.toISOString();
  let card = db.prepare("SELECT * FROM vocab_cards WHERE user_id = ? AND review_count > 0 AND due_at <= ? ORDER BY due_at, id LIMIT 1").get(userId, iso) as CardRow | undefined;
  let phase: "review" | "new" = "review";
  const summary = deckSummary(db, userId, now);
  if (!card && summary.new_left > 0) {
    phase = "new";
    // Words the user added or missed come before the scheduled introduction order.
    card = db.prepare("SELECT * FROM vocab_cards WHERE user_id = ? AND review_count = 0 ORDER BY (origin = 'scheduled'), created_at, id LIMIT 1").get(userId) as CardRow | undefined;
    if (!card) {
      const have = new Set((db.prepare("SELECT entry_id FROM vocab_cards WHERE user_id = ? AND entry_id IS NOT NULL").all(userId) as Array<{ entry_id: string }>).map((r) => r.entry_id));
      const next = introductionOrder(bank, userTargetBand(db, userId)).find((e) => !have.has(e.id));
      if (next) card = insertCard(db, userId, { entryId: next.id, headword: next.headword, origin: "scheduled" });
    }
  }
  if (!card) {
    // Nothing else to do: bring back a card missed a few minutes ago now rather than ending the session
    // (never the one answered last, so the same question is not repeated immediately).
    const ahead = new Date(now.getTime() + P.relearn_minutes * 60000).toISOString();
    card = db
      .prepare(
        `SELECT * FROM vocab_cards WHERE user_id = ? AND review_count > 0 AND interval_days = 0 AND due_at <= ?
           AND id != COALESCE((SELECT id FROM vocab_cards WHERE user_id = ? ORDER BY last_reviewed_at DESC LIMIT 1), '') ORDER BY due_at, id LIMIT 1`,
      )
      .get(userId, ahead, userId) as CardRow | undefined;
    phase = "review";
  }
  if (!card) return { card: null, question: null, summary };
  const e = studyable(bank, card);
  const format = chooseFormat(cardState(card), availableFormats(e, opts), P);
  const q = buildQuestion(e, format, String(card.review_count), bank.entries);
  return {
    card: { ...cardView(card, now), phase, tier: "tier" in e ? e.tier : "personal", cefr: "cefr" in e ? e.cefr : null },
    seed: card.review_count,
    question: publicQuestion(q),
    audio_entry_id: q.format === "dictation" && card.entry_id ? card.entry_id : null,
    summary,
  };
}

export function submitReview(db: DB, userId: string, r: { cardId: string; format: string; seed: number; choice?: number | null; text?: string | null; elapsedMs?: number }, now = new Date()) {
  const bank = bankFor(db);
  const card = getCard(db, r.cardId);
  if (!card || card.user_id !== userId) throw new VocabError(404, "Unknown card");
  if (r.seed !== card.review_count) throw new VocabError(409, "This card was already answered; load the next one.");
  const e = studyable(bank, card);
  if (!(FORMATS as readonly string[]).includes(r.format) || !availableFormats(e, { audio: true }).includes(r.format as Format)) throw new VocabError(400, "Format not available for this card");
  const format = r.format as Format;
  const q = buildQuestion(e, format, String(card.review_count), bank.entries);
  const checked = checkAnswer(q, { choice: r.choice, text: r.text });
  const elapsed = Math.max(0, Math.round(r.elapsedMs ?? 0));
  const quality = q.input === "none" ? 4 : qualityFor({ correct: checked.correct, nearMiss: checked.nearMiss, elapsedMs: elapsed || Number.MAX_SAFE_INTEGER, typed: q.input === "typed" }, P);
  const s = schedule(card, quality, now, P);
  const iso = now.toISOString();
  const wasPassed = !!card.recognition_passed;
  const passes = !wasPassed && checked.correct;
  db.transaction(() => {
    db.prepare(
      `UPDATE vocab_cards SET reps = ?, lapses = ?, ease = ?, interval_days = ?, due_at = ?, review_count = review_count + 1, recognition_passed = ?,
         practice_count = practice_count + ?, production_count = production_count + ?, introduced_at = COALESCE(introduced_at, ?), last_reviewed_at = ? WHERE id = ?`,
    ).run(s.reps, s.lapses, s.ease, s.interval_days, s.due_at, wasPassed || passes ? 1 : 0, wasPassed ? 1 : 0, wasPassed && isProduction(format) ? 1 : 0, iso, iso, card.id);
    db.prepare(
      `INSERT INTO vocab_reviews (user_id, card_id, entry_id, format, production, first_exposure, correct, quality, error_tag, response, expected, elapsed_ms, interval_before, interval_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(userId, card.id, card.entry_id, format, isProduction(format) ? 1 : 0, card.review_count === 0 ? 1 : 0, checked.correct ? 1 : 0, quality, checked.errorTag, checked.given, checked.expected, elapsed || null, card.interval_days, s.interval_days, iso);
  })();
  const updated = getCard(db, card.id)!;
  return {
    correct: checked.correct,
    near_miss: checked.nearMiss,
    expected: checked.expected,
    given: checked.given,
    error_tag: checked.errorTag,
    quality,
    format,
    card: cardView(updated, now),
    entry: card.entry_id ? (bank.byId.get(card.entry_id) ?? null) : null,
    headword: card.headword,
    summary: deckSummary(db, userId, now),
  };
}

// ---------------------------------------------------------------- bank browsing

export interface BankRow {
  id: string;
  card_id: string | null;
  headword: string;
  kind: string;
  pos: string | null;
  cefr: string | null;
  tier: string;
  category: string | null;
  definition: string | null;
  translation_fr: string | null;
  status: CardStatus;
  in_deck: boolean;
  due: boolean;
}

export function listBank(db: DB, userId: string, f: { tier?: string; cefr?: string; category?: string; status?: string; q?: string } = {}, now = new Date()): BankRow[] {
  const bank = bankFor(db);
  const cards = db.prepare("SELECT * FROM vocab_cards WHERE user_id = ?").all(userId) as CardRow[];
  const byEntry = new Map(cards.filter((c) => c.entry_id).map((c) => [c.entry_id!, c]));
  const iso = now.toISOString();
  const rows: BankRow[] = bank.entries.map((e) => {
    const c = byEntry.get(e.id);
    return { id: e.id, card_id: c?.id ?? null, headword: e.headword, kind: e.kind, pos: e.pos, cefr: e.cefr, tier: e.tier, category: e.category, definition: e.definition, translation_fr: e.translation_fr, status: c ? cardStatus(c, P) : "new", in_deck: !!c, due: !!c && c.review_count > 0 && (c.due_at ?? "") <= iso };
  });
  for (const c of cards.filter((c) => !c.entry_id))
    rows.push({ id: c.id, card_id: c.id, headword: c.headword, kind: "personal", pos: null, cefr: null, tier: "personal", category: null, definition: c.source_sentence, translation_fr: null, status: cardStatus(c, P), in_deck: true, due: c.review_count > 0 && (c.due_at ?? "") <= iso });
  const q = f.q?.trim().toLowerCase();
  return rows
    .filter((r) => (!f.tier || r.tier === f.tier) && (!f.cefr || r.cefr === f.cefr) && (!f.category || r.category === f.category))
    .filter((r) => !f.status || (f.status === "due" ? r.due : f.status === "in_deck" ? r.in_deck : r.status === f.status))
    .filter((r) => !q || r.headword.toLowerCase().includes(q) || (r.translation_fr ?? "").toLowerCase().includes(q) || (r.definition ?? "").toLowerCase().includes(q))
    .sort((a, b) => a.headword.localeCompare(b.headword));
}

// ---------------------------------------------------------------- statistics

export function deckStats(db: DB, userId: string, now = new Date()) {
  const bank = bankFor(db);
  const cards = db.prepare("SELECT * FROM vocab_cards WHERE user_id = ?").all(userId) as CardRow[];
  const blank = () => ({ new: 0, learning: 0, mature: 0, total: 0 });
  const byTier: Record<string, ReturnType<typeof blank>> = { core: blank(), extended: blank(), mastery: blank(), personal: blank() };
  const byEntry = new Map(cards.filter((c) => c.entry_id).map((c) => [c.entry_id!, c]));
  for (const e of bank.entries) {
    const c = byEntry.get(e.id);
    const t = byTier[e.tier]!;
    t[c ? cardStatus(c, P) : "new"]++;
    t.total++;
  }
  for (const c of cards.filter((c) => !c.entry_id)) {
    byTier.personal![cardStatus(c, P)]++;
    byTier.personal!.total++;
  }
  const byStatus = blank();
  for (const t of Object.values(byTier)) for (const k of ["new", "learning", "mature", "total"] as const) byStatus[k] += t[k];

  const since = new Date(now.getTime() - P.retention_window_days * 86400000).toISOString();
  const reviews = db.prepare("SELECT card_id, production, first_exposure, correct, error_tag, created_at FROM vocab_reviews WHERE user_id = ? AND created_at >= ? ORDER BY created_at").all(userId, since) as Array<{
    card_id: string;
    production: number;
    first_exposure: number;
    correct: number;
    error_tag: string | null;
    created_at: string;
  }>;
  const retained = reviews.filter((r) => !r.first_exposure);
  const fails = new Map<string, { n: number; tag: string | null }>();
  for (const r of reviews) if (!r.correct) fails.set(r.card_id, { n: (fails.get(r.card_id)?.n ?? 0) + 1, tag: r.error_tag });
  const byDay = new Map<string, { date: string; reviews: number; correct: number }>();
  for (const r of reviews) {
    const date = r.created_at.slice(0, 10);
    const d = byDay.get(date) ?? { date, reviews: 0, correct: 0 };
    d.reviews++;
    d.correct += r.correct;
    byDay.set(date, d);
  }
  const failing = cards
    .map((c) => ({ card_id: c.id, entry_id: c.entry_id, headword: c.headword, lapses: c.lapses, recent_fails: fails.get(c.id)?.n ?? 0, last_error_tag: fails.get(c.id)?.tag ?? null, status: cardStatus(c, P) }))
    .filter((c) => c.lapses >= P.leech_lapses || c.recent_fails >= P.leech_lapses)
    .sort((a, b) => b.lapses + b.recent_fails - (a.lapses + a.recent_fails) || a.headword.localeCompare(b.headword))
    .slice(0, 30);
  const challenges = (db.prepare("SELECT COUNT(*) n FROM vocab_challenges WHERE user_id = ? AND created_at >= ?").get(userId, since) as { n: number }).n;
  return {
    by_tier: byTier,
    by_status: byStatus,
    window_days: P.retention_window_days,
    retention: { reviews: retained.length, correct: retained.filter((r) => r.correct).length, rate: retained.length ? retained.filter((r) => r.correct).length / retained.length : null },
    production_share: retained.length ? retained.filter((r) => r.production).length / retained.length : null,
    reviews_by_day: [...byDay.values()],
    failing,
    leech_threshold: P.leech_lapses,
    challenges,
    summary: deckSummary(db, userId, now),
  };
}

/** Review errors in the shape the error profile needs (typed answers share the Complete-the-Words classes). */
export function vocabErrorStats(db: DB, userId: string, since: string) {
  const rows = db.prepare("SELECT format, production, correct, error_tag, created_at FROM vocab_reviews WHERE user_id = ? AND created_at >= ?").all(userId, since) as Array<{
    format: string;
    production: number;
    correct: number;
    error_tag: string | null;
    created_at: string;
  }>;
  const errors = new Map<string, { n: number; last: string; opportunities: number }>();
  const typed = rows.filter((r) => r.production).length;
  const perFormat = new Map<string, number>();
  for (const r of rows) perFormat.set(r.format, (perFormat.get(r.format) ?? 0) + 1);
  for (const r of rows) {
    if (r.correct || !r.error_tag) continue;
    const e = errors.get(r.error_tag) ?? { n: 0, last: r.created_at, opportunities: r.production ? typed : (perFormat.get(r.format) ?? 0) };
    e.n++;
    if (r.created_at > e.last) e.last = r.created_at;
    errors.set(r.error_tag, e);
  }
  return errors;
}

// ---------------------------------------------------------------- production challenge

export function challengeWords(db: DB, userId: string, now = new Date()) {
  const bank = bankFor(db);
  const cards = db.prepare("SELECT * FROM vocab_cards WHERE user_id = ? AND last_reviewed_at >= ? ORDER BY (entry_id IS NULL), interval_days, last_reviewed_at DESC LIMIT ?").all(userId, dayStart(now), P.challenge_words) as CardRow[];
  return cards.map((c) => {
    const e = c.entry_id ? bank.byId.get(c.entry_id) : null;
    return { card_id: c.id, entry_id: c.entry_id, headword: c.headword, definition: e?.definition ?? null, translation_fr: e?.translation_fr ?? null };
  });
}

export function wordPresent(bank: Bank, card: CardRow, text: string): boolean {
  const e = card.entry_id ? bank.byId.get(card.entry_id) : null;
  if (!e) return containsPhrase(text, card.headword, 0);
  const gap = gapFor(e.kind);
  return containsPhrase(text, e.headword, gap, e.inflections) || e.inflections.some((f) => containsPhrase(text, f, gap));
}

export interface ChallengeRow {
  id: string;
  user_id: string;
  mode: string;
  words_json: string;
  text: string;
  text_source: string;
  feedback_json: string | null;
  feedback_error: string | null;
  self_rating: number | null;
  created_at: string;
}

export function createChallenge(db: DB, userId: string, c: { cardIds: string[]; mode: "spoken" | "written"; text: string; textSource: "typed" | "server_stt" | "browser" | "none" }): ChallengeRow {
  const bank = bankFor(db);
  const text = c.text.trim();
  const words = c.cardIds.map((id) => {
    const card = getCard(db, id);
    if (!card || card.user_id !== userId) throw new VocabError(404, "Unknown card");
    // Without a transcript nothing can be verified: presence stays unknown and the user self-evaluates.
    return { card_id: card.id, headword: card.headword, present: text ? wordPresent(bank, card, text) : null };
  });
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO vocab_challenges (id, user_id, mode, words_json, text, text_source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, userId, c.mode, JSON.stringify(words), text, text ? c.textSource : "none", nowIso());
  return db.prepare("SELECT * FROM vocab_challenges WHERE id = ?").get(id) as ChallengeRow;
}
