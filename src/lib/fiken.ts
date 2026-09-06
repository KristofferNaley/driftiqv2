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
export const TILLATTE_KALL: ReadonlyArray<{ metode: "GET" | "POST"; monster: RegExp; hva: string }> = [
  { metode: "GET", monster: /^\/companies$/, hva: "foretakene nøkkelen har tilgang til" },
  { metode: "GET", monster: /^\/companies\/[a-z0-9-]+$/, hva: "ett foretak" },
  { metode: "GET", monster: /^\/companies\/[a-z0-9-]+\/purchases$/, hva: "bokførte kjøp" },
  { metode: "GET", monster: /^\/companies\/[a-z0-9-]+\/accountBalances$/, hva: "saldo per konto" },
  // Fakturering (docs/fiken.md «Steg 3»): kunder, bankkonto, faktura. Skrivekallene er de
  // eneste — DriftIQ bokfører aldri betalinger, sletter aldri, rører aldri kjøp.
  { metode: "GET", monster: /^\/companies\/[a-z0-9-]+\/bankAccounts$/, hva: "bankkontoene (fakturaen trenger én)" },
  { metode: "GET", monster: /^\/companies\/[a-z0-9-]+\/contacts$/, hva: "kunder (oppslag på medlemsnummer)" },
  { metode: "POST", monster: /^\/companies\/[a-z0-9-]+\/contacts$/, hva: "opprette kunde (seksjonseier)" },
  { metode: "GET", monster: /^\/companies\/[a-z0-9-]+\/invoices$/, hva: "fakturaer (oppslag på ordrereferanse)" },
  { metode: "GET", monster: /^\/companies\/[a-z0-9-]+\/invoices\/\d+$/, hva: "én faktura (nummer)" },
  { metode: "POST", monster: /^\/companies\/[a-z0-9-]+\/invoices$/, hva: "opprette faktura" },
  { metode: "POST", monster: /^\/companies\/[a-z0-9-]+\/invoices\/counter$/, hva: "starte fakturanummer-telleren (409 første gang)" },
  { metode: "POST", monster: /^\/companies\/[a-z0-9-]+\/invoices\/send$/, hva: "sende faktura på e-post" },
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
  metode: "GET" | "POST",
  sti: string,
  opts: { sok?: Record<string, string | number | undefined>; kropp?: unknown } = {},
): Promise<{ data: T; sider: number; antall: number; location: string | null }> {
  if (!erTillatt(metode, sti)) {
    throw new Error(`Fiken-kall utenfor hvitelista: ${metode} ${sti}`);
  }
  const url = new URL(`${FIKEN_API}${sti}`);
  for (const [k, v] of Object.entries(opts.sok ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const svar = await fetch(url, {
    method: metode,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(opts.kropp !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.kropp !== undefined ? JSON.stringify(opts.kropp) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!svar.ok) {
    // Fiken sender feilmeldinger i ISO-8859-1 iblant («H�Y» i stedet for «HØY» med ren UTF-8-lesing).
    const tekst = await lesTekst(svar);
    let melding = tekst.slice(0, 300);
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
  // POST svarer 201 med tom kropp og `Location` — id-en er siste ledd i den.
  const tekst = await svar.text();
  let data: T = undefined as T;
  if (tekst) {
    try { data = JSON.parse(tekst) as T; } catch { data = undefined as T; }
  }
  return {
    data,
    sider: Number(svar.headers.get("fiken-api-page-count") ?? 1),
    antall: Number(svar.headers.get("fiken-api-result-count") ?? 0),
    location: svar.headers.get("location"),
  };
}

async function lesTekst(svar: Response): Promise<string> {
  try {
    const bytes = new Uint8Array(await svar.arrayBuffer());
    // Fiken oppgir ikke tegnsett og sender iblant ISO-8859-1 («H�Y»): prøv streng UTF-8
    // først, og fall tilbake til latin-1 når bytene ikke er gyldig UTF-8.
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder("iso-8859-1").decode(bytes);
    }
  } catch {
    return "";
  }
}

/**
 * Fikens norske navn på mva-kodene (slik de står i feilmeldingen «Mulige mva koder er
 * […]») → API-ets `vatType`. Hvilke koder en konto godtar, vet bare Fiken — adapteret
 * leser lista fra svaret og velger.
 */
export const MVA_KODER: Record<string, string> = {
  SALG_INNTEKTER_UTEN_MVABEHANDLING: "NONE",
  SALG_FRITATT_FOR_MVA_AVGIFTSFRITT: "EXEMPT",
  SALG_UTENFOR_AVGIFTSOMRADET: "OUTSIDE",
  SALG_UTFORSEL_AV_VARER_OG_TJENESTER: "EXEMPT_IMPORT_EXPORT",
  SALG_INNENLANDSK_OMSETNING_MED_OMVENDT_AVGIFTPLIKT: "EXEMPT_REVERSE",
  SALG_MED_HOY_SATS: "HIGH",
  SALG_MED_MIDDELS_SATS: "MEDIUM",
  SALG_MED_LAV_SATS: "LOW",
};

/** Kodene Fiken lister som lovlige i en 400-melding, oversatt til `vatType` — tom liste når meldingen er en annen. */
export function lovligeMvaKoder(melding: string): string[] {
  const m = /Mulige mva koder er \[([^\]]+)\]/.exec(melding);
  if (!m) return [];
  return m[1]!
    .split(",")
    .map((k) => k.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\uFFFD/g, "O").replace(/Ø/g, "O").replace(/Å/g, "A").replace(/Æ/g, "AE").toUpperCase())
    .map((k) => MVA_KODER[k] ?? null)
    .filter((k): k is string => Boolean(k));
}

/** Id-en Fiken svarer med i `Location` etter en POST («…/contacts/13665985352» → 13665985352). */
export function idFraLocation(location: string | null): number | null {
  const m = /\/(\d+)\/?$/.exec(location ?? "");
  return m ? Number(m[1]) : null;
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

// ---------------------------------------------------------------------------------------
// Fakturering — kunder, bankkonto, faktura (docs/fiken.md «Steg 3»)
// ---------------------------------------------------------------------------------------

export type FikenBankkonto = { bankAccountId: number; name?: string | null; accountCode?: string | null; bankAccountNumber?: string | null; type?: string | null; inactive?: boolean | null };

export type FikenKunde = { contactId: number; name: string; email?: string | null; customer?: boolean | null; memberNumberString?: string | null; inactive?: boolean | null };

export type FikenFaktura = {
  invoiceId: number;
  invoiceNumber?: number | null;
  issueDate?: string;
  dueDate?: string;
  orderReference?: string | null;
  gross?: number;
  settled?: boolean | null;
  associatedCreditNotes?: number[] | null;
  customer?: { contactId?: number } | null;
  /** Utsendingene (e-post, EHF …). Tom liste = aldri sendt til mottakeren. */
  dispatches?: Array<{ date?: string; dispatchType?: string }> | null;
};

/** Bankkontoene — fakturaen må peke på én (`accountCode`, «1920:10001»). */
export async function hentBankkontoer(token: string, slug: string): Promise<FikenBankkonto[]> {
  return (await fikenKall<FikenBankkonto[]>(token, "GET", `/companies/${slug}/bankAccounts`)).data ?? [];
}

/** Kunden med gitt medlemsnummer — DriftIQ bruker seksjonens id, så navnebytte ikke gir dobbel kunde. */
export async function finnKunde(token: string, slug: string, memberNumberString: string): Promise<FikenKunde | null> {
  const r = await fikenKall<FikenKunde[]>(token, "GET", `/companies/${slug}/contacts`, { sok: { memberNumberString, customer: "true" } });
  return (r.data ?? []).find((k) => k.memberNumberString === memberNumberString) ?? null;
}

export async function opprettKunde(token: string, slug: string, k: { name: string; email: string | null; memberNumberString: string }): Promise<number> {
  const r = await fikenKall<unknown>(token, "POST", `/companies/${slug}/contacts`, {
    kropp: { name: k.name, ...(k.email ? { email: k.email } : {}), customer: true, memberNumberString: k.memberNumberString },
  });
  const id = idFraLocation(r.location);
  if (!id) throw new FikenFeil(502, "Fiken opprettet kunden, men svarte uten id");
  return id;
}

/**
 * Fakturaen med denne ordrereferansen hos denne kunden — idempotensnøkkelen (docs/fiken.md:
 * `uuid` er IKKE idempotent). Referansen alene holder ikke: «Lading juli 2026» står på
 * alle eiernes fakturaer for perioden. Krediterte fakturaer ses bort fra, ellers stopper
 * en ny faktura etter en kreditering.
 */
export async function finnFakturaVedReferanse(token: string, slug: string, orderReference: string, customerId: number): Promise<FikenFaktura | null> {
  const r = await fikenKall<FikenFaktura[]>(token, "GET", `/companies/${slug}/invoices`, { sok: { orderReference, customerId, pageSize: 25 } });
  return (r.data ?? []).find((f) =>
    f.orderReference === orderReference
    && (f.customer?.contactId === undefined || f.customer.contactId === customerId)
    && !(f.associatedCreditNotes && f.associatedCreditNotes.length > 0),
  ) ?? null;
}

export async function hentFaktura(token: string, slug: string, invoiceId: number): Promise<FikenFaktura> {
  return (await fikenKall<FikenFaktura>(token, "GET", `/companies/${slug}/invoices/${invoiceId}`)).data;
}

export type NyFaktura = {
  issueDate: string;
  dueDate: string;
  customerId: number;
  bankAccountCode: string;
  orderReference: string;
  ourReference?: string;
  invoiceText?: string;
  lines: Array<{ description: string; unitPrice: number; quantity: number; vatType: string; incomeAccount: string }>;
};

/**
 * Oppretter fakturaen. 409 «invoice counter not initialized» kommer i et foretak som aldri
 * har fakturert — da startes telleren (standard 10000) og kallet gjentas én gang.
 */
export async function opprettFaktura(token: string, slug: string, f: NyFaktura): Promise<number> {
  const kropp = { ...f, cash: false };
  let r: { location: string | null };
  try {
    r = await fikenKall<unknown>(token, "POST", `/companies/${slug}/invoices`, { kropp });
  } catch (e) {
    if (!(e instanceof FikenFeil && e.status === 409)) throw e;
    await fikenKall<unknown>(token, "POST", `/companies/${slug}/invoices/counter`, { kropp: {} });
    r = await fikenKall<unknown>(token, "POST", `/companies/${slug}/invoices`, { kropp });
  }
  const id = idFraLocation(r.location);
  if (!id) throw new FikenFeil(502, "Fiken opprettet fakturaen, men svarte uten id");
  return id;
}

/**
 * Sender fakturaen på e-post (PDF som vedlegg) til adressen — Fiken bruker kundens adresse
 * om den utelates. Feltene heter `recipientEmail` og `includeDocumentAttachments` (påkrevd);
 * `emailAddress` finnes ikke og ga 400 (lært 06.09.2026).
 */
export async function sendFaktura(token: string, slug: string, invoiceId: number, recipientEmail: string | null): Promise<void> {
  await fikenKall<unknown>(token, "POST", `/companies/${slug}/invoices/send`, {
    kropp: { invoiceId, method: ["email"], includeDocumentAttachments: true, emailSendOption: "attachment", ...(recipientEmail ? { recipientEmail } : {}) },
  });
}
