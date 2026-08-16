import { bigint, boolean, date, integer, numeric, pgEnum, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";
import { units } from "./units";
import { vendors } from "./vendors";

/**
 * Hvor ofte en oppgave skal utføres.
 *
 * NB: dette er en ekte Postgres-enum. Nye verdier krever `ALTER TYPE ... ADD VALUE`, ikke bare
 * en ny streng her — og dagtallet må inn i frekvenstabellen SAMTIDIG. Mangler det, blir
 * oppgaven stille aldri forsinket. Det er samme fella som i v1, og den overlever porten.
 */
export const frequencyEnum = pgEnum("frequencyenum", [
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "every_3_years",
  "every_5_years",
  "every_8_years",
  "on_demand",
]);

/** Oppgave. Direkte tenant-tabell — RLS-policy på org_id. */
export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey(),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id),
  vendorId: varchar("vendor_id")
    .notNull()
    .references(() => vendors.id),
  responsibleUserId: varchar("responsible_user_id").references(() => users.id),
  title: varchar("title").notNull(),
  description: text("description"),
  /** Historisk fritekst. Nye oppgaver peker på fellesareal via unit_id. */
  location: varchar("location"),
  frequency: frequencyEnum("frequency").notNull(),
  startDate: date("start_date"),
  /**
   * Frist for FØRSTE utførelse, og bare den. Ingen utkvittering → forsinket når fristen er
   * passert (også for `on_demand`, som ellers aldri kan bli forsinket). Etter første
   * utkvittering styrer frekvensen som før.
   */
  dueDate: date("due_date"),
  /**
   * Trykt på fysiske oppslag i bygget. Endres den, må hvert oppslag printes og henges opp
   * på nytt — migreringsskriptet verifiserer at den er uendret.
   */
  qrToken: varchar("qr_token").unique(),
  active: boolean("active").notNull().default(true),
  showOnArshjul: boolean("show_on_arshjul").notNull().default(false),
  /** Strukturert sted. Erstatter fritekstfeltet `location` for nye oppgaver. */
  unitId: varchar("unit_id").references(() => units.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Malpunkt på en oppgave. Barnetabell UTEN egen org_id — isoleres gjennom `tasks` via
 * EXISTS-policyen i rls/tables.ts. Selve avhukingen lagres per utførelse.
 */
export const taskChecklistItems = pgTable("task_checklist_items", {
  id: varchar("id").primaryKey(),
  taskId: varchar("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  text: varchar("text").notNull(),
  /**
   * `avkryssing` | `tall`.
   *
   * To typer, ikke fem. En fritekst-type inviterer til «ca. 5 bar» der man vil ha `5.0`, og
   * da er måleserien verdiløs — trengs en kommentar, finnes notatfeltet på utkvitteringen.
   */
  type: varchar("type").notNull().default("avkryssing"),
  /** «bar», «°C», «ppm». Kun for `tall`. Kopieres inn i resultatet — se `unit` der. */
  unit: varchar("unit"),
  /**
   * Må fylles ut for å kunne kvittere ut.
   *
   * AV som standard, og det er ikke forsiktighet: i dag er et uhuket punkt et gyldig svar
   * («ikke utført» og «ikke spurt om» er ulike ting). En hard sperre treffer QR-skjemaet,
   * der en montør står i et fyrrom med dårlig dekning — blokkerer den innsendingen, kan
   * resultatet bli at jobben ikke registreres i det hele tatt.
   */
  required: boolean("required").notNull().default(false),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Én utførelse av en oppgave. Kommer fra QR-skjemaet, leverandørportalen eller manuelt fra
 * styret i appen. Barnetabell uten egen `org_id` — isoleres gjennom `tasks`.
 */
export const completions = pgTable("completions", {
  id: varchar("id").primaryKey(),
  taskId: varchar("task_id")
    .notNull()
    .references(() => tasks.id),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  /** Navnet kopiert inn, ikke en peker. Historikk skal ikke endres i ettertid. */
  completedBy: varchar("completed_by").notNull(),
  /**
   * Hvem det VAR, når vi vet det. Ved siden av navnet, ikke i stedet for det.
   *
   * Navnet over er fortsatt det som VISES — en utkvittering skal lese likt om ti år, også
   * etter at kontoen er slettet. Id-en er til oppslag den andre veien: «hva har JEG gjort»
   * (`lib/aktivitet.ts`) kan ikke bygges på navn, for da forsvinner historikken din den dagen
   * du bytter etternavn.
   *
   * Nullbar, og det er ikke en svakhet: en utkvittering fra QR-skjemaet eller
   * leverandørportalen har ingen innlogget bruker å peke på. `SET NULL` fordi raden skal
   * overleve at kontoen slettes — navnet blir stående.
   */
  completedByUserId: varchar("completed_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  /**
   * Leverandøren som sto på oppgaven DA jobben ble utført — et snapshot, ikke et oppslag.
   *
   * Uten dette var leverandøren bare utledet via `tasks.vendor_id`, og den peker på hvem som
   * har avtalen NÅ. Bytter laget rørlegger, ville hele historikken lest som om den nye
   * rørleggeren utførte jobber de aldri var i nærheten av — og for en QR-utkvittering, der
   * navnefeltet er valgfri fritekst, er leverandøren ofte det eneste som sier hvem som kom.
   *
   * Nullbar: oppgaven har alltid en leverandør i dag, men gamle rader fra før kolonnen har
   * ingen, og en backfill av dem ville vært nettopp den gjetningen kolonnen skal hindre.
   */
  vendorId: varchar("vendor_id").references(() => vendors.id),
  notes: text("notes"),
  hasDeviation: boolean("has_deviation").notNull().default(false),
  deviationDescription: text("deviation_description"),
  /** Registrert av styret i appen, ikke via QR-skjemaet. Loggen viser kilden ærlig. */
  manual: boolean("manual").notNull().default(false),
});

/**
 * Avhuking av ett sjekkpunkt ved én utførelse.
 *
 * Teksten KOPIERES fra malen ved innsending. Malpunktet kan endres eller slettes uten at
 * gammel logg endrer seg — derfor er `itemId` nullbar med SET NULL. Dette er mønsteret for
 * all historikk i systemet.
 */
export const completionChecklistResults = pgTable("completion_checklist_results", {
  id: varchar("id").primaryKey(),
  completionId: varchar("completion_id")
    .notNull()
    .references(() => completions.id, { onDelete: "cascade" }),
  itemId: varchar("item_id").references(() => taskChecklistItems.id, { onDelete: "set null" }),
  text: varchar("text").notNull(),
  checked: boolean("checked").notNull().default(false),
  /**
   * Måleverdien, for punkter av typen `tall`. Null for avkryssingspunkter — og også for et
   * tallpunkt som IKKE ble lest av, som er noe annet enn verdien 0.
   *
   * `numeric` uten presisjon: trykk måles i bar med én desimal, temperatur i hele grader, og
   * en fast skala her ville avrundet noens avlesning. MERK at node-postgres gir `numeric`
   * tilbake som STRENG, akkurat som bigint — gjennom `Number()` før noe regnes eller tegnes.
   */
  value: numeric("value"),
  /**
   * Enheten SLIK DEN STO den dagen, kopiert fra malpunktet.
   *
   * Dette er den viktigste kolonnen i hele funksjonen. Uten den ville en endring av malen fra
   * bar til kPa stille omtolket alle gamle avlesninger, og en graf som blander de to er en
   * løgn som ser ut som data — kurven ser fortsatt ut som en kurve. Samme skille som `text`
   * over: malen kan endres, protokollen kan ikke.
   */
  unit: varchar("unit"),
  order: integer("order").notNull().default(0),
});

/**
 * Bilde som dokumentasjon på utført arbeid, lastet opp fra QR-skjemaet.
 *
 * `orgId` står HER og ikke bare på oppgaven: tabellen er en filtabell, og lagringskvoten
 * summeres per org. Uten kolonnen måtte hver kvoteberegning gå via to joins for å finne
 * eieren — og en filtabell uten `org_id` faller utenfor RLS-dekningstesten.
 */
export const completionPhotos = pgTable("completion_photos", {
  id: varchar("id").primaryKey(),
  completionId: varchar("completion_id")
    .notNull()
    .references(() => completions.id, { onDelete: "cascade" }),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id),
  filename: varchar("filename").notNull(),
  originalName: varchar("original_name").notNull(),
  contentType: varchar("content_type"),
  fileSize: bigint("file_size", { mode: "number" }),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Task = typeof tasks.$inferSelect;
export type CompletionPhoto = typeof completionPhotos.$inferSelect;
export type TaskChecklistItem = typeof taskChecklistItems.$inferSelect;
export type Completion = typeof completions.$inferSelect;
export type CompletionChecklistResult = typeof completionChecklistResults.$inferSelect;
