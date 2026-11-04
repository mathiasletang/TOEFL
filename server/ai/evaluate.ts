import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";
import { z } from "zod";
import type { DB } from "../db";
import { nowIso } from "../db";
import type { Env } from "../env";
import { getAttempt, rescoreAttempt, type AttemptRecord } from "../attempts";
import { getExercise } from "../content";
import { userTarget, snapshot } from "../analytics";
import { countWords } from "../../shared/ctw";
import type { InterviewResponse, TextResponse } from "../../shared/scoring";
import { emailSystemPrompt, discussionSystemPrompt, interviewSystemPrompt } from "./prompts";

const score = z.number().int().min(0).max(5);
const ErrorItem = z.object({
  span: z.string(),
  category: z.enum(["grammar", "word_choice", "word_form", "collocation", "mechanics", "register", "development", "other"]),
  explanation: z.string(),
  correction: z.string(),
});

export const EmailEvalSchema = z.object({
  task: z.literal("write_an_email"),
  rubric_score_0_5: score,
  confidence_0_1: z.number().min(0).max(1),
  criterion_scores: z.object({
    communicative_purpose: score,
    elaboration: score,
    syntax_vocabulary: score,
    social_conventions: score,
    language_control: score,
  }),
  missing_requirements: z.array(z.string()),
  errors: z.array(ErrorItem),
  highest_impact_fix: z.string(),
  target_rewrite: z.string(),
  rewrite_notes: z.array(z.string()),
});

export const DiscussionEvalSchema = z.object({
  task: z.literal("academic_discussion"),
  rubric_score_0_5: score,
  confidence_0_1: z.number().min(0).max(1),
  word_count: z.number().int().min(0),
  position_detected: z.string(),
  criterion_scores: z.object({
    relevance: score,
    argument_development: score,
    cohesion: score,
    syntax: score,
    vocabulary: score,
    accuracy: score,
  }),
  errors: z.array(ErrorItem),
  underdeveloped_claims: z.array(z.string()),
  highest_impact_fix: z.string(),
  target_rewrite: z.string(),
  rewrite_notes: z.array(z.string()),
});

export const InterviewEvalSchema = z.object({
  task: z.literal("take_an_interview"),
  rubric_score_0_5: score,
  confidence_0_1: z.number().min(0).max(1),
  criterion_scores: z.object({
    relevance_elaboration: score,
    fluency: score,
    pronunciation_intelligibility: score.nullable(),
    prosody: score.nullable(),
    grammar: score,
    vocabulary: score,
  }),
  errors: z.array(ErrorItem),
  content_gaps: z.array(z.string()),
  highest_impact_fix: z.string(),
  target_model_answer: z.string(),
});

