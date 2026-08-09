import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // RLS-testene deler én database og rydder etter seg med DELETE. Kjører de parallelt,
    // ser de hverandres testdata og «org A ser ikke org B» blir tilfeldig rød. Samme grunn
    // som at v1-suiten er sekvensiell.
    fileParallelism: false,
    sequence: { concurrent: false },
    include: ["tests/**/*.test.ts"],
    // Policyoppsett mot en kald database tar noen sekunder første gang.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
