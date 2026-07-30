// evaluate — the metric, built before any classifier so a model can't be tuned
// against a metric no one trusts (CLAUDE.md: metric-first). Per-chord accuracy
// plus a full confusion matrix over a fixed label set.

export interface ChordScore {
  correct: number;
  total: number;
  accuracy: number;
}

export interface Metrics {
  overallAccuracy: number;
  total: number;
  labels: string[];
  perChord: Record<string, ChordScore>;
  // confusion[truth][pred] = count
  confusion: Record<string, Record<string, number>>;
}

export function evaluate(
  preds: string[],
  truths: string[],
  labels: string[],
): Metrics {
  if (preds.length !== truths.length) {
    throw new Error(
      `evaluate: preds (${preds.length}) and truths (${truths.length}) must be the same length`,
    );
  }

  const confusion: Record<string, Record<string, number>> = {};
  for (const t of labels) {
    confusion[t] = {};
    for (const p of labels) confusion[t][p] = 0;
  }

  let correctTotal = 0;
  for (let i = 0; i < truths.length; i++) {
    const t = truths[i];
    const p = preds[i];
    confusion[t][p] = (confusion[t][p] ?? 0) + 1;
    if (t === p) correctTotal++;
  }

  const perChord: Record<string, ChordScore> = {};
  for (const label of labels) {
    const row = confusion[label];
    const total = Object.values(row).reduce((a, b) => a + b, 0);
    const correct = row[label] ?? 0;
    perChord[label] = {
      correct,
      total,
      accuracy: total === 0 ? 0 : correct / total,
    };
  }

  return {
    overallAccuracy: truths.length === 0 ? 0 : correctTotal / truths.length,
    total: truths.length,
    labels: [...labels],
    perChord,
    confusion,
  };
}