/** JSON schema for the API: strip numeric bounds (validated locally with Zod instead). */
export function apiSchema(schema: z.ZodType): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        if (["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "$schema"].includes(k)) continue;
        out[k] = strip(v);
      }
      return out;
    }
    return node;
  };
  return strip(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export interface LlmCaller {
  (args: { system: string; user: string; schema: Record<string, unknown> }): Promise<string>;
}

export class ProviderUnavailable extends Error {}

export function anthropicCaller(env: Env): LlmCaller {
  if (env.llm.provider !== "anthropic" || !env.llm.apiKey) throw new ProviderUnavailable("No LLM provider configured (set ANTHROPIC_API_KEY in .env).");
  const client = new Anthropic({ apiKey: env.llm.apiKey, timeout: env.llm.timeoutMs, maxRetries: 2 });
  return async ({ system, user, schema }) => {
    const res = await client.beta.messages.create({
      model: env.llm.model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: env.llm.effort, format: { type: "json_schema", schema } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (res.stop_reason === "refusal") throw new Error("The model declined to evaluate this response.");
    if (res.stop_reason === "max_tokens") throw new Error("Evaluation output was truncated (max_tokens).");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return text;
  };
}

function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON object in model output");
    return JSON.parse(m[0]);
  }
}

interface EvalJob {
  itemKey: string;
  system: string;
  user: string;
  schema: z.ZodType;
}

function buildJobs(db: DB, attempt: AttemptRecord, lang: "en" | "fr", target: number): EvalJob[] {
  const ex = getExercise(db, attempt.exercise_id);
  if (!ex) throw new Error("exercise not found");
  if (ex.task_type === "write_an_email") {
    const text = (attempt.response as TextResponse | null)?.text ?? "";
    return [
      {
        itemKey: "response",
        system: emailSystemPrompt(lang, target),
        schema: EmailEvalSchema,
        user: [
          `SCENARIO:\n${ex.scenario}`,
          `RECIPIENT: ${ex.recipient_name} (${ex.recipient_role})`,
          `SUBJECT: ${ex.subject}`,
          `REQUIREMENTS:\n${ex.requirements.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
          `TIME LIMIT: 7 minutes. Words written: ${countWords(text)}.`,
          `RESPONSE:\n"""\n${text}\n"""`,
        ].join("\n\n"),
      },
    ];
  }
  if (ex.task_type === "academic_discussion") {
    const text = (attempt.response as TextResponse | null)?.text ?? "";
    return [
      {
        itemKey: "response",
        system: discussionSystemPrompt(lang, target),
        schema: DiscussionEvalSchema,
        user: [
          `COURSE: ${ex.course}`,
          `PROFESSOR (${ex.professor.name}):\n${ex.professor.prompt}`,
          ...ex.students.map((s) => `STUDENT POST (${s.name}):\n${s.text}`),
          `TIME LIMIT: 10 minutes. ETS notes an effective response contains at least 100 words. Words written: ${countWords(text)}.`,
          `RESPONSE:\n"""\n${text}\n"""`,
        ].join("\n\n"),
      },
    ];
  }
  if (ex.task_type === "take_an_interview") {
    const r = (attempt.response ?? { items: [] }) as InterviewResponse;
    return ex.questions.flatMap((q) => {
      const it = r.items?.find((x) => x.index === q.index);
      if (!it?.transcript) return [];
      const secs = (it.durationMs ?? 0) / 1000;
      const words = countWords(it.transcript);
      return [
        {
          itemKey: `q${q.index}`,
          system: interviewSystemPrompt(lang, target),
          schema: InterviewEvalSchema,
          user: [
            `SCENARIO: ${ex.scenario}`,
            `QUESTION ${q.index} (${q.level.replace(/_/g, " ")}):\n${q.prompt}`,
            `RESPONSE WINDOW: ${ex.response_seconds} s, no preparation time.`,
            `RECORDED DURATION: ${secs ? secs.toFixed(1) + " s" : "unknown"}; words: ${words}; words per minute: ${secs > 3 ? Math.round((words / secs) * 60) : "unknown"}.`,
            `ASR CONFIDENCE (0–1, acoustic proxy): ${it.asrConfidence != null ? it.asrConfidence.toFixed(2) : "not available"}.`,
            `TRANSCRIPT SOURCE: ${it.transcriptSource ?? "unknown"}.`,
            `TRANSCRIPT:\n"""\n${it.transcript}\n"""`,
          ].join("\n\n"),
        },
      ];
    });
  }
  throw new Error(`AI evaluation is not used for ${ex.task_type}`);
}

export interface EvaluateOutcome {
  status: "ok" | "partial" | "unavailable" | "error";
  message?: string;
  evaluations: Array<{ item_key: string; status: string; error?: string | null }>;
  attempt: AttemptRecord;
}

export async function evaluateAttempt(db: DB, env: Env, attemptId: string, caller?: LlmCaller): Promise<EvaluateOutcome> {
  const attempt = getAttempt(db, attemptId);
  if (!attempt) throw new Error("attempt not found");
  let call: LlmCaller;
  try {
    call = caller ?? anthropicCaller(env);
  } catch (e) {
    if (e instanceof ProviderUnavailable) return { status: "unavailable", message: e.message, evaluations: [], attempt };
    throw e;
  }
  const { target } = userTarget(db, attempt.user_id);
  const jobs = buildJobs(db, attempt, env.llm.language, target);
  if (!jobs.length)
    return { status: "unavailable", message: "Nothing to evaluate: no transcript is available for these answers yet.", evaluations: [], attempt };

  const ins = db.prepare(
    "INSERT INTO ai_evaluations (id, user_id, attempt_id, item_key, task_type, provider, model, status, rubric_score, confidence, result_json, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const provider = caller ? "custom" : env.llm.provider;
  const outcomes = await Promise.all(
    jobs.map(async (job) => {
      let status = "ok";
      let error: string | null = null;
      let parsed = null as { rubric_score_0_5: number; confidence_0_1: number } | null;
      let raw: string | null = null;
      try {
        raw = await call({ system: job.system, user: job.user, schema: apiSchema(job.schema) });
        const v = job.schema.safeParse(extractJson(raw));
        if (!v.success) {
          status = "invalid_output";
          error = `Model output failed schema validation: ${v.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
        } else parsed = v.data as { rubric_score_0_5: number; confidence_0_1: number };
      } catch (e) {
        status = "provider_error";
        error = e instanceof Anthropic.APIError ? `API ${e.status ?? ""}: ${e.message}` : (e as Error).message;
      }
      ins.run(
        crypto.randomUUID(),
        attempt.user_id,
        attempt.id,
        job.itemKey,
        attempt.task_type,
        provider,
        env.llm.model,
        status,
        parsed?.rubric_score_0_5 ?? null,
        parsed?.confidence_0_1 ?? null,
        parsed ? JSON.stringify(parsed) : raw && status === "invalid_output" ? JSON.stringify({ raw: raw.slice(0, 4000) }) : null,
        error,
        nowIso(),
      );
      return { item_key: job.itemKey, status, error };
    }),
  );
  const okCount = outcomes.filter((o) => o.status === "ok").length;
  const updated = okCount ? rescoreAttempt(db, attempt.id) : attempt;
  if (okCount) snapshot(db, attempt.user_id, "ai_evaluation");
  return {
    status: okCount === outcomes.length ? "ok" : okCount ? "partial" : "error",
    message: okCount === outcomes.length ? undefined : outcomes.find((o) => o.error)?.error ?? undefined,
    evaluations: outcomes,
    attempt: updated,
  };
}
