import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Rutefilene bruker `@/`-aliaset fra tsconfig. Next løser det selv; vitest gjør det ikke,
  // og uten dette kan testene ikke importere de EKTE handlerne — bare kopier av dem, som er
  // verdiløst når det er nettopp wrapperen man vil teste.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
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
    // Vitest speiler Vites `import.meta.env` (BASE_URL, MODE, DEV, PROD, SSR) inn i
    // `process.env` i testarbeideren — og Vites `BASE_URL` er `base`, altså "/". Det
    // overskrev containerens `BASE_URL=https://…` og ga `MARKED_URL === "/"` («//ikon-512.png»
    // i webhooks-testen). `test.env` legges oppå Vites verdier, så her settes den tilbake til
    // det containeren faktisk har; er den ikke satt, blir den tom og `urler.ts` faller
    // tilbake til localhost — samme oppførsel som i appen.
    env: { BASE_URL: process.env.BASE_URL ?? "" },
  },
});
