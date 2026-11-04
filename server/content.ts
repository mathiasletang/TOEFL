import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./env";
import type { DB } from "./db";
import { nowIso } from "./db";
import { ContentFileSchema, exerciseB, itemCount, type Exercise, type McqQuestion } from "../shared/schema";
import { validateExercises, type ValidationReport } from "../shared/validate";
import { deriveCtw } from "../shared/ctw";

export const CONTENT_DIR = path.join(ROOT, "content", "exercises");

export interface LoadedContent extends ValidationReport {
  packs: Array<{ id: string; description: string; copyright_policy: string; file: string; ids: string[] }>;
  fileErrors: string[];
}

export function readContent(dir = CONTENT_DIR): LoadedContent {
  const fileErrors: string[] = [];
  const raw: Array<{ data: unknown; file: string }> = [];
  const packs: LoadedContent["packs"] = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
  for (const f of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch (e) {
      fileErrors.push(`${f}: invalid JSON (${(e as Error).message})`);
      continue;
    }
    const file = ContentFileSchema.safeParse(parsed);
    if (!file.success) {
      fileErrors.push(`${f}: ${file.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      continue;
    }
    const ids: string[] = [];
    for (const ex of file.data.exercises) {
      raw.push({ data: ex, file: f });
      ids.push((ex as { id?: string }).id ?? "?");
    }
    packs.push({ ...file.data.pack, file: f, ids });
  }
  const report = validateExercises(raw);
  return { ...report, exercises: report.exercises.map(canonicalize), packs, fileErrors };
}

// ---- Deterministic option shuffling (removes author answer-position bias) ----
function seededRandom(seed: string): () => number {
  let h = crypto.createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleWithAnswer(options: string[], answer: number, seed: string): { options: string[]; answer_index: number } {
  const rnd = seededRandom(seed);
  const idx = options.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return { options: idx.map((i) => options[i]!), answer_index: idx.indexOf(answer) };
}

function shuffleQ(q: McqQuestion, seed: string): McqQuestion {
  // Keep author order when options are meant to be read in order ("None of …" etc.).
  if (q.options.some((o) => /^(none|all) of/i.test(o))) return q;
  return { ...q, ...shuffleWithAnswer(q.options, q.answer_index, seed) };
}

export function canonicalize(ex: Exercise): Exercise {
  switch (ex.task_type) {
    case "listen_choose_response":
      return { ...ex, ...shuffleWithAnswer(ex.options, ex.answer_index, ex.id) };
    case "read_in_daily_life":
    case "read_academic_passage":
    case "conversation":
    case "announcement":
    case "academic_talk":
      return { ...ex, questions: ex.questions.map((q) => shuffleQ(q, `${ex.id}:${q.id}`)) } as Exercise;
    default:
      return ex;
  }
}

interface ItemRow {
  item_key: string;
  kind: string;
  prompt: string | null;
  answer: unknown;
  accepted: unknown;
  skill: string | null;
  b: number;
}

export function deriveItems(ex: Exercise): ItemRow[] {
  const b = exerciseB(ex);
  switch (ex.task_type) {
    case "complete_the_words":
      return deriveCtw(ex.passage).gaps.map((g, i) => ({ item_key: `gap${i + 1}`, kind: "gap", prompt: g.visible, answer: g.full, accepted: null, skill: "complete_the_words", b }));
    case "listen_choose_response":
      return [{ item_key: "q1", kind: "mcq", prompt: ex.audio[0]!.text, answer: ex.answer_index, accepted: null, skill: ex.skill, b }];
    case "build_a_sentence":
      return [{ item_key: "sentence", kind: "ordering", prompt: ex.context, answer: ex.answer, accepted: ex.alternatives, skill: ex.pattern, b }];
    case "listen_and_repeat":
      return ex.items.map((it) => ({ item_key: `item${it.index}`, kind: "repeat", prompt: null, answer: it.text, accepted: null, skill: "listen_and_repeat", b }));
    case "take_an_interview":
      return ex.questions.map((q) => ({ item_key: `q${q.index}`, kind: "interview", prompt: q.prompt, answer: null, accepted: null, skill: q.level, b }));
    case "write_an_email":
    case "academic_discussion":
      return [{ item_key: "response", kind: "essay", prompt: null, answer: null, accepted: null, skill: ex.task_type, b }];
    default:
      return ex.questions.map((q) => ({ item_key: q.id, kind: "mcq", prompt: q.stem, answer: q.answer_index, accepted: null, skill: q.skill, b: q.b ?? b }));
  }
}

/** Sync validated content into SQLite. Invalid exercises are never imported. */
export function syncContent(db: DB, loaded: LoadedContent = readContent()): LoadedContent {
  const now = nowIso();
  const valid = new Set(loaded.exercises.map((e) => e.id));
  const packOf = new Map<string, string>();
  for (const p of loaded.packs) for (const id of p.ids) packOf.set(id, p.id);

  const upPack = db.prepare(
    `INSERT INTO content_packs (id, description, copyright_policy, file, loaded_at) VALUES (@id, @description, @copyright_policy, @file, @loaded_at)
     ON CONFLICT(id) DO UPDATE SET description=excluded.description, copyright_policy=excluded.copyright_policy, file=excluded.file, loaded_at=excluded.loaded_at`,
  );
  const upEx = db.prepare(
    `INSERT INTO exercises (id, pack_id, section, task_type, difficulty, b, source_type, source_reference, item_count, content_json, content_hash, tags_json, active, updated_at)
     VALUES (@id, @pack_id, @section, @task_type, @difficulty, @b, @source_type, @source_reference, @item_count, @content_json, @content_hash, @tags_json, 1, @updated_at)
     ON CONFLICT(id) DO UPDATE SET pack_id=excluded.pack_id, section=excluded.section, task_type=excluded.task_type, difficulty=excluded.difficulty, b=excluded.b,
       source_type=excluded.source_type, source_reference=excluded.source_reference, item_count=excluded.item_count, content_json=excluded.content_json,
       content_hash=excluded.content_hash, tags_json=excluded.tags_json, active=1, updated_at=excluded.updated_at`,
  );
  const delItems = db.prepare("DELETE FROM exercise_items WHERE exercise_id = ?");
  const insItem = db.prepare(
    "INSERT INTO exercise_items (exercise_id, item_key, position, kind, prompt, answer_json, accepted_json, skill, b) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );

  db.transaction(() => {
    for (const p of loaded.packs) upPack.run({ id: p.id, description: p.description, copyright_policy: p.copyright_policy, file: p.file, loaded_at: now });
    for (const ex of loaded.exercises) {
      const content_json = JSON.stringify(ex);
      upEx.run({
        id: ex.id,
        pack_id: packOf.get(ex.id)!,
        section: ex.section,
        task_type: ex.task_type,
        difficulty: ex.difficulty,
        b: exerciseB(ex),
        source_type: ex.source_type,
        source_reference: ex.source_reference ?? null,
        item_count: itemCount(ex),
        content_json,
        content_hash: crypto.createHash("sha256").update(content_json).digest("hex"),
        tags_json: JSON.stringify(ex.tags ?? []),
        updated_at: now,
      });
      delItems.run(ex.id);
      deriveItems(ex).forEach((it, i) =>
        insItem.run(ex.id, it.item_key, i, it.kind, it.prompt, JSON.stringify(it.answer), it.accepted == null ? null : JSON.stringify(it.accepted), it.skill, it.b),
      );
    }
    // Exercises removed from content (or now invalid) are deactivated, never deleted (history stays intact).
    const all = db.prepare("SELECT id FROM exercises WHERE active = 1").all() as Array<{ id: string }>;
    const deact = db.prepare("UPDATE exercises SET active = 0, updated_at = ? WHERE id = ?");
    for (const r of all) if (!valid.has(r.id)) deact.run(now, r.id);
  })();
  return loaded;
}

export function getExercise(db: DB, id: string): Exercise | null {
  const row = db.prepare("SELECT content_json FROM exercises WHERE id = ?").get(id) as { content_json: string } | undefined;
  return row ? (JSON.parse(row.content_json) as Exercise) : null;
}

export function listExercises(db: DB, opts: { taskType?: string; activeOnly?: boolean } = {}): Exercise[] {
  const rows = db
    .prepare(`SELECT content_json FROM exercises WHERE (? IS NULL OR task_type = ?) ${opts.activeOnly === false ? "" : "AND active = 1"} ORDER BY id`)
    .all(opts.taskType ?? null, opts.taskType ?? null) as Array<{ content_json: string }>;
  return rows.map((r) => JSON.parse(r.content_json) as Exercise);
}
