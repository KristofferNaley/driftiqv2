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

/**
 * `--tabeller=a,b` kjører KUN de navngitte tabellene. Til etterfyll av noe som manglet
 * (som vedleggene, oppdaget 14.08.2026): en full kjøring OPPDATERER rader v2 har endret
 * siden sist — et avvik lukket i v2 ville blitt gjenåpnet av v1s status. Med filter
 * hoppes også passord, kontaktarv og QR-verifisering over.
 */
const TABELLFILTER = (() => {
  const arg = process.argv.find((a) => a.startsWith("--tabeller="));
  return arg ? new Set(arg.slice("--tabeller=".length).split(",").map((s) => s.trim())) : null;
})();

if (!V1_URL) {
  console.error("DATABASE_URL_V1 er ikke satt — pek den på v1-databasen du migrerer fra.");
  process.exit(1);
}

const v1 = new Pool({ connectionString: V1_URL });

/**
 * Oppslag i v1s FAKTISKE skjema, fylt av `lesV1Skjema()` før første spørring.
 *
 * ## Hvorfor dette trengs
 *
 * Skriptet må kunne kjøre mot mer enn én v1-versjon. Testmiljøet lå på v1 0.8.3, mens
 * produksjonen på server01 fortsatt sto på 0.8.2 da overgangen ble gjort (16.08.2026) —
 * og 0.8.3 hadde lagt til både kolonner (`tasks.due_date`,
 * `deviations.responsible_user_id`, `pricing_config.leads_notify_emails`) og hele tabeller
 * (`unit_works`, `unit_work_documents`). En `kilde` skrevet for 0.8.3 feiler mot 0.8.2 med
 * «column … does not exist», og migreringen stopper på tabell nummer tre.
 *
 * ## Hvorfor det IKKE er hardkodet til 0.8.2
 *
 * Å bare bytte de manglende kolonnene med `NULL` ville løst dagen og ødelagt neste kjøring:
 * mot en v1 som FAKTISKE har `due_date`, ville skriptet stille ha kastet ekte fristdatoer.
 * Derfor spør vi databasen i stedet for å anta, og hver gang et fallback brukes, SIES det
 * høyt i loggen. En manglende kolonne skal være en beskjed, ikke en stillhet.
 */
type Har = (tabell: string, kolonne: string) => boolean;

type Tabell = {
  navn: string;
  /**
   * SELECT mot v1. Kolonnenavnene her må matche kolonnene i v2.
   *
   * Er den en FUNKSJON, bygges spørringen etter at v1s skjema er lest — bruk `har(…)` til å
   * velge mellom ekte kolonne og `NULL`-fallback. Se `v1kol()`.
   */
  kilde: string | ((har: Har) => string);
  kolonner: string[];
  /** Kolonner som skal oppdateres hvis raden finnes fra før. Tom = la eksisterende rad stå. */
  oppdater?: string[];
  /**
   * Tabellen finnes ikke i alle v1-versjoner. Mangler den i kilden, hoppes den over med en
   * tydelig linje i loggen i stedet for å velte hele migreringen. Sett den KUN på tabeller
   * som er nye i en senere v1 enn den eldste vi migrerer fra — en tabell som forsvinner
   * uventet skal fortsatt være en feil.
   */
  valgfriIV1?: true;
};

/**
 * Kolonne fra v1 hvis den finnes, ellers `NULL` med riktig type og samme alias.
 *
 * Typen må stå: uten `::date` blir en tom kolonne `text` i resultatsettet, og INSERT-en i
 * v2 feiler på typemismatch i stedet for der problemet er.
 */
function v1kol(har: Har, tabell: string, kolonne: string, type: string): string {
  if (har(tabell, kolonne)) return kolonne;
  manglendeKolonner.push(`${tabell}.${kolonne}`);
  return `NULL::${type} AS ${kolonne}`;
}

/** Fylles av `v1kol()` og skrives ut samlet til slutt — se kommentaren på `Har`. */
const manglendeKolonner: string[] = [];

/** Leser v1s public-skjema én gang, og gir et oppslag som ikke treffer databasen igjen. */
async function lesV1Skjema(): Promise<{ har: Har; harTabell: (t: string) => boolean }> {
  const { rows } = await v1.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const kolonner = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
  const tabeller = new Set(rows.map((r) => r.table_name));
  return {
    har: (t, k) => kolonner.has(`${t}.${k}`),
    harTabell: (t) => tabeller.has(t),
  };
}

/**
 * Rekkefølgen er fremmednøkkelrekkefølge og kan ikke sorteres om: organisasjoner før
 * brukere, plasser før leieavtaler.
 */
