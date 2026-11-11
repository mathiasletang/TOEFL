/** HTTP routes of the Vocabulary module (bank browsing, daily session, statistics, production challenge). */
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { DB } from "./db";
import { json } from "./db";
import type { Env } from "./env";
import { getExercise } from "./content";
import { anthropicCaller, apiSchema, ProviderUnavailable, type LlmCaller } from "./ai/evaluate";
import { pickVoice, sttAvailable, transcribe, ttsAvailable, ttsFile } from "./speech";
import { CONFIG } from "../shared/config";
import { TASK_LABEL } from "../shared/schema";
import { ERROR_TAG_LABELS } from "../shared/errors";
import { VOCAB_CATEGORY_LABEL } from "../shared/vocab";
import { FORMAT_LABEL } from "../shared/vocabSrs";
import {
  VocabError,
  addWord,
  bankFor,
  cardView,
  challengeWords,
  createChallenge,
  deckStats,
  deckSummary,
  exerciseIndex,
  getCard,
  listBank,
  nextCard,
  submitReview,
  type ChallengeRow,
} from "./vocabDeck";

const P = CONFIG.internal.vocabulary.srs;

export const ChallengeFeedbackSchema = z.object({
  words: z.array(z.object({ headword: z.string(), used: z.boolean(), meaning_correct: z.boolean(), natural: z.boolean(), comment: z.string() })),
  overall_comment: z.string(),
  improved_version: z.string(),
});

function challengePrompt(lang: "en" | "fr"): string {
  return [
    "You give feedback on a short vocabulary production exercise for an advanced learner of English (French speaker) preparing for the TOEFL iBT.",
    "The learner had to use each target word or expression in a short spoken answer (transcribed, so ignore punctuation and transcription noise) or in two written sentences.",
    "For every target word say whether it was used, whether the meaning fits, and whether the use is natural (collocation, grammar pattern, register). Keep each comment to one or two sentences.",
    "Then give one overall comment and an improved version of the learner's text that keeps their ideas and uses every target word correctly.",
    "Do not give a score. This is training feedback, not an official assessment.",
    `Write comments in ${lang === "fr" ? "French" : "English"}; the improved version is always in English.`,
    "Return only JSON matching the schema.",
  ].join("\n");
}

export interface VocabRouteContext {
  db: DB;
  env: Env;
  llmCaller?: LlmCaller;
  /** Throws a 404 for unknown users. */
  requireUser: (id: string) => { id: string; target_band: number };
  exerciseTitle: (exerciseId: string) => string | null;
  sendFile: (reply: FastifyReply, file: string, mime: string) => unknown;
}

