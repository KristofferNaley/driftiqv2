import { boolean, date, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { vendors } from "./vendors";

/**
 * Serviceavtale med en leverandør.
 *
 * ## Filfeltene skiller seg fra v1
 *
 * v1 lagret hele stien i `file_path`, fordi lese-endepunktene måtte finne filer i to
 * strukturer samtidig under overgangen til org-først. v2 har bare én struktur, så her
 * lagres bare FILNAVNET (uuid-basert) — stien utledes av `filSti(orgId, "contracts", …)`.
 * Migreringsskriptet tar basename av v1s `file_path`.
 */
export const contracts = pgTable("contracts", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id),
  vendorId: varchar("vendor_id")
    .notNull()
    .references(() => vendors.id),
  title: varchar("title").notNull(),
  /** Fri tekst, ikke enum — kategoriene endres oftere enn en Postgres-enum tåler. */
  category: varchar("category"),
  annualSum: integer("annual_sum"),
  /**
   * Kostnadskonto etter NS 4102 (6620 heis, 7500 forsikring …). Foreslås fra kategorien
   * (`kontoForKategori`) og brukes av budsjettforslaget i Økonomi til å legge avtalen på
   * riktig budsjettlinje. Nullbar — en avtale uten konto faller bare ut av forslaget.
   */
  account: integer("account"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  notes: text("notes"),
  contactName: varchar("contact_name"),
  contactEmail: varchar("contact_email"),
  contactPhone: varchar("contact_phone"),

  /** Lagret filnavn på disk (uuid + endelse). NULL = ingen fil lastet opp. */
  fileName: varchar("file_name"),
  /** Brukerens filnavn, kun til visning og nedlasting. */
  fileOriginalName: varchar("file_original_name"),
  /** Teller mot lagringskvoten — tabellen står i `FILTABELLER`. */
  fileSize: integer("file_size"),

  /**
   * Opt-in per kontrakt, satt av kunden selv: dokumentet kan inneholde kommersielle vilkår
   * de ikke nødvendigvis vil sende til Anthropics API, selv om det er deres egen AI-rådgiver.
   * Default false — den som ikke tar stilling, deler ingenting.
   */
  aiReadable: boolean("ai_readable").notNull().default(false),

  /**
   * Arkivering er en TREDJE tilstand ved siden av aktiv/utløpt. En utløpt avtale blir
   * liggende i oversikten og i «Utløpte avtaler»-tellingen helt til noen aktivt tar en
   * beslutning om den — samme mønster som Oppgaver og Avvik: åpen til den lukkes.
   * Arkivering fjerner den fra listen og KPI-ene, men sletter den aldri: utløpte avtaler
   * har verdi som historikk (regnskap, meglerpakke ved salg av andel, dokumentasjon ved tvist).
   */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archiveNote: varchar("archive_note"),
  /** Peker fra en fornyet avtale tilbake til den den erstattet. */
  predecessorId: varchar("predecessor_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Prishistorikk. Barnetabell uten egen `org_id` — isoleres gjennom `contracts`. */
export const contractPriceHistory = pgTable("contract_price_history", {
  id: varchar("id").primaryKey(),
  contractId: varchar("contract_id")
    .notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  effectiveDate: date("effective_date").notNull(),
  annualSum: integer("annual_sum").notNull(),
  note: varchar("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Contract = typeof contracts.$inferSelect;
export type ContractPriceHistory = typeof contractPriceHistory.$inferSelect;
