import { describe, expect, test } from "vitest";
import { createKnnClassifier } from "./knn.ts";

// Two well-separated clusters in a tiny 2-D space (the classifier is
// dimension-agnostic; 63-D pose vectors work the same way).
const train = [
  { chord: "A", vector: [0, 0] },
  { chord: "A", vector: [1, 0] },
  { chord: "A", vector: [0, 1] },
  { chord: "B", vector: [10, 10] },
  { chord: "B", vector: [11, 10] },
  { chord: "B", vector: [10, 11] },
];

describe("createKnnClassifier", () => {
  test("classifies a point inside a cluster with full confidence", () => {
    const knn = createKnnClassifier(train, 3);
    const p = knn.classify([0.2, 0.2]);
    expect(p.label).toBe("A");
    expect(p.confidence).toBe(1); // all 3 neighbours are A
  });

  test("confidence is the winning vote fraction among k neighbours", () => {
    // Place the query so its 3 nearest are A, A, B -> label A, conf 2/3.
    const mixed = [
      { chord: "A", vector: [0, 0] },
      { chord: "A", vector: [0.5, 0] },
      { chord: "B", vector: [1, 0] },
      { chord: "B", vector: [5, 0] },
    ];
    const knn = createKnnClassifier(mixed, 3);
    const p = knn.classify([0.1, 0]);
    expect(p.label).toBe("A");
    expect(p.confidence).toBeCloseTo(2 / 3, 12);
  });

  test("k larger than the training set falls back to using all samples", () => {
    const knn = createKnnClassifier(train, 100);
    // Half A, half B; nearest-tie broken toward the closer cluster.
    const p = knn.classify([0, 0]);
    expect(p.label).toBe("A");
  });
});
