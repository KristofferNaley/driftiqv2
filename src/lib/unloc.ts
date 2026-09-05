/**
 * Unloc-adapteret — HTTP-laget mot `api.unloc.app/v2`. Ingen databasetilgang her; det
 * ligger i `unlockobling.ts`. Designnotatet er `docs/unloc.md`.
 *
 * ## Hvitelista
 *
 * Samme grep som Fiken-adapteret: `TILLATTE_KALL` er de eneste kombinasjonene av metode
 * og sti klienten sender, og alt annet kaster før noe går på nettet. Forskjellen er at
 * lista her HAR skrivekall — å dele ut og kalle tilbake nøkler er hele poenget — men bare
 * dem: DriftIQ rører aldri låser, låsforbindelser, adgangsgrupper eller administrerte
 * brukere i Unloc. `tests/unloc.test.ts` låser lista.
 *
 * ## Auth
 *
 * Client credentials → JWT med `project.admin`-scope, gyldig en time. Tokenet holdes i
 * minnet per org (`tokenCache`) — Unloc ber selv om at man ikke henter nytt per kall.
 *
 * ## Nøkler opprettes asynkront
 *
 * `POST /keys` svarer 202 med en jobbreferanse; nøkkelen finnes først når jobben er
 * `succeeded`. `opprettNokkel` poller jobben i inntil ~10 sekunder og faller tilbake til
 * et søk på (lås, telefon) hvis jobben bruker lengre tid — raden får da state «creating»
 * og friskes opp neste gang fanen åpnes.
 */

export const UNLOC_API = "https://api.unloc.app";

export const TILLATTE_KALL: ReadonlyArray<{ metode: "GET" | "POST" | "DELETE"; monster: RegExp; hva: string }> = [
  { metode: "POST", monster: /^\/v2\/auth\/token\/$/, hva: "token fra client credentials" },
  { metode: "POST", monster: /^\/v2\/auth\/resources-discovery\/$/, hva: "hvilke prosjekter credentials når" },
  { metode: "GET", monster: /^\/v2\/projects\/[A-Za-z0-9_-]+$/, hva: "ett prosjekt (navn)" },
  { metode: "GET", monster: /^\/v2\/projects\/[A-Za-z0-9_-]+\/locks$/, hva: "låsene i prosjektet" },
  { metode: "GET", monster: /^\/v2\/projects\/[A-Za-z0-9_-]+\/keys$/, hva: "nøklene i prosjektet" },
  { metode: "GET", monster: /^\/v2\/projects\/[A-Za-z0-9_-]+\/keys\/[A-Za-z0-9_-]+$/, hva: "én nøkkel" },
  { metode: "GET", monster: /^\/v2\/projects\/[A-Za-z0-9_-]+\/jobs\/[A-Za-z0-9_-]+$/, hva: "status på opprettelsesjobb" },
  { metode: "POST", monster: /^\/v2\/projects\/[A-Za-z0-9_-]+\/keys$/, hva: "dele ut nøkkel" },
  { metode: "DELETE", monster: /^\/v2\/projects\/[A-Za-z0-9_-]+\/keys\/[A-Za-z0-9_-]+$/, hva: "kalle tilbake nøkkel" },
];

export class UnlocFeil extends Error {
  constructor(
    readonly status: number,
    melding: string,
  ) {
    super(melding);
    this.name = "UnlocFeil";
  }
}

export function erTillatt(metode: string, sti: string): boolean {
  const [ren] = sti.split("?");
  return TILLATTE_KALL.some((k) => k.metode === metode && k.monster.test(ren ?? ""));
}

/**
 * Ett kall. Feil fra Unloc blir `UnlocFeil` med Unlocs egen melding (`detail`/`title` i
 * problem-format, `errorDescription` ved 401). 401 betyr avviste credentials, og kallstedet
 * skal si det i klartekst.
 */
