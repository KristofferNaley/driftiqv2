/**
 * Kopierer data fra v1s database til v2. Idempotent — kan kjøres om igjen.
 *
 *     DATABASE_URL_V1=postgresql://… npx tsx scripts/migrer-fra-v1.ts [--torrkjor]
 *
 * ## Hvorfor direkte mot databasen og ikke en JSON-eksport
 *
 * Eksporten finnes, men databasen er kilden den lages fra. Å lese den direkte fjerner et
 * mellomledd som kan tape presisjon (datoer, NULL vs tom streng, tegnsett), og gjør at
 * migreringen kan kjøres om igjen rett før overgangen for å hente det som er kommet til.
 *
 * ## Det kritiske: qr_token
 *
 * `tasks.qr_token` er trykt på fysiske oppslag som henger i bygget. Byttes den, må hvert
 * eneste oppslag printes og henges opp på nytt. Den kopieres derfor uendret, og skriptet
 * VERIFISERER det til slutt — en migrering som stille genererte nye tokens ville sett ut
 * som en suksess helt til noen skannet en QR-kode.
 *
 * ## Omfang
 *
 * Skriptet dekker de tabellene v2 har portert så langt. Det vokser med hver modul; en tabell
 * som ikke finnes i v2 ennå hoppes ikke over stille, den er bare ikke nevnt her. Se
 * `TABELLER` nederst for hva som faktisk kopieres.
 */

import { Pool } from "pg";
import { adminPool, lukkPooler } from "../src/db/client";

const V1_URL = process.env.DATABASE_URL_V1;
const TORRKJOR = process.argv.includes("--torrkjor");

if (!V1_URL) {
  console.error("DATABASE_URL_V1 er ikke satt — pek den på v1-databasen du migrerer fra.");
  process.exit(1);
}

const v1 = new Pool({ connectionString: V1_URL });

type Tabell = {
  navn: string;
  /** SELECT mot v1. Kolonnenavnene her må matche kolonnene i v2. */
  kilde: string;
  kolonner: string[];
  /** Kolonner som skal oppdateres hvis raden finnes fra før. Tom = la eksisterende rad stå. */
  oppdater?: string[];
};

/**
 * Rekkefølgen er fremmednøkkelrekkefølge og kan ikke sorteres om: organisasjoner før
 * brukere, plasser før leieavtaler.
 */
