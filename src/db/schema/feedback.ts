import { boolean, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * «Meld feil» fra kunde-appen.
 *
 * Dekker tre ting med vilje — feil, forslag og spørsmål. Et styremedlem som opplever at noe
 * ikke virker, skiller ikke mellom «bug» og «det jeg trodde skulle skje». Å tvinge dem til å
 * velge riktig innboks gir feilsorterte saker og færre innmeldinger.
 *
 * Står i `UNNTATT`: saken hører til DriftIQs kø, ikke kundens. Løpenummeret går på tvers av
 * alle kunder nettopp derfor — det er vår saksrekke.
 */
export const feedbackReports = pgTable("feedback_reports", {
  id: varchar("id").primaryKey(),
  /** Vises som FM-0042. På tvers av kunder — det er DriftIQs kø. */
  number: integer("number"),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** bug | idea | question */
  kind: varchar("kind").notNull().default("bug"),
  /** Modulnøkkel, eller null = vet ikke. Å tvinge fram et valg gir gjetting. */
  module: varchar("module"),
  description: text("description").notNull(),
  /** ny | under_arbeid | venter_kunde | lost */
  status: varchar("status").notNull().default("ny"),

  /**
   * Innmelder. Navn og e-post KOPIERES inn i stedet for å slås opp via bruker-id: en sak
   * skal fortsatt kunne besvares om personen er fjernet fra borettslaget i mellomtiden.
   */
  reportedByUserId: varchar("reported_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reportedByName: varchar("reported_by_name").notNull(),
  reportedByEmail: varchar("reported_by_email"),

  /** Legges ved automatisk, så vi slipper å spørre etterpå. */
  appVersion: varchar("app_version"),
  userAgent: varchar("user_agent"),

  /** Bekreftet som noe vi skal gjøre noe med. Føres videre i backloggen manuelt. */
  inBacklog: boolean("in_backlog").notNull().default(false),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: varchar("resolved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Svar til kunden og interne notater på en innmelding. */
export const feedbackMessages = pgTable("feedback_messages", {
  id: varchar("id").primaryKey(),
  reportId: varchar("report_id")
    .notNull()
    .references(() => feedbackReports.id, { onDelete: "cascade" }),
  /** Skjules for kunden. Lar oss notere «dette er samme sak som FM-0031» uten å sende det. */
  internal: boolean("internal").notNull().default(false),
  authorName: varchar("author_name").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeedbackReport = typeof feedbackReports.$inferSelect;
export type FeedbackMessage = typeof feedbackMessages.$inferSelect;
