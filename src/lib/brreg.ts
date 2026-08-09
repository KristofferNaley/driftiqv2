/**
 * Oppslag mot Enhetsregisteret i Brønnøysundregistrene (BL-139).
 *
 * ## Hvorfor dette kjører på SERVEREN, i motsetning til v1
 *
 * v1 kalte registeret rett fra nettleseren, og hadde en god grunn: alle API-kall gikk
 * gjennom `api.js`, som legger på DriftIQs eget Bearer-token — og det skal aldri sendes til
 * en tredjepart. Uten et serverlag å legge kallet i var nettleseren eneste sted igjen.
 *
 * v2 har det laget. Da er serversiden bedre på to punkter:
 *
 *  - **Org.nr. hentes fra basen, ikke fra klienten.** Endepunktet tar ingen parameter, så
 *    det kan ikke brukes som en åpen proxy til å slå opp hvilket som helst nummer.
 *  - **Ingen avhengighet til registerets CORS-oppsett.** Endrer de det, slutter v1 å virke.
 *
 * ## Hva vi henter — og hva vi bevisst ikke henter
 *
 * Kun navn og rolle. Det åpne roller-endepunktet gir alt vi trenger for å opprette brukere;
 * det autoriserte API-et med fødselsnummer krever Maskinporten og drar med seg et
 * personvernansvar uten funksjonell gevinst.
 */

/**
 * Selve enheten — navn, form og kommune.
 *
 * ## Denne kalles fra NETTLESEREN, i motsetning til styreoppslaget
 *
 * Styreoppslaget ligger på serveren fordi org.nr. hentes fra basen: endepunktet tar ingen
 * parameter og kan derfor ikke brukes som en åpen proxy mot Enhetsregisteret.
 *
 * Her kommer nummeret fra den BESØKENDE. Et serverendepunkt ville da vært nettopp en slik
 * proxy — uautentisert, på en offentlig side, som tar et vilkårlig nummer og gjør et
 * utgående kall. Da er det bedre at nettleseren spør registeret selv: ingen last på oss,
 * ingen proxy å misbruke.
 *
 * Kostnaden er at den besøkendes IP går til Brønnøysund. Det er et åpent norsk register, på
 * en side der de uansett er i ferd med å sende oss navn og e-post.
 */
export type Enhet = {
  orgNr: string;
  navn: string;
  orgForm: string | null;
  kommune: string | null;
  adresse: string | null;
  postnummer: string | null;
  poststed: string | null;
  epost: string | null;
  telefon: string | null;
  nettsted: string | null;
  /** Hele registersvaret, ordrett. Se kommentaren på `tolkEnhet`. */
  raa: string;
};

type EnhetSvar = {
  organisasjonsnummer?: string;
  navn?: string;
  organisasjonsform?: { beskrivelse?: string };
  forretningsadresse?: Adr;
  postadresse?: Adr;
  epostadresse?: string;
  telefon?: string;
  mobil?: string;
  hjemmeside?: string;
};

type Adr = {
  adresse?: string[];
  postnummer?: string;
  poststed?: string;
  kommune?: string;
};

/**
 * Plukker ut det vi bruker — og tar vare på RESTEN.
 *
 * `raa` er hele svaret ordrett. Registeret returnerer mer enn vi har felter for i dag
 * (næringskode, stiftelsesdato, sektorkode, historiske navn), og hvilke av dem som viser seg
 * nyttige i en salgssamtale vet vi ikke ennå. Å kaste dem her betyr at de er borte for godt
 * — enheten kan ha endret seg innen noen spør.
 */
export function tolkEnhet(d: EnhetSvar): Enhet | null {
  if (!d.navn || !d.organisasjonsnummer) return null;

  // Forretningsadressen vinner over postadressen: et borettslag kan ha postboks hos
  // forretningsføreren i en annen kommune enn bygget står i, og det er bygget vi vil vite om.
  const adr = d.forretningsadresse ?? d.postadresse;

  return {
    orgNr: d.organisasjonsnummer,
    navn: d.navn,
    orgForm: d.organisasjonsform?.beskrivelse ?? null,
    kommune: adr?.kommune ?? null,
    adresse: adr?.adresse?.filter(Boolean).join(", ") || null,
    postnummer: adr?.postnummer ?? null,
    poststed: adr?.poststed ?? null,
    epost: d.epostadresse ?? null,
    telefon: d.telefon ?? d.mobil ?? null,
    nettsted: d.hjemmeside ?? null,
    raa: JSON.stringify(d),
  };
}

