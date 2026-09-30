/**
 * Oppslagstavla — regler og typer som både serveren, adminsiden og selve skjermen trenger.
 *
 * IMPORTFRI med vilje (se «Server/klient-grensen» i CLAUDE.md): skjermsiden er en
 * klientkomponent, og status, farger og felt skal regnes likt i forhåndsvisningen og på
 * veggen. To kopier av «hva vises nå» ville drevet fra hverandre.
 */

/**
 * «bilder» er én type for bilder og PDF: en ordnet liste med sider, der hver side er et
 * bilde (`board_post_pages`). Før 30.09.2026 het typen «bilde» og hadde ett bilde i raden.
 */
export const OPPSLAGSTYPER = ["tekst", "bilder"] as const;
export type Oppslagstype = (typeof OPPSLAGSTYPER)[number];

export const KATEGORIER = ["viktig", "info", "arrangement"] as const;
export type Kategori = (typeof KATEGORIER)[number];
export const KATEGORI_ETIKETT: Record<Kategori, string> = {
  viktig: "Viktig",
  info: "Informasjon",
  arrangement: "Arrangement",
};
/**
 * Typen styrer bare merkelappen og fargen på kanten — ikke rekkefølge eller visningstid.
 * Én kort linje under valget i skjemaet, så styret velger ut fra hva beboeren skal oppfatte.
 */
export const KATEGORI_BESKRIVELSE: Record<Kategori, string> = {
  viktig: "Rød kant. For det beboerne må få med seg.",
  info: "Kant i aksentfargen. Vanlige beskjeder fra styret.",
  arrangement: "Gul kant. Noe beboerne er invitert til.",
};

// ---------------------------------------------------------------------------------------
// Bilder og PDF
// ---------------------------------------------------------------------------------------

export const MAKS_SIDER = 10;
export const MAKS_BILDETEKST = 80;
/** Sekunder per bilde. Egen liste: et bilde trenger kortere tid enn en tekst. */
export const BILDESEKUNDER = [5, 8, 12, 20] as const;
export const STANDARD_BILDESEKUNDER = 8;
/** Bilder vises samtidig i rutenettet. */
export const RUTENETT_ANTALL = 4;

export const VISNINGSMATER = ["bla", "rutenett"] as const;
export type Visningsmate = (typeof VISNINGSMATER)[number];
export const VISNINGSMATE_ETIKETT: Record<Visningsmate, string> = { bla: "Bla gjennom bildene", rutenett: "Rutenett" };

/** «dekk» fyller feltet og beskjærer rundt fokuspunktet; «hele» viser hele bildet (lysbilder fra PDF). */
export const TILPASNINGER = ["dekk", "hele"] as const;
export type Tilpasning = (typeof TILPASNINGER)[number];

export const MAKS_OPPLASTING = 20 * 1024 * 1024;
/** Lengste kant etter konvertering til WebP på serveren. */
export const MAKS_KANT = 3840;

