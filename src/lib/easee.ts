/**
 * Easee-adapteret — HTTP-laget mot `api.easee.com`. Ingen databasetilgang her; det ligger
 * i `easeekobling.ts`. Designnotatet er `docs/easee.md`. Importfri fil: etikettene for
 * ladertilstand brukes også av klienten.
 *
 * ## Hvitelista — kun lesing
 *
 * `TILLATTE_KALL` er de eneste kombinasjonene av metode og sti som slipper ut. De to
 * POST-ene er innlogging og tokenfornying; alt annet er GET. DriftIQ starter, stopper
 * eller styrer aldri en lader, endrer aldri strømgrenser, planer eller innstillinger. Det
 * er løftet til kunden — og grunnen til at tokenene kan lagres med god samvittighet.
 * `tests/easee.test.ts` låser lista.
 *
 * ## Auth
 *
 * `POST /api/accounts/login` med brukernavn (e-post eller mobil med landkode) og passord
 * gir `accessToken` (1 time) + `refreshToken`. Passordet brukes én gang ved tilkobling og
 * lagres aldri; tokenene lagres kryptert og fornyes med `POST /api/accounts/refresh_token`
 * før utløp (og ved 401 — Easee sier tokenet skal fornyes «if it expires or is
 * invalidated»). Svikter fornyingen, må kontoadmin koble til på nytt.
 *
 * ## Ratebegrensning
 *
 * Økt-endepunktene er begrenset til 10 kall per time per lader, `GET /api/chargers` til 2
 * per minutt. Derfor hentes tilstanden for HELE anlegget i ett kall
 * (`/api/sites/{id}/state`), og månedsforbruket lagres i basen i stedet for å hentes ved
 * hver visning.
 */

export const EASEE_API = "https://api.easee.com";

export const TILLATTE_KALL: ReadonlyArray<{ metode: "GET" | "POST"; monster: RegExp; hva: string }> = [
  { metode: "POST", monster: /^\/api\/accounts\/login$/, hva: "token fra brukernavn og passord" },
  { metode: "POST", monster: /^\/api\/accounts\/refresh_token$/, hva: "fornye token" },
  { metode: "GET", monster: /^\/api\/accounts\/profile$/, hva: "kontoen tokenet hører til" },
  { metode: "GET", monster: /^\/api\/sites$/, hva: "anleggene kontoen når" },
  { metode: "GET", monster: /^\/api\/sites\/\d+$/, hva: "ett anlegg med kurser og ladere" },
  { metode: "GET", monster: /^\/api\/sites\/\d+\/state$/, hva: "tilstanden til alle laderne i anlegget" },
  { metode: "GET", monster: /^\/api\/chargers\/lifetime-energy\/[A-Za-z0-9_-]+\/monthly$/, hva: "månedsforbruk for én lader" },
  { metode: "GET", monster: /^\/api\/chargers\/lifetime-energy\/[A-Za-z0-9_-]+\/hourly$/, hva: "timesforbruk for én lader" },
  { metode: "GET", monster: /^\/api\/sessions\/charger\/[A-Za-z0-9_-]+\/sessions\/[^/]+\/[^/]+$/, hva: "ladeøkter for én lader" },
];

export class EaseeFeil extends Error {
  constructor(
    readonly status: number,
    melding: string,
  ) {
    super(melding);
    this.name = "EaseeFeil";
  }
}

export function erTillatt(metode: string, sti: string): boolean {
  const [ren] = sti.split("?");
  return TILLATTE_KALL.some((k) => k.metode === metode && k.monster.test(ren ?? ""));
}

