/**
 * Content validator: schema, answer keys, CTW truncation, Build-a-Sentence
 * reconstruction, Listen-and-Repeat progression, timers, duplicate ids,
 * recorded-asset presence, and simulation sufficiency.
 *   npm run validate:content
 */
import fs from "node:fs";
import path from "node:path";
import { readContent, syncContent } from "../server/content";
import { openDb } from "../server/db";
import { sufficiency } from "../server/simulation";
import { ROOT } from "../server/env";
import { TASK_TYPES, TASK_LABEL } from "../shared/schema";
import { readVocab, syncVocab } from "../server/vocab";
import { countVocab, VOCAB_CATEGORIES, VOCAB_CATEGORY_LABEL } from "../shared/vocab";
import { CONFIG } from "../shared/config";

const c = readContent();
let failed = false;
for (const f of c.fileErrors) {
  console.error(`✗ ${f}`);
  failed = true;
}
for (const e of c.errors) {
  console.error(`✗ [${e.file}] ${e.id}: ${e.message}`);
  failed = true;
}
for (const w of c.warnings) console.warn(`! [${w.file}] ${w.id}: ${w.message}`);

// Recorded audio folders must match real exercises and keys.
const audioRoot = path.join(ROOT, "content", "audio");
if (fs.existsSync(audioRoot)) {
  const ids = new Set(c.exercises.map((e) => e.id));
  for (const d of fs.readdirSync(audioRoot)) {
    if (!ids.has(d)) {
      console.error(`✗ content/audio/${d}: no exercise with this id`);
      failed = true;
    }
  }
}

console.log("\nExercises per task type:");
for (const t of TASK_TYPES) console.log(`  ${TASK_LABEL[t].padEnd(36)} ${c.exercises.filter((e) => e.task_type === t).length}`);
console.log(`  ${"TOTAL valid".padEnd(36)} ${c.exercises.length}  (invalid: ${c.errors.length}, warnings: ${c.warnings.length})`);

const db = openDb(":memory:");
syncContent(db, c);
console.log("\nSimulation sufficiency (disjoint forms the bank can supply):");
for (const [k, v] of Object.entries(sufficiency(db))) console.log(`  ${k.padEnd(18)} ${String(v.forms).padStart(2)} form(s)${v.blocker && v.forms === 0 ? `  — blocked by: ${v.blocker}` : ""}`);

// ---------------------------------------------------------------- vocabulary bank
const v = readVocab();
for (const f of v.fileErrors) {
  console.error(`✗ [vocab] ${f}`);
  failed = true;
}
for (const e of v.errors) {
  console.error(`✗ [vocab/${e.file}] ${e.id}: ${e.message}`);
  failed = true;
}
const showWarnings = process.argv.includes("--vocab-warnings");
if (showWarnings) for (const w of v.warnings) console.warn(`! [vocab/${w.file}] ${w.id}: ${w.message}`);
syncVocab(db, v);
const stored = (db.prepare("SELECT COUNT(*) c FROM vocab_entries WHERE active = 1").get() as { c: number }).c;
if (stored !== v.entries.length) {
  console.error(`✗ [vocab] ${v.entries.length} valid entries but ${stored} stored in the database`);
  failed = true;
}
const vc = countVocab(v.entries);
const T = CONFIG.internal.vocabulary;
console.log(`\nVocabulary bank (original content; "core" = ${T.tiers.core.label}, an internal high-yield selection — not an official list):`);
console.log(`  ${"category".padEnd(42)} total  core   ext  mast    B2    C1    C2`);
const n = (x: number) => String(x).padStart(5);
for (const cat of VOCAB_CATEGORIES) {
  const r = vc.by_category[cat];
  if (!r) {
    console.error(`✗ [vocab] no entries for category ${cat}`);
    failed = true;
    continue;
  }
  console.log(`  ${VOCAB_CATEGORY_LABEL[cat].padEnd(42)}${n(r.total)} ${n(r.core)} ${n(r.extended)} ${n(r.mastery)} ${n(r.B2)} ${n(r.C1)} ${n(r.C2)}`);
}
console.log(`  ${"TOTAL valid".padEnd(42)}${n(vc.total)} ${n(vc.by_tier.core ?? 0)} ${n(vc.by_tier.extended ?? 0)} ${n(vc.by_tier.mastery ?? 0)} ${n(vc.by_cefr.B2 ?? 0)} ${n(vc.by_cefr.C1 ?? 0)} ${n(vc.by_cefr.C2 ?? 0)}`);
console.log(`  kinds: ${Object.entries(vc.by_kind).map(([k, x]) => `${k} ${x}`).join(" · ")}   (invalid: ${v.errors.length}, warnings: ${v.warnings.length}${showWarnings ? "" : " — list with --vocab-warnings"})`);
for (const [level, share] of Object.entries(T.targets.cefr_share)) {
  const actual = vc.total ? (vc.by_cefr[level] ?? 0) / vc.total : 0;
  if (Math.abs(actual - share) > T.targets.share_tolerance) console.warn(`! [vocab] ${level} share is ${(actual * 100).toFixed(0)}% (internal target ${(share * 100).toFixed(0)}% ± ${(T.targets.share_tolerance * 100).toFixed(0)})`);
}

if (failed) {
  console.error("\nContent validation FAILED.");
  process.exit(1);
}
console.log("\nContent validation passed.");