const OPPLASTINGSTYPER: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
  "application/pdf": "pdf",
};
const ENDELSER: Record<string, string> = { jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp", heic: "heic", heif: "heic", pdf: "pdf" };
export const OPPLASTING_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif";

/**
 * Hva slags fil dette er («jpg», «heic», «pdf» …), eller `null` når den ikke støttes.
 * Endelsen er reserve: noen nettlesere sender HEIC fra iPhone uten MIME-type.
 */
export function opplastingstype(fil: { name: string; type: string }): string | null {
  return OPPLASTINGSTYPER[fil.type] ?? (fil.type ? null : (ENDELSER[fil.name.split(".").pop()?.toLowerCase() ?? ""] ?? null));
}

/** Feilen på én fil før den lastes opp, eller `null`. Samme kontroll i skjemaet og på serveren. */
export function filFeil(fil: { name: string; type: string; size: number }): string | null {
  if (!opplastingstype(fil)) return "Filtypen støttes ikke";
  if (fil.size > MAKS_OPPLASTING) return "For stor, maks 20 MB";
  if (fil.size <= 0) return "Filen er tom";
  return null;
}

/** Sekundene et bildeoppslag står i rotasjonen: alle bildene etter tur, eller fire og fire i rutenettet. */
export function samletVisningstid(antall: number, sekunder: number, visning: Visningsmate = "bla"): number {
  return (visning === "rutenett" ? Math.ceil(antall / RUTENETT_ANTALL) : antall) * sekunder;
}

/** «4 bilder · 8 sek per bilde · 32 sek totalt» */
export function bildeoppsummering(antall: number, sekunder: number): string {
  return `${antall} ${antall === 1 ? "bilde" : "bilder"} · ${sekunder} sek per bilde · ${samletVisningstid(antall, sekunder)} sek totalt`;
}

export const RETNINGER = ["staende", "liggende"] as const;
export type Retning = (typeof RETNINGER)[number];
export const RETNING_ETIKETT: Record<Retning, string> = { staende: "Stående", liggende: "Liggende" };

/** Skalering per skjerm, i prosent. 85 er standard — 100 ble for stort på en vegg i nærheten. */
export const SKALERINGER = [60, 70, 75, 80, 85, 90, 100, 110, 120, 130] as const;
export const STANDARD_SKALERING = 85;

/** Sekunder hvert oppslag står før neste, som styret kan velge mellom. */
export const VISNINGSTIDER = [5, 8, 10, 15, 20, 30, 45, 60] as const;
export const STANDARD_SEKUNDER = 10;
/** Kontaktpersonene roterer i eget tempo, uavhengig av oppslagene. */
export const KONTAKT_SEKUNDER = 8;
/** Hvor ofte skjermen henter innhold — og dermed sender livstegn. */
export const HENT_SEKUNDER = 60;
/** Uten livstegn så lenge regnes skjermen som nede (tre bomskudd på rad). */
export const NEDE_ETTER_SEKUNDER = 3 * HENT_SEKUNDER;

// ---------------------------------------------------------------------------------------
// Validering — SAMME regler i skjemaet og på serveren
// ---------------------------------------------------------------------------------------

export const MAKS_TITTEL = 80;
/** 200 tegn siden 30.09.2026 (var 400). Eldre, lengre tekster vises som før, men må kortes ned ved redigering. */
export const MAKS_TEKST = 200;
/** Telleren i skjemaet blir gul herfra. */
export const TEKST_VARSEL = 160;

const erDato = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export type OppslagFelter = {
  /** Bildeoppslag kan stå uten tittel: den er bare navnet i lista. */
  type?: Oppslagstype;
  tittel: string;
  tekst?: string | null;
  fra: string;
  til: string;
  alleSkjermer: boolean;
  skjermIder: string[];
  sekunder: number;
};

/**
 * Feilen i et oppslag, som norsk melding, eller `null`. Skjemaet kaller den før innsending
 * og serveren kaller den i Zod-skjemaet (`oppslagInn`), så de to aldri er uenige om hva som
 * er et gyldig oppslag.
 */
export function oppslagFeil(d: OppslagFelter): string | null {
  const tittel = d.tittel.trim();
  if (tittel.length === 0 && d.type !== "bilder") return "Skriv en overskrift";
  if (tittel.length > MAKS_TITTEL) return `Overskriften er for lang (maks ${MAKS_TITTEL} tegn)`;
  if ((d.tekst ?? "").trim().length > MAKS_TEKST) return `Teksten er for lang (maks ${MAKS_TEKST} tegn)`;
  if (!erDato(d.fra) || !erDato(d.til)) return "Ugyldig dato";
  if (d.til < d.fra) return "«Til og med» kan ikke være før «Vis fra»";
  if (!d.alleSkjermer && d.skjermIder.length === 0) return "Velg minst én skjerm";
  if (![...VISNINGSTIDER, ...BILDESEKUNDER].includes(d.sekunder as never)) return "Ugyldig visningstid";
  return null;
}

export type HendelseFelter = { tittel: string; dato: string; tid?: string | null; sted?: string | null };

export function hendelseFeil(d: HendelseFelter): string | null {
  const tittel = d.tittel.trim();
  if (tittel.length === 0) return "Skriv hva som skjer";
  if (tittel.length > 60) return "Maks 60 tegn i «Hva»";
  if (!erDato(d.dato)) return "Ugyldig dato";
  if (d.tid && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.tid)) return "Ugyldig klokkeslett";
  if ((d.sted ?? "").trim().length > 50) return "Maks 50 tegn i «Hvor»";
  return null;
}

// ---------------------------------------------------------------------------------------
// Tekstskalering i oppslag
// ---------------------------------------------------------------------------------------

/** Grensene for tekstskaleringen: 1 er grunnstørrelsen i `.ot-hero`. */
export const TEKSTSKALA_MIN = 0.55;
export const TEKSTSKALA_MAKS = 2.6;

/** Det lengste ordet i teksten — det som avgjør hvor stor skriften kan bli i bredden. */
export function lengsteOrd(tekst: string): string {
  return tekst.split(/\s+/).reduce((lengst, ord) => (ord.length > lengst.length ? ord : lengst), "");
}

