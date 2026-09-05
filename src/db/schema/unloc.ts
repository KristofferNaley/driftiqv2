import { index, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";
import { vendors } from "./vendors";

/**
 * Unloc — digitale nøkler til leverandører. Designnotatet er `docs/unloc.md`.
 *
 * Integrasjonen er bygget som én fjernbar pakke: disse to tabellene, `lib/unloc.ts`
 * (HTTP), `lib/unlockobling.ts` (logikk), rutene under `/unloc` og `/vendors/{id}/unloc-keys`,
 * og to UI-komponenter. Ingen annen tabell har kolonner som peker hit; skal den ut, er det
 * én migrasjon som dropper begge tabellene (se «Slik fjernes den» i notatet).
 *
 * Nøkkelen i Unloc er sannheten om hvem som kan åpne hva. Radene her er DriftIQs bokføring
 * av det: hvem i styret delte ut, til hvem hos leverandøren, når — det Unloc ikke vet.
 */

/**
 * Koblingen per org: kundens egne API-credentials hos Unloc og prosjektet nøklene
 * opprettes i. Hemmeligheten ligger kryptert (`lib/kryptering.ts`, samme nøkkel som
 * Fiken-tokens); basen alene gir ikke tilgang til kundens låser.
 */
export const unlocSettings = pgTable("unloc_settings", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  clientId: varchar("client_id").notNull(),
  clientSecretEnc: text("client_secret_enc").notNull(),
  /** Unloc-prosjektet (`project.admin`-scope) — låser og nøkler lever i ett prosjekt. */
  projectId: varchar("project_id").notNull(),
  projectName: varchar("project_name").notNull(),
  /** Unloc-organisasjonen prosjektet hører til, når tokenet oppgir den. */
  unlocOrganizationId: varchar("unloc_organization_id"),
  connectedBy: varchar("connected_by").notNull(),
  connectedByUserId: varchar("connected_by_user_id").references(() => users.id, { onDelete: "set null" }),
  /** Siste feil fra Unloc (utløpt credential, nettfeil) — vises på Integrasjoner-fanen. */
  lastError: varchar("last_error"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("uq_unloc_settings_org").on(t.orgId),
]);

/**
 * Én digital nøkkel delt ut til en person hos en leverandør. `unloc_key_id` er nøkkelen
 * hos Unloc; `state` er et speil av Unlocs tilstand (`creating` | `scheduled` | `active` |
 * `inactive` | `expired` | `revoked` | `error`), friskes opp når fanen åpnes.
 *
 * Utdeler og tilbakekaller følger `Aktor`-mønsteret: navn OG bruker-id, begge — navnet
 * er snapshot (protokollen skal lese likt om ti år), id-en er søkenøkkel. Raden slettes
 * aldri ved tilbakekalling; den blir stående med `revoked_at` som historikk.
 */
export const vendorUnlocKeys = pgTable("vendor_unloc_keys", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  vendorId: varchar("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "cascade" }),
  unlocKeyId: varchar("unloc_key_id").notNull(),
  lockId: varchar("lock_id").notNull(),
  /** Låsens navn da nøkkelen ble delt ut — låser kan døpes om i Unloc, historikken ikke. */
  lockName: varchar("lock_name").notNull(),
  /** E.164 (`+4791234567`) — det er Unlocs identitet for mottakeren. */
  phone: varchar("phone").notNull(),
  /** Navnet på personen hos leverandøren, slik styret skrev det. */
  holderName: varchar("holder_name").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  /** NULL = uten utløp (til den kalles tilbake). */
  endAt: timestamp("end_at", { withTimezone: true }),
  state: varchar("state").notNull().default("creating"),
  stateCheckedAt: timestamp("state_checked_at", { withTimezone: true }),
  note: text("note"),
  issuedBy: varchar("issued_by").notNull(),
  issuedByUserId: varchar("issued_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedBy: varchar("revoked_by"),
  revokedByUserId: varchar("revoked_by_user_id").references(() => users.id, { onDelete: "set null" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_vendor_unloc_keys_vendor").on(t.vendorId),
  uniqueIndex("uq_vendor_unloc_keys_org_key").on(t.orgId, t.unlocKeyId),
]);

export type UnlocSettings = typeof unlocSettings.$inferSelect;
export type VendorUnlocKey = typeof vendorUnlocKeys.$inferSelect;
