/**
 * Oppslagstavla — regler og typer som både serveren, adminsiden og selve skjermen trenger.
 *
 * IMPORTFRI med vilje (se «Server/klient-grensen» i CLAUDE.md): skjermsiden er en
 * klientkomponent, og status, farger og felt skal regnes likt i forhåndsvisningen og på
 * veggen. To kopier av «hva vises nå» ville drevet fra hverandre.
 */

export const OPPSLAGSTYPER = ["tekst", "bilde"] as const;
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
 * Forklaringen står i skjemaet, så styret velger ut fra hva beboeren skal oppfatte.
 */
export const KATEGORI_BESKRIVELSE: Record<Kategori, string> = {
  viktig: "Rød kant. For det beboerne MÅ få med seg: vann eller strøm stenges, stengt innkjørsel, sikkerhet.",
  info: "Kant i aksentfargen. Vanlige beskjeder fra styret: nye regler, nøkkelbrikker, påminnelser.",
  arrangement: "Gul kant. Noe beboerne er invitert til: dugnad, sommerfest, åpent styremøte.",
};

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
