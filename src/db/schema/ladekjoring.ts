import { date, doublePrecision, index, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { unitOwners } from "./okonomi";
import { organizations } from "./organizations";
import { units } from "./units";
import { users } from "./users";

/**
 * Ladekjøringer — fakturagrunnlaget for strøm til lading, etter mønster av
 * `fee_runs`/`fee_run_lines` (docs/easee.md «Etappe 3»).
 *
 * Én kjøring = én periode (måned, kvartal, halvår — sameiets valg) og én linje per
 * seksjon med summen av månedsrapportene i perioden. Uten regnskapskobling er kjøringen
 * eksporten (CSV) til forretningsfører; med kobling oppretter adapteret fakturaene og
 * skriver `external_ref` tilbake. `sent_to` sier hvilket regnskapssystem — aldri antatt
 * Fiken. Kjøringen logges i hendelsesloggen.
 *
 * Hører til Easee-pakken (fjernes sammen med den), men tabellene heter `charging_*`
 * fordi grunnlaget er lading, ikke Easee — et annet anlegg gir samme linjer.
 */
export const chargingRuns = pgTable("charging_runs", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  /** «grunnlag» (laget, ikke sendt) | «sendt» (fakturert via adapter) | «annullert» */
  status: varchar("status").notNull().default("grunnlag"),
  dueDate: date("due_date").notNull(),
  /** Inntektskontoen fakturalinjene bokføres på (3605 standard). */
  incomeAccount: varchar("income_account").notNull(),
  /** Sum av linjene med mottaker, i øre. */
  totalAmount: integer("total_amount").notNull().default(0),
  lineCount: integer("line_count").notNull().default(0),
  /** Linjer uten mottaker (plass uten seksjon, seksjon uten eier, lader uten plass). */
  missingRecipients: integer("missing_recipients").notNull().default(0),
  totalKwh: doublePrecision("total_kwh").notNull().default(0),
  /** Regnskapssystemet fakturaene ble sendt til (`RegnskapsSystem`), når status er «sendt». */
  sentTo: varchar("sent_to"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdBy: varchar("created_by").notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chargingRunLines = pgTable("charging_run_lines", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  chargingRunId: varchar("charging_run_id")
    .notNull()
    .references(() => chargingRuns.id, { onDelete: "cascade" }),
  /** NULL når linja mangler mottaker — den står likevel, så styret ser hva som ikke ble fakturert. */
  unitId: varchar("unit_id").references(() => units.id, { onDelete: "set null" }),
  ownerId: varchar("owner_id").references(() => unitOwners.id, { onDelete: "set null" }),
  /** Eiernavnet slik det sto ved kjøringen — protokollen, ikke pekeren. */
  ownerName: varchar("owner_name"),
  ownerEmail: varchar("owner_email"),
  /** «H0301» — seksjonens visningsnavn ved kjøringen. */
  unitLabel: varchar("unit_label"),
  /** Plassene og laderne linja dekker («G01 · Garasje»), som tekst. */
  description: varchar("description").notNull(),
  /** Hvorfor linja mangler mottaker, når den gjør det. */
  issue: varchar("issue"),
  kwh: doublePrecision("kwh").notNull().default(0),
  kwhDay: doublePrecision("kwh_day").notNull().default(0),
  kwhNight: doublePrecision("kwh_night").notNull().default(0),
  energyAmount: integer("energy_amount").notNull().default(0),
  gridAmount: integer("grid_amount").notNull().default(0),
  fixedAmount: integer("fixed_amount").notNull().default(0),
  /** Øre — det som faktureres. */
  amount: integer("amount").notNull(),
  /** «Ordrereferanse» på fakturaen («Lading juli 2026»); sammen med kunden er den idempotensnøkkelen. */
  orderReference: varchar("order_reference").notNull(),
  /** Fakturaens id hos regnskapssystemet når adapteret har opprettet den. */
  externalRef: varchar("external_ref"),
  /** Fakturanummeret slik mottakeren ser det. */
  externalNumber: varchar("external_number"),
  /** Om fakturaen ble sendt til mottakeren (e-post) — ikke bare opprettet. */
  sentToRecipient: timestamp("sent_to_recipient", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_charging_run_lines_run").on(t.chargingRunId),
  index("idx_charging_run_lines_unit").on(t.unitId),
]);

export type ChargingRun = typeof chargingRuns.$inferSelect;
export type ChargingRunLine = typeof chargingRunLines.$inferSelect;
