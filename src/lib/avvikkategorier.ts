/**
 * Avvikskategoriene. **Ingen importer** — brukes både i API-et og i nettleseren.
 *
 * Kunden kan ha sitt eget sett lagret på organisasjonen (`deviation_categories`, JSON).
 * Standardsettet under gjelder når de ikke har det. `verdi` er det som lagres på avviket og
 * må ALDRI endres for en eksisterende nøkkel — gamle rader peker på den.
 */

export type Kategori = { verdi: string; etikett: string; aktiv?: boolean };

export const STANDARDKATEGORIER: Kategori[] = [
  { verdi: "hms", etikett: "HMS / sikkerhet" },
  { verdi: "teknisk", etikett: "Teknisk / vedlikehold" },
  { verdi: "leverandor", etikett: "Leverandørfeil" },
  { verdi: "orden", etikett: "Orden / rydde" },
  { verdi: "annet", etikett: "Annet" },
];

/**
 * Kundens kategorier, eller standardsettet.
 *
 * Ødelagt JSON gir standardsettet i stedet for å velte siden — en avvikstabell som ikke
 * vises er verre enn en kategoriliste som er litt feil.
 */
export function lesKategorier(lagret: string | null | undefined): Kategori[] {
  if (!lagret) return STANDARDKATEGORIER;
  try {
    const tolket = JSON.parse(lagret) as unknown;
    if (!Array.isArray(tolket) || tolket.length === 0) return STANDARDKATEGORIER;
    // v1 lagret feltene som `value`/`label`. Begge former godtas, så migrerte rader virker.
    return tolket
      .map((k) => {
        const r = k as Record<string, unknown>;
        return {
          verdi: String(r.verdi ?? r.value ?? ""),
          etikett: String(r.etikett ?? r.label ?? ""),
          aktiv: r.active === false || r.aktiv === false ? false : true,
        };
      })
      .filter((k) => k.verdi && k.etikett);
  } catch {
    return STANDARDKATEGORIER;
  }
}

/** Etiketten for en lagret verdi. Ukjent verdi vises som den er — den finnes jo på raden. */
export function kategoriEtikett(kategorier: Kategori[], verdi: string | null): string | null {
  if (!verdi) return null;
  return kategorier.find((k) => k.verdi === verdi)?.etikett ?? verdi;
}

/** ny | under_behandling | lukket → det kunden ser. */
export const STATUS_VISNING: Record<string, { etikett: string; kort: string; merke: string }> = {
  ny: { etikett: "Meldt", kort: "Meldt", merke: "danger" },
  under_behandling: { etikett: "Under behandling", kort: "Behandles", merke: "warn" },
  lukket: { etikett: "Løst og lukket", kort: "Lukket", merke: "ok" },
};

/**
 * Lager en `verdi` av en etikett.
 *
 * Verdien er det som LAGRES på avviket, og den kan aldri endres etterpå — gamle rader peker
 * på den. Derfor utledes den én gang ved opprettelse, og etiketten kan endres fritt uten at
 * historikken påvirkes.
 */
export function lagVerdi(etikett: string, opptatt: string[]): string {
  const grunn =
    etikett
      .toLowerCase()
      .replace(/[æ]/g, "ae")
      .replace(/[ø]/g, "o")
      .replace(/[å]/g, "a")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "kategori";

  if (!opptatt.includes(grunn)) return grunn;
  for (let n = 2; ; n++) {
    const kandidat = `${grunn}_${n}`;
    if (!opptatt.includes(kandidat)) return kandidat;
  }
}
