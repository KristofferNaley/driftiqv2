import { boolean, date, doublePrecision, index, integer, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { parkingSpots } from "./parking";
import { users } from "./users";

/**
 * Easee — ladeanlegget i parkeringsmodulen. Designnotatet er `docs/easee.md`.
 *
 * Bygget som én fjernbar pakke etter Unloc-mønsteret: tabellene her, `lib/easee.ts`
 * (HTTP), `lib/easeekobling.ts` (logikk), rutene under `/easee`, ett kort under
 * Integrasjoner og én komponent i Lading-fanen. `parking_spots` har INGEN kolonne som
 * peker hit — koblingen lader → plass ligger her (`easee_chargers.spot_id`), så pakken
 * kan droppes med én migrasjon uten spor i parkeringstabellene.
 *
 * Easee eier sannheten om laderne (tilstand, forbruk). Radene her er DriftIQs speil av
 * det, pluss det Easee ikke vet: hvilken parkeringsplass laderen står på.
 */

/**
 * Koblingen per org: tokenene fra kundens Easee-konto (site owner) og anlegget («site»)
 * laderne hører til. Easee gir access token (1 time) + refresh token mot brukernavn og
 * passord; PASSORDET LAGRES ALDRI — bare tokenene, kryptert (`lib/kryptering.ts`, samme
 * nøkkel som Fiken-tokens). Svikter fornyingen, må kontoadmin koble til på nytt.
 */
export const easeeSettings = pgTable("easee_settings", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** E-post eller mobilnummer med landkode — Easees brukernavn. Vises på Integrasjoner-fanen. */
  userName: varchar("user_name").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  /** Når access token utløper; fornyes med refresh token før det. */
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }).notNull(),
  /** Easees numeriske site-id — laderne og tilstanden hentes per site. */
  siteId: integer("site_id").notNull(),
  siteName: varchar("site_name").notNull(),
  /** Kontoen nøkkelen hører til (e-post fra profilen) — vises på Integrasjoner-fanen. */
  accountEmail: varchar("account_email"),
  connectedBy: varchar("connected_by").notNull(),
  connectedByUserId: varchar("connected_by_user_id").references(() => users.id, { onDelete: "set null" }),
  /** Siste feil fra Easee (ugyldig nøkkel, nettfeil) — vises på Integrasjoner-fanen. */
  lastError: varchar("last_error"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_easee_settings_org").on(t.orgId),
]);

/**
 * Én lader i anlegget, speilet fra Easee ved tilkobling og hver oppfrisking. `charger_id`
 * er Easees serienummer («EH123ABC»). `spot_id` er det DriftIQ tilfører: plassen laderen
 * står på — det er den som knytter kWh til disponent og leieavtale.
 *
 * Forsvinner laderen fra anlegget i Easee, settes `active = false`; raden slettes ikke,
 * forbrukshistorikken skal fortsatt kunne avregnes.
 */
export const easeeChargers = pgTable("easee_chargers", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  chargerId: varchar("charger_id").notNull(),
  name: varchar("name").notNull(),
  circuitName: varchar("circuit_name"),
  spotId: varchar("spot_id").references(() => parkingSpots.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  /** Easees `chargerOpMode` (0 offline … 8) — etiketter i `lib/easee.ts`. */
  opMode: integer("op_mode"),
  isOnline: boolean("is_online"),
  /** kW nå. */
  totalPower: doublePrecision("total_power"),
  /** kWh i pågående økt. */
  sessionEnergy: doublePrecision("session_energy"),
  /** kWh levert totalt siden laderen ble satt opp. */
  lifetimeEnergy: doublePrecision("lifetime_energy"),
  stateCheckedAt: timestamp("state_checked_at", { withTimezone: true }),
  usageCheckedAt: timestamp("usage_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_easee_chargers_org_charger").on(t.orgId, t.chargerId),
]);

/**
 * Månedsforbruk per lader, hentet fra Easees energimålinger. Lagres — ikke bare vises —
 * fordi avregningen skal kunne gjøres om igjen om et år, uavhengig av hva Easee da
 * husker, og fordi Easee ratebegrenser.
 */
export const easeeChargerUsage = pgTable("easee_charger_usage", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  chargerRowId: varchar("charger_row_id")
    .notNull()
    .references(() => easeeChargers.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  kwh: doublePrecision("kwh").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_easee_charger_usage_month").on(t.chargerRowId, t.year, t.month),
]);

