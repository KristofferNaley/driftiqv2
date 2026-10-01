/**
 * «I dag» i plattformpanelet — regelsettet bak kortet «Krever handling».
 *
 * Siden er en arbeidsliste, ikke et dashbord: den skal virke uansett hvor lenge siden du var
 * innom. Ingen regel er derfor bygget rundt «siste døgn». En jobb som feilet for en uke
 * siden og ikke har kjørt vellykket siden, er fortsatt et punkt; en som feilet i går og gikk
 * fint i natt, er det ikke.
 *
 * **Importfri med vilje**, som `kundehandlinger.ts`: dataene hentes i `lib/plattform.ts`
 * (`hentKreverHandling`), reglene er rene funksjoner som testene kaller direkte. En ny regel
 * er én funksjon i `REGLER` — ikke en ny `if` i en komponent.
 */

/** Disken på verten over denne andelen er et punkt. */
export const DISK_GRENSE_PROSENT = 85;
/** En ubesvart innmelding er et punkt når kunden har ventet MER enn så mange arbeidsdager. */
export const SVARFRIST_ARBEIDSDAGER = 1;
/**
 * En besvart sak som fortsatt står som ny/under arbeid, er et punkt når det har gått så
 * mange dager siden siste melding til kunden. Fanger saken som ble svart på og så glemt.
 */
export const STILLE_SAK_DAGER = 14;

const SONE = "Europe/Oslo";
const DAG_MS = 24 * 60 * 60 * 1000;

export type Nivaa = "rod" | "gul";

export type IDagPunkt = {
  /** Stabil nøkkel per punkt (React-key og tester). */
  nokkel: string;
  nivaa: Nivaa;
  tittel: string;
  forklaring: string;
  knapp: { etikett: string; href: string };
};

export type IDagGrunnlag = {
  disk: { prosent: number; bruktGb: number; totaltGb: number } | null;
  /** Appens jobber med siste kjøring. Vertsjobbene logger ikke hit og har `siste: null`. */
  jobber: ReadonlyArray<{
    nokkel: string;
    navn: string;
    siste: { naar: Date; ok: boolean; detail: string | null } | null;
  }>;
  /** Saker som ikke er løst. `sisteSvar` er siste melding til kunden (interne notater teller ikke). */
  saker: ReadonlyArray<{
    id: string;
    nummer: number | null;
    status: string;
    orgNavn: string;
    opprettet: Date;
    sisteSvar: Date | null;
  }>;
  /** Aktive kunder som ikke er demo. */
  kunder: ReadonlyArray<{ id: string; navn: string; epost: string | null }>;
  /** Support-økter som ikke er avsluttet og ikke utløpt. */
  supportokter: ReadonlyArray<{ orgId: string; orgNavn: string; adminNavn: string; utloper: Date }>;
};

type Regel = (g: IDagGrunnlag, naa: Date) => IDagPunkt[];

export const SYSTEM_HREF = "/plattform/innstillinger/system";

export const fmNr = (n: number | null) => `FM-${String(n ?? 0).padStart(4, "0")}`;

const desimal = (n: number) => n.toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** «tor. 1. okt. 07:00» i norsk tid, uansett hvilken sone containeren står i. */
export function tidspunkt(d: Date): string {
  const dato = new Intl.DateTimeFormat("nb-NO", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: SONE,
  }).format(d);
  return `${dato.replace(/,/g, "")} ${klokke(d)}`;
}

/** «14:30» i norsk tid. */
export function klokke(d: Date): string {
  return new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit", timeZone: SONE }).format(d);
}

/** Kalenderdatoen i norsk tid som «2026-10-01». */
export function osloDato(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: SONE }).format(d);
}

/**
 * Hele arbeidsdager (man–fre) som har begynt etter `fra` og fram til og med `til`, regnet i
 * norsk kalender. Meldt mandag: tirsdag = 1, onsdag = 2. Meldt fredag: mandag = 1.
 * Helligdager regnes som arbeidsdager — en ekstra varseldag i påsken er ufarlig.
 */
export function arbeidsdagerMellom(fra: Date, til: Date): number {
  const start = osloDato(fra);
  const slutt = osloDato(til);
  if (slutt <= start) return 0;
  let n = 0;
  // Middag UTC som ankerpunkt, så sommertid aldri flytter oss over en datogrense.
  let d = new Date(`${start}T12:00:00Z`);
  for (;;) {
    d = new Date(d.getTime() + DAG_MS);
    const iso = d.toISOString().slice(0, 10);
    if (iso > slutt) break;
    const ukedag = d.getUTCDay();
    if (ukedag !== 0 && ukedag !== 6) n++;
  }
  return n;
}

const dagerMellom = (fra: Date, til: Date) => Math.floor((til.getTime() - fra.getTime()) / DAG_MS);

const dager = (n: number) => `${n} ${n === 1 ? "dag" : "dager"}`;

export const disk: Regel = (g) => {
  if (!g.disk || g.disk.prosent <= DISK_GRENSE_PROSENT) return [];
  return [
    {
      nokkel: "disk",
      nivaa: g.disk.prosent >= 95 ? "rod" : "gul",
      tittel: `Disk på verten er ${g.disk.prosent} % full`,
      forklaring: `${desimal(g.disk.bruktGb)} av ${desimal(g.disk.totaltGb)} GB brukt.`,
      knapp: { etikett: "Åpne System", href: SYSTEM_HREF },
    },
  ];
};

