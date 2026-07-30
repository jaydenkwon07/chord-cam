// JSON export/import for the dataset, so a hand-recorded dataset can be backed
// up and reloaded. Kept pure (string in/out) and validated so a malformed file
// fails loudly instead of poisoning the eval.

import type { Sample } from "./dataset.ts";

export interface DatasetFile {
  version: 1;
  samples: Sample[];
}

export function serializeDataset(samples: Sample[]): string {
  const file: DatasetFile = { version: 1, samples };
  return JSON.stringify(file, null, 2);
}

function isSample(v: unknown): v is Sample {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.chord === "string" &&
    typeof s.takeId === "string" &&
    typeof s.timestamp === "number" &&
    Array.isArray(s.vector) &&
    s.vector.every((n) => typeof n === "number")
  );
}

export function deserializeDataset(json: string): Sample[] {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Not a chord-cam dataset file.");
  }
  const samples = (parsed as Record<string, unknown>).samples;
  if (!Array.isArray(samples)) {
    throw new Error("Dataset file has no `samples` array.");
  }
  if (!samples.every(isSample)) {
    throw new Error("Dataset file contains a malformed sample.");
  }
  return samples as Sample[];
}
