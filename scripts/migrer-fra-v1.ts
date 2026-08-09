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
    navn: "tasks",
    // qr_token kopieres UENDRET. Se modulkommentaren.
    kilde: `SELECT id, org_id, vendor_id, responsible_user_id, title, description, location,
                   frequency::text AS frequency, start_date, due_date, qr_token, unit_id,
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
    navn: "units",
    kilde: `SELECT id, org_id, COALESCE(type, 'bolig') AS type, navn, beskrivelse, andelsnr,
                   leilighetsnr, oppgang, etasje, areal_m2, archived_at,
                   COALESCE(created_at, now()) AS created_at
            FROM units`,
    kolonner: ["id", "org_id", "type", "navn", "beskrivelse", "andelsnr", "leilighetsnr", "oppgang", "etasje", "areal_m2", "archived_at", "created_at"],
    oppdater: ["type", "navn", "beskrivelse", "andelsnr", "leilighetsnr", "oppgang", "etasje", "areal_m2", "archived_at"],
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
                   file_name AS file_original_name, file_size,
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
    kilde: `SELECT id, org_id, number, task_id, completion_id, vendor_id, unit_id,
                   round_id, round_item_id, title,
                   description, category, severity, COALESCE(status, 'ny') AS status,
                   reported_by, COALESCE(reported_at, now()) AS reported_at,
                   responsible_user_id, assigned_to, due_date, resolved_at, resolved_by,
                   resolution_notes
            FROM deviations`,
    kolonner: ["id", "org_id", "number", "task_id", "completion_id", "vendor_id", "unit_id", "round_id", "round_item_id", "title", "description", "category", "severity", "status", "reported_by", "reported_at", "responsible_user_id", "assigned_to", "due_date", "resolved_at", "resolved_by", "resolution_notes"],
    oppdater: ["title", "description", "category", "severity", "status", "responsible_user_id", "assigned_to", "due_date", "resolved_at", "resolved_by", "resolution_notes"],
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

async function main(): Promise<void> {
  console.log(TORRKJOR ? "== TØRRKJØRING — ingenting skrives ==" : "== Migrerer fra v1 ==");

  for (const t of TABELLER) {
    const antall = await kopier(t);
    console.log(`  ${t.navn.padEnd(24)} ${antall}`);
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
