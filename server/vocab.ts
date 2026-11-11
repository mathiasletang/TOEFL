/** Loads content/vocab/*.json, validates it and syncs it into SQLite. Invalid entries are never imported. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "./env";
import type { DB } from "./db";
import { nowIso } from "./db";
import { VocabFileSchema, validateVocab, type VocabCategory, type VocabEntry, type VocabReport } from "../shared/vocab";

export const VOCAB_DIR = path.join(ROOT, "content", "vocab");

export interface LoadedVocab extends VocabReport {
  packs: Array<{ id: string; category: VocabCategory; description: string; selection_note: string; copyright_policy: string; file: string; ids: string[] }>;
  fileErrors: string[];
}

export function readVocab(dir = VOCAB_DIR): LoadedVocab {
  const fileErrors: string[] = [];
  const raw: Array<{ data: unknown; file: string; category: VocabCategory }> = [];
  const packs: LoadedVocab["packs"] = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
  const packIds = new Set<string>();
  const categories = new Set<string>();
  for (const f of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch (e) {
      fileErrors.push(`${f}: invalid JSON (${(e as Error).message})`);
      continue;
    }
    const file = VocabFileSchema.safeParse(parsed);
    if (!file.success) {
      fileErrors.push(`${f}: ${file.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      continue;
    }
    const p = file.data.pack;
    if (packIds.has(p.id)) fileErrors.push(`${f}: duplicate pack id ${p.id}`);
    if (categories.has(p.category)) fileErrors.push(`${f}: a pack for category ${p.category} already exists (one pack per category)`);
    if (/\bofficial\b/i.test(p.selection_note) && !/\bnot\b[^.]*\bofficial\b/i.test(p.selection_note)) fileErrors.push(`${f}: selection_note must not present the pack as an official list`);
    packIds.add(p.id);
    categories.add(p.category);
    const ids: string[] = [];
    for (const e of file.data.entries) {
      raw.push({ data: e, file: f, category: p.category });
      ids.push((e as { id?: string }).id ?? "?");
    }
    packs.push({ ...p, file: f, ids });
  }
  return { ...validateVocab(raw), packs, fileErrors };
}

export function syncVocab(db: DB, loaded: LoadedVocab = readVocab()): LoadedVocab {
  const now = nowIso();
  const packOf = new Map<string, string>();
  for (const p of loaded.packs) for (const id of p.ids) packOf.set(id, p.id);
  const upPack = db.prepare(
    `INSERT INTO vocab_packs (id, category, description, selection_note, copyright_policy, file, loaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET category=excluded.category, description=excluded.description, selection_note=excluded.selection_note,
       copyright_policy=excluded.copyright_policy, file=excluded.file, loaded_at=excluded.loaded_at`,
  );
  const upEntry = db.prepare(
    `INSERT INTO vocab_entries (id, pack_id, headword, kind, pos, cefr, tier, category, function, register, has_false_friend, has_spelling_trap, content_json, content_hash, active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET pack_id=excluded.pack_id, headword=excluded.headword, kind=excluded.kind, pos=excluded.pos, cefr=excluded.cefr, tier=excluded.tier,
       category=excluded.category, function=excluded.function, register=excluded.register, has_false_friend=excluded.has_false_friend,
       has_spelling_trap=excluded.has_spelling_trap, content_json=excluded.content_json, content_hash=excluded.content_hash, active=1, updated_at=excluded.updated_at`,
  );
  db.transaction(() => {
    for (const p of loaded.packs) upPack.run(p.id, p.category, p.description, p.selection_note, p.copyright_policy, p.file, now);
    const valid = new Set<string>();
    for (const e of loaded.entries) {
      valid.add(e.id);
      const json = JSON.stringify(e);
      upEntry.run(e.id, packOf.get(e.id)!, e.headword, e.kind, e.pos, e.cefr, e.tier, e.category, e.function ?? null, e.register, e.false_friend_fr ? 1 : 0, e.spelling_trap ? 1 : 0, json, crypto.createHash("sha256").update(json).digest("hex"), now);
    }
    // Entries removed from the files (or now invalid) are deactivated, never deleted.
    const deact = db.prepare("UPDATE vocab_entries SET active = 0, updated_at = ? WHERE id = ?");
    for (const r of db.prepare("SELECT id FROM vocab_entries WHERE active = 1").all() as Array<{ id: string }>) if (!valid.has(r.id)) deact.run(now, r.id);
  })();
  return loaded;
}

export function getVocabEntry(db: DB, id: string): VocabEntry | null {
  const row = db.prepare("SELECT content_json FROM vocab_entries WHERE id = ? AND active = 1").get(id) as { content_json: string } | undefined;
  return row ? (JSON.parse(row.content_json) as VocabEntry) : null;
}

export function listVocab(db: DB, filter: { tier?: string; category?: string; cefr?: string } = {}): VocabEntry[] {
  const rows = db
    .prepare("SELECT content_json FROM vocab_entries WHERE active = 1 AND (? IS NULL OR tier = ?) AND (? IS NULL OR category = ?) AND (? IS NULL OR cefr = ?) ORDER BY id")
    .all(filter.tier ?? null, filter.tier ?? null, filter.category ?? null, filter.category ?? null, filter.cefr ?? null, filter.cefr ?? null) as Array<{ content_json: string }>;
  return rows.map((r) => JSON.parse(r.content_json) as VocabEntry);
}
