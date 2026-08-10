/**
 * Kildene i den samlede driftsloggen — typer og etiketter. **Ingen importer**: fila leses av
 * både aggregeringen på serveren og driftslogg-siden i nettleseren, og en server-import her
 * ville dratt pg-driveren inn i klientbundlet (samme regel som `nivaer.ts` og
 * `aktivitetsslag.ts`).
 *
 * `manuelt` står SIST i lista med vilje: filterrekkefølgen på siden speiler hvor hendelsene
 * faktisk kommer fra, og de automatiske kildene er hovedinnholdet — notatene er unntaket for
 * det som ikke registreres noe annet sted.
 */

export const LOGGKILDER = ["oppgave", "avvik", "vedlikehold", "vernerunde", "manuelt"] as const;

export type Loggkilde = (typeof LOGGKILDER)[number];

export type Loggpost = {
  /** Kilde + kilderad, f.eks. `oppgave-<completionId>` — unik på tvers av kildene. */
  id: string;
  kilde: Loggkilde;
  tittel: string;
  /** Notat, løsningsbeskrivelse e.l. Én linje — klippes av kilden, ikke av CSS-en. */
  tekst: string | null;
  /** ISO. Dato eller tidspunkt — `visKlokke` sier hvilken. */
  tidspunkt: string;
  /**
   * Om klokkeslettet er reelt. Vedlikehold og vernerunder har bare en DATO, og «00:00» på
   * dem ville sett ut som midnattsarbeid. Manuelt: reelt bare når føringen skjedde samme dag.
   */
  visKlokke: boolean;
  vendorName: string | null;
  /** «Kvittert av», «Meldt av», «Lukket av» … — ferdig formulert av kilden. */
  aktor: string | null;
  /** Lenke inn i modulen. `null` for manuelle notater — de ER her. */
  sti: string | null;
};

export type Driftslogg = {
  poster: Loggpost[];
  antall: Record<Loggkilde, number>;
};

export const KILDE_ETIKETT: Record<Loggkilde, { filter: string; badge: string; ikon: string }> = {
  oppgave: { filter: "Oppgaver", badge: "Fra oppgaver", ikon: "ClipboardCheck" },
  avvik: { filter: "Avvik", badge: "Fra avvik", ikon: "TriangleAlert" },
  vedlikehold: { filter: "Vedlikehold", badge: "Fra vedlikehold", ikon: "Wrench" },
  vernerunde: { filter: "Vernerunder", badge: "Vernerunde", ikon: "ShieldCheck" },
  manuelt: { filter: "Notater", badge: "Notat", ikon: "NotebookPen" },
};
