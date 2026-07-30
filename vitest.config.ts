import { defineConfig } from "vitest/config";

// Pure seams only (normalize, evaluate, dataset split) — no DOM needed.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
