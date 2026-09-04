/**
 * Rutebyggeren for org-endepunkter. Dette er mønsteret alle moduler følger.
 *
 * ## Hva den løser
 *
 * v1 krevde at hvert endepunkt husket `require_org_access()` som sin første linje — 359
 * kallsteder, hvert av dem en mulighet til å glemme det. Modulgaten måtte i tillegg henges
 * på routeren, og org-konteksten kom fra URL-prefikset: la noen et endepunkt utenfor
 * `/organizations/{org_id}/`, fikk det ingen kontekst og hver RLS-tabell svarte null rader
 * uten feilmelding.
 *
 * Her er alt det strukturelt. `orgRute()` gjør, i denne rekkefølgen:
 *
 *   1. henter sesjonen — ingen sesjon ⇒ 401
 *   2. åpner `withOrg(orgId)` slik at RLS-konteksten er satt for alt som følger
 *   3. kjører tilgangsgaten for det nivået ruta krever
 *   4. sjekker at modulen er aktivert — ETTER tilgangsgaten, så modulstatusen ikke røpes
 *      til noen utenfor organisasjonen
 *   5. kaller handleren, som får en `db` som allerede har kontekst
 *
 * Å hoppe over et steg er ikke mulig: det finnes ingen annen vei til `db`.
 */

import { eq } from "drizzle-orm";
import { withOrg, withoutRls, type Db } from "../db/client";
import { organizations } from "../db/schema/organizations";
import { users, type User } from "../db/schema/users";
import { auth } from "./auth";
import { modulErAktivert, type ModulNokkel } from "./moduler";
import {
  Tilgangsfeil,
  krevOrgAdmin,
  krevPlattformadmin,
  krevOrgRedigering,
  krevOrgTilgang,
} from "./tilgang";

/** Hva ruta krever av den innloggede. Speiler de tre gatene i tilgang.ts. */
export type Nivaa = "lesing" | "redigering" | "admin";

export type Kontekst<P = Record<string, string>> = {
  db: Db;
  orgId: string;
  bruker: User;
  params: P;
  req: Request;
  /**
   * Kjør noe ETTER at transaksjonen er committet — e-post, webhooks, alt utadrettet.
   *
   * Inne i handleren er skrivingene dine usynlige for enhver annen tilkobling. Kaller du en
   * tjeneste som slår opp raden selv (Better Auth gjør nettopp det), finner den ingenting.
   */
  etterCommit: (fn: () => Promise<void>) => void;
};

/** Feil med en HTTP-status handleren selv vil styre. */
export class ApiFeil extends Error {
  constructor(
    readonly status: number,
    melding: string,
  ) {
    super(melding);
    this.name = "ApiFeil";
  }
}

export const ikkeFunnet = (hva: string) => new ApiFeil(404, `${hva} ikke funnet`);
export const ugyldig = (melding: string) => new ApiFeil(400, melding);

/**
 * Eksportert for den ene ruta som ikke kan gå gjennom `orgRute`: Fikens OAuth-callback,
 * der org-id-en kommer i signert `state` og ikke i stien. Alt annet bruker wrapperen.
 */
export async function hentBruker(req: Request): Promise<User> {
  const sesjon = await auth.api.getSession({ headers: req.headers });
  if (!sesjon?.user?.id) throw new ApiFeil(401, "Ikke innlogget");

  // Sesjonen bærer en kopi av brukeren, men gatene skal se den FERSKE raden: en deaktivering
  // gjort for ett minutt siden skal gjelde nå, ikke ved neste innlogging. Det var symptomet i
  // v1 der tilgangsnivået lå i localStorage og var et snapshot per økt — knappene forsvant
  // uten forklaring, eller ble stående etter at tilgangen var trukket.
  //
  // `users` står i UNNTATT og har ingen policy, så oppslaget trenger ingen org-kontekst.
  const rader = await withoutRls("innlogging", (db) =>
    db.select().from(users).where(eq(users.id, sesjon.user.id)).limit(1),
  );
  const bruker = rader[0];
  if (!bruker || !bruker.active) throw new ApiFeil(401, "Ikke innlogget");
  return bruker;
}