/**
 * Skalaen teksten i et oppslag skal ha. To steg, i den rekkefølgen:
 *
 * 1. **Bredden.** Det lengste ordet skal få plass på én linje: `ord` er bredden av det
 *    lengste ordet i hver tekstdel (overskrift, brødtekst) målt ved skala 1, mot bredden
 *    delen har. Bredden på et ord følger skriftstørrelsen lineært, så taket regnes ut.
 * 2. **Høyden.** Derfra og ned til hele teksten får plass (`passerIHoyden`, halvering).
 *
 * Aldri under `min`. Får ikke ordet plass selv der, settes `bryt`: ordet deles over to
 * linjer i stedet for å klippes. Får ikke teksten plass i høyden på `min`, settes `klipp`
 * (linjegrense). Første versjon målte bare høyden, og «arrangement» ble til «ement».
 */
export function finnTekstskala(m: {
  ord: ReadonlyArray<{ ordbredde: number; feltbredde: number }>;
  passerIHoyden: (skala: number) => boolean;
  min?: number;
  maks?: number;
}): { skala: number; bryt: boolean; klipp: boolean } {
  const min = m.min ?? TEKSTSKALA_MIN;
  const maks = m.maks ?? TEKSTSKALA_MAKS;
  // 2 % margin: målingen er i hele piksler, og en avrunding skal ikke koste siste bokstav.
  const tak = Math.min(maks, ...m.ord.filter((o) => o.ordbredde > 0).map((o) => (o.feltbredde / o.ordbredde) * 0.98));
  const bryt = tak < min;
  let hoy = Math.max(min, tak);
  if (m.passerIHoyden(hoy)) return { skala: hoy, bryt, klipp: false };
  let lav = min;
  if (!m.passerIHoyden(lav)) return { skala: lav, bryt, klipp: true };
  for (let n = 0; n < 8; n++) {
    const midt = (lav + hoy) / 2;
    if (m.passerIHoyden(midt)) lav = midt;
    else hoy = midt;
  }
  return { skala: lav, bryt, klipp: false };
}

export type Status = "na" | "planlagt" | "utlopt";
export const STATUS_ETIKETT: Record<Status, string> = { na: "Vises nå", planlagt: "Planlagt", utlopt: "Utløpt" };

/** `iDag` er ÅÅÅÅ-MM-DD i Oslo-tid; datoene er inklusive i begge ender. */
export function oppslagStatus(p: { showFrom: string; showUntil: string }, iDag: string): Status {
  if (p.showFrom > iDag) return "planlagt";
  if (p.showUntil < iDag) return "utlopt";
  return "na";
}

/** ÅÅÅÅ-MM-DD i Oslo-tid. Containeren kjører UTC; skjermen kan stå i hvilken som helst sone. */
export function osloIDag(t: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(t);
}

// ---------------------------------------------------------------------------------------
// Koblingskode
// ---------------------------------------------------------------------------------------

/** Uten 0/O, 1/I/L — koden leses av en veggskjerm og skrives inn for hånd. */
export const KODE_ALFABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const KODE_LENGDE = 6;

