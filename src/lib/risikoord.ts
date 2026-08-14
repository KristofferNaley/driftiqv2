/**
 * Ordene i risikovurderingen — importfri fil (samme mønster som nivaer.ts) så både
 * risikofanen og utskriftsarket leser de samme etikettene uten server-importer.
 *
 * Skalaen er 1–3; indeks 0 er verdien 1. Den som vurderer velger mellom tre utsagn,
 * ikke et tall — derfor bor ordene her og ikke bare i én komponent.
 */
export const SANNSYNLIGHET_ORD = ["Lite sannsynlig", "Mulig", "Sannsynlig"];
export const KONSEKVENS_ORD = ["Liten", "Moderat", "Alvorlig"];

export const NIVATEKST = { lav: "Lav", middels: "Middels", hoy: "Høy" } as const;
export const NIVAMERKE = { lav: "ok", middels: "warn", hoy: "danger" } as const;

/**
 * Etiketten for hovedvurderingen (context = NULL i basen) — det styrene kjenner fra
 * forskriften. Fast med vilje: en konfigurerbar etikett på lovpålagt dokumentasjon gir
 * støttespørsmål og ingen verdi. Prosjektene har frie navn; hovedvurderingen har ett.
 */
export const HOVEDVURDERING = "Årlig risikovurdering";

export const FARESTATUS_ETIKETT: Record<string, string> = {
  open: "Åpen",
  mitigated: "Under kontroll",
  closed: "Lukket",
};

/** Klientkopi av lib/internkontroll.ts' `risikoniva` — lib-en drar med seg drizzle/zod. */
export const risikonivaKlient = (tall: number): "lav" | "middels" | "hoy" =>
  tall <= 2 ? "lav" : tall <= 4 ? "middels" : "hoy";