async function krevNivaa(db: Db, orgId: string, bruker: User, nivaa: Nivaa): Promise<void> {
  if (nivaa === "lesing") await krevOrgTilgang(db, orgId, bruker);
  else if (nivaa === "redigering") await krevOrgRedigering(db, orgId, bruker);
  else await krevOrgAdmin(db, orgId, bruker);
}

async function krevModul(db: Db, orgId: string, modul: ModulNokkel): Promise<void> {
  const rader = await db
    .select({ enabledModules: organizations.enabledModules })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!modulErAktivert(rader[0]?.enabledModules, modul)) {
    throw new ApiFeil(403, "Modulen er ikke aktivert for denne organisasjonen");
  }
}

/**
 * Feil → HTTP-svar. Eksportert fordi de anonyme QR-rutene ikke går gjennom `orgRute` eller
 * `plattformRute` — de har ingen sesjon å gate på — men skal svare i samme form som resten.
 */
export function tilSvar(e: unknown): Response {
  if (e instanceof ApiFeil) {
    return Response.json({ detail: e.message }, { status: e.status });
  }
  if (e instanceof Tilgangsfeil) {
    return Response.json({ detail: e.message }, { status: e.status });
  }
  console.error("[api] uventet feil:", e);
  return Response.json({ detail: "Noe gikk galt" }, { status: 500 });
}

/**
 * Bygger en Next-rutehandler for et org-endepunkt.
 *
 * `modul` er valgfri bare for endepunkter som ikke tilhører en modul (org-metadata,
 * brukerliste). Alt annet skal oppgi den.
 */
export function orgRute<P extends Record<string, string> = Record<string, string>>(opts: {
  nivaa: Nivaa;
  modul?: ModulNokkel;
  handler: (ctx: Kontekst<P>) => Promise<unknown>;
  /** Status ved suksess. 204 sender ingen kropp — brukes av DELETE, som i v1. */
  status?: number;
}) {
  return async (req: Request, ctx: { params: Promise<P & { orgId: string }> }) => {
    try {
      const params = await ctx.params;
      const orgId = params.orgId;
      if (!orgId) throw new ApiFeil(400, "Mangler organisasjon i URL-en");

      const bruker = await hentBruker(req);

      /**
       * Sidevirkninger som IKKE må kjøre før transaksjonen er committet.
       *
       * E-post er det typiske tilfellet: `inviterBruker` skriver brukeren inne i
       * transaksjonen, mens Better Auth slår opp adressen på en HELT ANNEN tilkobling.
       * Sender man derfra, finnes ikke raden ennå for den som leser — Better Auth svarte
       * «User not found», brukeren ble opprettet, og velkomst-e-posten kom aldri.
       *
       * Samme regel gjelder alt utadrettet: webhooks, meldinger, tredjeparts-API-er. Ruller
       * transaksjonen tilbake etterpå, har man ellers allerede fortalt omverdenen om noe som
       * ikke skjedde.
       */
      const etterpaa: Array<() => Promise<void>> = [];

      const resultat = await withOrg(orgId, async (db) => {
        await krevNivaa(db, orgId, bruker, opts.nivaa);
        if (opts.modul) await krevModul(db, orgId, opts.modul);
        return opts.handler({
          db,
          orgId,
          bruker,
          params,
          req,
          etterCommit: (fn) => etterpaa.push(fn),
        });
      });

      // Feiler en sidevirkning, skal ikke svaret bli et annet: skrivingen ER fullført.
      for (const fn of etterpaa) {
        await fn().catch((e) => console.error("[api] Sidevirkning feilet:", e));
      }

      const status = opts.status ?? 200;
      if (status === 204) return new Response(null, { status: 204 });
      return somSvar(resultat, status);
    } catch (e) {
      return tilSvar(e);
    }
  };
}

/** En handler som leverer en fil i stedet for JSON. */
export type Filsvar = {
  innhold: Uint8Array;
  navn: string;
  contentType: string | null;
  /** `inline` lar nettleseren VISE fila (PDF i iframe, bilde i img) i stedet for å laste ned. */
  disposition?: "inline" | "attachment";
};

