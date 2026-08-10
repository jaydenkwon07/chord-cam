// Offline eval harness: measure the KNN baseline on a held-out TAKE split.
//
//   npm run eval -- <dataset.json> [k] [testTakesPerChord]
//
// Reuses the exact pure seams the live app uses (normalize is already baked into
// the stored vectors), so this number is honest, not a separate code path.

import { readFileSync } from "node:fs";
import { deserializeDataset } from "../src/lib/serialize.ts";
import { chooseTestTakes, splitByTake } from "../src/lib/dataset.ts";
import { createKnnClassifier } from "../src/lib/knn.ts";
import { evaluate } from "../src/lib/evaluate.ts";

const path = process.argv[2];
const k = Number(process.argv[3] ?? 5);
const testPerChord = Number(process.argv[4] ?? 3);

if (!path) {
  console.error("usage: npm run eval -- <dataset.json> [k] [testTakesPerChord]");
  process.exit(1);
}

const samples = deserializeDataset(readFileSync(path, "utf8"));
const labels = [...new Set(samples.map((s) => s.chord))].sort();

const testTakes = chooseTestTakes(samples, testPerChord);
const { train, test } = splitByTake(samples, testTakes);

const knn = createKnnClassifier(train, k);
const preds = test.map((s) => knn.classify(s.vector).label);
const truths = test.map((s) => s.chord);
const m = evaluate(preds, truths, labels);

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

console.log(`\nchord-cam · KNN eval  (k=${k}, held-out ${testPerChord} takes/chord)`);
console.log(`labels: ${labels.join(", ")}`);
console.log(`train samples: ${train.length}  |  test samples: ${test.length}`);
console.log(`held-out takes: ${[...testTakes].sort().join(", ")}`);

console.log(`\nOverall accuracy: ${pct(m.overallAccuracy)}\n`);

console.log("Per-chord accuracy:");
for (const label of labels) {
  const s = m.perChord[label];
  console.log(`  ${label.padEnd(3)}  ${pct(s.accuracy).padStart(6)}  (${s.correct}/${s.total})`);
}

console.log("\nConfusion matrix (rows = truth, cols = prediction):");
const header = "      " + labels.map((l) => l.padStart(6)).join("");
console.log(header);
for (const t of labels) {
  const row = labels.map((p) => String(m.confusion[t][p]).padStart(6)).join("");
  console.log(`  ${t.padEnd(3)} ${row}`);
}

// Watched confusers. On a *clean* dataset the irreducible overlap is the compact
// three-finger family — C, Dm, Am, D — whose centroids sit ~0.9 apart (the
// tightest in the matrix). They differ mainly by which string/fret set the same
// diagonal shape occupies, and normalize() (wrist origin + hand-size scale)
// deletes exactly that absolute position. Recovering it needs phase-2 fretboard
// geometry, not a KNN tweak.
//
// NB: E↔Am, once assumed shape-degenerate ("E is the Am shape shifted across
// strings"), turned out to be a data artifact — a few mislabelled/misfretted
// takes drove it. On cleaned data E and Am separate fine, so it's dropped here.
console.log("\nWatched confusers:");
for (const [a, b] of [["C", "Dm"], ["Dm", "Am"], ["D", "Dm"]] as const) {
  if (m.confusion[a] && m.confusion[b]) {
    const ab = m.confusion[a][b] ?? 0;
    const ba = m.confusion[b][a] ?? 0;
    console.log(`  ${a}<->${b}:  ${a} read as ${b} ${ab}x,  ${b} read as ${a} ${ba}x`);
  } else {
    console.log(`  ${a}<->${b}:  not both in vocabulary — skipped`);
  }
}
console.log();