/** Bare SISTE kjøring teller: en jobb som feilet og så gikk fint, krever ingenting. */
export const jobbFeilet: Regel = (g) =>
  g.jobber
    .filter((j) => j.siste && !j.siste.ok)
    .map((j) => ({
      nokkel: `jobb:${j.nokkel}`,
      nivaa: "rod" as const,
      tittel: `${j.navn} feilet ${tidspunkt(j.siste!.naar)}`,
      forklaring: forsteLinje(j.siste!.detail) ?? "Siste kjøring feilet. Se loggen under System.",
      knapp: { etikett: "Åpne System", href: SYSTEM_HREF },
    }));

/**
 * Kunden venter på svar: ingen melding til kunden, og mer enn én arbeidsdag siden saken kom
 * inn. Samme «ubesvart» som telleren i menyen — men telleren viser alle, her bare de som har
 * ventet for lenge.
 */
export const ubesvartInnmelding: Regel = (g, naa) =>
  g.saker
    .filter((s) => !s.sisteSvar && arbeidsdagerMellom(s.opprettet, naa) > SVARFRIST_ARBEIDSDAGER)
    .map((s) => ({
      nokkel: `ubesvart:${s.id}`,
      nivaa: "rod" as const,
      tittel: `${fmNr(s.nummer)} har ventet på svar i ${dager(dagerMellom(s.opprettet, naa))}`,
      forklaring: `${s.orgNavn}. Kunden har ikke fått noe svar ennå.`,
      knapp: { etikett: "Åpne innmelding", href: `/plattform/saker?apen=${encodeURIComponent(s.id)}` },
    }));

const AKTIV_STATUS: Record<string, string> = { ny: "ny", under_arbeid: "under arbeid" };

/**
 * Besvart, men stille: status «ny» eller «under arbeid», og siste melding til kunden er
 * eldre enn `STILLE_SAK_DAGER`. «Venter på kunde» er utenfor med vilje — da er ballen hos dem.
 */
export const stilleInnmelding: Regel = (g, naa) =>
  g.saker
    .filter(
      (s) =>
        s.sisteSvar &&
        s.status in AKTIV_STATUS &&
        dagerMellom(s.sisteSvar, naa) >= STILLE_SAK_DAGER,
    )
    .map((s) => ({
      nokkel: `stille:${s.id}`,
      nivaa: "gul" as const,
      tittel: `${fmNr(s.nummer)} har vært ${AKTIV_STATUS[s.status]} i ${dager(dagerMellom(s.opprettet, naa))}`,
      forklaring: `${s.orgNavn}. Siste melding til kunden for ${dager(dagerMellom(s.sisteSvar!, naa))} siden.`,
      knapp: { etikett: "Åpne innmelding", href: `/plattform/saker?apen=${encodeURIComponent(s.id)}` },
    }));

export const kundeUtenEpost: Regel = (g) =>
  g.kunder
    .filter((k) => !k.epost?.trim())
    .map((k) => ({
      nokkel: `epost:${k.id}`,
      nivaa: "rod" as const,
      tittel: `${k.navn} mangler e-post`,
      forklaring: "Systemet kan ikke sende varsler eller faktura.",
      knapp: { etikett: "Åpne kunden", href: `/plattform/kunder/${encodeURIComponent(k.id)}` },
    }));

/** Et åpent innsyn er alltid verdt å vite om, også ditt eget som du har glemt å avslutte. */
export const aktivSupport: Regel = (g) =>
  g.supportokter.map((s) => ({
    nokkel: `support:${s.orgId}:${s.adminNavn}`,
    nivaa: "gul" as const,
    tittel: `Support-modus aktiv hos ${s.orgNavn}, utløper ${klokke(s.utloper)}`,
    forklaring: `${s.adminNavn} har innsyn i kundens data.`,
    knapp: { etikett: "Åpne kunden", href: `/plattform/kunder/${encodeURIComponent(s.orgId)}` },
  }));

/** Rekkefølgen her er rekkefølgen på siden, innen samme nivå. */
export const REGLER: ReadonlyArray<Regel> = [
  disk,
  jobbFeilet,
  ubesvartInnmelding,
  stilleInnmelding,
  kundeUtenEpost,
  aktivSupport,
];

/** Alle punktene, røde før gule. */
export function kreverHandling(g: IDagGrunnlag, naa: Date): IDagPunkt[] {
  const alle = REGLER.flatMap((r) => r(g, naa));
  return [...alle.filter((p) => p.nivaa === "rod"), ...alle.filter((p) => p.nivaa === "gul")];
}

function forsteLinje(tekst: string | null): string | null {
  const linje = tekst?.split("\n")[0]?.trim();
  if (!linje) return null;
  return linje.length > 140 ? `${linje.slice(0, 139)}…` : linje;
}

/* ── «Siden sist du var her» ── */

export type SidenSist = {
  /** Forrige innlogging, eller `null` når den er eldre enn innloggingsloggen. */
  fra: string | null;
  leads: number;
  innmeldinger: number;
  supportokter: number;
};

/** Linja under kortet: bare det som ikke er 0. */
export function sidenSistTekst(s: Pick<SidenSist, "leads" | "innmeldinger" | "supportokter">): string {
  const deler = [
    s.leads > 0 && `${s.leads} ${s.leads === 1 ? "nytt lead" : "nye leads"}`,
    s.innmeldinger > 0 && `${s.innmeldinger} ${s.innmeldinger === 1 ? "ny innmelding" : "nye innmeldinger"}`,
    s.supportokter > 0 && `${s.supportokter} ${s.supportokter === 1 ? "support-økt" : "support-økter"}`,
  ].filter((d): d is string => !!d);
  if (deler.length === 0) return "Ingen nye leads, innmeldinger eller support-økter.";
  const liste = deler.length === 1 ? deler[0]! : `${deler.slice(0, -1).join(", ")} og ${deler.at(-1)}`;
  return `${liste[0]!.toUpperCase()}${liste.slice(1)}.`;
}
