// classify_chord — the classifier seam. A plain KNN over the captured pose
// vectors: no training step, honest baseline, easy to reason about. Kept behind
// the `Classifier` interface so a small MLP can replace it if the eval demands
// one — don't reach for that preemptively (CLAUDE.md).

export interface Prediction {
  label: string;
  confidence: number;
}

export interface Classifier {
  classify(vector: number[]): Prediction;
}

interface LabeledVector {
  chord: string;
  vector: number[];
}

function squaredDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

export function createKnnClassifier(
  train: readonly LabeledVector[],
  k: number,
): Classifier {
  return {
    classify(vector: number[]): Prediction {
      if (train.length === 0) return { label: "?", confidence: 0 };

      const ranked = train
        .map((t) => ({ label: t.chord, d: squaredDistance(vector, t.vector) }))
        .sort((a, b) => a.d - b.d);

      const kk = Math.min(k, ranked.length);
      const neighbours = ranked.slice(0, kk);

      const counts = new Map<string, number>();
      for (const n of neighbours) {
        counts.set(n.label, (counts.get(n.label) ?? 0) + 1);
      }
      const maxCount = Math.max(...counts.values());

      // Tie-break toward the nearest neighbour: first label (in distance order)
      // that reaches the winning count.
      let label = "?";
      for (const n of neighbours) {
        if (counts.get(n.label) === maxCount) {
          label = n.label;
          break;
        }
      }

      return { label, confidence: maxCount / kk };
    },
  };
}
