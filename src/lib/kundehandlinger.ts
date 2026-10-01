/**
 * «Krever handling» på kundedetaljen — regelsettet som REN funksjon (BL-180).
 *
 * Importfri med vilje: kortet i panelet regner punktene i nettleseren fra dataene det
 * allerede har, og testene kaller den samme funksjonen. En ny regel er én oppføring i
 * `REGLER` — ikke en ny `if` i en komponent.
 *
 * Nivå: rødt er det som stopper noe for kunden NÅ (uten e-post går ingen varsler eller
 * fakturaer ut). Gult er det som mangler, men ikke stopper noe.
 */

export type Nivaa = "rod" | "gul";

export type Handling =
  /** Inline e-postfelt med Lagre. */
  | { type: "epost" }
  /** Inline org.nr-felt med «Slå opp» mot Enhetsregisteret. */
  | { type: "orgnr" }
  /** Nedtrekk med selskapsformene. `brregKode` er satt når Brreg ga en kode vi ikke har. */
  | { type: "selskapsform"; brregKode: string | null }
  /** E-post til kundens orgadmins om ett onboarding-punkt. */
  | { type: "paaminnelse"; punkt: string; etikett: string }
  /** Gå til en annen fane. */
  | { type: "fane"; fane: "abonnement"; etikett: string }
  /** Åpne Organisasjon-skjemaet. */
  | { type: "rediger"; etikett: string };

export type HandlingPunkt = {
  nokkel: string;
  nivaa: Nivaa;
  tittel: string;
  konsekvens: string;
  handling: Handling;
};

export type Grunnlag = {
  org: { contactEmail: string | null; orgNr: string | null; orgForm: string | null };
  onboarding: ReadonlyArray<{ nokkel: string; etikett: string; ok: boolean }>;
  /** Koden Brreg ga ved siste oppslag, når den ikke er en av selskapsformene våre. */
  ukjentBrregKode?: string | null;
};

type Regel = (g: Grunnlag) => HandlingPunkt | HandlingPunkt[] | null;

const tom = (v: string | null | undefined) => !v || !v.trim();

/** Hva som skjer når et onboarding-punkt står åpent, og hva vi kan gjøre med det herfra. */
const ONBOARDING: Record<string, { konsekvens: string; handling?: Handling }> = {
  abonnement: {
    konsekvens: "Ingen avtale er registrert, så kunden blir ikke fakturert.",
    handling: { type: "fane", fane: "abonnement", etikett: "Registrer abonnement" },
  },
  andeler: {
    konsekvens: "Grunnpakkeprisen regnes ut fra antall andeler.",
    handling: { type: "rediger", etikett: "Sett andeler" },
  },
  enheter: { konsekvens: "Kunden har ikke lagt inn enhetene sine." },
  om_bygget: {
    konsekvens: "Kunden må som regel gjøre dette selv. AI-rådgiveren svarer dårligere uten.",
  },
  styret: {
    konsekvens: "Bare én person fra kunden har tilgang. Minst 2 fra styret må inn.",
    handling: { type: "paaminnelse", punkt: "styret", etikett: "Inviter styremedlem" },
  },
  leverandorer: { konsekvens: "Kunden har ikke registrert leverandørene sine." },
  kontrakter: { konsekvens: "Kunden har ikke lagt inn kontraktene sine." },
  arshjul: { konsekvens: "Kunden har ikke tatt årshjulet i bruk." },
  rutiner: { konsekvens: "Kunden har ikke opprettet rutiner." },
  dokumenter: { konsekvens: "Kunden har ikke lagt dokumenter i arkivet." },
};

/** Rekkefølgen er rekkefølgen punktene vises i, innenfor hvert nivå. */
export const REGLER: ReadonlyArray<Regel> = [
  (g) =>
    tom(g.org.contactEmail)
      ? {
          nokkel: "epost",
          nivaa: "rod",
          tittel: "Mangler e-post",
          konsekvens: "Systemet kan ikke sende varsler eller faktura til kunden.",
          handling: { type: "epost" },
        }
      : null,
  (g) =>
    tom(g.org.orgNr)
      ? {
          nokkel: "orgnr",
          nivaa: "gul",
          tittel: "Mangler org.nr",
          konsekvens: "Uten org.nr kan vi ikke hente data fra Enhetsregisteret.",
          handling: { type: "orgnr" },
        }
      : null,
  (g) =>
    tom(g.org.orgForm)
      ? {
          nokkel: "selskapsform",
          nivaa: "gul",
          tittel: g.ukjentBrregKode
            ? `Ukjent selskapsform fra Brreg (${g.ukjentBrregKode})`
            : "Mangler selskapsform",
          konsekvens: g.ukjentBrregKode
            ? "Koden er ikke på listen vår og ble ikke lagret. Velg riktig form."
            : "Statistikken og filtrene grupperer kundene på selskapsform.",
          handling: { type: "selskapsform", brregKode: g.ukjentBrregKode ?? null },
        }
      : null,
  (g) =>
    g.onboarding
      .filter((p) => !p.ok)
      .map((p) => {
        const regel = ONBOARDING[p.nokkel];
        return {
          nokkel: `onboarding:${p.nokkel}`,
          nivaa: "gul" as const,
          tittel: `Onboarding: ${p.etikett}`,
          konsekvens: regel?.konsekvens ?? "Punktet er ikke oppfylt.",
          handling: regel?.handling ?? {
            type: "paaminnelse" as const,
            punkt: p.nokkel,
            etikett: "Send påminnelse",
          },
        };
      }),
];

/** Alle punkter som gjelder kunden, røde først. Tom liste ⇒ kortet skjules. */
export function kreverHandling(g: Grunnlag): HandlingPunkt[] {
  const punkter = REGLER.flatMap((r) => {
    const svar = r(g);
    return svar === null ? [] : Array.isArray(svar) ? svar : [svar];
  });
  return [...punkter.filter((p) => p.nivaa === "rod"), ...punkter.filter((p) => p.nivaa === "gul")];
}

/**
 * Hva påminnelses-e-posten ber kunden gjøre, per onboarding-punkt, og hvor i appen.
 * Står her og ikke i epost.ts fordi den hører til punktene over — legges et punkt til,
 * er det her man ser at teksten mangler.
 */
export const PAMINNELSE: Record<string, { tekst: string; sti: string }> = {
  enheter: { tekst: "Legg inn enhetene (leilighetene) i borettslaget eller sameiet.", sti: "/innstillinger" },
  om_bygget: { tekst: "Fyll ut «Om bygget» under Innstillinger.", sti: "/innstillinger" },
  styret: {
    tekst: "Inviter resten av styret under Brukere, så systemet ikke står og faller på én person.",
    sti: "/brukere",
  },
  leverandorer: { tekst: "Registrer leverandørene dere bruker.", sti: "/leverandorer" },
  kontrakter: { tekst: "Legg inn kontraktene med leverandørene.", sti: "/kontrakter" },
  arshjul: { tekst: "Legg inn de faste hendelsene i årshjulet.", sti: "/arshjul" },
  rutiner: { tekst: "Opprett rutinene for det som skal gjøres jevnlig.", sti: "/rutiner" },
  dokumenter: { tekst: "Last opp de viktigste dokumentene til arkivet.", sti: "/dokumentarkiv" },
};

/** Gyldig e-postadresse? Samme sjekk i det inline feltet og på serveren. */
export const ER_EPOST = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
