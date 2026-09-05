/**
 * Kategoriene et anlegg kan høre til — hovedgruppene i NS 3451 (bygningsdelstabellen).
 *
 * «Bygningsdel» var for smalt: registeret rommer garasjeporter, sprinkleranlegg, branntavler,
 * varmtvannsberedere, nødlys og dørautomatikk — altså tekniske installasjoner, flere av dem
 * maskiner etter maskinforskriften. NS 3451 er tabellen takstmenn, forretningsførere og
 * leverandører allerede sorterer etter, på samme måte som NS 4102 er kontoplanen budsjettet
 * følger. Nummeret i etiketten er standardens eget kapittel.
 *
 * **Ingen server-importer** — fila leses av klientkomponenter (se «Server/klient-grensen»
 * i CLAUDE.md). `category` i basen er fri tekst; en lagret verdi utenfor lista vises som sitt
 * eget valg, så redigering ikke stille bytter kategori.
 */
export const ANLEGG_KATEGORIER = [
  { verdi: "bygning", etikett: "2 Bygning", hint: "tak, fasade, vinduer, dører, balkonger" },
  { verdi: "vvs", etikett: "3 VVS", hint: "varme, varmtvann, sanitær, sprinkler, ventilasjon" },
  { verdi: "elkraft", etikett: "4 Elkraft", hint: "tavler, nødlys, belysning, elbillading" },
  { verdi: "tele", etikett: "5 Tele og automatisering", hint: "brannalarm, adgangskontroll, styring" },
  { verdi: "andre", etikett: "6 Andre installasjoner", hint: "heis, porter, dørautomatikk" },
  { verdi: "utendors", etikett: "7 Utendørs", hint: "drenering, lekeplass, utebelysning" },
] as const;

export type AnleggKategori = (typeof ANLEGG_KATEGORIER)[number]["verdi"];

/** Etiketten for en lagret verdi — fritekst fra før NS 3451-lista vises som den er. */
export function anleggKategoriEtikett(verdi: string | null | undefined): string | null {
  if (!verdi) return null;
  return ANLEGG_KATEGORIER.find((k) => k.verdi === verdi)?.etikett ?? verdi;
}
