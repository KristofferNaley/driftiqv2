import { bigint, boolean, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { bbl } from "./bbl";

/** Et borettslag eller sameie. Står i UNNTATT — listes på tvers av plattformpanelet. */
export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey(),
  name: varchar("name").notNull(),
  slug: varchar("slug").notNull().unique(),
  orgNr: varchar("org_nr").unique(),
  /**
   * Kundens egne avvikskategorier som JSON, eller `null` for standardsettet. Les den gjennom
   * `lesKategorier` i lib/avvikkategorier.ts — aldri direkte: v1 lagret feltene som
   * `value`/`label`, og migrerte rader har fortsatt den formen.
   */
  deviationCategories: text("deviation_categories"),
  orgForm: varchar("org_form"),
  municipality: varchar("municipality"),
  /** Antall boliger/enheter — brukes til kostnad per enhet i vedlikeholdsplanen. */
  unitCount: integer("unit_count"),
  active: boolean("active").notNull().default(true),
  /**
   * Demo-, test- og kopikunder. De skal finnes (salgsdemoer, prod-kopier til feilsøk),
   * men statistikken skal kunne holde dem utenfor — ellers lyver hvert eneste tall.
   */
  demo: boolean("demo").notNull().default(false),
  /**
   * JSON-liste med modulnøkler kunden har aktivert. NULL/tom = ingen egen liste ⇒
   * standardsettet i lib/moduler.ts. Se `modulErAktivert()` for hvorfor en ødelagt verdi
   * faller tilbake til standard og ikke til «alt av».
   */
  enabledModules: text("enabled_modules"),
  /**
   * Lagringskvote i bytes. NULL = ingen egen kvote ⇒ `STANDARD_KVOTE` i lib/lagring.ts.
   * Da slipper vi å backfylle alle kunder, og standarden kan endres ett sted.
   */
  storageQuota: bigint("storage_quota", { mode: "number" }),
  /**
   * «Om bygget» — fri tekst styret fyller ut. Mates inn i AI-rådgiverens systemprompt og
   * brukes i det daglige, så den regnes som DRIFTSINNHOLD: `redigering` kan endre den.
   */
  buildingInfo: text("building_info"),
  /**
   * Avgjør hvilke lover internkontrollen må dekke. Uten ansatte gjelder verken
   * arbeidsmiljøloven eller forurensningsloven (jf. internkontrollforskriften § 2), og
   * kravene avgrenses til brannvern, el-sikkerhet og produktkontroll.
   */
  hasEmployees: boolean("has_employees").notNull().default(false),

  /**
   * Dashbordbanner — et bilde styret laster opp som vises øverst på dashbordet (v1-paritet).
   * Lagres under orgs/<id>/org/ med uuid-navn; originalnavnet er kun visning. Kolonnene
   * heter IKKE `file_size` med vilje: banneret er ett lite bilde og telles ikke mot kvoten,
   * og `file_size`-navnet ville dratt tabellen inn i FILTABELLER-kravet i lagring.test.ts.
   */
  bannerFileName: varchar("banner_file_name"),
  bannerOriginalName: varchar("banner_original_name"),

  /**
   * Kontaktpunktene til laget SELV — styrets fellesadresse, ikke en person. Hentes fra
   * Brønnøysund ved opprettelse og vedlikeholdes av plattformadmin.
   */
  phone: varchar("phone"),
  contactEmail: varchar("contact_email"),
  website: varchar("website"),

  // --- Tilknytning og forretningsfører (BL-85) ---------------------------------------
  // Settes KUN av plattformadmin. Kunden ser verdiene i egne innstillinger, men kan ikke
  // endre dem — se strippingen i lib/organisasjon.ts.

  /**
   * «frittstaende» | «tilknyttet» | NULL (ikke kartlagt ennå).
   *
   * Et tilknyttet borettslag følger andre regler ved salg og styring enn et frittstående.
   * Feltet er grunnlaget Lovverk-visningen og salgsflyten skal lese fra når de modulene
   * kommer; ingen av dem finnes ennå.
   */
  affiliationType: varchar("affiliation_type"),
  bblId: varchar("bbl_id").references(() => bbl.id),
  /**
   * Forretningsfører er et SEPARAT forhold fra tilknytningen. De faller ofte sammen (Vestbo
   * er forretningsfører for sine tilknyttede lag), men et frittstående lag kan ha et
   * regnskapsbyrå som forretningsfører, og et tilknyttet lag kan være selvadministrert.
   *
   * «selvadministrert» | «bbl» | «ekstern» | NULL.
   */
  managerType: varchar("manager_type"),
  managerBblId: varchar("manager_bbl_id").references(() => bbl.id),
  /**
   * Brukes kun når `managerType` = «ekstern». Eksterne forretningsførere er stort sett små,
   * lokale byråer med én kunde hos oss — et eget register ville vært tomgang.
   *
   * Kontaktperson, e-post og telefon fantes som kolonner i v1, men ble fjernet:
   * personopplysninger DriftIQ ikke trenger. De kommer ikke tilbake her.
   */
  managerName: varchar("manager_name"),
  managerOrgNr: varchar("manager_org_nr"),

  createdAt: timestamp("created_at").defaultNow(),
});

export type Organization = typeof organizations.$inferSelect;