/**
 * Timesforbruk per lader (kWh per time, Easees `lifetime-energy/{id}/hourly`). Det er
 * dette prisingen regnes fra: dag/natt-nettleie og spotpris er per time. Fylles av jobben
 * «easee-synk» og av «Oppdater fra Easee»; `hour_start` er timens start (UTC-øyeblikk).
 */
export const easeeChargerHours = pgTable("easee_charger_hours", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  chargerRowId: varchar("charger_row_id")
    .notNull()
    .references(() => easeeChargers.id, { onDelete: "cascade" }),
  hourStart: timestamp("hour_start", { withTimezone: true }).notNull(),
  kwh: doublePrecision("kwh").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_easee_charger_hours_hour").on(t.chargerRowId, t.hourStart),
  index("idx_easee_charger_hours_org_hour").on(t.orgId, t.hourStart),
]);

/**
 * Ladeøkter per lader (Easees `sessions/charger/{id}/sessions`): bil til, bil fra, kWh.
 * Rapporten viser dem som «hvem ladet når»; prisingen bruker timene over. Easees egen
 * `id` er nøkkelen, så en økt som oppdateres (pågående → ferdig) skrives over.
 */
export const easeeSessions = pgTable("easee_sessions", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  chargerRowId: varchar("charger_row_id")
    .notNull()
    .references(() => easeeChargers.id, { onDelete: "cascade" }),
  easeeSessionId: integer("easee_session_id").notNull(),
  carConnected: timestamp("car_connected", { withTimezone: true }).notNull(),
  carDisconnected: timestamp("car_disconnected", { withTimezone: true }),
  kwh: doublePrecision("kwh").notNull(),
  isComplete: boolean("is_complete").notNull().default(true),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_easee_sessions_session").on(t.chargerRowId, t.easeeSessionId),
  index("idx_easee_sessions_org_start").on(t.orgId, t.carConnected),
]);

/**
 * Prisplan for lading, versjonert med `valid_from` — «Norgespris ut desember, spot fra
 * januar» er to rader. Reglene og feltbetydningen står i `lib/laderegler.ts`; alle beløp
 * er øre inkl. mva. Rapporten for en måned bruker den nyeste planen med `valid_from` ≤
 * første dag i måneden.
 */
export const easeePricePlans = pgTable("easee_price_plans", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  validFrom: date("valid_from").notNull(),
  name: varchar("name").notNull(),
  /** «norgespris» | «spot» */
  kraftModel: varchar("kraft_model").notNull(),
  kraftOre: integer("kraft_ore").notNull().default(0),
  paaslagOre: integer("paaslag_ore").notNull().default(0),
  /** NO1–NO5, påkrevd for spot. */
  priceArea: varchar("price_area"),
  mvaProsent: integer("mva_prosent").notNull().default(25),
  nettDagOre: integer("nett_dag_ore").notNull().default(0),
  nettNattOre: integer("nett_natt_ore").notNull().default(0),
  nattFra: integer("natt_fra").notNull().default(22),
  nattTil: integer("natt_til").notNull().default(6),
  helgSomNatt: boolean("helg_som_natt").notNull().default(true),
  fastleddOre: integer("fastledd_ore").notNull().default(0),
  note: text("note"),
  createdBy: varchar("created_by").notNull(),
  createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_easee_price_plans_org_from").on(t.orgId, t.validFrom),
]);

/**
 * Spotpriser per prisområde og time (hvakosterstrommen.no, NOK/kWh UTEN mva). Offentlige
 * markedsdata uten org-eier — står i `UNNTATT` i RLS-registeret. Fylles av jobben for
 * områdene som har en spotplan, og leses av rapporten.
 */
export const powerPrices = pgTable("power_prices", {
  id: varchar("id").primaryKey(),
  area: varchar("area").notNull(),
  hourStart: timestamp("hour_start", { withTimezone: true }).notNull(),
  nokPerKwh: doublePrecision("nok_per_kwh").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_power_prices_area_hour").on(t.area, t.hourStart),
]);

export type EaseeSettings = typeof easeeSettings.$inferSelect;
export type EaseeChargerHour = typeof easeeChargerHours.$inferSelect;
export type EaseeSession = typeof easeeSessions.$inferSelect;
export type EaseePricePlan = typeof easeePricePlans.$inferSelect;
export type PowerPrice = typeof powerPrices.$inferSelect;
export type EaseeCharger = typeof easeeChargers.$inferSelect;
export type EaseeChargerUsage = typeof easeeChargerUsage.$inferSelect;