/** «k7m-4qx » → «K7M4QX». Bindestreken er bare for lesbarhet på skjermen. */
export function normaliserKode(kode: string): string {
  return kode.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function visKode(kode: string): string {
  return `${kode.slice(0, 3)}-${kode.slice(3)}`;
}

// ---------------------------------------------------------------------------------------
// Farger
// ---------------------------------------------------------------------------------------

export const STANDARD_UTSEENDE = { background: "#0b1f3a", accent: "#4c9bff" };

export const FORVALG = [
  { id: "driftiq", navn: "DriftIQ", background: "#0b1f3a", accent: "#4c9bff" },
  { id: "lys", navn: "Lys", background: "#f4f7fb", accent: "#1f5fd1" },
  { id: "skog", navn: "Skog", background: "#13261d", accent: "#7fd6a0" },
] as const;

export const erHexfarge = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

function hexTilRgb(h: string): [number, number, number] {
  const x = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as [number, number, number];
}
function rgbTilHex(a: number[]): string {
  return `#${a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}
function bland(a: string, b: string, t: number): string {
  const A = hexTilRgb(a);
  const B = hexTilRgb(b);
  return rgbTilHex(A.map((v, i) => v + (B[i]! - v) * t));
}
function luminans(h: string): number {
  const c = hexTilRgb(h).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function kontrast(a: string, b: string): number {
  const x = luminans(a);
  const y = luminans(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Hele skjermpaletten fra to farger. Styret velger bakgrunn og aksent; alt annet utledes,
 * og aksentteksten dyttes mot forgrunnen til den har 4.5:1 mot bakgrunnen — en lys aksent
 * på lys bakgrunn skal ikke gjøre telefonnummeret uleselig i oppgangen.
 */
export function skjermpalett(background: string, accent: string): Record<string, string> {
  const bg = erHexfarge(background) ? background : STANDARD_UTSEENDE.background;
  const acc = erHexfarge(accent) ? accent : STANDARD_UTSEENDE.accent;
  const mork = luminans(bg) < 0.35;
  const fg = mork ? "#f1f5fb" : "#0f1a2c";
  let aksentTekst = acc;
  for (let i = 0; i < 10 && kontrast(aksentTekst, bg) < 4.5; i++) aksentTekst = bland(aksentTekst, fg, 0.15);
  return {
    "--s-bg": bg,
    "--s-panel": bland(bg, mork ? "#ffffff" : "#000000", mork ? 0.07 : 0.045),
    "--s-line": bland(bg, fg, 0.16),
    "--s-fg": fg,
    "--s-fg2": bland(fg, bg, 0.18),
    "--s-muted": bland(fg, bg, 0.42),
    "--s-accent": acc,
    "--s-onacc": kontrast(acc, "#ffffff") >= 3 ? "#ffffff" : "#0f1a2c",
    "--s-accent-t": aksentTekst,
    "--s-sun": mork ? "#f2c14e" : "#9a6700",
    "--s-red": mork ? "#ff7a66" : "#c2412d",
  };
}

// ---------------------------------------------------------------------------------------
// Det skjermen får
// ---------------------------------------------------------------------------------------

/** Svaret på `/api/skjerm/innhold` — og på forhåndsvisningen i appen. Samme form begge steder. */
export type Skjerminnhold = {
  skjerm: {
    id: string;
    navn: string;
    adresse: string | null;
    retning: Retning;
    skala: number;
    /** Malen (`MALER` i tavlemaler.ts) og hvilke blokknøkler som står i hvilken sone. */
    mal: string;
    soner: Record<string, string[]>;
  };
  org: { navn: string; initialer: string; telefon: string | null; epost: string | null };
  utseende: { background: string; accent: string; harLogo: boolean; offlineMode: "siste" | "melding" };
  oppslag: Array<{
    id: string;
    type: Oppslagstype;
    tittel: string;
    tekst: string | null;
    kategori: Kategori | null;
    harFil: boolean;
    sekunder: number;
    /**
     * Bildeoppslag: sidene i rekkefølge, med bildetekst og fokuspunkt (prosent), og hvordan de
     * vises. Mangler i innhold en skjerm lagret før 30.09.2026.
     */
    sider?: Array<{ id: string; tekst: string | null; x: number; y: number; tilpasning: Tilpasning }>;
    visning?: Visningsmate;
  }>;
  kontakter: Array<{
    id: string;
    navn: string;
    rolle: string | null;
    telefon: string | null;
    epost: string | null;
    harBilde: boolean;
    /** Endres når bildet byttes — skjermen bruker den som nøkkel i bildebufferen sin. */
    bildeVersjon: string | null;
  }>;
  /** Data for de egne blokkene (vær, avganger) som står på skjermen, per `blokk:<id>`. */
  blokker: Record<string, Blokkdata>;
  /** Neste tømming per fraksjon (BIR). `null` = ikke koblet, og feltet skjules. */
  avfall: Array<{ fraksjon: string; etikett: string; dato: string }> | null;
  hendelser: Array<{ id: string; tittel: string; dato: string; tid: string | null; sted: string | null }>;
  /** ISO-tidspunkt da serveren svarte — skjermen viser det når den går uten nett. */
  hentet: string;
};

/** Værvarselet slik tavla bruker det (fra MET/yr, tolket i lib/yr.ts). */
export type Varsel = {
  naa: { temp: number; symbol: string | null };
  timer: Array<{ tid: string; temp: number; symbol: string | null; nedbor: number | null }>;
  dager: Array<{ dato: string; maks: number; min: number; symbol: string | null; nedbor: number }>;
};

export type Blokkdata =
  | {
      type: "vaer";
      navn: string;
      sted: string;
      visning: "timer" | "dager";
      /** `null` = MET har ikke svart på seks timer; blokken viser da ingenting. */
      varsel: Varsel | null;
    }
  | {
      type: "avganger";
      navn: string;
      holdeplasser: Array<{
        navn: string;
        avganger: Array<{ linje: string; modus: string; mot: string; tid: string; sanntid: boolean; innstilt: boolean }>;
      }>;
    };

/** Sekunder hver blokk står når flere deler en sone. Oppslagene roterer innenfor sin egen tid. */
export const SONE_SEKUNDER = 15;
