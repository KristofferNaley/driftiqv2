/**
 * Regnskapssystemene DriftIQ kan snakke med — importfri registerfil (jf. `moduler.ts`),
 * lest av både server og klient.
 *
 * Fiken er det første, men ikke det eneste: Tripletex og andre kan komme. Derfor skal
 * ingen side, knapp eller melding si «Fiken» som fast tekst — de sier navnet på det
 * systemet orgen faktisk er koblet til (`hentRegnskap()` i `regnskapskobling.ts`), og
 * «regnskapet» når ingen kobling finnes. Koblingsdetaljene (OAuth, tokens, synk) bor i
 * hvert systems egen fil; her ligger bare det felles vokabularet.
 */

export const REGNSKAPSSYSTEMER = {
  fiken: { navn: "Fiken", nettsted: "https://fiken.no" },
  tripletex: { navn: "Tripletex", nettsted: "https://www.tripletex.no" },
} as const;

export type RegnskapsSystem = keyof typeof REGNSKAPSSYSTEMER;

export const REGNSKAP_NOKLER = Object.keys(REGNSKAPSSYSTEMER) as RegnskapsSystem[];

export function regnskapNavn(system: RegnskapsSystem | null | undefined): string {
  return system ? REGNSKAPSSYSTEMER[system].navn : "regnskapet";
}

/** Det klienten trenger å vite om orgens regnskapskobling — aldri tokens. */
export type Regnskapsstatus = {
  /** Null = ingen kobling. */
  system: RegnskapsSystem | null;
  /** «Fiken», «Tripletex» — eller «regnskapet» uten kobling. */
  navn: string;
  /** Foretaket hos regnskapssystemet, når det er koblet. */
  foretak: string | null;
  /** Om systemet kan opprette og sende fakturaer herfra. */
  kanFakturere: boolean;
  /** Hvorfor ikke, i klartekst — vises på knappen. */
  grunn: string | null;
};

/**
 * Standard inntektskonto for viderefakturert strøm til lading: 3100 «salgsinntekt,
 * avgiftsfri». Lading er salg av strøm, ikke leie av fast eiendom (3600-serien), og et
 * sameie uten mva fakturerer avgiftsfritt. Et mva-registrert lag velger 3000 (høy sats)
 * selv; kontoen settes per kjøring, og regnskapsføreren bestemmer. Lært 06.09.2026:
 * 3605 avviste linja («… er ikke en gyldig mva kode for kontoen 3605») fordi den er
 * avgiftspliktig og krever mva-kode.
 */
export const LADING_INNTEKTSKONTO_STANDARD = "3100";