export function registerVocabRoutes(app: FastifyInstance, ctx: VocabRouteContext): void {
  const { db, env } = ctx;
  const parse = <T>(schema: z.ZodType<T>, data: unknown): T => {
    const r = schema.safeParse(data);
    if (!r.success) throw Object.assign(new VocabError(400, "Invalid request"), { details: r.error.issues });
    return r.data;
  };
  const llmConfigured = () => !!ctx.llmCaller || (env.llm.provider === "anthropic" && !!env.llm.apiKey);

  const challengeView = (c: ChallengeRow) => ({
    id: c.id,
    mode: c.mode,
    text: c.text,
    text_source: c.text_source,
    words: json<Array<{ card_id: string; headword: string; present: boolean | null }>>(c.words_json, []),
    feedback: json<z.infer<typeof ChallengeFeedbackSchema> | null>(c.feedback_json, null),
    feedback_error: c.feedback_error,
    ai_configured: llmConfigured(),
    self_rating: c.self_rating,
    created_at: c.created_at,
  });

  app.get("/api/vocab/meta", async () => ({
    tiers: CONFIG.internal.vocabulary.tiers,
    categories: VOCAB_CATEGORY_LABEL,
    formats: FORMAT_LABEL,
    new_per_day_default: P.new_per_day_default,
    new_per_day_options: P.new_per_day_options,
    mature_interval_days: P.mature_interval_days,
    production_share_min: P.production_share_min,
    challenge: { words: P.challenge_words, seconds: P.challenge_seconds },
    note: "Scheduling, tiers and CEFR levels are internal training conventions of this app, not ETS material.",
  }));

  // ------------------------------------------------------------- bank
  app.get<{ Params: { id: string }; Querystring: { tier?: string; cefr?: string; category?: string; status?: string; q?: string } }>("/api/users/:id/vocab/entries", async (req) => {
    ctx.requireUser(req.params.id);
    const q = req.query;
    const rows = listBank(db, req.params.id, { tier: q.tier || undefined, cefr: q.cefr || undefined, category: q.category || undefined, status: q.status || undefined, q: q.q || undefined });
    return { total: rows.length, entries: rows };
  });

  app.get<{ Params: { id: string; entryId: string } }>("/api/users/:id/vocab/entries/:entryId", async (req) => {
    ctx.requireUser(req.params.id);
    const bank = bankFor(db);
    const entry = bank.byId.get(req.params.entryId);
    if (entry) {
      const card = db.prepare("SELECT id FROM vocab_cards WHERE user_id = ? AND entry_id = ?").get(req.params.id, entry.id) as { id: string } | undefined;
      const exercises = (exerciseIndex(db).get(entry.id) ?? []).flatMap((id) => {
        const ex = getExercise(db, id);
        return ex ? [{ id, task_type: ex.task_type, task_label: TASK_LABEL[ex.task_type], title: ctx.exerciseTitle(id) ?? id }] : [];
      });
      return { entry, personal: null, card: card ? cardView(getCard(db, card.id)!) : null, exercises, audio: ttsAvailable(env) ? "tts" : "browser" };
    }
    const card = getCard(db, req.params.entryId);
    if (!card || card.user_id !== req.params.id || card.entry_id) throw new VocabError(404, "Unknown vocabulary entry");
    const src = card.source_exercise_id ? getExercise(db, card.source_exercise_id) : null;
    return {
      entry: null,
      personal: { headword: card.headword, source_sentence: card.source_sentence },
      card: cardView(card),
      exercises: src ? [{ id: src.id, task_type: src.task_type, task_label: TASK_LABEL[src.task_type], title: ctx.exerciseTitle(src.id) ?? src.id }] : [],
      audio: "browser",
    };
  });

  app.get<{ Params: { entryId: string; key: string } }>("/api/vocab/audio/:entryId/:key", async (req, reply) => {
    const entry = bankFor(db).byId.get(req.params.entryId);
    const text = entry ? { headword: entry.headword, academic: entry.example_academic, spoken: entry.example_spoken }[req.params.key] : undefined;
    if (!text) throw new VocabError(404, "Unknown audio");
    if (!ttsAvailable(env)) throw new VocabError(404, "No TTS provider; use the browser fallback.");
    const f = await ttsFile(env, db, { exerciseId: entry!.id, key: req.params.key, text, voice: pickVoice(env, "neutral", 0) });
    return ctx.sendFile(reply, f.path, f.mime);
  });

  app.post<{ Params: { id: string } }>("/api/users/:id/vocab/cards", async (req) => {
    ctx.requireUser(req.params.id);
    const body = parse(
      z.object({ entryId: z.string().optional(), word: z.string().trim().min(1).max(80).optional(), sentence: z.string().max(2000).nullable().optional(), exerciseId: z.string().nullable().optional() }).refine((b) => b.entryId || b.word, "entryId or word is required"),
      req.body,
    );
    const added = addWord(db, req.params.id, { entryId: body.entryId, word: body.word, sentence: body.sentence, exerciseId: body.exerciseId, origin: "manual" });
    if (!added) throw new VocabError(400, "Nothing to add: select a word.");
    return { created: added.created, matched: added.matched, headword: added.card.headword, card: cardView(added.card), summary: deckSummary(db, req.params.id) };
  });

  // ------------------------------------------------------------- session
  app.get<{ Params: { id: string } }>("/api/users/:id/vocab/summary", async (req) => {
    ctx.requireUser(req.params.id);
    return deckSummary(db, req.params.id);
  });

  app.post<{ Params: { id: string }; Querystring: { audio?: string } }>("/api/users/:id/vocab/next", async (req) => {
    ctx.requireUser(req.params.id);
    const n = nextCard(db, req.params.id, { audio: req.query.audio !== "0" || ttsAvailable(env) });
    return { ...n, audio_url: n.card && n.audio_entry_id && ttsAvailable(env) ? `/api/vocab/audio/${n.audio_entry_id}/headword` : null };
  });

  app.post<{ Params: { id: string } }>("/api/users/:id/vocab/reviews", async (req) => {
    ctx.requireUser(req.params.id);
    const body = parse(
      z.object({ cardId: z.string(), format: z.string(), seed: z.number().int().min(0), choice: z.number().int().min(0).max(3).nullable().optional(), text: z.string().max(200).nullable().optional(), elapsedMs: z.number().min(0).optional() }),
      req.body,
    );
    const r = submitReview(db, req.params.id, body);
    return { ...r, error_label: r.error_tag ? (ERROR_TAG_LABELS[r.error_tag] ?? r.error_tag) : null };
  });

  app.get<{ Params: { id: string } }>("/api/users/:id/vocab/stats", async (req) => {
    ctx.requireUser(req.params.id);
    const s = deckStats(db, req.params.id);
    return { ...s, failing: s.failing.map((f) => ({ ...f, last_error_label: f.last_error_tag ? (ERROR_TAG_LABELS[f.last_error_tag] ?? f.last_error_tag) : null })) };
  });

  // ------------------------------------------------------------- production challenge
  app.get<{ Params: { id: string } }>("/api/users/:id/vocab/challenge", async (req) => {
    ctx.requireUser(req.params.id);
    return { words: challengeWords(db, req.params.id), seconds: P.challenge_seconds, ai_configured: llmConfigured(), stt_configured: sttAvailable(env) };
  });

  /** Server speech-to-text for the spoken challenge. The audio is transcribed and not stored. */
  app.post<{ Params: { id: string } }>("/api/users/:id/vocab/challenge/transcribe", async (req) => {
    ctx.requireUser(req.params.id);
    if (!sttAvailable(env)) throw new VocabError(409, "Speech-to-text is not configured.");
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw new VocabError(400, "Empty audio body");
    const t = await transcribe(env, buf, (req.headers["content-type"] ?? "audio/webm").split(";")[0]!);
    return { transcript: t.text };
  });

  app.post<{ Params: { id: string } }>("/api/users/:id/vocab/challenge", async (req) => {
    ctx.requireUser(req.params.id);
    const body = parse(
      z.object({ cardIds: z.array(z.string()).min(1).max(5), mode: z.enum(["spoken", "written"]), text: z.string().max(4000), textSource: z.enum(["typed", "server_stt", "browser", "none"]) }),
      req.body,
    );
    const row = createChallenge(db, req.params.id, body);
    if (row.text) {
      let caller: LlmCaller | null = ctx.llmCaller ?? null;
      if (!caller) {
        try {
          caller = anthropicCaller(env);
        } catch (e) {
          if (!(e instanceof ProviderUnavailable)) throw e;
        }
      }
      if (caller) {
        const words = json<Array<{ headword: string }>>(row.words_json, []);
        try {
          const raw = await caller({
            system: challengePrompt(env.llm.language),
            schema: apiSchema(ChallengeFeedbackSchema),
            user: [`TARGET WORDS: ${words.map((w) => w.headword).join("; ")}`, `MODE: ${row.mode === "spoken" ? "spoken answer (automatic transcript)" : "two written sentences"}`, `LEARNER TEXT:\n"""\n${row.text}\n"""`].join("\n\n"),
          });
          const m = raw.trim().match(/\{[\s\S]*\}/);
          const fb = ChallengeFeedbackSchema.parse(JSON.parse(m ? m[0] : raw));
          db.prepare("UPDATE vocab_challenges SET feedback_json = ? WHERE id = ?").run(JSON.stringify(fb), row.id);
        } catch (e) {
          // A failed or invalid evaluation is recorded as such; nothing is invented.
          db.prepare("UPDATE vocab_challenges SET feedback_error = ? WHERE id = ?").run((e as Error).message.slice(0, 500), row.id);
        }
      }
    }
    return challengeView(db.prepare("SELECT * FROM vocab_challenges WHERE id = ?").get(row.id) as ChallengeRow);
  });

  app.post<{ Params: { id: string } }>("/api/vocab/challenges/:id/self-rate", async (req) => {
    const body = parse(z.object({ rating: z.number().int().min(1).max(5) }), req.body);
    const row = db.prepare("SELECT * FROM vocab_challenges WHERE id = ?").get(req.params.id) as ChallengeRow | undefined;
    if (!row) throw new VocabError(404, "Unknown challenge");
    db.prepare("UPDATE vocab_challenges SET self_rating = ? WHERE id = ?").run(body.rating, row.id);
    return challengeView({ ...row, self_rating: body.rating });
  });
}
