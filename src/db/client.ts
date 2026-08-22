/**
 * Databasetilkoblinger og tenant-kontekst (v2). Arvtakeren til `backend/app/database.py`.
 *
 * ## Hva som er endret fra v1, og hvorfor
 *
 * v1 eksponerte en `Session` og satte org-konteksten i en `after_begin`-lytter. Det virket, men
 * lot deg skrive en spørring uten kontekst — og fordi RLS feiler *lukket*, ble symptomet en tom
 * liste uten feilmelding. Det er den vanligste buggen i v1, og den er dokumentert i CLAUDE.md
 * fordi den ikke lar seg oppdage av typer eller tester.
 *
 * Her finnes det ingen eksportert `db`. Eneste vei til databasen går gjennom `withOrg()` eller
 * `withoutRls()`, og begge tar konteksten som argument. Å glemme den er dermed en
 * kompileringsfeil, ikke en tom liste.
 *
 * ## To pooler, med vilje
 *
 * - `adminPool` — skjemaets eier. Kjører migrasjoner, RLS-oppsett og bakgrunnsjobber, og
 *   **omgår RLS** (BYPASSRLS). Nås kun via `withoutRls()`.
 * - `appPool`  — appens egen rolle (`driftiq_v2_app`), som ikke eier noe og derfor er underlagt
 *   policyene. Alle innloggede forespørsler går her.
 *
 * Skillet er hele poenget: tabelleieren omgår RLS som standard, og en superbruker omgår den
 * selv med FORCE. Kobler appen til som eieren, er policyene ren dekorasjon.
 *
 * ## Hvorfor én transaksjon per arbeidsenhet
 *
 * `set_config(..., true)` er `SET LOCAL` uttrykt som funksjon — transaksjonsscoped, og derfor
 * trygg: en vanlig `SET` ville hengt igjen på connectionen i poolen og blitt arvet av neste
 * request fra et annet borettslag. Prisen i v1 var at konteksten forsvant ved `commit()`, som
 * krevde lytteren. Her er transaksjonen selve arbeidsenheten, så problemet finnes ikke.
 *
 * `set_config` tar en bunden parameter. `SET LOCAL app.org_id = '<streng>'` måtte vært
 * strenginterpolert, altså SQL-injeksjon rett inn i selve sikkerhetsmekanismen.
 */

/*
 * Denne modulen skal ALDRI havne i et nettleserbundle. Skjer det, feiler bygget med
 * «Module not found: Can't resolve 'dns'» — en melding som peker på pg og ikke på importen
 * som er feil.
 *
 * Vakten `server-only` ble prøvd og TATT UT IGJEN: den fanget feilen fint i `next build`,
 * men velter alt som importerer denne fila utenfor Next — oppstartsskriptet, migreringen og
 * hele testsuiten. Å holde den i live krevde et alias i vitest og et til i tsx, altså to
 * skjør omveier i produksjonsstien for å beskytte mot noe et grønt bygg uansett fanger.
 *
 * Det som faktisk løser problemet er å la alt en klientkomponent trenger ligge i en fil
 * UTEN importer: `nivaer.ts`, `varselvalg.ts`, `avvikkategorier.ts`, `feilmeldingtyper.ts`,
 * `oppgaveregler.ts`, `orgnr.ts`, `brreg.ts`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

// ---------------------------------------------------------------------------------------
// Miljø
// ---------------------------------------------------------------------------------------

function paakrevd(navn: string): string {
  const verdi = process.env[navn];
  if (!verdi) {
    throw new Error(
      `${navn} er ikke satt. Se .env.v2.example — v2 nekter å starte uten den, ` +
        "i motsetning til v1 som falt tilbake til eierrollen med en advarsel.",
    );
  }
  return verdi;
}

const DATABASE_URL = paakrevd("DATABASE_URL");
const APP_DB_USER = process.env.APP_DB_USER ?? "driftiq_v2_app";

/**
 * APP_DB_PASSWORD er påkrevd — ikke valgfri som i v1.
 *
 * v1 falt tilbake til eierrollen med `[rls] ADVARSEL` i loggen og `rls_aktiv: false` i
 * plattformpanelet. Det er en fornuftig avveining når systemet allerede står i produksjon og en
 * feilkonfigurasjon ellers ville tatt ned appen. v2 har ingen slik arv, og velger derfor det
 * strengere: er RLS ikke i kraft, starter vi ikke. En app som kjører uten tenantisolasjon skal
 * ikke kunne oppstå ved et uhell.
 */
