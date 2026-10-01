/**
 * Selskapsform — en FAST liste med Enhetsregisterets koder, ikke fritekst (BL-180).
 *
 * **Ingen importer**: nedtrekkslistene i panelet og databaseskjemaet (`orgformenum`) leser
 * begge herfra. Fritekst ga varianter som «Borettslag », «borettslag» og «BRL», og da talte
 * statistikken feil.
 *
 * Det lagres KODEN (`BRL`), aldri visningsnavnet. Kodene er sjekket mot
 * https://data.brreg.no/enhetsregisteret/api/organisasjonsformer/enheter (01.10.2026).
 * `AS` er aksjeselskap generelt i registeret; hos oss er det boligaksjeselskapet, så
 * visningsnavnet er vårt eget.
 *
 * En ny form er en ny oppføring her OG en migrasjon (`ALTER TYPE orgformenum ADD VALUE`).
 */

export const SELSKAPSFORMER = [
  { kode: "BRL", navn: "Borettslag" },
  { kode: "ESEK", navn: "Eierseksjonssameie" },
  { kode: "SAM", navn: "Tingsrettslig sameie" },
  { kode: "AS", navn: "Boligaksjeselskap" },
] as const;

export type Selskapsform = (typeof SELSKAPSFORMER)[number]["kode"];

export const SELSKAPSFORM_KODER = SELSKAPSFORMER.map((s) => s.kode) as [
  Selskapsform,
  ...Selskapsform[],
];

export function erSelskapsform(kode: string | null | undefined): kode is Selskapsform {
  return SELSKAPSFORMER.some((s) => s.kode === kode);
}

/** Visningsnavnet for en kode. Ukjent eller tom kode gir `null` (vises som «Ikke satt»). */
export function selskapsformNavn(kode: string | null | undefined): string | null {
  return SELSKAPSFORMER.find((s) => s.kode === kode)?.navn ?? null;
}
