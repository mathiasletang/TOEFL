import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync, StatementSync, SQLInputValue } from "node:sqlite";
import { ROOT } from "./env";
import { ERROR_TAG_LABELS } from "../shared/errors";
import { CONFIG } from "../shared/config";

/*
 * SQLite through Node's built-in `node:sqlite` module (Node ≥ 22.13): no native
 * dependency to compile, so `npm install` works on any Windows/macOS/Linux machine.
 * The small wrapper below exposes the subset of the better-sqlite3 API the app uses.
 */

// node:sqlite prints an "experimental" warning on first load; it is expected and harmless here.
const emit = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === "string" ? warning : warning?.message;
  if (typeof msg === "string" && msg.includes("SQLite is an experimental feature")) return;
  return (emit as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
const { DatabaseSync: Sqlite } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

type Params = unknown[];

function bind(args: Params): SQLInputValue[] {
  // A single plain object = named parameters (@name); otherwise positional.
  return args.map((a) => (a === undefined ? null : (a as SQLInputValue)));
}

export class Statement {
  constructor(private st: StatementSync) {}
  get(...args: Params): unknown {
    return this.st.get(...(bind(args) as [SQLInputValue]));
  }
  all(...args: Params): unknown[] {
    return this.st.all(...(bind(args) as [SQLInputValue]));
  }
  run(...args: Params): { changes: number; lastInsertRowid: number | bigint } {
    const r = this.st.run(...(bind(args) as [SQLInputValue]));
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }
}

export class DB {
  private depth = 0;
  constructor(private raw: DatabaseSync) {}
  prepare(sql: string): Statement {
    return new Statement(this.raw.prepare(sql));
  }
  exec(sql: string): void {
    this.raw.exec(sql);
  }
  pragma(p: string): void {
    this.raw.exec(`PRAGMA ${p}`);
  }
  close(): void {
    this.raw.close();
  }
  /** Same contract as better-sqlite3: returns a function that runs `fn` atomically (nestable via savepoints). */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A) => {
      const sp = `sp${this.depth}`;
      const outer = this.depth === 0;
      this.raw.exec(outer ? "BEGIN" : `SAVEPOINT ${sp}`);
      this.depth++;
      try {
        const r = fn(...args);
        this.depth--;
        this.raw.exec(outer ? "COMMIT" : `RELEASE ${sp}`);
        return r;
      } catch (e) {
        this.depth--;
        this.raw.exec(outer ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      }
    };
  }
}

export const USERS = [
  { id: "User_1", display_name: "User_1" },
  { id: "Mathias", display_name: "Mathias" },
] as const;

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DB(new Sqlite(file));
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
