// Leave-one-take-out cross-validation: every take is the test fold exactly once
// (train = all other takes). A robust, fully take-based accuracy estimate — many
// folds instead of one arbitrary split. Micro-averaged over all test samples.
import { readFileSync } from "node:fs";
import { deserializeDataset } from "../src/lib/serialize.ts";
import { splitByTake } from "../src/lib/dataset.ts";
import { createKnnClassifier } from "../src/lib/knn.ts";
import { evaluate } from "../src/lib/evaluate.ts";

const path = process.argv[2];
const k = Number(process.argv[3] ?? 5);
const samples = deserializeDataset(readFileSync(path, "utf8"));
const labels = [...new Set(samples.map((s) => s.chord))].sort();
const allTakes = [...new Set(samples.map((s) => s.takeId))];

const preds: string[] = [];
const truths: string[] = [];
for (const take of allTakes) {
  const { train, test } = splitByTake(samples, new Set([take]));
  const knn = createKnnClassifier(train, k);
  for (const s of test) {
    preds.push(knn.classify(s.vector).label);
    truths.push(s.chord);
  }
}

const m = evaluate(preds, truths, labels);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

console.log(`\nLeave-one-take-out CV  (k=${k}, ${allTakes.length} folds)`);
console.log(`Overall accuracy: ${pct(m.overallAccuracy)}\n`);
console.log("Per-chord accuracy:");
for (const l of labels) {
  const s = m.perChord[l];
  console.log(`  ${l.padEnd(3)}  ${pct(s.accuracy).padStart(6)}  (${s.correct}/${s.total})`);
}
console.log("\nConfusion (rows=truth, cols=pred):");
console.log("      " + labels.map((l) => l.padStart(6)).join(""));
for (const t of labels) {
  console.log(`  ${t.padEnd(3)} ` + labels.map((p) => String(m.confusion[t][p]).padStart(6)).join(""));
}
console.log();
