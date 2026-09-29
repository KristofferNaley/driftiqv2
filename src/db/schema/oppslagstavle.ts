import { boolean, date, index, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * Oppslagstavla — infoskjermer i oppgangen. Designnotatet er `docs/oppslagstavle.md`.
 *
 * Styret legger ut oppslag og hendelser i appen; skjermene henter dem med et enhetstoken
 * og viser dem i faste soner. Skjermen har ingen brukerkonto — tokenet ER tilgangen, samme
 * modell som QR-koden, men for lesing av ett borettslags oppslag.
 */

/**
 * En tilkoblet skjerm. Én rad = én lisens.
 *
 * `deviceTokenHash` er sha256 av enhetstokenet. Tokenet selv ligger bare i skjermens
 * nettleser; en databasedump gir ingen tilgang til å lese oppslagene som en skjerm.
 */
export const boardScreens = pgTable(
  "board_screens",
  {
    id: varchar("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name").notNull(),
    /** Adressen skjermen står i — vises øverst på skjermen, så beboeren vet hvor hun er. */
    address: varchar("address"),
    /** «staende» | «liggende» — se `RETNINGER` i lib/oppslagstavleregler.ts. */
    orientation: varchar("orientation").notNull().default("staende"),
    /** JSON-liste over feltene som vises (`FELT`). Ukjente nøkler ignoreres ved lesing. */
    fields: text("fields"),
    deviceTokenHash: varchar("device_token_hash").notNull().unique(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    pairedBy: varchar("paired_by").notNull(),
    pairedByUserId: varchar("paired_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("board_screens_org_idx").on(t.orgId)],
);

/**
 * Koblingskoden en ny skjerm viser før den tilhører et borettslag.
 *
 * Ingen `org_id`: raden opprettes av en anonym skjerm FØR noen org er kjent, og står derfor
 * i `UNNTATT`. Når styret skriver inn koden, settes `screenId`; neste gang skjermen spør med
 * hemmeligheten sin, får den et ferskt enhetstoken og raden slettes. Hemmeligheten skiller
 * skjermen som viser koden fra alle andre som har sett den på veggen.
 */
export const boardPairings = pgTable("board_pairings", {
  code: varchar("code").primaryKey(),
  secretHash: varchar("secret_hash").notNull().unique(),
  screenId: varchar("screen_id").references(() => boardScreens.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Et oppslag: tekst eller bilde, med en visningsperiode og et utvalg skjermer.
 *
 * `allScreens` er et eget flagg og ikke «alle id-ene i lista»: en skjerm som kobles til i
 * morgen skal vise dugnadsoppslaget som gjelder hele borettslaget, uten at noen husker å
 * krysse den av.
 */
export const boardPosts = pgTable(
  "board_posts",
  {
    id: varchar("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** «tekst» | «bilde» — `OPPSLAGSTYPER`. */
    kind: varchar("kind").notNull(),
    title: varchar("title").notNull(),
    body: text("body"),
    /** «viktig» | «info» | «arrangement» — styrer fargen på kanten. Bare for tekst. */
    category: varchar("category"),
    fileName: varchar("file_name"),
    originalName: varchar("original_name"),
    contentType: varchar("content_type"),
    fileSize: integer("file_size"),
    /** Sekunder oppslaget står før neste. Styret velger per oppslag — et bilde trenger kortere tid enn en tekst. */
    displaySeconds: integer("display_seconds").notNull().default(10),
    showFrom: date("show_from").notNull(),
    showUntil: date("show_until").notNull(),
    allScreens: boolean("all_screens").notNull().default(true),
    screenIds: varchar("screen_ids").array().notNull().default([]),
    createdBy: varchar("created_by").notNull(),
    createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("board_posts_org_idx").on(t.orgId)],
);

/** En hendelse i skjermens kalenderfelt, lagt inn for hånd. Synk fra Outlook/Google kommer senere. */
export const boardEvents = pgTable(
  "board_events",
  {
    id: varchar("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: varchar("title").notNull(),
    eventDate: date("event_date").notNull(),
    /** «HH:MM», eller null for heldagshendelser. */
    eventTime: varchar("event_time"),
    place: varchar("place"),
    createdBy: varchar("created_by").notNull(),
    createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("board_events_org_idx").on(t.orgId)],
);

/**
 * Kontaktpersonene i kontaktfeltet — de roterer, så beboeren ser hvem i styret de kan
 * ringe. Bildet er valgfritt. Ingen rader ⇒ skjermen viser borettslagets egen telefon og
 * e-post (`organizations.phone`/`contactEmail`).
 *
 * Dette er personopplysninger på en vegg i oppgangen. Styret legger dem inn selv, og
 * sletting fjerner også bildet fra disk.
 */
export const boardContacts = pgTable(
  "board_contacts",
  {
    id: varchar("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name").notNull(),
    /** «Styreleder», «Vaktmester» … */
    role: varchar("role"),
    phone: varchar("phone"),
    email: varchar("email"),
    fileName: varchar("file_name"),
    contentType: varchar("content_type"),
    fileSize: integer("file_size"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("board_contacts_org_idx").on(t.orgId)],
);

/**
 * Utseendet for hele borettslaget — én rad per org, opprettes ved første lagring.
 * Mangler raden, brukes `STANDARD_UTSEENDE`. `file_size` heter som i de andre filtabellene
 * så logoen teller mot lagringskvoten (`FILTABELLER`).
 */
export const boardSettings = pgTable("board_settings", {
  orgId: varchar("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  background: varchar("background").notNull(),
  accent: varchar("accent").notNull(),
  fileName: varchar("file_name"),
  contentType: varchar("content_type"),
  fileSize: integer("file_size"),
  /** «siste» (vis siste innhold) | «melding» — hva skjermen gjør uten nett. */
  offlineMode: varchar("offline_mode").notNull().default("siste"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BoardScreen = typeof boardScreens.$inferSelect;
export type BoardPost = typeof boardPosts.$inferSelect;
export type BoardEvent = typeof boardEvents.$inferSelect;
export type BoardContact = typeof boardContacts.$inferSelect;