export async function unlocKall<T>(
  token: string | null,
  metode: "GET" | "POST" | "DELETE",
  sti: string,
  opts: { kropp?: unknown; sok?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  if (!erTillatt(metode, sti)) {
    throw new Error(`Unloc-kall utenfor hvitelista: ${metode} ${sti}`);
  }
  const url = new URL(`${UNLOC_API}${sti}`);
  for (const [k, v] of Object.entries(opts.sok ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const svar = await fetch(url, {
    method: metode,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.kropp !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.kropp !== undefined ? JSON.stringify(opts.kropp) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!svar.ok) {
    const tekst = await svar.text().catch(() => "");
    let melding = tekst.slice(0, 200);
    try {
      const j = JSON.parse(tekst) as {
        detail?: string; title?: string; errorDescription?: string; error_description?: string; error?: string;
        invalidParams?: Array<{ name?: string; reason?: string }>;
      };
      melding = j.detail ?? j.title ?? j.errorDescription ?? j.error_description ?? j.error ?? melding;
      if (j.invalidParams?.length) {
        melding += ` (${j.invalidParams.map((p) => [p.name, p.reason].filter(Boolean).join(": ")).join("; ")})`;
      }
    } catch {
      // ikke JSON — behold teksten
    }
    if (svar.status === 401) melding = "Unloc avviste tilgangen — sjekk client id og secret, eller koble til på nytt";
    if (svar.status === 403) melding = "Credentials har ikke tilgang til dette prosjektet i Unloc";
    throw new UnlocFeil(svar.status, melding || `Unloc svarte ${svar.status}`);
  }
  if (svar.status === 204) return undefined as T;
  return (await svar.json()) as T;
}

// ---------------------------------------------------------------------------------------
// Telefonnummer
// ---------------------------------------------------------------------------------------

/**
 * Unloc identifiserer mottakeren med E.164 (`+4791234567`). Styret skriver «912 34 567»
 * eller «+47 912 34 567» — begge skal bli riktig. Åtte siffer uten landkode = norsk.
 * Returnerer null når det ikke kan bli et gyldig nummer, så skjemaet kan si fra før Unloc.
 */
export function tilE164(inn: string): string | null {
  let s = inn.replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (/^\d{8}$/.test(s)) s = `+47${s}`;
  if (/^47\d{8}$/.test(s)) s = `+${s}`;
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

/** Lesbar norsk form: `+47 912 34 567`. Andre landkoder vises som de er. */
export function visTelefon(e164: string): string {
  const m = /^\+47(\d{3})(\d{2})(\d{3})$/.exec(e164);
  return m ? `+47 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

// ---------------------------------------------------------------------------------------
// Datatyper — bare feltene vi bruker
// ---------------------------------------------------------------------------------------

export type UnlocToken = { access_token: string; expires_in?: number; organization_id?: string; project_id?: string };

export type UnlocRessurser = {
  resources: {
    projects: Array<{ projectId: string; scope: string }>;
    organizations: Array<{ organizationId: string; scope: string }>;
  };
};

export type UnlocProsjekt = { id: string; name: string; organizationId: string };

export type UnlocLaas = {
  id: string;
  name: string;
  vendor?: string;
  address?: { street?: string; floor?: string; visitorInstructions?: string } | null;
  batteryStatus?: { batteryLevel?: string } | null;
};

export type UnlocNokkelState = "creating" | "scheduled" | "active" | "inactive" | "expired" | "revoked" | "error";

export type UnlocNokkel = {
  id: string;
  lockId: string;
  appUser?: { id: string; name?: string } | null;
  start?: string;
  end?: string | null;
  created?: string;
  state?: UnlocNokkelState;
};

export type UnlocJobb = {
  id: string;
  status: "pending" | "inProgress" | "succeeded" | "failedValidation" | "failedJob" | "timeout";
  failureReason?: string;
  resultData?: { createdKeys?: unknown[]; failedKeys?: unknown[]; creatingKeys?: unknown[] };
};

// ---------------------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------------------

export type Credentials = { clientId: string; clientSecret: string };

export async function hentRessurser(c: Credentials): Promise<UnlocRessurser> {
  return unlocKall<UnlocRessurser>(null, "POST", "/v2/auth/resources-discovery/", {
    kropp: { client_id: c.clientId, client_secret: c.clientSecret },
  });
}

export async function hentProsjektToken(c: Credentials, projectId: string): Promise<UnlocToken> {
  return unlocKall<UnlocToken>(null, "POST", "/v2/auth/token/", {
    kropp: { grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret, scope: "project.admin", project_id: projectId },
  });
}

const tokenCache = new Map<string, { token: string; utloper: number }>();

/**
 * Prosjekt-token, hentet på nytt først når det er under fem minutter igjen. Nøkkelen i
 * cachen er (clientId, projectId) — byttes credentials, treffer man aldri et gammelt token.
 */
export async function gyldigProsjektToken(c: Credentials, projectId: string, naa = Date.now()): Promise<string> {
  const nokkel = `${c.clientId}:${projectId}`;
  const t = tokenCache.get(nokkel);
  if (t && t.utloper - naa > 5 * 60 * 1000) return t.token;
  const nytt = await hentProsjektToken(c, projectId);
  tokenCache.set(nokkel, { token: nytt.access_token, utloper: naa + (nytt.expires_in ?? 3600) * 1000 });
  return nytt.access_token;
}

/** Testene og frakobling: glem tokens for et sett credentials. */
export function glemTokens(clientId?: string) {
  if (!clientId) return tokenCache.clear();
  for (const k of [...tokenCache.keys()]) if (k.startsWith(`${clientId}:`)) tokenCache.delete(k);
}

// ---------------------------------------------------------------------------------------
// Prosjekt, låser, nøkler
// ---------------------------------------------------------------------------------------

export async function hentProsjekt(token: string, projectId: string): Promise<UnlocProsjekt> {
  return (await unlocKall<{ project: UnlocProsjekt }>(token, "GET", `/v2/projects/${projectId}`)).project;
}

/** Alle låser i prosjektet, side for side (Unloc pagineres med `startAfterId`). */
export async function hentLaaser(token: string, projectId: string): Promise<UnlocLaas[]> {
  const alle: UnlocLaas[] = [];
  let startAfterId: string | undefined;
  for (let side = 0; side < 20; side++) {
    const r = await unlocKall<{ locks: UnlocLaas[] }>(token, "GET", `/v2/projects/${projectId}/locks`, {
      sok: { limit: 500, startAfterId },
    });
    alle.push(...r.locks);
    if (r.locks.length < 500) break;
    startAfterId = r.locks[r.locks.length - 1]?.id;
  }
  return alle.sort((a, b) => a.name.localeCompare(b.name, "nb"));
}

/** Nøkler i prosjektet, valgfritt filtrert på lås og/eller telefon. */
export async function hentNokler(
  token: string,
  projectId: string,
  filter: { lockId?: string; appUserId?: string } = {},
): Promise<UnlocNokkel[]> {
  const alle: UnlocNokkel[] = [];
  let startAfterId: string | undefined;
  for (let side = 0; side < 20; side++) {
    const r = await unlocKall<{ keys: UnlocNokkel[] }>(token, "GET", `/v2/projects/${projectId}/keys`, {
      sok: { limit: 500, startAfterId, lockId: filter.lockId, appUserId: filter.appUserId },
    });
    alle.push(...r.keys);
    if (r.keys.length < 500) break;
    startAfterId = r.keys[r.keys.length - 1]?.id;
  }
  return alle;
}

export async function hentNokkel(token: string, projectId: string, keyId: string): Promise<UnlocNokkel> {
  return (await unlocKall<{ key: UnlocNokkel }>(token, "GET", `/v2/projects/${projectId}/keys/${keyId}`)).key;
}

export type NyNokkelInn = {
  lockId: string;
  appUserId: string;
  /** null = nå. Feltet UTELATES da — Unloc avviser `null` med «must be of type string», tross dokumentasjonen. */
  start: string | null;
  /** null = uten utløp. Utelates på samme måte. */
  end: string | null;
  /** Vises i Unloc Control Center på nøkkelen — leverandør og DriftIQ-id, som v1 gjorde. */
  metadata?: Record<string, string>;
};

/** Nøkkelobjektet slik det ligger i jobbresultatet — Unloc dokumenterer bare `object`. */
function nokkelIdFra(x: unknown): string | null {
  if (!x || typeof x !== "object") return null;
  const o = x as { id?: unknown; keyId?: unknown; key?: { id?: unknown } };
  if (typeof o.id === "string") return o.id;
  if (typeof o.keyId === "string") return o.keyId;
  if (o.key && typeof o.key.id === "string") return o.key.id;
  return null;
}

/**
 * Deler ut én nøkkel og venter på at jobben blir ferdig. Returnerer nøkkelens id og
 * tilstand slik Unloc rapporterer den — eller `state: "creating"` når jobben ennå ikke
 * er ferdig etter ventetiden og nøkkelen ikke kunne finnes ved søk.
 */
export async function opprettNokkel(
  token: string,
  projectId: string,
  inn: NyNokkelInn,
  opts: { vent?: (ms: number) => Promise<void>; maksForsok?: number } = {},
): Promise<{ id: string; state: UnlocNokkelState }> {
  const vent = opts.vent ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const startet = Date.now();
  const { jobRef } = await unlocKall<{ jobRef: { id: string } }>(token, "POST", `/v2/projects/${projectId}/keys`, {
    kropp: {
      keys: [{
        lockId: inn.lockId,
        appUserId: inn.appUserId,
        ...(inn.start ? { start: inn.start } : {}),
        ...(inn.end ? { end: inn.end } : {}),
        ...(inn.metadata ? { metadata: inn.metadata } : {}),
      }],
    },
  });

  for (let forsok = 0; forsok < (opts.maksForsok ?? 12); forsok++) {
    await vent(forsok === 0 ? 400 : 800);
    const { job } = await unlocKall<{ job: UnlocJobb }>(token, "GET", `/v2/projects/${projectId}/jobs/${jobRef.id}`);
    if (job.status === "succeeded") {
      const id = nokkelIdFra(job.resultData?.createdKeys?.[0]);
      if (id) {
        const n = await hentNokkel(token, projectId, id).catch(() => null);
        return { id, state: n?.state ?? "active" };
      }
      break; // ferdig, men uventet form — finn nøkkelen ved søk under
    }
    if (job.status === "failedValidation" || job.status === "failedJob" || job.status === "timeout") {
      const grunn = job.failureReason ?? beskrivFeiletNokkel(job.resultData?.failedKeys?.[0]);
      throw new UnlocFeil(502, `Unloc kunne ikke opprette nøkkelen${grunn ? `: ${grunn}` : ""}`);
    }
  }

  // Jobben tok lengre tid enn vi venter i en forespørsel, eller resultatet manglet id:
  // nøkkelen ble opprettet for (lås, telefon) nå nettopp — finn den nyeste.
  const kandidater = (await hentNokler(token, projectId, { lockId: inn.lockId, appUserId: inn.appUserId }))
    .filter((k) => !k.created || Date.parse(k.created) >= startet - 60_000)
    .sort((a, b) => Date.parse(b.created ?? "0") - Date.parse(a.created ?? "0"));
  const k = kandidater[0];
  if (!k) throw new UnlocFeil(504, "Unloc bekreftet ikke nøkkelen i tide — prøv igjen om et øyeblikk, og sjekk om den likevel dukket opp");
  return { id: k.id, state: k.state ?? "creating" };
}

function beskrivFeiletNokkel(x: unknown): string | null {
  if (!x || typeof x !== "object") return null;
  const o = x as { reason?: unknown; error?: unknown; message?: unknown };
  const r = o.reason ?? o.error ?? o.message;
  return typeof r === "string" ? r : null;
}

export async function tilbakekallNokkel(token: string, projectId: string, keyId: string): Promise<void> {
  await unlocKall<unknown>(token, "DELETE", `/v2/projects/${projectId}/keys/${keyId}`);
}