/** Det ene stedet auth-formen bestemmes. */
export function autorisasjon(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Ett kall. Feil fra Easee blir `EaseeFeil` med Easees egen melding (problem-JSON med
 * `title`/`detail`). 401 betyr utløpt eller avvist token; kallstedet fornyer eller ber om
 * ny innlogging i klartekst.
 */
export async function easeeKall<T>(
  accessToken: string | null,
  metode: "GET" | "POST",
  sti: string,
  opts: { kropp?: unknown; sok?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  if (!erTillatt(metode, sti)) {
    throw new Error(`Easee-kall utenfor hvitelista: ${metode} ${sti}`);
  }
  const url = new URL(`${EASEE_API}${sti}`);
  for (const [k, v] of Object.entries(opts.sok ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const svar = await fetch(url, {
    method: metode,
    headers: {
      Accept: "application/json",
      ...(accessToken ? autorisasjon(accessToken) : {}),
      ...(opts.kropp !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.kropp !== undefined ? JSON.stringify(opts.kropp) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!svar.ok) {
    const tekst = await svar.text().catch(() => "");
    let melding = tekst.slice(0, 200);
    try {
      // Easees problem-JSON: `title` er teksten, `errorCodeName` koden (104 InvalidRefreshToken,
      // 105 RefreshTokenExpired, …). `detail` er «[Empty in production]» og sier ingenting.
      const j = JSON.parse(tekst) as { detail?: string; title?: string; message?: string; errorCodeName?: string };
      const tittel = j.title ?? j.message ?? j.errorCodeName ?? (j.detail && !j.detail.startsWith("[Empty") ? j.detail : undefined);
      if (tittel) melding = j.errorCodeName && j.errorCodeName !== tittel ? `${tittel} (${j.errorCodeName})` : tittel;
    } catch {
      // ikke JSON — behold teksten
    }
    if (svar.status === 401) {
      // Fornyingen svarer 401 både når refresh-tokenet er brukt (rotert) og når det er utløpt —
      // Easees egen kode må med, ellers er de to umulige å skille i ettertid.
      if (sti === "/api/accounts/login") melding = "Easee avviste brukernavn eller passord";
      else if (sti === "/api/accounts/refresh_token") melding = `Easee avviste refresh-tokenet: ${melding || "401"}`;
      else melding = "Easee-innloggingen er utløpt — koble til på nytt";
    }
    if (svar.status === 403) melding = "Easee-kontoen har ikke tilgang til dette anlegget";
    if (svar.status === 429) melding = "Easee begrenser antall kall — prøv igjen om noen minutter";
    throw new EaseeFeil(svar.status, melding || `Easee svarte ${svar.status}`);
  }
  if (svar.status === 204) return undefined as T;
  return (await svar.json()) as T;
}

// ---------------------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------------------

export type EaseeToken = { accessToken: string; refreshToken: string; expiresIn?: number; tokenType?: string };

/** Passordet brukes her og bare her — det lagres aldri. */
export async function loggInn(userName: string, password: string): Promise<EaseeToken> {
  return easeeKall<EaseeToken>(null, "POST", "/api/accounts/login", { kropp: { userName, password } });
}

/** Dokumentasjonen ber om `refreshToken`; `accessToken` sendes også, som Easees egne klienter gjør. */
export async function fornyToken(accessToken: string, refreshToken: string): Promise<EaseeToken> {
  return easeeKall<EaseeToken>(null, "POST", "/api/accounts/refresh_token", { kropp: { accessToken, refreshToken } });
}

// ---------------------------------------------------------------------------------------
// Ladertilstand — Easees `chargerOpMode`
// ---------------------------------------------------------------------------------------

export const OP_MODE: Record<number, { etikett: string; merke: "ok" | "info" | "warn" | "danger" | "muted" }> = {
  0: { etikett: "Frakoblet", merke: "danger" },
  1: { etikett: "Ingen bil", merke: "muted" },
  2: { etikett: "Venter på start", merke: "info" },
  3: { etikett: "Lader", merke: "ok" },
  4: { etikett: "Fullført", merke: "info" },
  5: { etikett: "Feil", merke: "danger" },
  6: { etikett: "Klar til lading", merke: "info" },
  7: { etikett: "Venter på godkjenning", merke: "warn" },
  8: { etikett: "Avslutter", merke: "muted" },
};

export function opModeTekst(opMode: number | null | undefined, isOnline: boolean | null | undefined) {
  if (isOnline === false) return OP_MODE[0]!;
  if (opMode === null || opMode === undefined) return { etikett: "Ukjent", merke: "muted" as const };
  return OP_MODE[opMode] ?? { etikett: `Tilstand ${opMode}`, merke: "muted" as const };
}

// ---------------------------------------------------------------------------------------
// Datatyper — bare feltene vi bruker
// ---------------------------------------------------------------------------------------

export type EaseeProfil = { userId?: number; eMail?: string | null; phoneNo?: string | null; firstName?: string | null; lastName?: string | null };

export type EaseeSite = {
  id: number;
  uuid?: string;
  siteKey?: string;
  name: string;
  address?: { street?: string | null; buildingNumber?: string | null; zip?: string | null; area?: string | null } | null;
  costPerKWh?: number | null;
  currencyId?: string | null;
  userRole?: number | string | null;
};

export type EaseeLader = { id: string; name?: string | null; productCode?: number | string | null };

export type EaseeKurs = { id: number; panelName?: string | null; chargers?: EaseeLader[] | null };

export type EaseeSiteDetalj = EaseeSite & { circuits?: EaseeKurs[] | null };

export type EaseeLaderTilstand = {
  chargerOpMode?: number | null;
  totalPower?: number | null;
  sessionEnergy?: number | null;
  isOnline?: boolean | null;
  lifetimeEnergy?: number | null;
  latestPulse?: string | null;
  errorCode?: number | null;
  reasonForNoCurrent?: number | null;
};

/**
 * Easees `reasonForNoCurrent` (observasjon 96) på norsk — hvorfor en bil som står i ikke
 * får strøm. Gruppene 1–6 og 25–30 er lastbalansering; 50-serien er laderen selv;
 * 75-serien er begrensninger. Ukjente koder vises som tallet.
 */
export const GRUNN_INGEN_STROM: Record<number, string> = {
  0: "",
  1: "lastbalansering", 2: "lastbalansering", 3: "lastbalansering", 4: "lastbalansering", 5: "lastbalansering", 6: "lastbalansering",
  7: "ugyldig nettype", 8: "hovedenheten har ikke fått strømforespørsel", 9: "mistet kontakt med hovedenheten",
  10: "for lite strøm fra Equalizer", 11: "fase ikke tilkoblet",
  25: "begrenset av kurssikring", 26: "begrenset av kursens maksstrøm", 27: "begrenset av dynamisk kursstrøm",
  28: "begrenset av Equalizer", 29: "begrenset av lastbalansering i kursen", 30: "begrenset av frakoblet-innstilling",
  50: "bilen ber ikke om strøm", 51: "laderens maksstrøm for lav", 52: "dynamisk maksstrøm for lav", 53: "laderen er deaktivert",
  54: "venter på planlagt lading", 55: "venter på godkjenning", 56: "laderen er i feiltilstand", 57: "bilen oppfører seg uregelmessig",
  75: "begrenset av kabelen", 76: "begrenset av ladeplan", 77: "begrenset av laderens maksstrøm", 78: "begrenset av dynamisk laderstrøm",
  79: "bilen lader ikke (full?)", 80: "begrenset lokalt", 81: "begrenset av bilen", 100: "udefinert feil",
};

export function grunnTekst(kode: number | null | undefined): string | null {
  if (kode === null || kode === undefined || kode === 0) return null;
  return GRUNN_INGEN_STROM[kode] ?? `kode ${kode}`;
}

export type EaseeSiteTilstand = {
  circuitStates?: Array<{
    circuit?: EaseeKurs | null;
    chargerStates?: Array<{ chargerID: string; chargerState?: EaseeLaderTilstand | null }> | null;
  }> | null;
  site?: EaseeSiteDetalj | null;
};

export type EaseeMaanedsforbruk = { year: number; month: number | null; consumption: number; date?: string };

export type EaseeTimeforbruk = { year: number; month: number | null; day: number | null; hour: number | null; consumption: number; date: string };

export type EaseeOkt = {
  id: number;
  chargerId?: string;
  carConnected: string | null;
  carDisconnected: string | null;
  kiloWattHours: number;
  isComplete?: boolean;
  actualDurationSeconds?: number | null;
  pricePerKwhExcludingVat?: number | null;
  costIncludingVat?: number | null;
  currency?: string | null;
};

// ---------------------------------------------------------------------------------------
// Kallene
// ---------------------------------------------------------------------------------------

export async function hentProfil(token: string): Promise<EaseeProfil> {
  return easeeKall<EaseeProfil>(token, "GET", "/api/accounts/profile");
}

/** Anleggene kontoen når. Easee paginerer med offset/limit; et sameie har ett, kanskje to. */
export async function hentAnlegg(token: string): Promise<EaseeSite[]> {
  const alle: EaseeSite[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const side = await easeeKall<EaseeSite[]>(token, "GET", "/api/sites", { sok: { offset, limit: 100 } });
    alle.push(...(Array.isArray(side) ? side : []));
    if (!Array.isArray(side) || side.length < 100) break;
  }
  return alle;
}

export async function hentAnleggDetalj(token: string, siteId: number): Promise<EaseeSiteDetalj> {
  return easeeKall<EaseeSiteDetalj>(token, "GET", `/api/sites/${siteId}`, { sok: { detailed: "true" } });
}

/** Tilstanden til alle laderne i anlegget — ETT kall, uansett antall ladere. */
export async function hentAnleggTilstand(token: string, siteId: number): Promise<EaseeSiteTilstand> {
  return easeeKall<EaseeSiteTilstand>(token, "GET", `/api/sites/${siteId}/state`);
}

/** Laderne i et anlegg, flatet ut fra kursene, med kursnavn. */
export function laderneI(site: EaseeSiteDetalj | null | undefined): Array<{ id: string; name: string; circuitName: string | null }> {
  const ut: Array<{ id: string; name: string; circuitName: string | null }> = [];
  for (const kurs of site?.circuits ?? []) {
    for (const l of kurs.chargers ?? []) {
      if (!l?.id) continue;
      ut.push({ id: l.id, name: (l.name ?? "").trim() || l.id, circuitName: kurs.panelName?.trim() || null });
    }
  }
  return ut.sort((a, b) => a.name.localeCompare(b.name, "nb"));
}

/** Tilstandene i et anleggssvar, per lader-id. Kurser uten tilstand hoppes over. */
export function tilstandeneI(t: EaseeSiteTilstand | null | undefined): Map<string, EaseeLaderTilstand> {
  const ut = new Map<string, EaseeLaderTilstand>();
  for (const k of t?.circuitStates ?? []) {
    for (const s of k.chargerStates ?? []) {
      if (s?.chargerID && s.chargerState) ut.set(s.chargerID, s.chargerState);
    }
  }
  return ut;
}

/**
 * Månedsforbruk (kWh) for én lader i perioden. Easee svarer med én rad per måned med
 * `consumption` — et periodetall, ikke akkumulert.
 */
export async function hentMaanedsforbruk(token: string, chargerId: string, fra: Date, til: Date): Promise<EaseeMaanedsforbruk[]> {
  const r = await easeeKall<EaseeMaanedsforbruk[]>(token, "GET", `/api/chargers/lifetime-energy/${chargerId}/monthly`, {
    sok: { from: fra.toISOString(), to: til.toISOString() },
  });
  return Array.isArray(r) ? r.filter((m) => typeof m.year === "number" && typeof m.month === "number") : [];
}

/**
 * Timesforbruk (kWh per time) for én lader i perioden. `date` er timens start i UTC
 * («2026-07-23T15:00:00+00:00»); år/måned/dag/time-feltene brukes ikke, tidspunktet
 * leses fra `date`.
 */
export async function hentTimesforbruk(token: string, chargerId: string, fra: Date, til: Date): Promise<Array<{ start: Date; kwh: number }>> {
  const r = await easeeKall<EaseeTimeforbruk[]>(token, "GET", `/api/chargers/lifetime-energy/${chargerId}/hourly`, {
    sok: { from: fra.toISOString(), to: til.toISOString() },
  });
  return (Array.isArray(r) ? r : [])
    .map((t) => ({ start: new Date(t.date), kwh: Number(t.consumption) || 0 }))
    .filter((t) => !Number.isNaN(t.start.getTime()));
}

/**
 * Ladeøktene for én lader i perioden — ratebegrenset til 10 kall per time per lader, så
 * dette kalles av jobben (én gang i døgnet) og av «Oppdater fra Easee», aldri ved visning.
 */
export async function hentOkter(token: string, chargerId: string, fra: Date, til: Date): Promise<EaseeOkt[]> {
  const r = await easeeKall<EaseeOkt[]>(token, "GET", `/api/sessions/charger/${chargerId}/sessions/${fra.toISOString()}/${til.toISOString()}`);
  return (Array.isArray(r) ? r : []).filter((o) => typeof o.id === "number" && o.carConnected);
}
