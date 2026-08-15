/**
 * Lint-oppsettet. Satt opp for å fange NØYAKTIG det et grønt bygg ikke fanger.
 *
 * v1s lærdom, dokumentert i CLAUDE.md: `vite build` behandlet en ukjent identifikator som en
 * global variabel og bygget grønt. En manglende import ga altså et bygg som lyktes og en
 * `ReferenceError` i nettleseren. Det skjedde 08.08.2026 — `dashboardWidgets.jsx` ble
 * deployet med tre navn som aldri var importert, og dashbordet krasjet for alle kunder med
 * modulen på.
 *
 * `next build` typesjekker og fanger mer enn Vite gjorde, men `no-undef` og
 * `rules-of-hooks` er fortsatt de to som faktisk ryker i produksjon. De står som `error`;
 * resten er advarsler.
 *
 * `next lint` finnes ikke lenger i Next 16 — derfor denne fila og `npm run lint`.
 */

import js from "@eslint/js";
import ts from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default ts.config(
  // De fire siste hører til designsystem-eksporten til Claude Design (se
  // `.design-sync/NOTES.md`): generert output (`ds-bundle/`, `designsystem/dist/`),
  // konverterens egne skript (`.ds-sync/`) og forhåndsvisningene (`.design-sync/`, som
  // importerer en pakke som først finnes under kortbygget). Linten har ingenting å si om
  // kode ingen skriver for hånd — uten dette drukner ekte funn i noen tusen `no-undef`
  // fra et minifisert React. Merk at flat config IKKE hopper over punktmapper av seg selv.
  { ignores: [
    ".next/**", "node_modules/**", "drizzle/**",
    "ds-bundle/**", "designsystem/dist/**", ".ds-sync/**", ".design-sync/**",
  ] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: {
        // Nettleser- og Node-globaler vi faktisk bruker. Lista er kort med vilje: et navn
        // som IKKE står her og ikke er importert, er nettopp feilen vi vil fange.
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        /** `navigator.clipboard` — «Kopier teksten» i leverandørmeldingen. */
        navigator: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        File: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Buffer: "readonly",
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        // Tidsavbrudd på utgående kall til tredjeparter (lib/brreg.ts).
        AbortSignal: "readonly",
        // CSV-eksporten på leads-siden bygger en fil i nettleseren.
        Blob: "readonly",
        // Tidslinja i årshjulet måler etikettbredder med canvas i dokumentets egen font.
        ResizeObserver: "readonly",
        CanvasRenderingContext2D: "readonly",
        getComputedStyle: "readonly",
        RequestInit: "readonly",
        React: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
        NodeJS: "readonly",
        // DOM-grensesnitt brukt i hendelsestyper (`React.ChangeEvent<HTMLInputElement>`).
        // De er ekte globaler i nettleserkode, i motsetning til et navn noen glemte å importere.
        HTMLInputElement: "readonly",
        HTMLFormElement: "readonly",
        HTMLTextAreaElement: "readonly",
        HTMLSelectElement: "readonly",
        FileList: "readonly",
        HTMLElement: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        HTMLDivElement: "readonly",
        Node: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Ubrukte navn er støy, ikke en krasj. `_`-prefiks er den vanlige unntaksmåten.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
