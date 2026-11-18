/**
 * npm run vocab:stock [-- --user <id>] [-- --db <path>]
 *
 * Stock of the vocabulary bank per profile: entries that are neither marked as known in triage
 * nor learned yet (never reviewed), by tier and by category. Also shows how many of them the
 * profile's introduction order will actually serve (discipline terms may be excluded).
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../server/env";
import { openDb, USERS } from "../server/db";
import { syncVocab, readVocab } from "../server/vocab";
import { bankFor, introductionOrder } from "../server/vocabDeck";
import { VOCAB_CATEGORIES, VOCAB_CATEGORY_LABEL, VOCAB_TIERS } from "../shared/vocab";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const env = loadEnv();
const file = opt("db") ?? path.join(env.dataDir, "toefl.db");
if (!fs.existsSync(file)) console.log(`No database at ${file} yet: every entry is in stock. Start the app once to create it.\n`);
const db = openDb(fs.existsSync(file) ? file : ":memory:");
syncVocab(db, readVocab());
const bank = bankFor(db);
const users = opt("user") ? [opt("user")!] : USERS.map((u) => u.id);

const pad = (s: string | number, n: number) => String(s).padStart(n);
for (const userId of users) {
  const target = (db.prepare("SELECT target_band t FROM users WHERE id = ?").get(userId) as { t: number } | undefined)?.t;
  if (target == null) {
    console.log(`Unknown profile ${userId}`);
    continue;
  }
  const cards = new Map(
    (db.prepare("SELECT entry_id, triage, review_count FROM vocab_cards WHERE user_id = ? AND entry_id IS NOT NULL").all(userId) as Array<{ entry_id: string; triage: string | null; review_count: number }>).map((c) => [c.entry_id, c]),
  );
  const inStock = (id: string) => {
    const c = cards.get(id);
    return !c || (c.review_count === 0 && c.triage !== "known");
  };
  const servable = new Set(introductionOrder(bank, target).map((e) => e.id));
  const known = [...cards.values()].filter((c) => c.triage === "known" && c.review_count === 0).length;
  const learned = [...cards.values()].filter((c) => c.review_count > 0).length;

  console.log(`\n${userId} (target ${target.toFixed(1)}) — stock = entries neither known nor learned`);
  console.log(`  ${"category".padEnd(42)}${VOCAB_TIERS.map((t) => pad(t, 10)).join("")}${pad("total", 8)}${pad("served", 8)}`);
  const totals: Record<string, number> = { core: 0, extended: 0, mastery: 0 };
  let total = 0;
  let served = 0;
  for (const cat of VOCAB_CATEGORIES) {
    const entries = bank.entries.filter((e) => e.category === cat && inStock(e.id));
    if (!entries.length) continue;
    const row = VOCAB_TIERS.map((t) => entries.filter((e) => e.tier === t).length);
    const s = entries.filter((e) => servable.has(e.id)).length;
    VOCAB_TIERS.forEach((t, i) => (totals[t]! += row[i]!));
    total += entries.length;
    served += s;
    console.log(`  ${VOCAB_CATEGORY_LABEL[cat].padEnd(42)}${row.map((n) => pad(n, 10)).join("")}${pad(entries.length, 8)}${pad(s, 8)}`);
  }
  console.log(`  ${"TOTAL".padEnd(42)}${VOCAB_TIERS.map((t) => pad(totals[t]!, 10)).join("")}${pad(total, 8)}${pad(served, 8)}`);
  console.log(`  known (triage): ${known} · learned or in review: ${learned} · "served" = in the introduction order for this target (discipline terms excluded at 6.0, harvested from errors only)`);
}
db.close();
