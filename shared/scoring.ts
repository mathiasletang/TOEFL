import { deriveCtw, isCtwGapCorrect } from "./ctw";
import { classifyCtwError } from "./errors";
import { repeatMetrics, repeatRubricProxy, type RepeatProxyConfig, type RepeatMetrics } from "./align";
import { exerciseB, type Exercise, type QuestionSkill } from "./schema";

export interface ItemResult {
  key: string;
  correct: boolean | null; // null = not objectively scorable (yet)
  score: number | null;
  max: number;
  response: string | null;
  expected: string | null;
  skill: string | null;
  b: number;
  errorTag: string | null;
  elapsedMs?: number | null;
  detail?: unknown;
}

export interface ScoreResult {
  raw: number | null;
  max: number;
  accuracy: number | null;
  items: ItemResult[];
  errorTags: string[];
  /** True when part of the score needs AI evaluation or a transcript. */
  pending: boolean;
  notes: string[];
}

export type CtwResponse = { gaps: string[]; gapMs?: (number | null)[] };
export type McqResponse = { answers: (number | null)[]; questionMs?: (number | null)[] };
export type ChoiceResponse = { answer: number | null };
export type BuildResponse = { order: (string | null)[] };
export type RepeatItemResponse = {
  index: number;
  recordingId?: string | null;
  transcript?: string | null;
  transcriptSource?: "server_stt" | "browser" | "typed_self_report" | null;
  asrConfidence?: number | null;
  selfRating?: number | null;
  durationMs?: number | null;
  interrupted?: boolean;
};
export type RepeatResponse = { items: RepeatItemResponse[] };
export type InterviewResponse = { items: RepeatItemResponse[] };
export type TextResponse = { text: string };

export type AnyResponse =
  | CtwResponse
  | McqResponse
  | ChoiceResponse
  | BuildResponse
  | RepeatResponse
  | InterviewResponse
  | TextResponse;

function skillTag(skill: QuestionSkill | undefined | null): string | null {
  return skill ?? null;
}