const TABELLER: Tabell[] = [
  {
    navn: "organizations",
    kilde: `SELECT id, name, slug, org_nr, org_form, municipality, unit_count,
                   COALESCE(active, true) AS active, enabled_modules, created_at
            FROM organizations`,
    kolonner: ["id", "name", "slug", "org_nr", "org_form", "municipality", "unit_count", "active", "enabled_modules", "created_at"],
    oppdater: ["name", "slug", "org_nr", "org_form", "municipality", "unit_count", "active", "enabled_modules"],
  },
  {
    navn: "users",
    // `email_verified` settes til true: brukerne finnes allerede og har logget inn i v1.
    // Å kreve verifisering på nytt ville låst alle ute ved overgangen.
    kilde: `SELECT id, org_id, name, lower(email) AS email, phone, role::text AS role,
                   COALESCE(active, true) AS active, last_login_at,
                   true AS email_verified, false AS two_factor_enabled,
                   COALESCE(created_at, now()) AS created_at,
                   COALESCE(created_at, now()) AS updated_at
            FROM users`,
    kolonner: ["id", "org_id", "name", "email", "phone", "role", "active", "last_login_at", "email_verified", "two_factor_enabled", "created_at", "updated_at"],
    oppdater: ["name", "email", "phone", "role", "active", "last_login_at"],
  },
  {
    navn: "user_org_memberships",
    kilde: `SELECT id, user_id, org_id, role::text AS role, title,
                   COALESCE(created_at, now()) AS created_at
            FROM user_org_memberships`,
    kolonner: ["id", "user_id", "org_id", "role", "title", "created_at"],
    oppdater: ["role", "title"],
  },
  {
    navn: "platform_contracts",
    kilde: `SELECT id, org_id, annual_fee, base_fee, modules,
                   COALESCE(discount_percent, 0) AS discount_percent,
                   start_date, end_date, notes, COALESCE(created_at, now()) AS created_at
            FROM platform_contracts`,
    kolonner: ["id", "org_id", "annual_fee", "base_fee", "modules", "discount_percent", "start_date", "end_date", "notes", "created_at"],
    oppdater: ["annual_fee", "base_fee", "modules", "discount_percent", "start_date", "end_date", "notes"],
  },
  {
    navn: "vendors",
    kilde: `SELECT id, org_id, name, COALESCE(active, true) AS active,
                   COALESCE(created_at, now()) AS created_at
            FROM vendors`,
    kolonner: ["id", "org_id", "name", "active", "created_at"],
    oppdater: ["name", "active"],
  },
  {
    navn: "tasks",
    // qr_token kopieres UENDRET. Se modulkommentaren.
    kilde: `SELECT id, org_id, vendor_id, responsible_user_id, title, description, location,
                   frequency::text AS frequency, start_date, due_date, qr_token,
                   COALESCE(created_at, now()) AS created_at
            FROM tasks`,
    kolonner: ["id", "org_id", "vendor_id", "responsible_user_id", "title", "description", "location", "frequency", "start_date", "due_date", "qr_token", "created_at"],
    oppdater: ["title", "description", "location", "frequency", "start_date", "due_date", "responsible_user_id"],
  },
  {
    navn: "task_checklist_items",
    kilde: `SELECT id, task_id, text, COALESCE("order", 0) AS "order",
                   COALESCE(created_at, now()) AS created_at
            FROM task_checklist_items`,
    kolonner: ["id", "task_id", "text", "order", "created_at"],
    oppdater: ["text", "order"],
  },
  {
    navn: "parking_spots",
    kilde: `SELECT id, org_id, number, area_label, ownership_type, spot_type, status,
                   holder_name, unit_label, notes, COALESCE(created_at, now()) AS created_at
            FROM parking_spots`,
    kolonner: ["id", "org_id", "number", "area_label", "ownership_type", "spot_type", "status", "holder_name", "unit_label", "notes", "created_at"],
    oppdater: ["number", "area_label", "ownership_type", "spot_type", "status", "holder_name", "unit_label", "notes"],
  },
  {
    navn: "parking_leases",
    kilde: `SELECT id, org_id, spot_id, tenant_name, price_per_month, start_date, end_date,
                   notice_period_months, COALESCE(created_at, now()) AS created_at
            FROM parking_leases`,
    kolonner: ["id", "org_id", "spot_id", "tenant_name", "price_per_month", "start_date", "end_date", "notice_period_months", "created_at"],
    oppdater: ["tenant_name", "price_per_month", "start_date", "end_date", "notice_period_months"],
  },
  {
    navn: "parking_waitlist",
    kilde: `SELECT id, org_id, name, requested_type, requested_at, notes,
                   COALESCE(created_at, now()) AS created_at
            FROM parking_waitlist`,
    kolonner: ["id", "org_id", "name", "requested_type", "requested_at", "notes", "created_at"],
    oppdater: ["name", "requested_type", "requested_at", "notes"],
  },
];

function siter(navn: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(navn)) throw new Error(`Ugyldig kolonnenavn: ${navn}`);
  return `"${navn}"`;
}

async function kopier(t: Tabell): Promise<number> {
  const { rows } = await v1.query(t.kilde);
  if (rows.length === 0) return 0;
  if (TORRKJOR) return rows.length;

  const kolonner = t.kolonner.map(siter).join(", ");
  const oppdater =
    t.oppdater && t.oppdater.length > 0
      ? `DO UPDATE SET ${t.oppdater.map((k) => `${siter(k)} = EXCLUDED.${siter(k)}`).join(", ")}`
      : "DO NOTHING";

  const klient = await adminPool.connect();
  try {
    await klient.query("BEGIN");
    for (const rad of rows) {
      const verdier = t.kolonner.map((k) => rad[k]);
      const plassholdere = verdier.map((_, i) => `$${i + 1}`).join(", ");
      await klient.query(
        `INSERT INTO ${t.navn} (${kolonner}) VALUES (${plassholdere})
         ON CONFLICT (id) ${oppdater}`,
        verdier,
      );
    }
    await klient.query("COMMIT");
  } catch (e) {
    await klient.query("ROLLBACK");
    throw e;
  } finally {
    klient.release();
  }
  return rows.length;
}

