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

/**
 * Egne fraksjonsmerker på tavla: farge + lucide-ikon (som streng — fila er importfri).
 * IKKE BIRs ikoner; de er BIRs grafikk. Fargene følger det de fleste kjenner fra spann og
 * sekker, men er ikke en offisiell merkeordning.
 */
export const AVFALL_MERKE: Readonly<Record<string, { farge: string; ikon: string }>> = {
  rest: { farge: "#6b7280", ikon: "Trash2" },
  papir: { farge: "#2563eb", ikon: "Newspaper" },
  mat: { farge: "#16a34a", ikon: "Apple" },
  glass: { farge: "#0d9488", ikon: "Wine" },
  plast: { farge: "#ea580c", ikon: "Recycle" },
};
export const avfallMerke = (fraksjon: string) => AVFALL_MERKE[fraksjon] ?? { farge: "#64748b", ikon: "Recycle" };
