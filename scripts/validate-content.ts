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

if (failed) {
  console.error("\nContent validation FAILED.");
  process.exit(1);
}
console.log("\nContent validation passed.");
