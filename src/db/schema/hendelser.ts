import { index, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * Hendelsesloggen — «hvem gjorde hva» på tvers av modulene.
 *
 * Skrives av systemet i samme transaksjon som handlingen (`loggHendelse` i
 * `lib/hendelser.ts`), aldri av brukeren direkte. Generaliseringen av mønsteret fra
 * `deviation_logs`: der avviksmodulen logger per avvik, logger denne per organisasjon,
 * med modul og entitet som kolonner i stedet for som egen tabell.
 *
 * `entity`/`entityId` har med vilje INGEN fremmednøkkel: raden skal bli stående som
 * dokumentasjon etter at entiteten er slettet — en logglinje om et slettet dokument
 * som forsvant sammen med dokumentet hadde vært verdiløs.
 *
 * Navnet `audit_events` (ikke `events`) for avstand til `annual_events`.
 */
export const auditEvents = pgTable("audit_events", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  actorName: varchar("actor_name").notNull(),
  /** Aktøren som id. Nullbar — QR-flyten er anonym. Se `lib/aktor.ts`. */
  actorUserId: varchar("actor_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  /** Modulnøkkel fra `lib/moduler.ts`, eller «org» for bruker- og org-administrasjon. */
  module: varchar("module").notNull(),
  /** Hva slags entitet hendelsen gjelder («bruker», «dokument», «leieforhold», …). */
  entity: varchar("entity").notNull(),
  entityId: varchar("entity_id"),
  /** Norsk fritekst i fortid, samme stil som `deviation_logs.event`. */
  event: varchar("event").notNull(),
}, (t) => [
  // Append-only og vokser forbi alle andre tabeller. Både RLS-policyen og lesesiden
  // filtrerer på org_id og sorterer på occurred_at — uten indeks blir det seq scan.
  index("idx_audit_events_org_tid").on(t.orgId, t.occurredAt),
]);

export type AuditEvent = typeof auditEvents.$inferSelect;

/**
 * Innloggingshendelser — egen tabell, med vilje IKKE i `audit_events`.
 *
 * Innlogging er på BRUKERNIVÅ, ikke org-nivå: en bruker som sitter i to borettslag skal
 * ikke få innloggingene sine eksponert for begge styrene. Tabellen står derfor i UNNTATT
 * (leses kun av plattformpanelet) og har kort oppbevaring — se `lib/hendelser.ts`.
 *
 * `email` kopieres inn: mislykkede forsøk har ingen bruker å peke på, og raden skal
 * kunne leses etter at kontoen er slettet.
 */
export const authEvents = pgTable("auth_events", {
  id: varchar("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  email: varchar("email").notNull(),
  /** «innlogget», «feilet», «avvist» (deaktivert/sperret) eller «utlogget». */
  event: varchar("event").notNull(),
  ip: varchar("ip"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("idx_auth_events_tid").on(t.occurredAt),
]);

export type AuthEvent = typeof authEvents.$inferSelect;
