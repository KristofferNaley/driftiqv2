import { boolean, doublePrecision, integer, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { parkingSpots } from "./parking";
import { users } from "./users";

/**
 * Easee — ladeanlegget i parkeringsmodulen. Designnotatet er `docs/easee.md`.
 *
 * Bygget som én fjernbar pakke etter Unloc-mønsteret: disse tre tabellene, `lib/easee.ts`
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
  /** Strømpris til avregning, i ØRE per kWh (jf. økonomimodulen). NULL = bare kWh vises. */
  pricePerKwhOre: integer("price_per_kwh_ore"),
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

export type EaseeSettings = typeof easeeSettings.$inferSelect;
export type EaseeCharger = typeof easeeChargers.$inferSelect;
export type EaseeChargerUsage = typeof easeeChargerUsage.$inferSelect;
