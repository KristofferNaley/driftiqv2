/**
 * Delte konstanter for Rutiner-modulen — port av v1s `routineConstants.js`.
 *
 * **Ingen importer.** Leses av både listesiden, byggeren, detaljsiden og utskriftsarket —
 * samme grunn som `nivaer.ts`: en server-import her ville dratt databasedriveren inn i
 * nettleserbundlet.
 */

export const RUTINEKATEGORIER = [
  { verdi: "vann_lekkasje", etikett: "Vann & lekkasje", farge: "#00c2ff" },
  { verdi: "brann_sikkerhet", etikett: "Brann & sikkerhet", farge: "#f04040" },
  { verdi: "adgang_nokler", etikett: "Adgang & nøkler", farge: "#8b5cf6" },
  { verdi: "beboerhenvendelser", etikett: "Beboerhenvendelser", farge: "#0fba81" },
  { verdi: "eierskifte", etikett: "Eierskifte", farge: "#f5a623" },
] as const;

/** Ukjente verdier (fri tekst fra migrerte rutiner) får nøytral farge, ikke en krasj. */
export function kategoriInfo(verdi: string | null | undefined) {
  return (
    RUTINEKATEGORIER.find((k) => k.verdi === verdi) ?? {
      verdi: verdi ?? "",
      etikett: verdi || "Uten kategori",
      farge: "#8892a4",
    }
  );
}

/** Fri tekst i databasen — dette er bare forslagene UI-et tilbyr. */
export const ANSVARLIG_VALG = ["Styret", "Vaktmester", "Beboer", "Beboer → Styret", "Alle"] as const;
export const GJELDER_FOR_VALG = ["Alle beboere", "Kun styret", "Leverandører"] as const;

/** NULL = ingen påminnelse; rutinen flagges da aldri som «trenger gjennomgang». */
export const REVISJONSINTERVALLER: ReadonlyArray<{ verdi: number | null; etikett: string }> = [
  { verdi: 6, etikett: "Hver 6. måned" },
  { verdi: 12, etikett: "Hver 12. måned" },
  { verdi: 24, etikett: "Hver 24. måned" },
  { verdi: null, etikett: "Ingen påminnelse" },
];