/**
 * Passordene. v1 lagret bcrypt i `users.password_hash`; Better Auth vil ha dem i
 * `account.password` med `provider_id = 'credential'`. Formatet er identisk — se
 * hashing-konfigurasjonen i src/lib/auth.ts — så hashen kopieres rett over.
 *
 * Brukere uten passord i v1 (invitert, aldri satt) får ingen account-rad. De må gjennom
 * «glemt passord», akkurat som de måtte i v1.
 */
async function kopierPassord(): Promise<{ kopiert: number; utenPassord: number }> {
  const { rows } = await v1.query<{ id: string; password_hash: string | null }>(
    "SELECT id, password_hash FROM users",
  );
  const medPassord = rows.filter((r) => r.password_hash);
  if (TORRKJOR) return { kopiert: medPassord.length, utenPassord: rows.length - medPassord.length };

  const klient = await adminPool.connect();
  try {
    await klient.query("BEGIN");
    for (const r of medPassord) {
      await klient.query(
        // $2 og $3 er samme verdi, men må være ULIKE plassholdere: kolonnene har forskjellig
        // type (varchar og text), og Postgres klarer ikke å utlede én type for begge.
        `INSERT INTO account (id, user_id, account_id, provider_id, password, created_at, updated_at)
         VALUES ($1, $2, $3, 'credential', $4, now(), now())
         ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password, updated_at = now()`,
        [`cred-${r.id}`, r.id, r.id, r.password_hash],
      );
    }
    await klient.query("COMMIT");
  } catch (e) {
    await klient.query("ROLLBACK");
    throw e;
  } finally {
    klient.release();
  }
  return { kopiert: medPassord.length, utenPassord: rows.length - medPassord.length };
}

/**
 * Verifiserer at hver eneste qr_token er uendret. Dette er den ene sjekken som ikke kan
 * hoppes over: en migrering som genererte nye tokens ville sett vellykket ut helt til noen
 * skannet et oppslag i bygget.
 */
async function verifiserQrTokens(): Promise<void> {
  const kilde = await v1.query<{ id: string; qr_token: string | null }>(
    "SELECT id, qr_token FROM tasks WHERE qr_token IS NOT NULL",
  );
  if (kilde.rows.length === 0) {
    console.log("[qr] ingen tokens i v1 — ingenting å verifisere");
    return;
  }

  const klient = await adminPool.connect();
  try {
    const avvik: string[] = [];
    for (const rad of kilde.rows) {
      const { rows } = await klient.query<{ qr_token: string | null }>(
        "SELECT qr_token FROM tasks WHERE id = $1",
        [rad.id],
      );
      if (rows.length === 0) {
        avvik.push(`${rad.id}: mangler i v2`);
      } else if (rows[0]!.qr_token !== rad.qr_token) {
        avvik.push(`${rad.id}: ${rad.qr_token} → ${rows[0]!.qr_token}`);
      }
    }
    if (avvik.length > 0) {
      throw new Error(
        `QR-TOKENS ER ENDRET for ${avvik.length} oppgave(r). De fysiske oppslagene i bygget ` +
          `ville sluttet å virke:\n  ${avvik.slice(0, 10).join("\n  ")}`,
      );
    }
    console.log(`[qr] ✓ alle ${kilde.rows.length} qr_token er uendret`);
  } finally {
    klient.release();
  }
}

async function main(): Promise<void> {
  console.log(TORRKJOR ? "== TØRRKJØRING — ingenting skrives ==" : "== Migrerer fra v1 ==");

  for (const t of TABELLER) {
    const antall = await kopier(t);
    console.log(`  ${t.navn.padEnd(24)} ${antall}`);
  }

  const passord = await kopierPassord();
  console.log(`  ${"account (passord)".padEnd(24)} ${passord.kopiert}` +
    (passord.utenPassord ? `  (${passord.utenPassord} uten passord — må bruke «glemt passord»)` : ""));

  if (!TORRKJOR) await verifiserQrTokens();
  console.log("Ferdig.");
}

main()
  .then(async () => {
    await v1.end();
    await lukkPooler();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("\nMIGRERING FEILET:", e instanceof Error ? e.message : e);
    await v1.end().catch(() => {});
    await lukkPooler().catch(() => {});
    process.exit(1);
  });