export function sentenceFromOrder(frame: (string | null)[], order: (string | null)[]): string {
  let k = 0;
  const parts: string[] = [];
  for (const f of frame) {
    if (f === null) {
      const c = order[k++];
      parts.push(c ?? "___");
    } else parts.push(f);
  }
  return parts
    .join(" ")
    .replace(/\s+([.,?!;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreExercise(
  ex: Exercise,
  response: unknown,
  opts: { repeatProxy: RepeatProxyConfig },
): ScoreResult {
  const b = exerciseB(ex);
  switch (ex.task_type) {
    case "complete_the_words": {
      const r = (response ?? { gaps: [] }) as CtwResponse;
      const d = deriveCtw(ex.passage);
      const items: ItemResult[] = d.gaps.map((g, i) => {
        const typed = (r.gaps?.[i] ?? "").trim();
        const correct = isCtwGapCorrect(g, typed);
        return {
          key: `gap${i + 1}`,
          correct,
          score: correct ? 1 : 0,
          max: 1,
          response: g.visible + typed,
          expected: g.full,
          skill: "complete_the_words",
          b,
          errorTag: correct ? null : classifyCtwError(g.full, g.visible + typed === g.visible ? "" : g.visible + typed),
          elapsedMs: r.gapMs?.[i] ?? null,
        };
      });
      return finalize(items, []);
    }
    case "read_in_daily_life":
    case "read_academic_passage":
    case "conversation":
    case "announcement":
    case "academic_talk": {
      const r = (response ?? { answers: [] }) as McqResponse;
      const items: ItemResult[] = ex.questions.map((q, i) => {
        const a = r.answers?.[i] ?? null;
        const correct = a === q.answer_index;
        return {
          key: q.id,
          correct,
          score: correct ? 1 : 0,
          max: 1,
          response: a == null ? null : (q.options[a] ?? null),
          expected: q.options[q.answer_index] ?? null,
          skill: q.skill,
          b: q.b ?? b,
          errorTag: correct ? null : skillTag(q.skill),
          elapsedMs: r.questionMs?.[i] ?? null,
        };
      });
      return finalize(items, []);
    }
    case "listen_choose_response": {
      const r = (response ?? { answer: null }) as ChoiceResponse;
      const correct = r.answer === ex.answer_index;
      return finalize(
        [
          {
            key: "q1",
            correct,
            score: correct ? 1 : 0,
            max: 1,
            response: r.answer == null ? null : (ex.options[r.answer] ?? null),
            expected: ex.options[ex.answer_index] ?? null,
            skill: ex.skill,
            b,
            errorTag: correct ? null : ex.skill,
          },
        ],
        [],
      );
    }
    case "build_a_sentence": {
      const r = (response ?? { order: [] }) as BuildResponse;
      const order = ex.answer.map((_, i) => r.order?.[i] ?? null);
      const accepted = [ex.answer, ...ex.alternatives];
      const correct = accepted.some((acc) => acc.every((c, i) => c === order[i]));
      return finalize(
        [
          {
            key: "sentence",
            correct,
            score: correct ? 1 : 0,
            max: 1,
            response: sentenceFromOrder(ex.frame, order),
            expected: ex.full_response,
            skill: ex.pattern,
            b,
            errorTag: correct ? null : ex.pattern,
          },
        ],
        [],
      );
    }
    case "listen_and_repeat": {
      const r = (response ?? { items: [] }) as RepeatResponse;
      const notes: string[] = [];
      const tags = new Set<string>();
      const items: ItemResult[] = ex.items.map((it) => {
        const resp = r.items?.find((x) => x.index === it.index);
        const transcript = resp?.transcript ?? null;
        if (transcript != null && resp?.transcriptSource !== "typed_self_report") {
          const metrics = repeatMetrics(it.text, transcript);
          const proxy = repeatRubricProxy(metrics, resp?.asrConfidence ?? null, opts.repeatProxy);
          const tag = repeatErrorTag(metrics);
          if (tag) tags.add(tag);
          return {
            key: `item${it.index}`,
            correct: proxy.rubric >= 5,
            score: proxy.rubric,
            max: 5,
            response: transcript,
            expected: it.text,
            skill: "listen_and_repeat",
            b: b + (it.index - 4) * 0.35,
            errorTag: tag,
            detail: { metrics: compactMetrics(metrics), proxy, source: resp?.transcriptSource ?? null },
          };
        }
        if (resp?.selfRating != null) {
          return {
            key: `item${it.index}`,
            correct: resp.selfRating >= 5,
            score: resp.selfRating,
            max: 5,
            response: null,
            expected: it.text,
            skill: "listen_and_repeat",
            b: b + (it.index - 4) * 0.35,
            errorTag: resp.selfRating < 4 ? "repeat_self_rated_low" : null,
            detail: { source: "self_rating" },
          };
        }
        return {
          key: `item${it.index}`,
          correct: null,
          score: null,
          max: 5,
          response: null,
          expected: it.text,
          skill: "listen_and_repeat",
          b: b + (it.index - 4) * 0.35,
          errorTag: null,
          detail: { source: null, interrupted: resp?.interrupted ?? false },
        };
      });
      if (items.some((i) => i.score == null))
        notes.push("Some items have no transcript yet: configure speech-to-text, use browser recognition, or self-rate.");
      return finalize(items, notes, [...tags]);
    }
    case "take_an_interview": {
      const r = (response ?? { items: [] }) as InterviewResponse;
      const items: ItemResult[] = ex.questions.map((q) => {
        const resp = r.items?.find((x) => x.index === q.index);
        return {
          key: `q${q.index}`,
          correct: null,
          score: resp?.selfRating ?? null,
          max: 5,
          response: resp?.transcript ?? null,
          expected: null,
          skill: "take_an_interview",
          b,
          errorTag: null,
          detail: { source: resp?.selfRating != null ? "self_rating" : null },
        };
      });
      return finalize(items, ["Interview answers are scored by the AI evaluator (or self-rated)."]);
    }
    case "write_an_email":
    case "academic_discussion": {
      const r = (response ?? { text: "" }) as TextResponse;
      return finalize(
        [
          {
            key: "response",
            correct: null,
            score: null,
            max: 5,
            response: r.text ?? "",
            expected: null,
            skill: ex.task_type,
            b,
            errorTag: null,
          },
        ],
        ["Writing responses are scored by the AI evaluator when configured."],
      );
    }
  }
}

function compactMetrics(m: RepeatMetrics) {
  return {
    wer: m.wer,
    cer: m.cer,
    contentRecall: m.contentRecall,
    functionRecall: m.functionRecall,
    orderScore: m.orderScore,
    substitutions: m.substitutions,
    deletions: m.deletions,
    insertions: m.insertions,
    missingWords: m.missingWords,
    insertedWords: m.insertedWords,
    substitutedPairs: m.substitutedPairs,
    ops: m.ops,
  };
}

export function repeatErrorTag(m: RepeatMetrics): string | null {
  if (m.wer === 0) return null;
  if (m.hypWords.length < m.refWords.length * 0.6) return "repeat_truncation";
  if (m.orderScore < 1) return "repeat_word_order";
  if (m.contentRecall < m.functionRecall) return "repeat_missing_content_words";
  if (m.deletions > 0 && m.functionRecall < 1) return "repeat_missing_function_words";
  return "repeat_substitutions";
}

function finalize(items: ItemResult[], notes: string[], extraTags: string[] = []): ScoreResult {
  const scored = items.filter((i) => i.score != null);
  const max = items.reduce((a, i) => a + i.max, 0);
  const pending = scored.length < items.length;
  const raw = scored.length === 0 ? null : scored.reduce((a, i) => a + (i.score ?? 0), 0);
  const scoredMax = scored.reduce((a, i) => a + i.max, 0);
  const accuracy = raw == null || scoredMax === 0 ? null : raw / scoredMax;
  const errorTags = [...new Set([...items.map((i) => i.errorTag).filter((t): t is string => !!t), ...extraTags])];
  return { raw, max, accuracy, items, errorTags, pending, notes };
}