/**
 * Søk på NAVN.
 *
 * Oppslag på organisasjonsnummer var feil inngang: et styremedlem kan ikke nummeret sitt
 * utenat, men vet hva laget heter. Nummeret er noe de må lete etter — navnet er noe de
 * allerede har i hodet.
 */
export async function sokEnheter(sok: string): Promise<Enhet[]> {
  const rent = sok.trim();
  // Under tre tegn treffer søket alt og ingenting.
  if (rent.length < 3) return [];

  let res: Response;
  try {
    res = await fetch(
      `https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(rent)}&size=8`,
      { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } },
    );
  } catch {
    return [];
  }
  if (!res.ok) return [];

  const d = (await res.json()) as { _embedded?: { enheter?: EnhetSvar[] } };
  return (d._embedded?.enheter ?? []).map(tolkEnhet).filter((e): e is Enhet => e !== null);
}

/** Ett bestemt organisasjonsnummer. Brukes der nummeret allerede er kjent. */
export async function hentEnhet(orgNr: string): Promise<Enhet | null> {
  const rent = orgNr.replace(/\D/g, "");
  if (rent.length !== 9) return null;

  let res: Response;
  try {
    res = await fetch(`https://data.brreg.no/enhetsregisteret/api/enheter/${rent}`, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  return tolkEnhet((await res.json()) as EnhetSvar);
}

/** Registerets rollekoder → tittelen vi lagrer. Andre koder (revisor, regnskapsfører) ignoreres. */
const STYREROLLER: Record<string, string> = {
  LEDE: "Styreleder",
  NEST: "Nestleder",
  MEDL: "Styremedlem",
  VARA: "Varamedlem",
};

/** Rekkefølgen styret presenteres i — ikke alfabetisk, men etter ansvar. */
const SORTERING = ["Styreleder", "Nestleder", "Styremedlem", "Varamedlem"];

export type Styremedlem = { navn: string; rolle: string };

/** Registeret skriver en del navn i BARE STORE BOKSTAVER. */
export function normaliserNavnedel(del: string): string {
  if (del !== del.toUpperCase()) return del;
  return del.toLowerCase().replace(/(^|[\s-])(\S)/gu, (_, sep: string, tegn: string) => sep + tegn.toUpperCase());
}

type RollerSvar = {
  rollegrupper?: Array<{
    type?: { kode?: string };
    roller?: Array<{
      type?: { kode?: string };
      fratraadt?: boolean;
      person?: {
        erDoed?: boolean;
        navn?: { fornavn?: string; mellomnavn?: string; etternavn?: string };
      };
    }>;
  }>;
};

/**
 * Plukker styret ut av registerets svar. Skilt fra `hentStyre` med vilje: dette er all
 * logikken som kan være feil, og den kan testes uten å røre nettverket.
 *
 * Filtrene er ikke pynt — `fratraadt` er personer som har GÅTT UT av styret, og `erDoed`
 * taler for seg. Uten dem inviterer man folk som ikke sitter der lenger.
 */
export function tolkStyre(data: RollerSvar): Styremedlem[] {
  const styre = (data.rollegrupper ?? []).find((g) => g.type?.kode === "STYR");
  return (styre?.roller ?? [])
    .filter((r) => r.type?.kode && STYREROLLER[r.type.kode] && !r.fratraadt && r.person && !r.person.erDoed)
    .map((r) => ({
      navn: [r.person!.navn?.fornavn, r.person!.navn?.mellomnavn, r.person!.navn?.etternavn]
        .filter((d): d is string => Boolean(d))
        .map(normaliserNavnedel)
        .join(" "),
      rolle: STYREROLLER[r.type!.kode!]!,
    }))
    .sort((a, b) => SORTERING.indexOf(a.rolle) - SORTERING.indexOf(b.rolle));
}

/**
 * Styrerollene på et org.nr.
 *
 * Returnerer `null` når registeret ikke svarer (nummeret finnes ikke, tidsavbrudd, nede) og
 * en TOM LISTE når org-en ikke har styreroller. Kalleren viser ulik melding for de to — «vi
 * fikk ikke svar» og «det står ingenting der» er to forskjellige beskjeder til brukeren.
 *
 * Tidsavbruddet er ikke valgfritt: uten det kan et hengende register holde på en
 * serverforbindelse til den ryker av seg selv.
 */
export async function hentStyre(orgNr: string): Promise<Styremedlem[] | null> {
  const rent = orgNr.replace(/\D/g, "");
  if (rent.length !== 9) return null;

  let res: Response;
  try {
    res = await fetch(`https://data.brreg.no/enhetsregisteret/api/enheter/${rent}/roller`, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  return tolkStyre((await res.json()) as RollerSvar);
}