const TABELLER: Tabell[] = [
  {
    navn: "bbl",
    // Må komme FØR organizations: `bbl_id` og `manager_bbl_id` peker hit, og en org med
    // tilknytning ville ellers blitt avvist av fremmednøkkelen.
    //
    // `ORDER BY` er ikke pynt: `successor_id` er en selvreferanse (fusjonerte lag peker på
    // laget de gikk inn i), og etterfølgeren må finnes før den som peker på den. Radene uten
    // etterfølger settes derfor inn først.
    kilde: `SELECT id, name, org_nr, region, website, notes, successor_id, merge_date,
                   COALESCE(active, true) AS active, COALESCE(created_at, now()) AS created_at
            FROM bbl
            ORDER BY (successor_id IS NOT NULL)`,
    kolonner: ["id", "name", "org_nr", "region", "website", "notes", "successor_id", "merge_date", "active", "created_at"],
    oppdater: ["name", "org_nr", "region", "website", "notes", "successor_id", "merge_date", "active"],
  },
  {
    navn: "organizations",
    // Kolonnelista er ikke minimal med vilje. Alt som er fylt ut av en kunde og IKKE kan
    // gjenskapes fra noe annet, skal med — en tom kontaktkolonne i v2 ser ut som «ikke fylt
    // ut ennå», ikke som tapt data, og oppdages derfor aldri. Førstemigreringen tok bare de
    // elleve første, og testmiljøet mistet stille byggdata, kvoteoverstyring og
    // BBL-tilknytning (oppdaget 16.08.2026 under generalprøven).
    //
    // `banner_path` er en FULL STI i v1 (`/app/uploads/orgs/{org}/profil/{uuid}.png`); v2
    // lagrer bare filnavnet og finner mappa selv. Derfor strippes alt fram til siste `/`.
    // Selve fila flyttes av migrer-opplastinger.sh (v1 `profil/` → v2 `org/`).
    kilde: `SELECT id, name, slug, org_nr, org_form, municipality, unit_count,
                   COALESCE(active, true) AS active, enabled_modules, deviation_categories, created_at,
                   phone, contact_email, website, storage_quota, building_info,
                   affiliation_type, bbl_id, manager_type, manager_bbl_id, manager_name, manager_org_nr,
                   COALESCE(has_employees, false) AS has_employees,
                   regexp_replace(banner_path, '^.*/', '') AS banner_file_name,
                   banner_name AS banner_original_name
            FROM organizations`,
    kolonner: ["id", "name", "slug", "org_nr", "org_form", "municipality", "unit_count", "active", "enabled_modules", "deviation_categories", "created_at",
      "phone", "contact_email", "website", "storage_quota", "building_info",
      "affiliation_type", "bbl_id", "manager_type", "manager_bbl_id", "manager_name", "manager_org_nr",
      "has_employees", "banner_file_name", "banner_original_name"],
    // `deviation_categories` er kundens egne avvikskategorier. Uten den her ville et lag som
    // har navngitt kategoriene sine falt tilbake til standardsettet, og gamle avvik ville
    // pekt på verdier som ikke lenger fantes i nedtrekket.
    oppdater: ["name", "slug", "org_nr", "org_form", "municipality", "unit_count", "active", "enabled_modules", "deviation_categories",
      "phone", "contact_email", "website", "storage_quota", "building_info",
      "affiliation_type", "bbl_id", "manager_type", "manager_bbl_id", "manager_name", "manager_org_nr", "has_employees"],
    // Banneret står bevisst UTENFOR `oppdater`: har kunden lastet opp et nytt i v2, skal en
    // ny kjøring ikke peke raden tilbake til v1-fila.
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
    // `notification_prefs` lå på ORGANISASJONEN i v1 til og med 0.8.2 (ett sett brytere og
    // én e-postadresse for hele laget) og flyttet til medlemskapet i 0.8.3. Migrerer vi fra
    // en 0.8.2-base, finnes kolonnen ikke her, og medlemskapene får NULL — altså
    // standardvalgene i src/lib/varselvalg.ts. Se notatet i overleveringen: de gamle
    // org-valgene er en egen vurdering, ikke noe dette skriptet skal gjette seg til.
    //
    // ── Nivået ──────────────────────────────────────────────────────────────────────────
    // v1 0.8.3 lagret nivået direkte (`orgadmin`/`redigering`/`visning`) og kunne kopieres
    // rått. v1 0.8.2 hadde det spredt på TRE felt, og en rå kopi feiler på
    // «invalid input value for enum accesslevelenum: "admin"»:
    //
    //   role             admin/superadmin styrer de kontosensitive sidene (Brukere,
    //                    Innstillinger) — det er v2s `orgadmin`.
    //   title            fri tekst, men styrer redigeringsrett i driftsmodulene: alt UNNTATT
    //                    et eksakt «varamedlem» gir full redigering (v1s auth.py
    //                    `_has_full_edit_tier`). Derfor er ELSE-grenen `redigering`, ikke
    //                    `visning` — motsatt vei ville stille fratatt hele styret skriverett.
    //   access_override  eksplisitt unntak per person, vinner over tittelen.
    //
    // Rekkefølgen under er v1s egen: `role` først (kontotilgang er den sterkeste), så
    // overstyringen, så tittelen. Merk at v2 ikke kan uttrykke v1s ene rare kombinasjon —
    // en admin som ER varamedlem hadde kontotilgang UTEN redigering. Den finnes ikke i
    // dataene (sjekket 16.08.2026), og orgadmin er det nærmeste hvis den skulle dukke opp.
    kilde: (har) => {
      const overstyring = har("user_org_memberships", "access_override")
        ? `WHEN access_override = 'visning' THEN 'visning'
                     WHEN access_override = 'full' THEN 'redigering'`
        : "";
      return `SELECT id, user_id, org_id,
                   CASE
                     WHEN role::text IN ('orgadmin', 'redigering', 'visning') THEN role::text
                     WHEN role::text IN ('admin', 'superadmin', 'kontoansvarlig') THEN 'orgadmin'
                     ${overstyring}
                     WHEN lower(trim(COALESCE(title, ''))) = 'varamedlem' THEN 'visning'
                     ELSE 'redigering'
                   END AS role,
                   title,
                   ${v1kol(har, "user_org_memberships", "notification_prefs", "text")},
                   COALESCE(created_at, now()) AS created_at
            FROM user_org_memberships`;
    },
    kolonner: ["id", "user_id", "org_id", "role", "title", "notification_prefs", "created_at"],
    // `notification_prefs` er med i `oppdater`: kjøres migreringen om igjen etter at kunden
    // har endret varslene sine i v1, skal v2 følge etter — ellers står v2 på et gammelt sett.
    oppdater: ["role", "title", "notification_prefs"],
  },
  {
    navn: "leads",
    // Innboksen skal ikke starte tom ved overgangen: en halvt bearbeidet lead i v1 er
    // fortsatt en mulig kunde. Statusløpet er det samme i begge (ny/kontaktet/kvalifisert/
    // avslatt/konvertert). `source` og `unit_count` har ingen kolonne i v2 og droppes —
    // v2-skjemaet samler dem ikke inn, og Brreg-feltene har tatt over rollen deres.
    // Etter organizations pga. converted_org_id-fremmednøkkelen.
    kilde: `SELECT id, name, lower(email) AS email, phone, company, message,
                   org_nr, org_form, municipality AS kommune,
                   COALESCE(status, 'ny') AS status, converted_org_id,
                   COALESCE(created_at, now()) AS created_at
            FROM leads`,
    kolonner: ["id", "name", "email", "phone", "company", "message", "org_nr", "org_form", "kommune", "status", "converted_org_id", "created_at"],
    // Status og konvertering følger med ved re-kjøring: behandles leaden videre i v1 etter
    // forrige migrering, skal ikke v2 vise den som ubehandlet.
    oppdater: ["status", "converted_org_id"],
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
                   COALESCE(relationship_type, 'avtale') AS relationship_type,
                   category, customer_number, COALESCE(ehf, false) AS ehf, last_used_at,
                   notes, org_number, invoice_reference,
                   COALESCE(created_at, now()) AS created_at
            FROM vendors`,
    kolonner: ["id", "org_id", "name", "active", "relationship_type", "category", "customer_number", "ehf", "last_used_at", "notes", "org_number", "invoice_reference", "created_at"],
    oppdater: ["name", "active", "relationship_type", "category", "customer_number", "ehf", "last_used_at", "notes", "org_number", "invoice_reference"],
  },
  {
    navn: "vendor_contacts",
    kilde: `SELECT id, org_id, vendor_id, name, role, email, phone,
                   COALESCE(is_primary, false) AS is_primary,
                   COALESCE(created_at, now()) AS created_at
            FROM vendor_contacts`,
    kolonner: ["id", "org_id", "vendor_id", "name", "role", "email", "phone", "is_primary", "created_at"],
    oppdater: ["name", "role", "email", "phone", "is_primary"],
  },
  {
    navn: "vendor_access_items",
    kilde: `SELECT id, org_id, vendor_id, title, description, areas,
                   COALESCE(status, 'utlevert') AS status, issued_to, issued_at,
                   COALESCE(created_at, now()) AS created_at
            FROM vendor_access_items`,
    kolonner: ["id", "org_id", "vendor_id", "title", "description", "areas", "status", "issued_to", "issued_at", "created_at"],
    oppdater: ["title", "description", "areas", "status", "issued_to", "issued_at"],
  },
  {
    navn: "vendor_notes",
    kilde: `SELECT id, org_id, vendor_id, text, author_name,
                   COALESCE(created_at, now()) AS created_at
            FROM vendor_notes`,
    kolonner: ["id", "org_id", "vendor_id", "text", "author_name", "created_at"],
    // Notater er append-only, som behandlingsjournalen på avvik.
    oppdater: [],
  },
  {
    // Før `tasks`: oppgaver kan være knyttet til én enhet (`unit_id`).
    navn: "units",
    kilde: `SELECT id, org_id, COALESCE(type, 'bolig') AS type, navn, beskrivelse, andelsnr,
                   leilighetsnr, oppgang, etasje, areal_m2, archived_at,
                   COALESCE(created_at, now()) AS created_at
            FROM units`,
    kolonner: ["id", "org_id", "type", "navn", "beskrivelse", "andelsnr", "leilighetsnr", "oppgang", "etasje", "areal_m2", "archived_at", "created_at"],
    oppdater: ["type", "navn", "beskrivelse", "andelsnr", "leilighetsnr", "oppgang", "etasje", "areal_m2", "archived_at"],
  },
  {
    navn: "tasks",
    // qr_token kopieres UENDRET. Se modulkommentaren.
    // `due_date` på oppgaver kom i v1 0.8.3; i 0.8.2 er en oppgave ren gjentakelse
    // (`frequency` + `start_date`) og har ingen egen frist å ta med.
    kilde: (har) => `SELECT id, org_id, vendor_id, responsible_user_id, title, description, location,
                   frequency::text AS frequency, start_date,
                   ${v1kol(har, "tasks", "due_date", "date")}, qr_token, unit_id,
                   COALESCE(active, true) AS active,
                   COALESCE(show_on_arshjul, false) AS show_on_arshjul,
                   COALESCE(created_at, now()) AS created_at
            FROM tasks`,
    kolonner: ["id", "org_id", "vendor_id", "responsible_user_id", "title", "description", "location", "frequency", "start_date", "due_date", "qr_token", "unit_id", "active", "show_on_arshjul", "created_at"],
    oppdater: ["title", "description", "location", "frequency", "start_date", "due_date", "responsible_user_id", "unit_id", "active", "show_on_arshjul"],
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
    navn: "hms_templates",
    kilde: `SELECT id, template_type, name, description,
                   COALESCE(is_default, false) AS is_default, COALESCE(active, true) AS active,
                   COALESCE(created_at, now()) AS created_at
            FROM hms_templates`,
    kolonner: ["id", "template_type", "name", "description", "is_default", "active", "created_at"],
    oppdater: ["name", "description", "is_default", "active"],
  },
  {
    navn: "hms_template_categories",
    kilde: `SELECT id, template_id, template_type, key, label, icon,
                   COALESCE("order", 0) AS "order", COALESCE(created_at, now()) AS created_at
            FROM hms_template_categories`,
    kolonner: ["id", "template_id", "template_type", "key", "label", "icon", "order", "created_at"],
    oppdater: ["label", "icon", "order"],
  },
  {
    navn: "hms_template_items",
    kilde: `SELECT id, category_id, text, COALESCE("order", 0) AS "order",
                   COALESCE(created_at, now()) AS created_at
            FROM hms_template_items`,
    kolonner: ["id", "category_id", "text", "order", "created_at"],
    oppdater: ["text", "order"],
  },
  {
    navn: "building_elements",
    kilde: `SELECT id, org_id, name, COALESCE(icon, '🏗') AS icon, category, installed_year,
                   condition_grade, expected_lifetime_years, next_action_year, estimated_cost,
                   vendor_id, warranty_years, warranty_expires, notes,
                   COALESCE(created_at, now()) AS created_at
            FROM building_elements`,
    kolonner: ["id", "org_id", "name", "icon", "category", "installed_year", "condition_grade", "expected_lifetime_years", "next_action_year", "estimated_cost", "vendor_id", "warranty_years", "warranty_expires", "notes", "created_at"],
    oppdater: ["name", "icon", "category", "installed_year", "condition_grade", "expected_lifetime_years", "next_action_year", "estimated_cost", "vendor_id", "warranty_years", "warranty_expires", "notes"],
  },
  {
    navn: "element_documents",
    kilde: `SELECT id, element_id, org_id, COALESCE(fdv_type, 'annet') AS fdv_type, title,
                   filename, original_name, content_type, file_size, uploaded_by,
                   COALESCE(uploaded_at, now()) AS uploaded_at
            FROM element_documents`,
    kolonner: ["id", "element_id", "org_id", "fdv_type", "title", "filename", "original_name", "content_type", "file_size", "uploaded_by", "uploaded_at"],
    oppdater: ["fdv_type", "title"],
  },
  {
    navn: "element_services",
    kilde: `SELECT id, element_id, org_id, service_date, title, performed_by, notes,
                   COALESCE(created_at, now()) AS created_at
            FROM element_services`,
    kolonner: ["id", "element_id", "org_id", "service_date", "title", "performed_by", "notes", "created_at"],
    oppdater: ["service_date", "title", "performed_by", "notes"],
  },
  {
    navn: "unit_works",
    // Hele modulen «arbeid på enhet» kom i v1 0.8.3. Migreres det fra en eldre v1, finnes
    // tabellen ikke, og det er ikke en feil — det er bare ingenting å hente.
    valgfriIV1: true,
    kilde: `SELECT id, org_id, unit_id, unit_label, element_id,
                   COALESCE(category, 'annet') AS category,
                   COALESCE(work_type, 'vedlikehold') AS work_type,
                   work_date, title, description, vendor_id, performed_by,
                   COALESCE(paid_by, 'borettslag') AS paid_by, cost, created_by,
                   COALESCE(created_at, now()) AS created_at
            FROM unit_works`,
    kolonner: ["id", "org_id", "unit_id", "unit_label", "element_id", "category", "work_type", "work_date", "title", "description", "vendor_id", "performed_by", "paid_by", "cost", "created_by", "created_at"],
    // unit_label er et snapshot og skal ALDRI oppdateres — se kommentaren på kolonnen.
    oppdater: ["element_id", "category", "work_type", "work_date", "title", "description", "vendor_id", "performed_by", "paid_by", "cost"],
  },
  {
    navn: "unit_work_documents",
    // Følger unit_works — se kommentaren der.
    valgfriIV1: true,
    kilde: `SELECT id, work_id, org_id, COALESCE(doc_type, 'annet') AS doc_type, title,
                   filename, original_name, content_type, file_size, uploaded_by,
                   COALESCE(uploaded_at, now()) AS uploaded_at
            FROM unit_work_documents`,
    kolonner: ["id", "work_id", "org_id", "doc_type", "title", "filename", "original_name", "content_type", "file_size", "uploaded_by", "uploaded_at"],
    oppdater: ["doc_type", "title"],
  },
  {
    navn: "annual_events",
    kilde: `SELECT id, org_id, title, description, COALESCE(category, 'annet') AS category,
                   start_date, event_date, COALESCE(is_recurring, false) AS is_recurring,
                   COALESCE(created_at, now()) AS created_at
            FROM annual_events`,
    kolonner: ["id", "org_id", "title", "description", "category", "start_date", "event_date", "is_recurring", "created_at"],
    oppdater: ["title", "description", "category", "start_date", "event_date", "is_recurring"],
  },
  {
    navn: "log_entries",
    kilde: `SELECT id, org_id, vendor_id, title, description, entry_date, created_by,
                   COALESCE(created_at, now()) AS created_at
            FROM log_entries`,
    kolonner: ["id", "org_id", "vendor_id", "title", "description", "entry_date", "created_by", "created_at"],
    oppdater: ["vendor_id", "title", "description", "entry_date"],
  },
  {
    navn: "contracts",
    // v1 lagret HELE stien i file_path; v2 lagrer bare filnavnet og utleder stien.
    // regexp_replace tar basename. MERK: selve FILENE kopieres ikke av dette skriptet —
    // se «Filer» i README. Uten den kopien peker radene på filer som ikke finnes.
    kilde: `SELECT id, org_id, vendor_id, title, category, annual_sum, start_date::date AS start_date,
                   end_date::date AS end_date, notes, contact_name, contact_email, contact_phone,
                   regexp_replace(file_path, '^.*/', '') AS file_name,
                   file_name AS file_original_name,
                   -- En størrelse UTEN fil er et fantom: den teller mot lagringskvoten for
                   -- alltid uten at kunden kan slette noe for å bli kvitt den. v1s
                   -- testbase har 13 slike kontrakter (28 MB til sammen), sannsynligvis
                   -- etter at filer forsvant uten at file_size ble nullet.
                   CASE WHEN file_path IS NULL THEN NULL ELSE file_size END AS file_size,
                   COALESCE(ai_readable, false) AS ai_readable,
                   archived_at, archive_note, predecessor_id,
                   COALESCE(created_at, now()) AS created_at
            FROM contracts`,
    kolonner: ["id", "org_id", "vendor_id", "title", "category", "annual_sum", "start_date", "end_date", "notes", "contact_name", "contact_email", "contact_phone", "file_name", "file_original_name", "file_size", "ai_readable", "archived_at", "archive_note", "predecessor_id", "created_at"],
    oppdater: ["title", "category", "annual_sum", "start_date", "end_date", "notes", "contact_name", "contact_email", "contact_phone", "file_name", "file_original_name", "file_size", "ai_readable", "archived_at", "archive_note"],
  },
  {
    navn: "contract_price_history",
    kilde: `SELECT id, contract_id, effective_date, annual_sum, note,
                   COALESCE(created_at, now()) AS created_at
            FROM contract_price_history`,
    kolonner: ["id", "contract_id", "effective_date", "annual_sum", "note", "created_at"],
    oppdater: ["effective_date", "annual_sum", "note"],
  },
  {
    navn: "document_folders",
    kilde: `SELECT id, org_id, parent_id, name, COALESCE(icon, '📁') AS icon,
                   COALESCE(created_at, now()) AS created_at
            FROM document_folders`,
    kolonner: ["id", "org_id", "parent_id", "name", "icon", "created_at"],
    oppdater: ["parent_id", "name", "icon"],
  },
  {
    navn: "documents",
    kilde: `SELECT id, org_id, COALESCE(folder, 'annet') AS folder, document_date, title,
                   description, filename, original_name, content_type, file_size, uploaded_by,
                   COALESCE(uploaded_at, now()) AS uploaded_at,
                   COALESCE(ai_readable, false) AS ai_readable
            FROM documents`,
    kolonner: ["id", "org_id", "folder", "document_date", "title", "description", "filename", "original_name", "content_type", "file_size", "uploaded_by", "uploaded_at", "ai_readable"],
    oppdater: ["folder", "document_date", "title", "description", "ai_readable"],
  },
  {
    // Rutinene står HER, og ikke oppe ved malene der de hører hjemme tematisk: en rutine kan
    // peke på en kontrakt, et dokument, en oppgave og en leverandør, og alle fire må finnes
    // først.
    navn: "routines",
    kilde: `SELECT id, org_id, title, description, category, responsible, applies_to,
                   COALESCE(is_critical, false) AS is_critical, review_interval_months,
                   COALESCE(status, 'utkast') AS status, last_reviewed_at,
                   COALESCE(version, 1) AS version, qr_token, vendor_id, contract_id,
                   document_id, task_id, COALESCE(created_at, now()) AS created_at
            FROM routines`,
    kolonner: ["id", "org_id", "title", "description", "category", "responsible", "applies_to", "is_critical", "review_interval_months", "status", "last_reviewed_at", "version", "qr_token", "vendor_id", "contract_id", "document_id", "task_id", "created_at"],
    oppdater: ["title", "description", "category", "responsible", "applies_to", "is_critical", "review_interval_months", "status", "last_reviewed_at", "version", "vendor_id", "contract_id", "document_id", "task_id"],
  },
  {
    navn: "routine_steps",
    kilde: `SELECT id, routine_id, COALESCE("order", 0) AS "order", title, description,
                   COALESCE(is_critical, false) AS is_critical, callout_type, callout_text
            FROM routine_steps`,
    kolonner: ["id", "routine_id", "order", "title", "description", "is_critical", "callout_type", "callout_text"],
    oppdater: ["order", "title", "description", "is_critical", "callout_type", "callout_text"],
  },
  {
    navn: "routine_versions",
    kilde: `SELECT id, routine_id, org_id, version_number, content_snapshot, changed_by,
                   COALESCE(changed_at, now()) AS changed_at
            FROM routine_versions`,
    kolonner: ["id", "routine_id", "org_id", "version_number", "content_snapshot", "changed_by", "changed_at"],
    // Versjonshistorikk er uforanderlig — ingen oppdatering, heller ikke fra migreringen.
    oppdater: [],
  },
  {
    navn: "completions",
    kilde: `SELECT id, task_id, COALESCE(completed_at, now()) AS completed_at, completed_by,
                   notes, COALESCE(has_deviation, false) AS has_deviation, deviation_description,
                   COALESCE(manual, false) AS manual
            FROM completions`,
    kolonner: ["id", "task_id", "completed_at", "completed_by", "notes", "has_deviation", "deviation_description", "manual"],
    oppdater: ["notes", "has_deviation", "deviation_description"],
  },
  {
    navn: "completion_checklist_results",
    kilde: `SELECT id, completion_id, item_id, text, COALESCE(checked, false) AS checked,
                   COALESCE("order", 0) AS "order"
            FROM completion_checklist_results`,
    kolonner: ["id", "completion_id", "item_id", "text", "checked", "order"],
    oppdater: [],
  },
  {
    navn: "hms_goals",
    kilde: `SELECT id, org_id, year, goal_text, period_start, period_end, responsible_user_id,
                   COALESCE(approved, false) AS approved, approved_date, approved_meeting,
                   COALESCE(created_at, now()) AS created_at
            FROM hms_goals`,
    kolonner: ["id", "org_id", "year", "goal_text", "period_start", "period_end", "responsible_user_id", "approved", "approved_date", "approved_meeting", "created_at"],
    oppdater: ["goal_text", "period_start", "period_end", "responsible_user_id", "approved", "approved_date", "approved_meeting"],
  },
  {
    navn: "hms_sub_goals",
    kilde: `SELECT id, goal_id, category, text, owner, COALESCE(created_at, now()) AS created_at
            FROM hms_sub_goals`,
    kolonner: ["id", "goal_id", "category", "text", "owner", "created_at"],
    oppdater: ["category", "text", "owner"],
  },
  {
    navn: "hms_goal_approvals",
    kilde: `SELECT id, goal_id, user_id, COALESCE(signed_at, now()) AS signed_at
            FROM hms_goal_approvals`,
    kolonner: ["id", "goal_id", "user_id", "signed_at"],
    // En signatur er en signatur. Den skal aldri skrives om av en migrering.
    oppdater: [],
  },
  {
    navn: "hazards",
    kilde: `SELECT id, org_id, title, category, description, probability, consequence, owner,
                   COALESCE(status, 'open') AS status, COALESCE(created_at, now()) AS created_at
            FROM hazards`,
    kolonner: ["id", "org_id", "title", "category", "description", "probability", "consequence", "owner", "status", "created_at"],
    oppdater: ["title", "category", "description", "probability", "consequence", "owner", "status"],
  },
  {
    navn: "hazard_actions",
    kilde: `SELECT id, org_id, hazard_id, title, COALESCE(status, 'not_started') AS status,
                   due_date, owner, COALESCE(created_at, now()) AS created_at
            FROM hazard_actions`,
    kolonner: ["id", "org_id", "hazard_id", "title", "status", "due_date", "owner", "created_at"],
    oppdater: ["title", "status", "due_date", "owner"],
  },
  {
    navn: "safety_rounds",
    kilde: `SELECT id, org_id, title, round_date, COALESCE(status, 'planned') AS status, notes,
                   COALESCE(created_at, now()) AS created_at
            FROM safety_rounds`,
    kolonner: ["id", "org_id", "title", "round_date", "status", "notes", "created_at"],
    oppdater: ["title", "round_date", "status", "notes"],
  },
  {
    navn: "safety_round_items",
    kilde: `SELECT id, round_id, text, section, COALESCE(checked, false) AS checked, notes,
                   COALESCE(created_at, now()) AS created_at
            FROM safety_round_items`,
    kolonner: ["id", "round_id", "text", "section", "checked", "notes", "created_at"],
    oppdater: ["text", "section", "checked", "notes"],
  },
  {
    navn: "safety_round_participants",
    kilde: `SELECT id, round_id, name, role, COALESCE(created_at, now()) AS created_at
            FROM safety_round_participants`,
    kolonner: ["id", "round_id", "name", "role", "created_at"],
    oppdater: ["name", "role"],
  },
  {
    navn: "hms_responsibilities",
    kilde: `SELECT id, org_id, area, person_name, note, COALESCE(updated_at, now()) AS updated_at
            FROM hms_responsibilities`,
    kolonner: ["id", "org_id", "area", "person_name", "note", "updated_at"],
    oppdater: ["person_name", "note", "updated_at"],
  },
  {
    navn: "hms_evaluations",
    kilde: `SELECT id, org_id, year, evaluated_date, participants, meeting, conclusion,
                   COALESCE(created_at, now()) AS created_at
            FROM hms_evaluations`,
    kolonner: ["id", "org_id", "year", "evaluated_date", "participants", "meeting", "conclusion", "created_at"],
    oppdater: ["evaluated_date", "participants", "meeting", "conclusion"],
  },
  {
    navn: "deviations",
    // `responsible_user_id` (ekte FK til users) kom i v1 0.8.3. I 0.8.2 finnes bare
    // `assigned_to`, som er fritekst — den er med uansett, og v2 bruker den nettopp som
    // «bærer av gamle verdier» (se src/db/schema/avvik.ts). Ingenting går tapt ved NULL her;
    // det som mangler er koblingen til en konkret bruker, og den fantes ikke i 0.8.2.
    kilde: (har) => `SELECT id, org_id, number, task_id, completion_id, vendor_id, unit_id,
                   round_id, round_item_id, title,
                   description, category, severity, COALESCE(status, 'ny') AS status,
                   reported_by, COALESCE(reported_at, now()) AS reported_at,
                   ${v1kol(har, "deviations", "responsible_user_id", "varchar")},
                   assigned_to, due_date, resolved_at, resolved_by,
                   resolution_notes
            FROM deviations`,
    kolonner: ["id", "org_id", "number", "task_id", "completion_id", "vendor_id", "unit_id", "round_id", "round_item_id", "title", "description", "category", "severity", "status", "reported_by", "reported_at", "responsible_user_id", "assigned_to", "due_date", "resolved_at", "resolved_by", "resolution_notes"],
    oppdater: ["title", "description", "category", "severity", "status", "responsible_user_id", "assigned_to", "due_date", "resolved_at", "resolved_by", "resolution_notes"],
  },
  {
    navn: "completion_photos",
    kilde: `SELECT id, completion_id, org_id, filename, original_name, content_type,
                   file_size, COALESCE(uploaded_at, now()) AS uploaded_at
            FROM completion_photos`,
    kolonner: ["id", "completion_id", "org_id", "filename", "original_name", "content_type", "file_size", "uploaded_at"],
    oppdater: [],
  },
  {
    navn: "deviation_treatments",
    kilde: `SELECT id, deviation_id, text, created_by, COALESCE(created_at, now()) AS created_at
            FROM deviation_treatments`,
    kolonner: ["id", "deviation_id", "text", "created_by", "created_at"],
    // Append-only: et innlegg skal ALDRI oppdateres, heller ikke av migreringen.
    oppdater: [],
  },
  {
    navn: "deviation_attachments",
    // Etter `deviation_treatments`: et vedlegg kan henge på ett behandlingsinnlegg
    // (`treatment_id`) — bildet som ble lastet opp da avviket ble lukket.
    //
    // Filene kopieres separat med scripts/migrer-opplastinger.sh — v1 lagrer dem nøstet
    // (deviations/{devId}/fil), v2 leser flatt (deviations/fil). Raden uten fila gir
    // «Fil ikke funnet på disk», fila uten raden er usynlig — begge må med.
    kilde: `SELECT id, deviation_id, org_id, treatment_id, filename, original_name,
                   content_type, file_size, uploaded_by, COALESCE(uploaded_at, now()) AS uploaded_at
            FROM deviation_attachments`,
    kolonner: ["id", "deviation_id", "org_id", "treatment_id", "filename", "original_name", "content_type", "file_size", "uploaded_by", "uploaded_at"],
    // Dokumentasjon — append-only, som behandlingsinnleggene.
    oppdater: [],
  },
  {
    navn: "deviation_logs",
    kilde: `SELECT id, deviation_id, changed_by, COALESCE(changed_at, now()) AS changed_at, event
            FROM deviation_logs`,
    kolonner: ["id", "deviation_id", "changed_by", "changed_at", "event"],
    oppdater: [],
  },
  {
    navn: "ai_conversations",
    kilde: `SELECT id, org_id, user_id, title, COALESCE(created_at, now()) AS created_at,
                   COALESCE(updated_at, now()) AS updated_at
            FROM ai_conversations`,
    kolonner: ["id", "org_id", "user_id", "title", "created_at", "updated_at"],
    oppdater: ["title", "updated_at"],
  },
  {
    navn: "ai_messages",
    kilde: `SELECT id, conversation_id, role, content, sources, model,
                   COALESCE(created_at, now()) AS created_at
            FROM ai_messages`,
    kolonner: ["id", "conversation_id", "role", "content", "sources", "model", "created_at"],
    // En logget samtale er et øyeblikksbilde. Migreringen skriver den aldri om.
    oppdater: [],
  },
  {
    navn: "ai_usage_daily",
    kilde: `SELECT id, org_id, date, COALESCE(questions,0) AS questions,
                   COALESCE(api_calls,0) AS api_calls, COALESCE(input_tokens,0) AS input_tokens,
                   COALESCE(output_tokens,0) AS output_tokens,
                   COALESCE(cache_read_tokens,0) AS cache_read_tokens,
                   COALESCE(cache_write_tokens,0) AS cache_write_tokens,
                   COALESCE(updated_at, now()) AS updated_at
            FROM ai_usage_daily`,
    kolonner: ["id", "org_id", "date", "questions", "api_calls", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "updated_at"],
    oppdater: ["questions", "api_calls", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "updated_at"],
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

  // -------------------------------------------------------------------------------------
  // Plattformens egne tabeller. De eies ikke av en kunde, og er derfor lette å glemme —
  // ingen ringer og sier at prismodellen er borte, den bare står på standardverdiene.
  // -------------------------------------------------------------------------------------
  {
    navn: "pricing_config",
    // Én rad («default»). Uten den faller panelet tilbake til innebygde priser, og et
    // abonnement regnet ut i v2 ville ikke stemt med fakturaen kunden allerede har fått.
    // `leads_notify_emails` (lista over varselmottakere) kom i v1 0.8.3. Er den ikke der,
    // står lista tom i v2, og LEADS_NOTIFY_EMAIL i .env er reserven — se kommentaren på
    // plattformVarslingsadresser() i src/lib/prismodell.ts.
    kilde: (har) => `SELECT id, floor_price, tiers, module_defaults, hidden_modules,
                   ${v1kol(har, "pricing_config", "leads_notify_emails", "text")},
                   COALESCE(updated_at, now()) AS updated_at
            FROM pricing_config`,
    kolonner: ["id", "floor_price", "tiers", "module_defaults", "hidden_modules", "leads_notify_emails", "updated_at"],
    oppdater: ["floor_price", "tiers", "module_defaults", "hidden_modules", "leads_notify_emails", "updated_at"],
  },
  {
    navn: "support_access_log",
    // Revisjonsspor: hvem i DriftIQ som har sett på hvilken kunde, og hvorfor. Et spor som
    // starter på null ved overgangen er verdiløst nettopp den dagen noen spør.
    kilde: `SELECT id, superadmin_id, admin_name, org_id, reason, started_at, expires_at, ended_at
            FROM support_access_log`,
    kolonner: ["id", "superadmin_id", "admin_name", "org_id", "reason", "started_at", "expires_at", "ended_at"],
    // Append-only. En avsluttet sesjon skal aldri skrives om.
  },
  {
    navn: "feedback_reports",
    // «Meld feil»-køen. Løpenummeret (`number`) er DriftIQs saksrekke på tvers av kunder og
    // kopieres uendret — en sak omtalt som FM-0031 i en e-post skal fortsatt hete det.
    //
    // v1s `screenshot_*`-kolonner har ingen mottaker i v2 (skjermbilder ble tatt ut til
    // fordel for `url` + `screen`, som v1 ikke har). De faller derfor bort, og det er et
    // bevisst valg — ikke en glipp.
    kilde: `SELECT id, number, org_id, kind, module, description, status,
                   reported_by_user_id, reported_by_name, reported_by_email,
                   app_version, user_agent, COALESCE(in_backlog, false) AS in_backlog,
                   resolved_at, resolved_by, COALESCE(created_at, now()) AS created_at
            FROM feedback_reports`,
    kolonner: ["id", "number", "org_id", "kind", "module", "description", "status",
      "reported_by_user_id", "reported_by_name", "reported_by_email",
      "app_version", "user_agent", "in_backlog", "resolved_at", "resolved_by", "created_at"],
    oppdater: ["status", "in_backlog", "resolved_at", "resolved_by"],
  },
  {
    navn: "feedback_messages",
    // v1 merket meldingen med om den ble SENDT til kunden; v2 merker den motsatte veien, med
    // om den er intern. Samme skille, snudd — derfor negeringen. En feilvending her ville
    // vist interne notater til kunden, så den står som eneste logikk i denne fila.
    kilde: `SELECT id, report_id, NOT COALESCE(sent_to_customer, false) AS internal,
                   author AS author_name, body, COALESCE(created_at, now()) AS created_at
            FROM feedback_messages`,
    kolonner: ["id", "report_id", "internal", "author_name", "body", "created_at"],
  },
];

function siter(navn: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(navn)) throw new Error(`Ugyldig kolonnenavn: ${navn}`);
  return `"${navn}"`;
}

async function kopier(t: Tabell, kildeSql: string): Promise<number> {
  const { rows } = await v1.query(kildeSql);
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
         -- DO NOTHING, ikke DO UPDATE: har brukeren allerede satt et passord i v2, er DET
         -- sannheten for dem. En ny migreringskjøring skal ikke stille dem tilbake til
         -- v1-passordet og låse dem ute av det de nettopp valgte.
         --
         -- Konflikten går på (user_id, provider_id), ikke på id: skriptets deterministiske
         -- «cred-<id>» kolliderer aldri med Better Auths uuid-er, så en id-basert konflikt
         -- ville bare lagt på enda en rad.
         ON CONFLICT (user_id, provider_id) DO NOTHING`,
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
/**
 * v1s `vendors.contact_name/_email/_phone` ble erstattet av `vendor_contacts`, men
 * kolonnene sto igjen med data for leverandører som aldri fikk en ny kontaktperson. v2 har
 * ikke kolonnene — så de radene ville forsvunnet stille. Her løftes de inn som en
 * primærkontakt, men BARE der leverandøren ikke allerede har en.
 */
async function loftGamleKontakter(): Promise<number> {
  const { rows } = await v1.query<{ id: string; org_id: string; contact_name: string | null; contact_email: string | null; contact_phone: string | null }>(
    `SELECT id, org_id, contact_name, contact_email, contact_phone FROM vendors
     WHERE (contact_name IS NOT NULL OR contact_email IS NOT NULL OR contact_phone IS NOT NULL)
       AND id NOT IN (SELECT vendor_id FROM vendor_contacts)`,
  );
  if (rows.length === 0 || TORRKJOR) return rows.length;

  const klient = await adminPool.connect();
  try {
    await klient.query("BEGIN");
    for (const r of rows) {
      await klient.query(
        `INSERT INTO vendor_contacts (id, org_id, vendor_id, name, email, phone, is_primary, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, true, now())
         ON CONFLICT (id) DO NOTHING`,
        [`legacy-${r.id}`, r.org_id, r.id, r.contact_name ?? "Kontakt", r.contact_email, r.contact_phone],
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

/**
 * Sjekker `TABELLER`-rekkefølgen mot v2s ekte fremmednøkler FØR første innsetting.
 *
 * Uten denne oppdages en feilsortering først midtveis: tabellene før den som ryker er
 * allerede committet, og en prod-migrering står halvveis inne i vedlikeholdsvinduet. Fire
 * feil lå her da rekkefølgen ble prøvd for første gang mot en TOM base (16.08.2026) —
 * `tasks` før `units`, `routines` før kontrakter og dokumenter, vedlegg før behandlinger.
 * At de aldri hadde smelt før, var flaks: mot en base som allerede hadde radene fra en
 * tidligere kjøring, fantes forelderen alt.
 *
 * Sjekken leser katalogen, ikke en liste vi vedlikeholder ved siden av — en ny
 * fremmednøkkel er derfor dekket i samme øyeblikk den finnes.
 */
async function sjekkRekkefolge(navn: string[]): Promise<void> {
  const plass = new Map(navn.map((n, i) => [n, i]));
  const { rows } = await adminPool.query<{ barn: string; forelder: string }>(
    `SELECT conrelid::regclass::text AS barn, confrelid::regclass::text AS forelder
       FROM pg_constraint
      WHERE contype = 'f' AND conrelid <> confrelid`,
  );
  const feil = rows
    .filter((r) => plass.has(r.barn) && plass.has(r.forelder) && plass.get(r.forelder)! > plass.get(r.barn)!)
    .map((r) => `${r.barn} settes inn før ${r.forelder}, som den peker på`);
  if (feil.length > 0) {
    throw new Error(
      `TABELLER er i feil rekkefølge — migreringen ville stoppet halvveis:\n  ` +
        [...new Set(feil)].sort().join("\n  "),
    );
  }
}

async function main(): Promise<void> {
  console.log(TORRKJOR ? "== TØRRKJØRING — ingenting skrives ==" : "== Migrerer fra v1 ==");

  const tabeller = TABELLFILTER ? TABELLER.filter((t) => TABELLFILTER.has(t.navn)) : TABELLER;
  if (TABELLFILTER && tabeller.length !== TABELLFILTER.size) {
    const kjente = new Set(tabeller.map((t) => t.navn));
    throw new Error(`Ukjente tabeller i --tabeller: ${[...TABELLFILTER].filter((n) => !kjente.has(n)).join(", ")}`);
  }

  // Kjøres også ved tørrkjøring: rekkefølgen er nettopp det en tørrkjøring skal avsløre.
  await sjekkRekkefolge(TABELLER.map((t) => t.navn));

  // Leses FØR første spørring: `kilde` som er en funksjon bygges av v1s faktiske skjema.
  const { har, harTabell } = await lesV1Skjema();

  const hoppetOver: string[] = [];
  for (const t of tabeller) {
    if (t.valgfriIV1 && !harTabell(t.navn)) {
      hoppetOver.push(t.navn);
      console.log(`  ${t.navn.padEnd(24)} —  (finnes ikke i denne v1-versjonen)`);
      continue;
    }
    const kildeSql = typeof t.kilde === "function" ? t.kilde(har) : t.kilde;
    const antall = await kopier(t, kildeSql);
    console.log(`  ${t.navn.padEnd(24)} ${antall}`);
  }

  // Sies HØYT, ikke bare i forbifarten: står det noe her, er v1 en eldre versjon enn den
  // skriptet er skrevet mot, og feltene under er tomme i v2 fordi de ikke fantes — ikke
  // fordi migreringen mistet dem. Er lista uventet, STOPP og finn ut hvorfor.
  if (manglendeKolonner.length > 0 || hoppetOver.length > 0) {
    console.log("\n  ── v1 manglet dette (eldre v1 enn skriptet er skrevet mot) ──");
    for (const k of manglendeKolonner) console.log(`     kolonne  ${k}  → NULL i v2`);
    for (const t of hoppetOver) console.log(`     tabell   ${t}  → hoppet over`);
  }

  if (TABELLFILTER) {
    console.log("Ferdig (kun filtrerte tabeller — passord, kontaktarv og QR hoppet over).");
    return;
  }

  const passord = await kopierPassord();
  console.log(`  ${"account (passord)".padEnd(24)} ${passord.kopiert}` +
    (passord.utenPassord ? `  (${passord.utenPassord} uten passord — må bruke «glemt passord»)` : ""));

  const loftet = await loftGamleKontakter();
  if (loftet > 0) {
    console.log(`  ${"vendor_contacts (arv)".padEnd(24)} ${loftet}  (fra v1s gamle enkeltkontakt)`);
  }

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
