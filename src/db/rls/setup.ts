/**
 * Oppretter approllen og legger RLS-policyene på plass. Port av `sett_opp()` og
 * `opprett_approlle()` i `backend/app/rls.py`. Kjøres ved oppstart, som skjemaets eier.
 * Alt her MÅ tåle å kjøres om igjen.
 */

import type { PoolClient } from "pg";
import {
  BARNETABELLER,
  DIREKTE_TABELLER,
  FK_INDEKSER,
  ORG,
  POLICY_NAVN,
  UNNTATT,
  sikkertNavn,
} from "./tables";

async function tabellFinnes(client: PoolClient, tabell: string): Promise<boolean> {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
    [tabell],
  );
  return rows.length > 0;
}

async function settPolicy(client: PoolClient, tabell: string, betingelse: string): Promise<void> {
  const t = sikkertNavn(tabell);
  // FORCE er ikke valgfritt: uten den omgår tabelleieren sin egen policy, og hele oppsettet
  // blir dekorasjon i det øyeblikket noen kobler til som eieren.
  await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
  await client.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
  // DROP før CREATE: alt må tåle å kjøres om igjen ved hver oppstart.
  await client.query(`DROP POLICY IF EXISTS ${POLICY_NAVN} ON ${t}`);
  // USING styrer lesing, WITH CHECK styrer skriving. Uten WITH CHECK kan man skrive rader
  // inn i en annen organisasjon selv om man ikke kan lese dem.
  await client.query(
    `CREATE POLICY ${POLICY_NAVN} ON ${t} USING (${betingelse}) WITH CHECK (${betingelse})`,
  );
}

/**
 * Oppretter/oppdaterer approllen — den appen kobler til med.
 *
 * Den eier ingenting og har verken SUPERUSER eller BYPASSRLS, og er derfor faktisk underlagt
 * policyene. Migrasjoner kjører fortsatt som eieren.
 *
 * Rolle- og passordsetning kan ikke parameteriseres i SQL. I stedet lar vi Postgres selv
 * sitere verdiene med `format()`s %I/%L og kjører resultatet — samme sikkerhet som en bunden
 * parameter, uten strenginterpolering i applikasjonskoden.
 */
export async function opprettApprolle(
  client: PoolClient,
  bruker: string,
  passord: string,
  database: string,
): Promise<void> {
  const finnes = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [bruker]);
  if (finnes.rows.length === 0) {
    const { rows } = await client.query("SELECT format('CREATE ROLE %I LOGIN', $1::text) AS sql", [
      bruker,
    ]);
    await client.query(rows[0].sql);
  }

  // Fra Postgres 16 kan et attributt bare NEVNES i ALTER ROLE av en rolle som selv har det
  // (SUPERUSER/BYPASSRLS krever superbruker, NOCREATEDB krever CREATEDB) — også når verdien
  // ikke endres. Kjører oppstarten som en CREATEROLE-eier (slik den gjør mot en sentral, delt
  // Postgres-server), settes derfor bare LOGIN + passord her; at rollen ikke kan omgå RLS
  // verifiseres i stedet av `verifiserRoller()` i client.ts.
  const superbruker = await client.query<{ rolsuper: boolean }>(
    "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
  );
  const attributter = superbruker.rows[0]?.rolsuper
    ? "LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE"
    : "LOGIN";

  const steg: Array<[string, unknown[]]> = [
    [`SELECT format('ALTER ROLE %I WITH ${attributter} PASSWORD %L', $1::text, $2::text) AS sql`, [bruker, passord]],
    ["SELECT format('GRANT CONNECT ON DATABASE %I TO %I', $1::text, $2::text) AS sql", [database, bruker]],
    ["SELECT format('GRANT USAGE ON SCHEMA public TO %I', $1::text) AS sql", [bruker]],
    [
      "SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', $1::text) AS sql",
      [bruker],
    ],
    [
      "SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', $1::text) AS sql",
      [bruker],
    ],
    // Så nye tabeller fra migrasjonene ikke må huskes manuelt neste gang.
    [
      "SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', $1::text) AS sql",
      [bruker],
    ],
    [
      "SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', $1::text) AS sql",
      [bruker],
    ],
  ];

  for (const [mal, params] of steg) {
    const { rows } = await client.query(mal, params);
    await client.query(rows[0].sql);
  }

  // Garantien fra før PG16-endringen: har approllen likevel SUPERUSER eller BYPASSRLS (satt
  // manuelt av noen med rettigheter til det), er policyene ren dekorasjon — da skal appen
  // nekte å starte, ikke late som RLS virker.
  const kanOmga = await client.query<{ kan: boolean }>(
    "SELECT (rolsuper OR rolbypassrls) AS kan FROM pg_roles WHERE rolname = $1",
    [bruker],
  );
  if (kanOmga.rows[0]?.kan) {
    throw new Error(
      `Approllen «${bruker}» har SUPERUSER eller BYPASSRLS og ville omgått Row Level Security. ` +
        "Fjern attributtene (ALTER ROLE ... NOSUPERUSER NOBYPASSRLS) og start på nytt.",
    );
  }
}

/** Kjøres ved oppstart, som skjemaets eier. Idempotent. */
export async function settOpp(
  client: PoolClient,
  opts: { approlle: string; apppassord: string; database: string },
): Promise<void> {
  await opprettApprolle(client, opts.approlle, opts.apppassord, opts.database);

  for (const stmt of FK_INDEKSER) {
    // Indeksene gjelder tabeller som først finnes når modulen deres er portert. Hopp over
    // det som ikke er der ennå i stedet for å kreve at hele skjemaet eksisterer fra dag én.
    try {
      await client.query(stmt);
    } catch (e) {
      if ((e as { code?: string }).code !== "42P01") throw e; // undefined_table
    }
  }

  for (const tabell of DIREKTE_TABELLER) {
    if (await tabellFinnes(client, tabell)) {
      await settPolicy(client, tabell, `org_id = ${ORG}`);
    }
  }

  for (const [tabell, betingelse] of Object.entries(BARNETABELLER)) {
    if (await tabellFinnes(client, tabell)) {
      await settPolicy(client, tabell, betingelse);
    }
  }
}

// ---------------------------------------------------------------------------------------
// Introspeksjon — grunnlaget for regresjonstestene
// ---------------------------------------------------------------------------------------

/**
 * Tabeller som burde hatt RLS, men ikke har det. Det enkelttiltaket med lengst levetid:
 * det er dette som fanger tabellen noen legger til om fjorten måneder.
 */
export async function manglerRls(client: PoolClient): Promise<string[]> {
  const forventet = new Set<string>([...DIREKTE_TABELLER, ...Object.keys(BARNETABELLER)]);
  const { rows } = await client.query<{ relname: string }>(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
  `);
  return rows
    .map((r) => r.relname)
    .filter((navn) => forventet.has(navn))
    .sort();
}

/**
 * Tabeller med org_id som verken har RLS eller står oppført i UNNTATT.
 * Fanger den nye modulen som får en tabell, men ingen policy.
 */
export async function tenanttabellerUtenDekning(client: PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ relname: string }>(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = c.relname
            AND column_name = 'org_id'
      )
      AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
  `);
  return rows
    .map((r) => r.relname)
    .filter((navn) => !(navn in UNNTATT))
    .sort();
}
