// Diagnostic: leave-one-take-out for each chord, to see whether a chord's
// failure is uniform (shape overlap) or driven by specific anomalous takes.
import { readFileSync } from "node:fs";
import { deserializeDataset } from "../src/lib/serialize.ts";
import { splitByTake } from "../src/lib/dataset.ts";
import { createKnnClassifier } from "../src/lib/knn.ts";

const path = process.argv[2];
const k = Number(process.argv[3] ?? 5);
const samples = deserializeDataset(readFileSync(path, "utf8"));
const labels = [...new Set(samples.map((s) => s.chord))].sort();

const takesByChord = new Map<string, string[]>();
for (const l of labels) {
  takesByChord.set(l, [
    ...new Set(samples.filter((s) => s.chord === l).map((s) => s.takeId)),
  ]);
}

for (const chord of labels) {
  console.log(`\n=== leave-one-take-out: ${chord} ===`);
  for (const take of takesByChord.get(chord)!) {
    const { train, test } = splitByTake(samples, new Set([take]));
    const knn = createKnnClassifier(train, k);
    const votes = new Map<string, number>();
    for (const s of test) {
      const p = knn.classify(s.vector).label;
      votes.set(p, (votes.get(p) ?? 0) + 1);
    }
    const total = test.length;
    const correct = votes.get(chord) ?? 0;
    const spread = [...votes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([l, n]) => `${l}:${((100 * n) / total).toFixed(0)}%`)
      .join(" ");
    console.log(
      `  ${take.slice(-6)}  n=${String(total).padStart(4)}  acc=${((100 * correct) / total).toFixed(0).padStart(3)}%   ${spread}`,
    );
  }
}
