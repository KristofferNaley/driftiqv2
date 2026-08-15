# Designsystem-eksport til Claude Design — notater

Prosjektet: **DriftIQ Design System** — https://claude.ai/design/p/0c6fc7bb-02f7-4f33-986d-d319bdeaf35c
Første synk: 15.08.2026. 18 komponenter, alle med egenskrevet forhåndsvisning, alle gradert `good`.

## Dette repoet er ikke et komponentbibliotek

DriftIQ v2 er en Next.js-app. Det finnes ingen Storybook, ingen `dist/`, og ingen pakke som
eksporterer komponenter. `designsystem/` ble laget for denne synken og er **inngangen**
konverteren bygger fra:

- `designsystem/index.ts` — barrel som re-eksporterer 18 byggeklosser fra
  `src/components/felles.tsx` og `src/components/skjema.tsx`. Ingen kopier: endres en
  komponent i appen, endres den i biblioteket ved neste bygg.
- `designsystem/build.mjs` — esbuild → `dist/index.js`, pluss `tsc` → `dist/types/`.
  Kopierer også `src/app/globals.css` til `dist/styles.css` (se «cssEntry» under).
- `designsystem/dist/` er gitignorert. Den MÅ bygges før konverteren kjøres —
  `cfg.buildCmd` har kommandoen.

Utvalget er bevisst. `Layout`, `Sidebar`, `OrgVelger`, `ProfilModal`, `MeldFeil`,
`EnhetVelger`, `Temaknapp`, `Dokumentviser` og de tre detaljmodalene leser økten
(`useOkt`) og API-et, og ville blitt tomme kort. Skal de med senere, må de ha mock-providere.

## Ingen Node på verten — alt kjøres i Docker

```bash
# Bygg (pakke + konverter)
docker run --rm -v "$PWD:/app" -w /app -u "$(id -u):$(id -g)" -e HOME=/tmp node:22-alpine sh -c \
  "node designsystem/build.mjs && node .ds-sync/package-build.mjs --config .design-sync/config.json \
   --node-modules ./node_modules --entry ./designsystem/dist/index.js --out ./ds-bundle"

# Validering og fangst (krever Chromium)
docker run --rm -v "$PWD:/app" -w /app -u "$(id -u):$(id -g)" -e HOME=/tmp \
  mcr.microsoft.com/playwright:v1.62.1-noble node .ds-sync/package-validate.mjs ./ds-bundle
```

- Playwright-imaget må matche `playwright`-pakken i `.ds-sync/` — begge er **1.62.1**.
  Bumpes den ene, må den andre med, ellers: `browserType.launch: Executable doesn't exist`.
- `-u "$(id -u):$(id -g)"` er ikke pynt: uten den blir `ds-bundle/` eid av root.
- `-e HOME=/tmp` trengs for at npm skal ha et skrivbart hjem i containeren.
- Kjør alltid fra repo-rota. `$PWD` monteres, så en `cd` i et tidligere skall gir
  «Cannot find module '/app/designsystem/build.mjs'».

## Fallgruver som kostet en runde

- **`cssEntry` må ligge INNI pakken.** `../src/app/globals.css` ble stille hoppet over
  («resolves outside the package») og bundlet gikk ut uten designsystemets stilark.
  Løsningen er kopien til `dist/styles.css` i `build.mjs` — byggeartefakt, ikke en kopi som
  kan drive fra hverandre. Fasiten er fortsatt `src/app/globals.css`.
- **`OktProvider` stubbes i `build.mjs`.** `felles.tsx` importerer `useOkt` fordi
  `useOrgData` bor i samme fil. Uten stubben drar bundlet inn `next/navigation` og hele
  API-klienten. Ingen av de eksporterte komponentene kaller den.
- **Forhåndsvisninger må skrives som `export const X = () => …`.** `export function`
  fungerer til gjengivelsen, men `previewExamples` i konverteren matcher bare `export const`
  — med `function` blir `## Examples` i `.prompt.md` tomt, og det er nettopp de eksemplene
  designagenten kopierer fra.
- **`position: fixed` måler seg mot nærmeste transformerte forelder.** Korthylsen
  (`.ds-single`) har `translateZ(0)` uten høyde, så `Modal`, `Skuff` og `Fanemodal` ble
  sentrert i en null-høy boks og klippet i begge ender. Løsningen er `scene`-wrapperen i de
  tre forhåndsvisningene: `height: 100dvh` + `transform: translateZ(0)`.
- **Gruppering går via frontmatter-stubber**, ikke ekte dokumenter. `.design-sync/docs/*.md`
  inneholder BARE `category:`. Skriver du innhold i dem, erstatter det den syntetiserte
  `.prompt.md` — og da forsvinner `## Examples`.
- **`docsDir` er pakke-relativ** (`../.design-sync/docs`), mens `readmeHeader` er relativ til
  repo-rota (`.design-sync/conventions.md`). Ikke samme rot.

- **ESLint hopper ikke over punktmapper i flat config.** `.ds-sync/` og `.design-sync/` måtte
  inn i `ignores` i `eslint.config.mjs` sammen med `ds-bundle/` og `designsystem/dist/`,
  ellers gir `npx eslint .` ~2400 `no-undef` fra bundlet React og fra konverterens
  Node-skript. `npx tsc --noEmit` er upåvirket — TypeScript utelater punktmapper selv.

## Kjente render-advarsler (forventet, ikke nye funn)

- `Hurtigskjema/IKorttopp`: knappeteksten «Legg til» brekker over to linjer i korttoppen.
  Ekte oppførsel i `.card-header` på smal bredde — ikke en feil i komposisjonen.
- `Felt/EgenKontroll` og `Felt/ToPaaRad`: datofelter vises som `09/14/2026`. Containerens
  locale er `en-US`; i appen vises norsk format. Kosmetisk artefakt i kortet.
- `Feil/Ingenting`: cella er med vilje bare forklarende tekst — den demonstrerer at
  `melding={null}` ikke gjengir noe.

## Risiko ved neste synk

- **`designsystem/index.ts` speiler ikke `src/components` automatisk.** Legges en ny
  byggekloss til i `felles.tsx`/`skjema.tsx`, må den eksporteres her OG få en
  `componentSrcMap`-pin og en `docs/`-stubb. Ingen test fanger glippen.
- **`componentSrcMap` peker på `felles.tsx`/`skjema.tsx`.** Splittes de filene, må hver
  oppføring følge med, ellers mister komponenten JSDoc-en sin.
- **Alle 18 forhåndsvisninger inneholder oppdiktede, men realistiske data** (leverandører,
  avvik, beløp). Ingen ekte kundedata. Kopier ikke inn ekte navn ved senere endringer.
- **`playwright`-versjonen er pinnet to steder** (`.ds-sync/package.json` og
  docker-imaget). De må følges ad.
- **`overrides` i konfigurasjonen er kalibrert mot dagens CSS.** Endres høyden på
  `.fanemodal-kropp` eller bredden på `.skuff`, kan viewport-verdiene måtte justeres.
- Fonten hentes fra `node_modules/@fontsource-variable/plus-jakarta-sans` via
  `cfg.extraFonts`. Byttes fontpakken, må stien med.
