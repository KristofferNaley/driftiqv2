/**
 * Avfallsfraksjonene på oppslagstavla. IMPORTFRI — leses av skjermen (klient) og av
 * BIR-tolkningen (server). Designnotatet er `docs/bir.md`.
 */

/** BIRs ikonfil (`/css/assets/trashicons/<navn>.svg`) → vår nøkkel. Ikonet er det eneste som sier fraksjonen. */
export const BIR_IKON: Readonly<Record<string, string>> = {
  restavfall: "rest",
  papirOgPlast: "papir",
  matavfall: "mat",
  glassOgMetall: "glass",
  plastemballasje: "plast",
};

export const AVFALL_ETIKETT: Readonly<Record<string, string>> = {
  rest: "Restavfall",
  papir: "Papir og plast",
  mat: "Matavfall",
  glass: "Glass og metall",
  plast: "Plastemballasje",
};

/** Ukjent fraksjon (BIR har lagt til en ny) vises med ikonnavnet i stedet for å forsvinne. */
export const avfallEtikett = (fraksjon: string) => AVFALL_ETIKETT[fraksjon] ?? fraksjon;
