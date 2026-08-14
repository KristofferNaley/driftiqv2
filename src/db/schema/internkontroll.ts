import { boolean, date, integer, pgTable, text, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * Internkontroll — kravene i internkontrollforskriften § 5 andre ledd.
 *
 * Modulen er delt i fire: HMS-mål (pkt. 4), ansvarsfordeling (pkt. 5), risikovurdering
 * (pkt. 6) og vernerunde. Den årlige evalueringen (pkt. 8) ligger for seg.
 */

/** § 5 pkt. 4 — målene for helse, miljø og sikkerhet. Ett per år. */
export const hmsGoals = pgTable(
  "hms_goals",
  {
    id: varchar("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    goalText: text("goal_text").notNull(),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    responsibleUserId: varchar("responsible_user_id").references(() => users.id),
    approved: boolean("approved").notNull().default(false),
    approvedDate: date("approved_date"),
    approvedMeeting: varchar("approved_meeting"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("uq_hms_goal_year").on(t.orgId, t.year)],
);

export const hmsSubGoals = pgTable("hms_sub_goals", {
  id: varchar("id").primaryKey(),
  goalId: varchar("goal_id")
    .notNull()
    .references(() => hmsGoals.id, { onDelete: "cascade" }),
  category: varchar("category"),
  text: varchar("text").notNull(),
  owner: varchar("owner"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Signatur på et HMS-mål. Unik per (mål, bruker): styremedlemmet signerer på at målet er
 * kjent og vedtatt, og en dobbeltsignatur ville sett ut som to personer.
 */
export const hmsGoalApprovals = pgTable(
  "hms_goal_approvals",
  {
    id: varchar("id").primaryKey(),
    goalId: varchar("goal_id")
      .notNull()
      .references(() => hmsGoals.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("uq_hms_goal_user_approval").on(t.goalId, t.userId)],
);

/**
 * § 5 pkt. 6 — kartlagt fare. Risikotallet er `probability * consequence` og utledes,
 * det lagres aldri: to tall som kan si ulike ting om samme fare er verre enn ett.
 */
export const hazards = pgTable("hazards", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  title: varchar("title").notNull(),
  category: varchar("category"),
  description: text("description"),
  /**
   * 1–3 — se `skala` i lib/internkontroll.ts for hvorfor ikke v1s 1–5. NULL = ikke
   * vurdert: seeding fra mal skal SE uvurdert ut — et forvalg på 2/2 så ut som en
   * gjennomført vurdering ingen hadde gjort.
   */
  probability: integer("probability"),
  /** 1–3, NULL = ikke vurdert. */
  consequence: integer("consequence"),
  owner: varchar("owner"),
  status: varchar("status").notNull().default("open"),
  /**
   * Sist noen tok stilling til sannsynlighet/konsekvens. Det årlige sikres ikke av en
   * kalenderhendelse, men av at farer over tolv måneder gamle flagges og løftes opp i
   * lista — samme modell som rutinenes `lastReviewedAt`. NULL = aldri vurdert.
   */
  lastAssessedAt: timestamp("last_assessed_at", { withTimezone: true }),
  /**
   * Hvilken vurdering faren hører til: NULL = den løpende driften (standardbildet),
   * ellers et prosjektnavn («Takrehabilitering 2027»). Én avgrenset vurdering — bygging,
   * nytt anlegg — er bare farer med en annen kontekst, ikke et eget dokument.
   */
  context: varchar("context"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Tiltak mot en fare. Egen `org_id` som i v1 — RLS-policyen blir da den enkle formen. */
export const hazardActions = pgTable("hazard_actions", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  hazardId: varchar("hazard_id")
    .notNull()
    .references(() => hazards.id, { onDelete: "cascade" }),
  title: varchar("title").notNull(),
  status: varchar("status").notNull().default("not_started"),
  dueDate: date("due_date"),
  owner: varchar("owner"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Lagets egne sjekklister for vernerunder — én per rundetype (inne, ute, garasje …).
 *
 * Standardmalene fra plattformen (`hms_templates`) er bare utgangspunktet: velges en
 * standardmal, kopieres punktene inn som lagets EGEN liste, og laget redigerer kopien
 * fritt etterpå. Punkter som ikke passer laget slettes her — «ikke aktuelt» på en runde
 * er for det som vanligvis sjekkes, men ikke fantes den dagen.
 */
export const safetyRoundChecklists = pgTable("safety_round_checklists", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const safetyRoundChecklistItems = pgTable("safety_round_checklist_items", {
  id: varchar("id").primaryKey(),
  checklistId: varchar("checklist_id")
    .notNull()
    .references(() => safetyRoundChecklists.id, { onDelete: "cascade" }),
  text: varchar("text").notNull(),
  section: varchar("section"),
  /** Rekkefølgen i lista — createdAt er lik for punkter kopiert inn i samme kall. */
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Vernerunde. `completed` LÅSER runden: den er dokumentasjon på hva som ble observert den
 * dagen, og en runde som kan redigeres i ettertid dokumenterer ingenting.
 */
export const safetyRounds = pgTable("safety_rounds", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /**
   * Rundetypen — hvilken av lagets sjekklister runden ble opprettet fra. SET NULL ved
   * sletting: punktene er uansett KOPIERT inn i runden, så dokumentasjonen står seg.
   */
  checklistId: varchar("checklist_id").references(() => safetyRoundChecklists.id, {
    onDelete: "set null",
  }),
  title: varchar("title").notNull(),
  roundDate: date("round_date"),
  /** Fristen — bransjepraksis er vernerunde innen 1. juni og 1. desember. Driver banneret. */
  dueDate: date("due_date"),
  /** `planned` | `completed`. */
  status: varchar("status").notNull().default("planned"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const safetyRoundItems = pgTable("safety_round_items", {
  id: varchar("id").primaryKey(),
  roundId: varchar("round_id")
    .notNull()
    .references(() => safetyRounds.id, { onDelete: "cascade" }),
  text: varchar("text").notNull(),
  section: varchar("section"),
  /**
   * Rekkefølgen fra sjekklista punktene ble kopiert fra. `createdAt` er ubrukelig som
   * sortering her: now() er transaksjonstid, så alle punkter satt inn i samme kall får
   * samme stempel. Eldre rader har 0 og faller tilbake på createdAt.
   */
  order: integer("order").notNull().default(0),
  /**
   * `ok` | `avvik` | `ikke_aktuelt` | NULL = ubesvart. En avkryssing kunne ikke skille
   * «i orden» fra «ikke sjekket» fra «finnes ikke hos oss» — og det er forskjellen som
   * er dokumentasjonen. `checked` holdes i takt (status = ok) for eldre lesere.
   */
  status: varchar("status"),
  checked: boolean("checked").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const safetyRoundParticipants = pgTable("safety_round_participants", {
  id: varchar("id").primaryKey(),
  roundId: varchar("round_id")
    .notNull()
    .references(() => safetyRounds.id, { onDelete: "cascade" }),
  name: varchar("name").notNull(),
  role: varchar("role"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * § 5 pkt. 5 — hvem som følger opp hvilket HMS-område.
 *
 * Bevisst tynn: ett navn per område, som fritekst. Kravet er å ha fordelt oppfølgingen
 * skriftlig, ikke å modellere en organisasjon. Styret har uansett det samlede ansvaret
 * etter § 4, så dette er en arbeidsdeling og ikke en ansvarsfraskrivelse.
 *
 * Navn og ikke `userId`: den som følger opp brannvernet er ofte vaktmesteren eller en
 * leverandør, ikke en bruker i systemet. Et fremmednøkkelkrav ville tvunget kunden til å
 * opprette kontoer for folk som aldri skal logge inn.
 */
export const hmsResponsibilities = pgTable(
  "hms_responsibilities",
  {
    id: varchar("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** `brannvern` | `el_sikkerhet` | `utearealer`. */
    area: varchar("area").notNull(),
    personName: varchar("person_name"),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("uq_hms_responsibility_area").on(t.orgId, t.area)],
);

/**
 * § 5 pkt. 8 — styrets årlige gjennomgang av om internkontrollen virker.
 *
 * DSB stiller tre spørsmål: gir arbeidet forventede resultater, stemmer dokumentasjonen med
 * det som faktisk gjøres, og nås målet? De besvares samlet i `conclusion` framfor i tre
 * kolonner — svarene henger sammen, og et fritekstfelt er det styret faktisk fører i
 * protokollen.
 *
 * Forskriften angir ingen hyppighet. Årlig er en konvensjon styret setter selv, og det er
 * derfor `year` er nøkkelen og ikke et intervall vi håndhever.
 */
export const hmsEvaluations = pgTable(
  "hms_evaluations",
  {
    id: varchar("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    evaluatedDate: date("evaluated_date"),
    participants: varchar("participants"),
    meeting: varchar("meeting"),
    conclusion: text("conclusion"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("uq_hms_evaluation_year").on(t.orgId, t.year)],
);

export type HmsGoal = typeof hmsGoals.$inferSelect;
export type Hazard = typeof hazards.$inferSelect;
export type HazardAction = typeof hazardActions.$inferSelect;
export type SafetyRound = typeof safetyRounds.$inferSelect;
export type SafetyRoundChecklist = typeof safetyRoundChecklists.$inferSelect;
export type SafetyRoundChecklistItem = typeof safetyRoundChecklistItems.$inferSelect;
export type HmsResponsibility = typeof hmsResponsibilities.$inferSelect;
export type HmsEvaluation = typeof hmsEvaluations.$inferSelect;
