/**
 * Bygger designsystem-pakken: én ESM-fil + et .d.ts-tre.
 *
 * Kjøres i Docker (ingen Node på verten):
 *   docker run --rm -v "$PWD:/app" -w /app -u "$(id -u):$(id -g)" node:22-alpine \
 *     node designsystem/build.mjs
 *
 * `react`, `react-dom` og `next/*` holdes eksterne. React kommer fra Claude Designs eget
 * `_vendor/`, og `next/navigation` er bare med fordi `felles.tsx` importerer `OktProvider`
 * i samme fil — ingen av de eksporterte komponentene kaller den. Blir den bundlet inn,
 * drar den med seg halve Next-klienten i en pakke som skal være ren presentasjon.
 */

import { build } from "esbuild";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const her = dirname(fileURLToPath(import.meta.url));
const rot = resolve(her, "..");

/**
 * `OktProvider` erstattes av en stubb. Den er ikke en del av designsystemet — den leser
 * sesjonen fra `/api/meg` — men `felles.tsx` importerer `useOkt` fra den fordi
 * `useOrgData` bor i samme fil. Uten stubben trekkes `next/navigation` og hele
 * API-klienten inn i et bundle som bare skal inneholde presentasjon.
 */
const oktStubb = {
  name: "okt-stubb",
  setup(bygg) {
    bygg.onResolve({ filter: /OktProvider$/ }, () => ({
      path: resolve(her, ".okt-stubb.mjs"),
    }));
  },
};

writeFileSync(
  resolve(her, ".okt-stubb.mjs"),
  `// Generert av build.mjs — se forklaringen der.
export const useOkt = () => {
  throw new Error("useOkt er ikke tilgjengelig i designsystem-pakken");
};
export const OktProvider = ({ children }) => children;
`,
);

mkdirSync(resolve(her, "dist"), { recursive: true });

/**
 * Stilarket kopieres inn i `dist/` ved hvert bygg.
 *
 * Konverteren krever at `cssEntry` ligger INNI pakken (innholdet inlines), og
 * `src/app/globals.css` gjør ikke det. En kopi som lages på nytt hver gang kan ikke drive
 * fra hverandre — den er byggeartefakt på lik linje med `dist/index.js`, og `dist/` er
 * gitignorert nettopp derfor. Fasiten er og blir `src/app/globals.css`.
 */
copyFileSync(resolve(rot, "src/app/globals.css"), resolve(her, "dist/styles.css"));

await build({
  entryPoints: [resolve(her, "index.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  jsx: "automatic",
  outfile: resolve(her, "dist/index.js"),
  external: ["react", "react-dom", "react/jsx-runtime", "next/*", "lucide-react"],
  plugins: [oktStubb],
  tsconfig: resolve(her, "tsconfig.json"),
  absWorkingDir: rot,
  logLevel: "info",
});