const APP_DB_PASSWORD = paakrevd("APP_DB_PASSWORD");

function medBruker(url: string, bruker: string, passord: string): string {
  const u = new URL(url);
  u.username = encodeURIComponent(bruker);
  u.password = encodeURIComponent(passord);
  return u.toString();
}

export function dbNavn(): string {
  return new URL(DATABASE_URL).pathname.replace(/^\//, "");
}

export const adminPool = new Pool({ connectionString: DATABASE_URL });
export const appPool = new Pool({
  connectionString: medBruker(DATABASE_URL, APP_DB_USER, APP_DB_PASSWORD),
});

// ---------------------------------------------------------------------------------------
// Kontekst
// ---------------------------------------------------------------------------------------

type Kontekst = { orgId: string; db: Db };

const kontekstLager = new AsyncLocalStorage<Kontekst>();

export class ManglendeOrgKontekst extends Error {
  constructor(fikk: unknown) {
    super(
      `withOrg() krever en org-id, fikk ${JSON.stringify(fikk)}. ` +
        "Uten kontekst returnerer RLS null rader helt stille — derfor kastes det her i stedet.",
    );
    this.name = "ManglendeOrgKontekst";
  }
}

export class KryssendeOrgKontekst extends Error {
  constructor(ytre: string, indre: string) {
    super(
      `Forsøk på å åpne org-kontekst «${indre}» inne i «${ytre}». Én forespørsel skal aldri ` +
        "røre to borettslag i samme transaksjon — dette er nesten alltid en id som er ført " +
        "videre feil. Trenger du å lese på tvers, er withoutRls() riktig verktøy, med grunn.",
    );
    this.name = "KryssendeOrgKontekst";
  }
}

/**
 * Kjører `fn` med tenant-konteksten satt, i én transaksjon på approllen.
 *
 * Postgres nekter da rader fra andre borettslag uavhengig av om spørringen husket sitt
 * `org_id`-filter. **Applikasjonsfiltrene beholdes likevel** — `.where(eq(tasks.orgId, orgId))`
 * skal fortsatt stå. To uavhengige lag som må svikte samtidig er hele poenget.
 *
 * Org-id-en her er *ikke* verifisert — den er bare den forespørselen gjelder. Autorisasjon
 * gjøres av tilgangsgatene (`krevOrgTilgang` o.l.). Å sette konteksten til en org man ikke har
 * tilgang til gir ingenting: forespørselen avvises uansett.
 *
 * Kall inni et kall med samme org gjenbruker den ytre transaksjonen. Med en *annen* org kastes
 * `KryssendeOrgKontekst` — se klassen over for hvorfor.
 */
export async function withOrg<T>(orgId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  if (typeof orgId !== "string" || orgId.trim() === "") {
    throw new ManglendeOrgKontekst(orgId);
  }

  const ytre = kontekstLager.getStore();
  if (ytre) {
    if (ytre.orgId !== orgId) throw new KryssendeOrgKontekst(ytre.orgId, orgId);
    return fn(ytre.db);
  }

  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    // Bunden parameter — se modulkommentaren om hvorfor dette ikke er strenginterpolert.
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const db = drizzle(client, { schema });
    let resultat: T;
    try {
      resultat = await kontekstLager.run({ orgId, db }, () => fn(db));
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
    await client.query("COMMIT");
    return resultat;
  } finally {
    client.release();
  }
}

/**
 * Grunnene til at et kall får omgå RLS. Union-typen er poenget: hvert unntak er et navngitt,
 * opplistet valg som må stå i koden, ikke en kommentar noen kan la være å skrive.
 *
 * v1 hadde samme regel som prosatekst på importen av `get_db_uten_rls`. Den holdt, men den
 * kunne ikke håndheves. Her feiler en ny bruk å kompilere til noen har lagt grunnen inn her —
 * og da er lista over alt som omgår tenantisolasjonen komplett, per definisjon.
 */
export type RlsUnntak =
  | "plattformpanel" // ser per definisjon på tvers av kunder
  | "leverandorportal" // en leverandør betjener oppgaver i flere borettslag
  | "qr-anonym" // anonymt, må slå opp token FØR org er kjent
  | "innlogging" // identitet og abonnementssperre, før org er kjent
  | "migrasjon" // skjemaendringer og RLS-oppsett kjøres som eier
  | "bakgrunnsjobb"; // varsler og opprydding, på tvers av alle kunder

/**
 * Sesjon som OMGÅR RLS. Alle disse er avhengige av applikasjonsfiltrene sine alene.
 *
 * Legg ikke nye kall her uten at grunnen finnes i `RlsUnntak` — og legger du til en ny grunn,
 * skal den kunne forsvares i en kodegjennomgang.
 */
export async function withoutRls<T>(grunn: RlsUnntak, fn: (db: Db) => Promise<T>): Promise<T> {
  void grunn; // brukes av typesystemet og av lesbarheten på kallstedet, ikke av kjøretiden
  const client = await adminPool.connect();
  try {
    return await fn(drizzle(client, { schema }));
  } finally {
    client.release();
  }
}

/**
 * Databasehåndtaket Better Auth får. Dette ER `withoutRls("innlogging")`, materialisert —
 * biblioteket tar en `db`-instans og kan ikke ta en callback.
 *
 * Det er trygt, men bare på grunn av én invariant: Better Auth rører KUN tabeller som står i
 * `UNNTATT` (`users`, `session`, `account`, `verification`, `jwks`). Ingen av dem har `org_id`,
 * og ingen inneholder kundedata. Legger noen en org-eid tabell inn i auth-skjemaet, faller
 * invarianten — og testen `ingen tenanttabell uten dekning` er det som sier fra.
 */
export const authDb: Db = drizzle(adminPool, { schema });

/**
 * Rå tilgang til eierrollen for oppsett som må styre transaksjonen selv (RLS-policyer,
 * migrasjoner). Ikke for forespørsler.
 */
export async function medEierklient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await adminPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------------------
// Oppstartskontroll
// ---------------------------------------------------------------------------------------

/**
 * Verifiserer at rollene faktisk har egenskapene hele oppsettet hviler på. Kjøres ved oppstart.
 *
 * Begge retninger er reelle feilmoduser, og begge er stille:
 * - kan approllen omgå RLS, er policyene dekorasjon og alle kunder ser hverandres data
 * - kan ikke eieren omgå RLS, ser plattformpanel, QR og bakgrunnsjobber en tom database
 */
export async function verifiserRoller(): Promise<void> {
  const eier = await adminPool.query<{ bruker: string; kan_omga: boolean }>(
    "SELECT current_user AS bruker, (rolsuper OR rolbypassrls) AS kan_omga " +
      "FROM pg_roles WHERE rolname = current_user",
  );
  if (!eier.rows[0]?.kan_omga) {
    throw new Error(
      `Databaserollen i DATABASE_URL (${eier.rows[0]?.bruker}) kan ikke omgå Row Level ` +
        "Security, men admin-laget (migrasjoner, plattformpanel, QR) er avhengig av det. " +
        "Gi rollen BYPASSRLS (ALTER ROLE ... BYPASSRLS, som superbruker) og start på nytt.",
    );
  }

  const app = await appPool.query<{ bruker: string; kan_omga: boolean }>(
    "SELECT current_user AS bruker, (rolsuper OR rolbypassrls) AS kan_omga " +
      "FROM pg_roles WHERE rolname = current_user",
  );
  if (app.rows[0]?.kan_omga) {
    throw new Error(
      `Approllen «${app.rows[0]?.bruker}» har SUPERUSER eller BYPASSRLS og ville omgått Row ` +
        "Level Security. Fjern attributtene (ALTER ROLE ... NOSUPERUSER NOBYPASSRLS) og " +
        "start på nytt.",
    );
  }
}

/**
 * Helsesjekken til /api/health — svarer databasen? Går via approllen, altså samme vei som
 * innloggede forespørsler, så et passordbytte på approllen fanges selv om eierrollen
 * (migrasjoner) fortsatt kommer til. Rører ingen tabeller; ligger her så rå pooltilgang
 * forblir denne filas privilegium.
 */
export async function sjekkDatabase(): Promise<void> {
  await appPool.query("SELECT 1");
}

export async function lukkPooler(): Promise<void> {
  await Promise.all([appPool.end(), adminPool.end()]);
}
