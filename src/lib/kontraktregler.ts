/**
 * Statusregler og standardkategorier for kontrakter. **Ingen importer** — brukes både i
 * API-et og i nettleseren, samme mønster som avvikkategorier.ts.
 *
 * v1 hadde fire tilstander, ikke fem: «Aktiv» og «Løpende» beskrev det samme og forvirret
 * mer enn de forklarte. En avtale er Løpende til den nærmer seg utløp, så Snart ut, så
 * Utløpt. Arkivert er ikke en tilstand avtalen «er i» på samme måte — det er et sted man
 * aktivt slår opp historikk, og i v2 en egen fane. «Kommende» (startdato fram i tid) får
 * egen etikett, men deler filternøkkel med Løpende: den er hverken på vei ut eller utløpt,
 * og fortjener ikke en egen pille for hvor sjelden den er.
 */

/**
 * Samme grense som KPI-kortet «Utløper innen 180 dager». Én konstant, så kortet og
 * radmerkene aldri kan regne ulikt — det var slik v1s sju forsinket-kopier drev fra
 * hverandre.
 */
export const SNART_UT_DAGER = 180;

export type KontraktKategori = { verdi: string; etikett: string };

/**
 * Standardsettet fra v1s Innstillinger. `verdi` er det som lagres på kontrakten og må
 * ALDRI endres for en eksisterende nøkkel — gamle rader peker på den. En lagret verdi
 * utenfor settet vises som den er; kategorifeltet er fri tekst i basen.
 */
export const KONTRAKT_KATEGORIER: KontraktKategori[] = [
  { verdi: "renhold", etikett: "Renhold" },
  { verdi: "vaktmester", etikett: "Vaktmester" },
  { verdi: "forretningsforer", etikett: "Forretningsfører" },
  { verdi: "brann", etikett: "Brann & sikkerhet" },
  { verdi: "heis", etikett: "Heis & teknikk" },
  { verdi: "uteanlegg", etikett: "Uteanlegg" },
  { verdi: "forsikring", etikett: "Forsikring" },
  { verdi: "tv_internett", etikett: "TV/Internett" },
  { verdi: "annet", etikett: "Annet" },
];

export function kontraktKategoriEtikett(verdi: string | null | undefined): string | null {
  if (!verdi) return null;
  return KONTRAKT_KATEGORIER.find((k) => k.verdi === verdi)?.etikett ?? verdi;
}

/** Feltene statusen regnes av. Både API-rader og klienttyper oppfyller den. */
export type KontraktStatusFelter = {
  archivedAt: string | Date | null;
  startDate: string | null;
  endDate: string | null;
};

export type KontraktStatusNokkel = "lopende" | "snartut" | "utlopt" | "arkiv";

export type KontraktStatus = {
  nokkel: KontraktStatusNokkel;
  etikett: string;
  merke: "ok" | "warn" | "danger" | "muted";
};

/** Hele dager fra `iDag` til `dato` — negativt når datoen er passert. Begge `YYYY-MM-DD`. */
function dagerTil(dato: string, iDag: string): number {
  return Math.round((Date.parse(dato) - Date.parse(iDag)) / 86_400_000);
}

export const dagensDato = () => new Date().toISOString().slice(0, 10);

export function kontraktStatus(k: KontraktStatusFelter, iDag = dagensDato()): KontraktStatus {
  if (k.archivedAt) return { nokkel: "arkiv", etikett: "Arkivert", merke: "muted" };
  if (k.startDate && dagerTil(k.startDate, iDag) > 0)
    return { nokkel: "lopende", etikett: "Kommende", merke: "muted" };
  if (!k.endDate) return { nokkel: "lopende", etikett: "Løpende", merke: "ok" };
  const dager = dagerTil(k.endDate, iDag);
  if (dager < 0) return { nokkel: "utlopt", etikett: "Utløpt", merke: "danger" };
  if (dager < SNART_UT_DAGER) return { nokkel: "snartut", etikett: "Snart ut", merke: "warn" };
  return { nokkel: "lopende", etikett: "Løpende", merke: "ok" };
}

/**
 * «Aktiv» i pengesammenheng: avtalen løper akkurat nå. Brukes av «Innkjøp per år»-kortet,
 * så arkiverte, utløpte og ennå ikke påbegynte avtaler ikke koster noe i år.
 */
export function erAktiv(k: KontraktStatusFelter, iDag = dagensDato()): boolean {
  if (k.archivedAt) return false;
  if (k.startDate && dagerTil(k.startDate, iDag) > 0) return false;
  if (!k.endDate) return true;
  return dagerTil(k.endDate, iDag) >= 0;
}
