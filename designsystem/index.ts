/**
 * Designsystemet i DriftIQ v2, samlet som bibliotek.
 *
 * Denne fila er en ren re-eksport av byggeklossene i `src/components` — den kopierer
 * ingenting og eier ingenting. Formålet er å gi Claude Design en pakke-inngang å bygge
 * fra, slik at designagenten setter sammen skjermbilder av de SAMME komponentene appen
 * kjører på. Endres en komponent i `src/components`, endres den her ved neste bygg.
 *
 * Utvalget er bevisst: her ligger bare det som gjengis frittstående. Komponentene som
 * leser økten (`Layout`, `Sidebar`, `OrgVelger`, `ProfilModal` …) er holdt utenfor —
 * de krever sesjon og `/api/meg`, og ville blitt tomme kort i biblioteket.
 *
 * Selve utseendet ligger i `src/app/globals.css`: tokenene og klassene (`.card`,
 * `.btn`, `.input`, `.list-item` …) som komponentene under peker på.
 */

export {
  /** Kort med tittel og valgfri handling i toppen. Standardflaten for alt innhold. */
  Kort,
  /** Én rad i en liste — tittel, metatekst og et høyrefelt. */
  Rad,
  /** Tomtilstand: én setning der lista ville vært. */
  Tom,
  /** Feilmelding. Gjengir ingenting når meldingen er null. */
  Feil,
  /** Stort tall med etikett — KPI-flisen i oversiktene. */
  Nokkeltall,
  /** Inline «legg til»-skjema for korttoppen. */
  Hurtigskjema,
  /** Horisontal fanerad for moduler med flere visninger. */
  Faner,
} from "../src/components/felles";

export {
  /** Dialog over siden. Lukkes med Escape og klikk utenfor. */
  Modal,
  /** Høyreskuff for én rad mens lista blir stående. */
  Skuff,
  /** Modal med vertikale faner — detaljvisningen i v2. */
  Fanemodal,
  /** Plassholder for en fane som ikke er bygget ennå. */
  Kommer,
  /** Etikettramme rundt et vilkårlig skjemafelt. */
  Felt,
  /** Enlinjes tekstfelt. */
  Tekstfelt,
  /** Flerlinjes tekstfelt. */
  Tekstomrade,
  /** Nedtrekksliste. */
  Nedtrekk,
  /** Avkryssingsboks med etikett. */
  Avkryssing,
  /** Av/på-bryter. */
  Bryter,
  /** Knapperad nederst i et skjema — avbryt til venstre, primærhandling til høyre. */
  Knapperad,
} from "../src/components/skjema";

export type { Fanevalg } from "../src/components/skjema";
