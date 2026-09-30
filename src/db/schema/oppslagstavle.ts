import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
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
    /**
     * Skalering i prosent (`SKALERINGER`). Tavla måles i prosent av bredden, så 4K og Full HD
     * ser like ut — dette er for leseavstand og hvor mye som får plass, ikke oppløsning.
     */
    scale: integer("scale").notNull().default(85),
    /** Malen skjermen deles etter (`MALER` i lib/tavlemaler.ts). Ukjent mal ⇒ standardmalen. */
    layout: varchar("layout"),
    /**
     * Hva som står i hvert felt i malen: `{ a: ["oppslag"], b: ["kalender"], stripe: [...] }`.
     * Verdiene er blokknøkler (`INNEBYGDE_BLOKKER` eller `blokk:<id>`); flere i samme felt
     * roterer. `null` finnes bare på rader fra før felt ble lagret per skjerm — de fylles av
     * `migrerPlasseringerTilFelt` ved oppstart.
     */
    zones: jsonb("zones").$type<Record<string, string[]>>(),
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
    /** «tekst» | «bilder» — `OPPSLAGSTYPER`. */
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
    /** Bildeoppslag: «bla» | «rutenett» (`VISNINGSMATER`). */
    layoutMode: varchar("layout_mode"),
    /**
     * Kladd: et bildeoppslag opprettes idet første fil lastes opp, så hver fil kan lastes opp
     * for seg med egen fremdrift. Kladder vises verken i lista eller på skjermene, og de som
     * aldri blir lagt ut, ryddes av nattjobben (`ryddKladder`).
     */
    draft: boolean("draft").notNull().default(false),
    /** Plassen i rotasjonen, lavest først. Styret drar radene i lista; nye oppslag havner øverst. */
    sortOrder: integer("sort_order").notNull().default(0),
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

/**
 * Sidene i et bildeoppslag, i rekkefølge. En side er ALLTID et bilde: opplastede bilder
 * gjøres om til WebP, og en PDF deles i ett bilde per side (lib/tavlebilder.ts) — PDF-en er
 * ikke en egen enhet etterpå, så enkeltsider kan fjernes og flyttes.
 *
 * Egen `org_id` så radene teller mot lagringskvoten (`FILTABELLER`) og har egen RLS-policy.
 */
export const boardPostPages = pgTable(
  "board_post_pages",
  {
    id: varchar("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    postId: varchar("post_id")
      .notNull()
      .references(() => boardPosts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    fileName: varchar("file_name").notNull(),
    contentType: varchar("content_type").notNull(),
    fileSize: integer("file_size").notNull(),
    /** Valgfri bildetekst, maks `MAKS_BILDETEKST`. */
    caption: varchar("caption"),
    /** Fokuspunktet i prosent — `object-position` på skjermen når bildet beskjæres. */
    focusX: integer("focus_x").notNull().default(50),
    focusY: integer("focus_y").notNull().default(50),
    /** «dekk» | «hele» (`TILPASNINGER`). Sider fra PDF får «hele»: et lysbilde skal ikke beskjæres. */
    fit: varchar("fit").notNull().default("dekk"),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("board_post_pages_org_idx").on(t.orgId), index("board_post_pages_post_idx").on(t.postId)],
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
 * Kontaktpersonene i kontaktfeltet: DriftIQ-brukere i orgen, valgt av orgadmin. De roterer,
 * så beboeren ser hvem i styret de kan ringe. Ingen rader ⇒ skjermen viser borettslagets
 * egen telefon og e-post (`organizations.phone`/`contactEmail`).
 *
 * Personopplysninger på en vegg i oppgangen: telefon og e-post vises bare når de er slått
 * på per person (`showPhone`/`showEmail`). Bildet er valgfritt; sletting fjerner det fra disk.
 */
export const boardContacts = pgTable(
  "board_contacts",
  {
    id: varchar("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /**
     * DriftIQ-brukeren. Navn, telefon og e-post leses FERSKT fra profilen og rollen fra
     * medlemskapets tittel — ingen kopi som går ut på dato. Slettes brukeren, forsvinner
     * kontakten fra veggen.
     */
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    showPhone: boolean("show_phone").notNull().default(true),
    showEmail: boolean("show_email").notNull().default(false),
    fileName: varchar("file_name"),
    contentType: varchar("content_type"),
    fileSize: integer("file_size"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("board_contacts_org_idx").on(t.orgId), uniqueIndex("board_contacts_bruker").on(t.orgId, t.userId)],
);

/**
 * En innholdsblokk med egne innstillinger — vær for et sted, avganger fra en eller to
 * holdeplasser. Oppslag, kalender, kontakt og tømmedager er innebygde blokker med faste
 * nøkler og har ingen rad her (`INNEBYGDE_BLOKKER`).
 *
 * `config` er JSON, validert med Zod-skjemaet for typen i lib/tavleblokker.ts ved hver
 * skriving og lesing — en ødelagt rad blir en tom blokk, ikke en krasj på veggen.
 */
export const boardBlocks = pgTable(
  "board_blocks",
  {
    id: varchar("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** «vaer» | «avganger» — `BLOKKTYPER`. */
    kind: varchar("kind").notNull(),
    name: varchar("name").notNull(),
    config: text("config").notNull(),
    createdBy: varchar("created_by").notNull(),
    createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("board_blocks_org_idx").on(t.orgId)],
);

/**
 * UTGÅTT 30.09.2026: plassering per blokk (område og skjermer). Feltene lagres nå per skjerm
 * (`board_screens.zones`). Tabellen leses bare av `migrerPlasseringerTilFelt` i
 * lib/tavlemigrering.ts, som gjør radene om til felt for skjermer som mangler dem.
 */
export const boardPlacements = pgTable(
  "board_placements",
  {
    id: varchar("id").primaryKey(),
    orgId: varchar("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    blockKey: varchar("block_key").notNull(),
    /** «hoved» | «side» | «stripe» | «av» — `OMRADER`. */
    area: varchar("area").notNull(),
    allScreens: boolean("all_screens").notNull().default(true),
    screenIds: varchar("screen_ids").array().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("board_placements_nokkel").on(t.orgId, t.blockKey)],
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
export type BoardBlock = typeof boardBlocks.$inferSelect;
