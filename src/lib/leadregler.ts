/**
 * Kilde og avslagsgrunn på en lead — FASTE lister, ikke fritekst (BL-182).
 *
 * **Ingen importer**: nedtrekkene på leads-siden, Statistikk og databaseskjemaet
 * (`leadkildeenum`, `avslagsgrunnenum`) leser alle herfra. Fritekst ville gitt «Pris»,
 * «for dyrt» og «prisen» som tre grunner, og da teller Salg-fanen feil. Samme mønster som
 * selskapsformen (`lib/selskapsform.ts`).
 *
 * Det lagres NØKKELEN, aldri etiketten. En ny verdi er en ny oppføring her OG en migrasjon
 * (`ALTER TYPE … ADD VALUE`); `tests/leads.test.ts` feiler hvis de to drifter.
 *
 * «Demo holdt» er bevisst IKKE et trinn i løpet — det er et åpent spørsmål i BL-182.
 */

export const LEADKILDER = [
  { nokkel: "kald_epost", etikett: "Kald e-post" },
  { nokkel: "anbefaling", etikett: "Anbefaling" },
  { nokkel: "nettsiden", etikett: "Nettsiden" },
  { nokkel: "messe", etikett: "Messe/seminar" },
  { nokkel: "annet", etikett: "Annet" },
] as const;

export type Leadkilde = (typeof LEADKILDER)[number]["nokkel"];

export const LEADKILDE_NOKLER = LEADKILDER.map((k) => k.nokkel) as [Leadkilde, ...Leadkilde[]];

export const AVSLAGSGRUNNER = [
  { nokkel: "for_tidlig", etikett: "For tidlig" },
  { nokkel: "forretningsforer", etikett: "Bruker forretningsførers system" },
  { nokkel: "pris", etikett: "Pris" },
  { nokkel: "ingen_respons", etikett: "Ingen respons" },
  { nokkel: "annet", etikett: "Annet" },
] as const;

export type Avslagsgrunn = (typeof AVSLAGSGRUNNER)[number]["nokkel"];

export const AVSLAGSGRUNN_NOKLER = AVSLAGSGRUNNER.map((g) => g.nokkel) as [
  Avslagsgrunn,
  ...Avslagsgrunn[],
];

/** Etiketten for en kilde. Ukjent eller tom gir `null` (vises som «Ikke satt»). */
export function kildeEtikett(nokkel: string | null | undefined): string | null {
  return LEADKILDER.find((k) => k.nokkel === nokkel)?.etikett ?? null;
}

/** Etiketten for en avslagsgrunn. Ukjent eller tom gir `null`. */
export function avslagsgrunnEtikett(nokkel: string | null | undefined): string | null {
  return AVSLAGSGRUNNER.find((g) => g.nokkel === nokkel)?.etikett ?? null;
}

/**
 * Løpet trakten teller langs. «Kommet minst til» et trinn = har stått i det eller et senere
 * trinn. `avslatt` er utenfor løpet: den sier ikke hvor langt leaden kom.
 */
export const LEADLOP = ["ny", "kontaktet", "kvalifisert", "konvertert"] as const;
