import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env";
import { ERROR_TAG_LABELS } from "../shared/errors";
import { CONFIG } from "../shared/config";

export type DB = Database.Database;

export const USERS = [
  { id: "User_1", display_name: "User_1" },
  { id: "Mathias", display_name: "Mathias" },
] as const;

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seedReference(db);
  return db;
}

export function migrate(db: DB): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const dir = path.join(ROOT, "server", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(db.prepare("SELECT name FROM schema_migrations").all().map((r) => (r as { name: string }).name));
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(f, new Date().toISOString());
    })();
  }
}

function seedReference(db: DB): void {
  const insUser = db.prepare("INSERT OR IGNORE INTO users (id, display_name, target_band) VALUES (?, ?, ?)");
  for (const u of USERS) insUser.run(u.id, u.display_name, CONFIG.internal.default_target_band);
  const insErr = db.prepare("INSERT OR REPLACE INTO error_categories (id, label) VALUES (?, ?)");
  for (const [id, label] of Object.entries(ERROR_TAG_LABELS)) insErr.run(id, label);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function json<T>(s: string | null | undefined, fallback: T): T {
  if (s == null) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
