/**
 * Fiken-adapteret — HTTP-laget mot `api.fiken.no/api/v2`. Ingen databasetilgang her; det
 * ligger i `fikenkobling.ts`. Designnotatet er `docs/fiken.md`.
 *
 * ## Hvitelista er løftet til kunden
 *
 * «DriftIQ oppretter fakturaer, kreditnotaer og innboksdokumenter i Fiken — bokfører aldri
 * kjøp, sletter aldri, endrer aldri noe det ikke selv har laget.» Løftet håndheves her:
 * `TILLATTE_KALL` er de eneste kombinasjonene av metode og sti klienten sender, og alt
 * annet kaster før noe går på nettet. `tests/fiken.test.ts` låser lista. Steg 2 (lesing)
 * har bare GET; skrivekallene kommer med steg 3 og må legges til HER, synlig i diffen.
 *
 * ## Rate limit
 *
 * Fiken bremser over 4 kall/sekund per nøkkel. Alt her går sekvensielt, og synkjobben går
 * gjennom orgene én om gangen — ingen `Promise.all` mot Fiken.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const FIKEN_API = "https://api.fiken.no/api/v2";
export const FIKEN_OAUTH_AUTHORIZE = "https://fiken.no/oauth/authorize";
export const FIKEN_OAUTH_TOKEN = "https://fiken.no/oauth/token";

/** Metode + sti-mønster. `{slug}` og `{id}` er plassholdere; ingen andre kall slipper ut. */
export const TILLATTE_KALL: ReadonlyArray<{ metode: "GET"; monster: RegExp; hva: string }> = [
  { metode: "GET", monster: /^\/companies$/, hva: "foretakene nøkkelen har tilgang til" },
  { metode: "GET", monster: /^\/companies\/[a-z0-9-]+$/, hva: "ett foretak" },
  { metode: "GET", monster: /^\/companies\/[a-z0-9-]+\/purchases$/, hva: "bokførte kjøp" },
  { metode: "GET", monster: /^\/companies\/[a-z0-9-]+\/accountBalances$/, hva: "saldo per konto" },
];

export class FikenFeil extends Error {
  constructor(
    readonly status: number,
    melding: string,
  ) {
    super(melding);
    this.name = "FikenFeil";
  }
}

export function erTillatt(metode: string, sti: string): boolean {
  const [ren] = sti.split("?");
  return TILLATTE_KALL.some((k) => k.metode === metode && k.monster.test(ren ?? ""));
}

/**
 * Ett kall. Svaret kommer som JSON pluss sidetellerne Fiken setter i headere. Feil fra
 * Fiken blir `FikenFeil` med Fikens egen melding — 401 betyr utgått eller trukket token,
 * og kallstedet skal si det i klartekst, ikke «Noe gikk galt».
 */
