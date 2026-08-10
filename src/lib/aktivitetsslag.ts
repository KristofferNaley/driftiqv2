/**
 * Aktivitetsslagene — typer og etiketter for «Min aktivitet». **Ingen importer**, med vilje.
 *
 * Fila leses av BÅDE spørringene i `lib/aktivitet.ts` (server) og profilmodalen (nettleser).
 * Lå den sammen med spørringene, ville en `"use client"`-komponent dratt databaseklienten og
 * hele pg-driveren inn i nettleserbundlet — og bygget feiler da med «Can't resolve 'dns'»,
 * uten at verken `tsc --noEmit` eller lint sier fra. Samme regel som `nivaer.ts` og
 * `varselvalg.ts`: alt en klientkomponent trenger, må ligge i en fil uten server-importer.
 *
 * `ikon` er navnet på et lucide-ikon som en streng, ikke komponenten — en import her ville
 * brutt regelen over. Kallstedet slår det opp, slik sidemenyen gjør med modulikonene.
 */

export const AKTIVITETSSLAG = [
  "oppgave",
  "avvik",
  "behandling",
  "lukket",
  "driftslogg",
  "hms",
  "vernerunde",
  "enhetsarbeid",
] as const;

export type Aktivitetsslag = (typeof AKTIVITETSSLAG)[number];

export type Hendelse = {
  slag: Aktivitetsslag;
  tittel: string;
  /** Konteksten raden trenger for å bli forstått — enhet, notat, alvorsgrad. */
  detalj: string | null;
  /** ISO. Dato der kilden har en dato, tidspunkt der den har et tidspunkt. */
  dato: string;
  /** Lenke inn i modulen. `null` når raden ikke har en egen side. */
  sti: string | null;
};

export type MinAktivitet = {
  hendelser: Hendelse[];
  /** Antall per slag INNENFOR vinduet — ikke totalt. Teksten i UI-et sier det. */
  antall: Record<Aktivitetsslag, number>;
  /** Navnet oppslaget brukte. Vises, fordi det forklarer et tomt resultat. */
  navn: string;
  /** Hvor langt tilbake vi så. ISO-dato. */
  fra: string;
};

/**
 * `etikett` er i FORTID og beskriver handlingen, ikke modulen: «Kvittert ut», ikke «Oppgaver».
 * Raden svarer på hva du gjorde, og modulnavnet står i tittelen ved siden av.
 *
 * `entall`/`flertall` er SUBSTANTIVER, og de finnes fordi sammendraget setter et tall foran:
 * «8 behandlinger», ikke «8 Behandling». Én etikett kan ikke gjøre begge jobbene på norsk —
 * første forsøk sa «1 kvittert ut» og «8 behandling» i samme rad.
 */
export const SLAG: Record<
  Aktivitetsslag,
  { etikett: string; entall: string; flertall: string; ikon: string }
> = {
  oppgave: {
    etikett: "Kvittert ut",
    entall: "utkvittering",
    flertall: "utkvitteringer",
    ikon: "ClipboardCheck",
  },
  avvik: {
    etikett: "Meldt avvik",
    entall: "meldt avvik",
    flertall: "meldte avvik",
    ikon: "TriangleAlert",
  },
  behandling: {
    etikett: "Behandling",
    entall: "behandling",
    flertall: "behandlinger",
    ikon: "MessageSquare",
  },
  lukket: {
    etikett: "Lukket avvik",
    entall: "lukket avvik",
    flertall: "lukkede avvik",
    ikon: "CircleCheck",
  },
  driftslogg: {
    etikett: "Driftslogg",
    entall: "loggføring",
    flertall: "loggføringer",
    ikon: "NotebookPen",
  },
  hms: {
    etikett: "Signert HMS-mål",
    entall: "signert HMS-mål",
    flertall: "signerte HMS-mål",
    ikon: "PenLine",
  },
  vernerunde: {
    etikett: "Vernerunde",
    entall: "vernerunde",
    flertall: "vernerunder",
    ikon: "ShieldCheck",
  },
  enhetsarbeid: {
    etikett: "Arbeid i enhet",
    entall: "arbeid i enhet",
    flertall: "arbeid i enheter",
    ikon: "Wrench",
  },
};
