import { date, index, integer, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { units } from "./units";
import { users } from "./users";
import { vendors } from "./vendors";
import { contracts } from "./kontrakter";

/**
 * Økonomimodulen — «DriftIQ styrer, Fiken fører». Designnotatet er `docs/fiken.md`
 * («Økonomimodulen» og «Foreslått rekkefølge», steg 1: økonomi uten Fiken).
 *
 * ## Beløp er heltall i ØRE
 *
 * Alle beløpskolonner her (`amount`, `monthly_amount`) er øre, ikke kroner — 3 500,00 kr
 * lagres som 350000. Det er formen Fiken bruker, og det er den eneste formen som ikke
 * krever flyttall for en leverandørfaktura på 5 725,50. Resten av appen (kontrakter,
 * parkering) lagrer hele kroner; den forskjellen er bevisst og dokumentert her og i
 * `lib/okonomiregler.ts`, som eier konverteringen begge veier. Ingen kolonne i dette
 * skjemaet skal noen gang være `numeric`.
 *
 * ## Ingen Fiken-felt
 *
 * Tabellene er DriftIQs egne grunndata. Regnskapskoblingen blir et adapter med egne
 * koblingstabeller (Fiken-id-er) — «byttes regnskapssystem, følger grunndataene med».
 * `fee_run_lines.order_reference` er det ene unntaket, og det er ikke Fiken-spesifikt:
 * det er DriftIQs idempotensnøkkel (`<unitId>:<ÅÅÅÅ-MM>`) som ethvert adapter sender med.
 */

/**
 * Eier per seksjon — eierregisteret («andelsregisteret»).
 *
 * Det første stedet DriftIQ lagrer personopplysninger om beboere systematisk. Avklart
 * 03.09.2026: sameiet får databehandleravtale der eiere med navn, e-post, telefon og
 * seksjon nevnes eksplisitt (se `docs/fiken.md`). Kommentaren på `units` om at registeret
 * aldri skal ha eiere gjaldt enhetsregisteret som sådan — eierne ligger derfor her, i egen
 * tabell, ikke på enheten: `units` er fortsatt bare fysiske fakta.
 *
 * Eierskifte er en HANDLING (`eierskifte()`), ikke en redigering: gammel eier får
 * `owner_to` satt og blir stående — fakturagrunnlaget for januar peker fortsatt på den som
 * eide i januar. En rad med `owner_to = NULL` er nåværende eier; det er høyst én per enhet.
 */
export const unitOwners = pgTable("unit_owners", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  unitId: varchar("unit_id")
    .notNull()
    .references(() => units.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  email: varchar("email"),
  phone: varchar("phone"),
  /** Fakturaadresse når den er en annen enn seksjonen — utleiere, dødsbo, verge. */
  invoiceAddress: text("invoice_address"),
  ownerFrom: date("owner_from").notNull(),
  /** NULL = nåværende eier. */
  ownerTo: date("owner_to"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_unit_owners_unit").on(t.unitId),
]);

/**
 * Budsjett per regnskapsår. `utkast` kan endres fritt; `vedtatt` (med årsmøtedato) låser
 * linjene og er grunnlaget satsene beregnes fra. Ett per år per org.
 */
export const budgets = pgTable("budgets", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  /** «utkast» | «vedtatt» */
  status: varchar("status").notNull().default("utkast"),
  /** Årsmøtedatoen vedtaket ble gjort. Satt sammen med status «vedtatt». */
  adoptedDate: date("adopted_date"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_budgets_org_year").on(t.orgId, t.year),
]);

/**
 * Én budsjettlinje = én kostnadsgruppe eller inntektspost, med et kontointervall fra Norsk
 * Standard kontoplan (NS 4102: 6320 kommunale avgifter, 6341 strøm, 6600–6620 vedlikehold,
 * 7500 forsikring …). Intervallet er det som senere matcher bokførte kjøp fra Fiken,
 * Tripletex eller forretningsførerens system — de bruker alle samme nummerserie.
 *
 * `kind`: «felleskost» er inntekten som fordeles på seksjonene etter brøk (konto 3601 —
 * låst i koden, ikke valgbart), «inntekt» er annet (utleie, renter), «kostnad» er utgifter.
 */
export const budgetLines = pgTable("budget_lines", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  budgetId: varchar("budget_id")
    .notNull()
    .references(() => budgets.id, { onDelete: "cascade" }),
  /** «felleskost» | «inntekt» | «kostnad» */
  kind: varchar("kind").notNull(),
  name: varchar("name").notNull(),
  accountFrom: integer("account_from"),
  /** NULL = samme som `account_from` (én konto). */
  accountTo: integer("account_to"),
  /** Årsbeløp i øre. */
  amount: integer("amount").notNull().default(0),
  note: text("note"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_budget_lines_budget").on(t.budgetId),
]);

/**
 * Sats per seksjon med gyldig-fra. Én rad per (enhet, gyldig-fra).
 *
 * `source` skiller det som er REGNET fra det som er SATT: «beregnet» skrives av
 * `beregnSatser()` fra vedtatt budsjett × brøk / 12, «overstyrt» av et menneske (garasje,
 * bod, tillegg). En ny beregning rører aldri en overstyrt rad — ellers forsvinner
 * tillegget hver gang noen trykker «Beregn».
 */
export const unitFeeRates = pgTable("unit_fee_rates", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  unitId: varchar("unit_id")
    .notNull()
    .references(() => units.id, { onDelete: "cascade" }),
  /** Budsjettet satsen ble regnet fra. NULL for en manuelt satt sats uten budsjett. */
  budgetId: varchar("budget_id").references(() => budgets.id, { onDelete: "set null" }),
  /** Månedsbeløp i øre, hele kroner i praksis (beregningen runder). */
  monthlyAmount: integer("monthly_amount").notNull(),
  validFrom: date("valid_from").notNull(),
  /** «beregnet» | «overstyrt» */
  source: varchar("source").notNull().default("beregnet"),
  note: varchar("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_unit_fee_rates_unit_from").on(t.unitId, t.validFrom),
]);

/**
 * Halvårskjøring av felleskostnader — fakturagrunnlaget.
 *
 * Én kjøring = én periode (1.1–30.6 eller 1.7–31.12) og én linje per seksjon per måned.
 * Uten regnskapskobling er kjøringen eksporten (CSV) til forretningsfører eller annet
 * system; med Fiken oppretter adapteret fakturaene fra de samme linjene og skriver
 * `external_ref` tilbake. Kjøringen logges i hendelsesloggen.
 */
export const feeRuns = pgTable("fee_runs", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  /** «grunnlag» (laget, ikke sendt) | «sendt» (fakturert via adapter) | «annullert» */
  status: varchar("status").notNull().default("grunnlag"),
  /** Forfallsdag i måneden, 1–28. */
  dueDay: integer("due_day").notNull().default(15),
  /** Sum av linjene i øre — kopiert ved opprettelse så lista slipper en join. */
  totalAmount: integer("total_amount").notNull().default(0),
  lineCount: integer("line_count").notNull().default(0),
  /** Seksjoner uten registrert eier da kjøringen ble laget — de fikk linjer uten mottaker. */
  missingOwners: integer("missing_owners").notNull().default(0),
  /** Aktør: navn OG id, begge — se `lib/aktor.ts`. */
  createdBy: varchar("created_by").notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feeRunLines = pgTable("fee_run_lines", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  feeRunId: varchar("fee_run_id")
    .notNull()
    .references(() => feeRuns.id, { onDelete: "cascade" }),
  unitId: varchar("unit_id")
    .notNull()
    .references(() => units.id, { onDelete: "cascade" }),
  /** Eieren linja skal faktureres. NULL når seksjonen manglet eier ved kjøringen. */
  ownerId: varchar("owner_id").references(() => unitOwners.id, { onDelete: "set null" }),
  /** Eiernavnet slik det sto ved kjøringen — protokollen, ikke pekeren. */
  ownerName: varchar("owner_name"),
  /** Første dag i måneden linja gjelder. */
  month: date("month").notNull(),
  dueDate: date("due_date").notNull(),
  /** Øre. */
  amount: integer("amount").notNull(),
  /** Idempotensnøkkelen mot regnskapssystemet: `<unitId>:<ÅÅÅÅ-MM>`. */
  orderReference: varchar("order_reference").notNull(),
  /** Fakturaens id i regnskapssystemet når adapteret har opprettet den. */
  externalRef: varchar("external_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_fee_run_lines_run").on(t.feeRunId),
  index("idx_fee_run_lines_unit").on(t.unitId),
]);

/**
 * Leverandørfaktura til godkjenning.
 *
 * Styret godkjenner før noe betales; regnskapet (Fiken eller forretningsfører) bokfører og
 * betaler. Her ligger BESLUTNINGEN: mottatt → godkjent/avvist → betalt, med hvem og når,
 * og koblingen til budsjettlinja som gir «budsjett mot faktisk». Vedlegget (PDF-en) lagres
 * som i kontrakter og teller mot kvoten (`FILTABELLER`).
 *
 * `vendor_id` er nullbar med `supplier_name` som reserve: en engangsleverandør skal ikke
 * måtte opprettes i leverandørregisteret for å få fakturaen sin godkjent.
 */
export const supplierInvoices = pgTable("supplier_invoices", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
  supplierName: varchar("supplier_name"),
  contractId: varchar("contract_id").references(() => contracts.id, { onDelete: "set null" }),
  budgetLineId: varchar("budget_line_id").references(() => budgetLines.id, { onDelete: "set null" }),
  invoiceNumber: varchar("invoice_number"),
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date"),
  /** Bruttobeløp i øre — det sameiet faktisk betaler (inngående mva er kostnad). */
  amount: integer("amount").notNull(),
  kid: varchar("kid"),
  description: varchar("description"),
  note: text("note"),
  /** «mottatt» | «godkjent» | «avvist» | «betalt» */
  status: varchar("status").notNull().default("mottatt"),
  registeredBy: varchar("registered_by").notNull(),
  registeredByUserId: varchar("registered_by_user_id").references(() => users.id, { onDelete: "set null" }),
  /** Den som godkjente eller avviste — begge er en beslutning, og begge logges. */
  decidedBy: varchar("decided_by"),
  decidedByUserId: varchar("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: varchar("decision_note"),
  paidDate: date("paid_date"),

  fileName: varchar("file_name"),
  fileOriginalName: varchar("file_original_name"),
  fileSize: integer("file_size"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_supplier_invoices_org_status").on(t.orgId, t.status),
]);

export type UnitOwner = typeof unitOwners.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type BudgetLine = typeof budgetLines.$inferSelect;
export type UnitFeeRate = typeof unitFeeRates.$inferSelect;
export type FeeRun = typeof feeRuns.$inferSelect;
export type FeeRunLine = typeof feeRunLines.$inferSelect;
export type SupplierInvoice = typeof supplierInvoices.$inferSelect;