export async function fikenKall<T>(
  token: string,
  metode: "GET",
  sti: string,
  opts: { sok?: Record<string, string | number | undefined> } = {},
): Promise<{ data: T; sider: number; antall: number }> {
  if (!erTillatt(metode, sti)) {
    throw new Error(`Fiken-kall utenfor hvitelista: ${metode} ${sti}`);
  }
  const url = new URL(`${FIKEN_API}${sti}`);
  for (const [k, v] of Object.entries(opts.sok ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const svar = await fetch(url, {
    method: metode,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!svar.ok) {
    const tekst = await svar.text().catch(() => "");
    let melding = tekst.slice(0, 200);
    try {
      const j = JSON.parse(tekst) as { message?: string; error_description?: string; error?: string };
      melding = j.message ?? j.error_description ?? j.error ?? melding;
    } catch {
      // ikke JSON — behold teksten
    }
    if (svar.status === 401) melding = "Fiken avviste tilgangen — koblingen må settes opp på nytt";
    if (svar.status === 402) melding = "Modulen er ikke aktivert i Fiken for dette foretaket";
    throw new FikenFeil(svar.status, melding || `Fiken svarte ${svar.status}`);
  }
  return {
    data: (await svar.json()) as T,
    sider: Number(svar.headers.get("fiken-api-page-count") ?? 1),
    antall: Number(svar.headers.get("fiken-api-result-count") ?? 0),
  };
}

// ---------------------------------------------------------------------------------------
// Datatyper — bare feltene vi bruker
// ---------------------------------------------------------------------------------------

export type FikenForetak = {
  slug: string;
  name: string;
  organizationNumber?: string | null;
  vatType?: string | null;
};

export type FikenKjop = {
  purchaseId: number;
  identifier?: string | null;
  date: string;
  dueDate?: string | null;
  kind: string;
  paid?: boolean;
  settled?: boolean;
  deleted?: boolean;
  lines: Array<{ description?: string | null; netPrice: number; vat: number; account?: string | null }>;
  supplier?: { name?: string | null; organizationNumber?: string | null } | null;
};

export async function hentForetak(token: string): Promise<FikenForetak[]> {
  return (await fikenKall<FikenForetak[]>(token, "GET", "/companies")).data;
}

/**
 * Alle kjøp, side for side. `sidenDato` (ÅÅÅÅ-MM-DD) bruker `lastModifiedGe`, som er en
 * DATO, ikke et tidspunkt — inkrementell synk henter «siden i går» og dedupliserer på id.
 */
export async function hentKjop(token: string, slug: string, sidenDato?: string): Promise<FikenKjop[]> {
  const alle: FikenKjop[] = [];
  let side = 0;
  let sider = 1;
  while (side < sider) {
    const r = await fikenKall<FikenKjop[]>(token, "GET", `/companies/${slug}/purchases`, {
      sok: { page: side, pageSize: 100, lastModifiedGe: sidenDato },
    });
    alle.push(...r.data);
    sider = r.sider;
    side++;
    if (side > 50) break; // 5 000 kjøp — mer enn noe sameie har; vern mot evig løkke
  }
  return alle;
}

/** Kjøpet slik det lagres lokalt. Brutto = netto + mva over linjene (inngående mva er kostnad). */
export function tilLokaltKjop(k: FikenKjop) {
  const linjer = k.lines.map((l) => ({
    account: l.account ? Number(l.account) : null,
    description: l.description ?? null,
    net: l.netPrice,
    vat: l.vat,
    gross: l.netPrice + l.vat,
  }));
  return {
    fikenId: String(k.purchaseId),
    date: k.date,
    dueDate: k.dueDate ?? null,
    identifier: k.identifier ?? null,
    supplierName: k.supplier?.name ?? null,
    supplierOrgNumber: k.supplier?.organizationNumber ?? null,
    gross: linjer.reduce((s, l) => s + l.gross, 0),
    paid: Boolean(k.paid),
    settled: Boolean(k.settled),
    deleted: Boolean(k.deleted),
    lines: JSON.stringify(linjer),
  };
}

export type KjopLinje = { account: number | null; description: string | null; net: number; vat: number; gross: number };

export function lesLinjer(json: string): KjopLinje[] {
  try {
    const r = JSON.parse(json);
    return Array.isArray(r) ? (r as KjopLinje[]) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------------------

export const oauthErKonfigurert = () => Boolean(process.env.FIKEN_CLIENT_ID && process.env.FIKEN_CLIENT_SECRET);

/**
 * `state` bærer org-id signert med `BETTER_AUTH_SECRET` — ellers kan en callback lande i
 * feil org. Tidsstempel så en gammel lenke ikke kan brukes om igjen etter en time.
 */
export function lagState(orgId: string, naa = Date.now()): string {
  const nytte = Buffer.from(JSON.stringify({ orgId, t: naa })).toString("base64url");
  return `${nytte}.${signer(nytte)}`;
}

export function lesState(state: string, naa = Date.now()): { orgId: string } | null {
  const [nytte, sig] = state.split(".");
  if (!nytte || !sig) return null;
  const riktig = signer(nytte);
  if (riktig.length !== sig.length || !timingSafeEqual(Buffer.from(riktig), Buffer.from(sig))) return null;
  try {
    const d = JSON.parse(Buffer.from(nytte, "base64url").toString("utf8")) as { orgId?: string; t?: number };
    if (typeof d.orgId !== "string" || typeof d.t !== "number") return null;
    if (naa - d.t > 60 * 60 * 1000) return null;
    return { orgId: d.orgId };
  } catch {
    return null;
  }
}

function signer(tekst: string): string {
  const hemmelighet = process.env.BETTER_AUTH_SECRET ?? "";
  if (!hemmelighet) throw new Error("BETTER_AUTH_SECRET mangler");
  return createHmac("sha256", hemmelighet).update(tekst).digest("base64url");
}

export function autoriseringsUrl(redirectUri: string, state: string): string {
  const u = new URL(FIKEN_OAUTH_AUTHORIZE);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", process.env.FIKEN_CLIENT_ID ?? "");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

export type Tokensvar = { access_token: string; refresh_token?: string; expires_in?: number };

/** Bytter kode mot token, eller fornyer. Fiken bruker Basic-auth med client id/secret. */
export async function hentToken(
  kropp: { grant_type: "authorization_code"; code: string; redirect_uri: string } | { grant_type: "refresh_token"; refresh_token: string },
): Promise<Tokensvar> {
  const id = process.env.FIKEN_CLIENT_ID ?? "";
  const hemmelighet = process.env.FIKEN_CLIENT_SECRET ?? "";
  if (!id || !hemmelighet) throw new Error("FIKEN_CLIENT_ID/FIKEN_CLIENT_SECRET mangler");
  const svar = await fetch(FIKEN_OAUTH_TOKEN, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${hemmelighet}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(kropp as Record<string, string>).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!svar.ok) {
    const t = await svar.text().catch(() => "");
    throw new FikenFeil(svar.status, `Fiken avviste tokenforespørselen (${svar.status}) ${t.slice(0, 200)}`);
  }
  return (await svar.json()) as Tokensvar;
}