function erFilsvar(v: unknown): v is Filsvar {
  return (
    typeof v === "object" &&
    v !== null &&
    "innhold" in v &&
    "navn" in v &&
    (v as { innhold: unknown }).innhold instanceof Uint8Array
  );
}

/**
 * JSON — med mindre handleren leverer en FIL.
 *
 * Uten dette ble en `Buffer` JSON-kodet til `{"type":"Buffer","data":[…]}`. Nedlasting av
 * dokumenter og kontrakter var derfor ødelagt: UI-et lenker direkte til ruta som en vanlig
 * `<a href>`, og brukeren fikk en tekstfil full av tall i stedet for PDF-en sin.
 *
 * `Content-Disposition: attachment` med filnavnet er ikke pynt — uten den arver nedlastingen
 * URL-ens siste ledd, altså «file», uten filendelse.
 */
function somSvar(resultat: unknown, status: number): Response {
  if (!erFilsvar(resultat)) return Response.json(resultat, { status });

  return new Response(new Uint8Array(resultat.innhold), {
    status,
    headers: {
      "Content-Type": resultat.contentType ?? "application/octet-stream",
      // Filnavnet kan inneholde æøå og komma. `filename*` med UTF-8 er den formen som
      // faktisk overlever; `filename=` beholdes for eldre klienter. Navnet følger med også
      // ved `inline` — trykker brukeren «Last ned» i PDF-viseren, er det navnet som brukes.
      "Content-Disposition": `${resultat.disposition ?? "attachment"}; filename="${resultat.navn.replace(/["\\]/g, "")}"; filename*=UTF-8''${encodeURIComponent(resultat.navn)}`,
    },
  });
}

/**
 * Rute for PLATTFORMDATA — data som ikke tilhører én kunde.
 *
 * HMS-malene er det første tilfellet: samme mal brukes på tvers av alle borettslag, og bare
 * plattformadmin kan endre dem. Lesetilgangen er åpen for innloggede brukere fordi
 * kunde-appen må kunne hente spørsmålslista.
 *
 * Merk at det IKKE er noen org-kontekst her, og derfor ingen `withOrg`. Det er trygt bare så
 * lenge handleren utelukkende rører tabeller uten `org_id` — de står da utenfor RLS uansett.
 * Trenger du kundedata, er `orgRute` riktig verktøy.
 */
export function plattformRute<P extends Record<string, string> = Record<string, string>>(opts: {
  /** `alle` = enhver innlogget bruker. `plattformadmin` = kun DriftIQ-ansatte. */
  nivaa: "alle" | "plattformadmin";
  handler: (ctx: { db: Db; bruker: User; params: P; req: Request }) => Promise<unknown>;
  status?: number;
}) {
  return async (req: Request, ctx: { params: Promise<P> }) => {
    try {
      const params = await ctx.params;
      const bruker = await hentBruker(req);
      if (opts.nivaa === "plattformadmin") krevPlattformadmin(bruker);

      const resultat = await withoutRls("plattformpanel", (db) =>
        opts.handler({ db, bruker, params, req }),
      );

      const status = opts.status ?? 200;
      if (status === 204) return new Response(null, { status: 204 });
      return Response.json(resultat, { status });
    } catch (e) {
      return tilSvar(e);
    }
  };
}

/** Leser og validerer JSON-kroppen med et Zod-skjema. */
export async function lesKropp<T>(
  req: Request,
  skjema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } },
): Promise<T> {
  let raa: unknown;
  try {
    raa = await req.json();
  } catch {
    throw ugyldig("Ugyldig JSON i forespørselen");
  }
  const resultat = skjema.safeParse(raa);
  if (!resultat.success || resultat.data === undefined) {
    throw ugyldig(feilmelding(resultat.error));
  }
  return resultat.data;
}

/** Plukker den første feilmeldingen ut av en Zod-feil, på norsk der skjemaet har satt en. */
function feilmelding(feil: unknown): string {
  const issues = (feil as { issues?: Array<{ path: unknown[]; message: string }> })?.issues;
  const forste = issues?.[0];
  if (!forste) return "Ugyldige data";
  const felt = forste.path.join(".");
  return felt ? `${felt}: ${forste.message}` : forste.message;
}
