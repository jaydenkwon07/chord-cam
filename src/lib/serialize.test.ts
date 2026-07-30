import { describe, expect, test } from "vitest";
import { deserializeDataset, serializeDataset } from "./serialize.ts";
import type { Sample } from "./dataset.ts";

const samples: Sample[] = [
  { chord: "C", takeId: "C-1", vector: [0, 1, 2], timestamp: 10 },
  { chord: "Am", takeId: "Am-1", vector: [3, 4, 5], timestamp: 20 },
];

describe("dataset serialization", () => {
  test("round-trips samples through JSON", () => {
    const restored = deserializeDataset(serializeDataset(samples));
    expect(restored).toEqual(samples);
  });

  test("rejects JSON that is not a dataset", () => {
    expect(() => deserializeDataset('{"nope": true}')).toThrow();
  });

  test("rejects a sample missing required fields", () => {
    const bad = JSON.stringify({ samples: [{ chord: "C" }] });
    expect(() => deserializeDataset(bad)).toThrow();
  });
});
