import { describe, expect, test } from "vitest";
import { smooth } from "./smooth.ts";

describe("smooth", () => {
  test("returns the majority label over the window", () => {
    expect(smooth(["C", "C", "G", "C"])).toBe("C");
  });

  test("ignores a single stray prediction (debounce)", () => {
    expect(smooth(["Am", "Am", "Am", "C", "Am"])).toBe("Am");
  });

  test("ignores no-hand frames (null) rather than blanking the label", () => {
    // Hand dropped out for most of the window but was clearly Em when seen.
    expect(smooth([null, "Em", null, "Em", null])).toBe("Em");
  });

  test("returns null when there is no confident label in the window", () => {
    expect(smooth([null, null, null])).toBeNull();
  });

  test("breaks ties toward the most recent label", () => {
    expect(smooth(["C", "Am"])).toBe("Am");
  });
});
