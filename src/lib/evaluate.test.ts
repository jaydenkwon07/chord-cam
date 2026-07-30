import { describe, expect, test } from "vitest";
import { evaluate } from "./evaluate.ts";

const LABELS = ["C", "G", "D", "Em", "Am"];

describe("evaluate", () => {
  test("perfect predictions score 100% overall and per chord", () => {
    const truths = ["C", "G", "D", "Em", "Am", "C"];
    const m = evaluate(truths, truths, LABELS);
    expect(m.overallAccuracy).toBe(1);
    for (const label of LABELS) {
      if (m.perChord[label].total > 0) {
        expect(m.perChord[label].accuracy).toBe(1);
      }
    }
    // Confusion is purely diagonal.
    expect(m.confusion["C"]["C"]).toBe(2);
    expect(m.confusion["C"]["Am"]).toBe(0);
  });

  test("a dummy always-majority classifier scores the majority fraction", () => {
    // 3x C, 1x G, 1x Am. Majority = C. Predict C for everything.
    const truths = ["C", "C", "C", "G", "Am"];
    const preds = truths.map(() => "C");
    const m = evaluate(preds, truths, LABELS);
    expect(m.overallAccuracy).toBeCloseTo(3 / 5, 12);
    expect(m.perChord["C"].accuracy).toBe(1);
    expect(m.perChord["G"].accuracy).toBe(0);
    expect(m.perChord["Am"].accuracy).toBe(0);
  });

  test("counts off-diagonal confusions by (truth, pred)", () => {
    // Two C's, one misread as Am.
    const truths = ["C", "C", "Em"];
    const preds = ["C", "Am", "Em"];
    const m = evaluate(preds, truths, LABELS);
    expect(m.confusion["C"]["C"]).toBe(1);
    expect(m.confusion["C"]["Am"]).toBe(1);
    expect(m.confusion["Em"]["Em"]).toBe(1);
    expect(m.perChord["C"].correct).toBe(1);
    expect(m.perChord["C"].total).toBe(2);
    expect(m.perChord["C"].accuracy).toBeCloseTo(0.5, 12);
  });

  test("includes every label in the matrix even with zero samples", () => {
    const truths = ["C", "C"];
    const m = evaluate(truths, truths, LABELS);
    expect(Object.keys(m.confusion).sort()).toEqual([...LABELS].sort());
    expect(m.perChord["D"].total).toBe(0);
    expect(m.perChord["D"].accuracy).toBe(0); // no NaN
  });

  test("throws when preds and truths lengths differ", () => {
    expect(() => evaluate(["C"], ["C", "G"], LABELS)).toThrow();
  });
});
