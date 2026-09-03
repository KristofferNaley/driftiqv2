/**
 * Reglene i økonomimodulen som både server og nettleser trenger. **Ingen importer** —
 * fila leses av klientkomponenter, se kommentaren i `nivaer.ts` for hvorfor det er et krav.
 *
 * ## Øre, aldri flyttall
 *
 * Alle beløp i modulen er heltall i øre (se `db/schema/okonomi.ts`). Denne fila eier
 * konverteringen begge veier: `tilOre()` fra det brukeren skriver, `kroner()` til det
 * brukeren ser. Ingen andre steder skal gange eller dele med 100.
 *
 * ## Satsen er én funksjon
 *
 * `beregnSats()` er det ene stedet regelen «vedtatt felleskost × brøk / 12, rundet til hele
 * kroner» står. Skjermen, beregningsjobben og testene bruker samme funksjon — samme grep som
 * `erForsinket` i oppgaveregler.ts, og av samme grunn: v1 hadde sju kopier av en regel.
 */

// ---------------------------------------------------------------------------------------
// Beløp
// ---------------------------------------------------------------------------------------

/**
 * Øre → «3 500 kr», eller «5 725,50 kr» når det finnes øre. Hele kroner uten desimaler er
 * det styret er vant til å lese i et budsjett; ørene vises bare der de faktisk er.
 */
export function kroner(ore: number | null | undefined, opts: { alltidOre?: boolean } = {}): string {
  if (ore === null || ore === undefined) return "—";
  const negativ = ore < 0;
  const abs = Math.abs(ore);
  const hele = Math.floor(abs / 100);
  const rest = abs % 100;
  const heleTekst = hele.toLocaleString("nb-NO");
  const tekst =
    rest === 0 && !opts.alltidOre
      ? `${heleTekst} kr`
      : `${heleTekst},${String(rest).padStart(2, "0")} kr`;
  return negativ ? `−${tekst}` : tekst;
}

/** Øre → tall med to desimaler som tekst, til redigeringsfelt og CSV («5725,50»). */
export function tilKronerTekst(ore: number | null | undefined): string {
  if (ore === null || ore === undefined) return "";
  const negativ = ore < 0;
  const abs = Math.abs(ore);
  const hele = Math.floor(abs / 100);
  const rest = abs % 100;
  const tekst = rest === 0 ? String(hele) : `${hele},${String(rest).padStart(2, "0")}`;
  return negativ ? `-${tekst}` : tekst;
}

/**
 * Det brukeren skriver → øre. Tåler «3 500», «3500,50», «3.500,50», «3500.5» og «kr».
 * Returnerer `null` når teksten ikke er et beløp — kallstedet velger feilmeldingen.
 */
export function tilOre(tekst: string | number | null | undefined): number | null {
  if (tekst === null || tekst === undefined) return null;
  if (typeof tekst === "number") return Number.isFinite(tekst) ? Math.round(tekst * 100) : null;
  let s = tekst.replace(/\s|kr|nok/gi, "").trim();
  if (!s) return null;
  // Tusenskilletegn: «3.500,50» (norsk) — punktum foran komma er skille, ikke desimal.
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "");
  s = s.replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

// ---------------------------------------------------------------------------------------
// Brøk og sats
// ---------------------------------------------------------------------------------------

export type Brok = { teller: number | null; nevner: number | null };

export function harBrok(b: Brok | null | undefined): b is { teller: number; nevner: number } {
  return !!b && b.teller !== null && b.nevner !== null && b.nevner > 0 && b.teller >= 0;
}

export const brokTekst = (b: Brok | null | undefined) => (harBrok(b) ? `${b.teller}/${b.nevner}` : "—");

/**
 * Summen av brøkene, som andel av 1. Skal være 1 (innenfor avrunding) når alle seksjoner er
 * registrert med riktig brøk — avviket er den beste kontrollen styret har på at registeret
 * stemmer med det tinglyste. Enheter uten brøk telles ikke (og rapporteres separat).
 */
export function brokSum(enheter: ReadonlyArray<Brok>): number {
  let sum = 0;
  for (const e of enheter) if (harBrok(e)) sum += e.teller / e.nevner;
  return sum;
}

/** Toleransen for «brøkene summerer til 1» — tre promille tåler avrunding i tinglyste brøker. */
export const BROK_TOLERANSE = 0.003;

export const brokStemmer = (sum: number) => Math.abs(sum - 1) <= BROK_TOLERANSE;

/**
 * Månedlig sats for én seksjon, i øre, rundet til hele kroner.
 *
 * `aarligFelleskost` er den vedtatte felleskostnad-linja i budsjettet (øre per år).
 * Rundingen til hele kroner er bevisst: fakturaer på «2 916,67 kr» skaper flere spørsmål enn
 * de avvik på noen kroner per år som rundingen gir.
 */
export function beregnSats(aarligFelleskost: number, teller: number, nevner: number): number {
  if (nevner <= 0) throw new Error("Brøkens nevner må være større enn 0");
  const maanedOre = (aarligFelleskost * teller) / nevner / 12;
  return Math.round(maanedOre / 100) * 100;
}

// ---------------------------------------------------------------------------------------
// Budsjett
// ---------------------------------------------------------------------------------------

export const BUDSJETT_STATUSER = ["utkast", "vedtatt"] as const;
export type BudsjettStatus = (typeof BUDSJETT_STATUSER)[number];

export const LINJETYPER = ["felleskost", "inntekt", "kostnad"] as const;
export type Linjetype = (typeof LINJETYPER)[number];

export const LINJETYPE_ETIKETT: Record<Linjetype, string> = {
  felleskost: "Felleskostnader",
  inntekt: "Andre inntekter",
  kostnad: "Kostnader",
};

/** Inntektskontoen for felleskostnader. Låst — aldri mva, aldri valgbar. */
export const FELLESKOST_KONTO = 3601;

/**
 * Forslaget et nytt budsjett starter med. Kontointervallene følger NS 4102 slik Fiken,
 * Tripletex og forretningsførerne bruker dem. Beløpene er 0 — styret fyller inn.
 * Linjer kan slettes og legges til fritt; lista er en start, ikke en fasit.
 */
export const STANDARD_LINJER: ReadonlyArray<{
  kind: Linjetype;
  name: string;
  accountFrom: number | null;
  accountTo: number | null;
}> = [
  { kind: "felleskost", name: "Felleskostnader", accountFrom: FELLESKOST_KONTO, accountTo: null },
  { kind: "inntekt", name: "Andre inntekter (utleie, renter)", accountFrom: 3600, accountTo: 3699 },
  { kind: "kostnad", name: "Styrehonorar", accountFrom: 5330, accountTo: 5339 },
  { kind: "kostnad", name: "Kommunale avgifter og renovasjon", accountFrom: 6320, accountTo: 6329 },
  { kind: "kostnad", name: "Strøm og oppvarming fellesareal", accountFrom: 6340, accountTo: 6349 },
  { kind: "kostnad", name: "Vedlikehold bygning og anlegg", accountFrom: 6600, accountTo: 6629 },
  { kind: "kostnad", name: "Regnskap og revisjon", accountFrom: 6700, accountTo: 6729 },
  { kind: "kostnad", name: "Vaktmester, renhold og drift", accountFrom: 6790, accountTo: 6799 },
  { kind: "kostnad", name: "Administrasjon og styreportal", accountFrom: 6800, accountTo: 6899 },
  { kind: "kostnad", name: "Forsikring", accountFrom: 7500, accountTo: 7509 },
  { kind: "kostnad", name: "Annen driftskostnad", accountFrom: 7700, accountTo: 7799 },
  { kind: "kostnad", name: "Renter og gebyrer felleslån", accountFrom: 8100, accountTo: 8199 },
];

export type Budsjettsummer = {
  felleskost: number;
  inntekter: number;
  kostnader: number;
  /** felleskost + inntekter − kostnader. */
  resultat: number;
};

export function budsjettSummer(
  linjer: ReadonlyArray<{ kind: string; amount: number }>,
): Budsjettsummer {
  let felleskost = 0;
  let inntekter = 0;
  let kostnader = 0;
  for (const l of linjer) {
    if (l.kind === "felleskost") felleskost += l.amount;
    else if (l.kind === "inntekt") inntekter += l.amount;
    else kostnader += l.amount;
  }
  return { felleskost, inntekter, kostnader, resultat: felleskost + inntekter - kostnader };
}

/**
 * Hvor stor del av året som er gått for et budsjettår, i hele måneder: 12/12 for et år som
 * er over, 0 for et som ikke har begynt, og antall påbegynte måneder minus én for inneværende
 * (i september er åtte måneder ferdige). «Forventet hittil» = budsjett × dette.
 */
export function andelAvAaret(aar: number, naa: Date): number {
  const iAar = naa.getFullYear();
  if (aar < iAar) return 1;
  if (aar > iAar) return 0;
  return naa.getMonth() / 12;
}

/** Budsjettbeløpet man skulle forvente å ha brukt så langt i året, i øre. */
export const forventetHittil = (amount: number, aar: number, naa: Date) =>
  Math.round(amount * andelAvAaret(aar, naa));

/** Kontointervallet som tekst: «6600–6629», «3601» eller «—». */
export function kontoTekst(fra: number | null, til: number | null): string {
  if (fra === null) return "—";
  if (til === null || til === fra) return String(fra);
  return `${fra}–${til}`;
}

// ---------------------------------------------------------------------------------------
// Perioder og kjøringer
// ---------------------------------------------------------------------------------------

export const KJORING_STATUSER = ["grunnlag", "sendt", "annullert"] as const;
export type KjoringStatus = (typeof KJORING_STATUSER)[number];

export const KJORING_STATUS_ETIKETT: Record<KjoringStatus, { etikett: string; merke: string }> = {
  grunnlag: { etikett: "Grunnlag", merke: "info" },
  sendt: { etikett: "Sendt", merke: "ok" },
  annullert: { etikett: "Annullert", merke: "muted" },
};

export const FORFALLSDAG_STANDARD = 15;

/** «ÅÅÅÅ-MM-DD» for en lokal dato — uten `toISOString`, som ville hoppet til UTC. */
export function isoDato(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dag = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dag}`;
}

/** De to halvårsperiodene i et år — det som kan kjøres. */
export function halvaarsperioder(aar: number): Array<{ start: string; slutt: string; etikett: string }> {
  return [
    { start: `${aar}-01-01`, slutt: `${aar}-06-30`, etikett: `1. halvår ${aar}` },
    { start: `${aar}-07-01`, slutt: `${aar}-12-31`, etikett: `2. halvår ${aar}` },
  ];
}

/** Perioden en startdato tilhører, eller `null` når datoen ikke er 1.1 eller 1.7. */
export function periodeFor(start: string): { start: string; slutt: string; etikett: string } | null {
  const aar = Number(start.slice(0, 4));
  if (!Number.isInteger(aar)) return null;
  return halvaarsperioder(aar).find((p) => p.start === start) ?? null;
}

/** Første dag i hver måned fra og med `start` til og med måneden `slutt` ligger i. */
export function manederI(start: string, slutt: string): string[] {
  const ut: string[] = [];
  let aar = Number(start.slice(0, 4));
  let mnd = Number(start.slice(5, 7));
  const sluttAar = Number(slutt.slice(0, 4));
  const sluttMnd = Number(slutt.slice(5, 7));
  while (aar < sluttAar || (aar === sluttAar && mnd <= sluttMnd)) {
    ut.push(`${aar}-${String(mnd).padStart(2, "0")}-01`);
    mnd++;
    if (mnd > 12) {
      mnd = 1;
      aar++;
    }
  }
  return ut;
}

/** Forfall i måneden linja gjelder, på den avtalte dagen (1–28 så februar alltid går). */
export function forfallsdato(maaned: string, dag: number): string {
  const d = Math.min(28, Math.max(1, dag));
  return `${maaned.slice(0, 7)}-${String(d).padStart(2, "0")}`;
}

/** Idempotensnøkkelen mot regnskapssystemet — se `fee_run_lines.order_reference`. */
export const ordreReferanse = (unitId: string, maaned: string) => `${unitId}:${maaned.slice(0, 7)}`;

export const MANEDSNAVN = [
  "januar", "februar", "mars", "april", "mai", "juni",
  "juli", "august", "september", "oktober", "november", "desember",
] as const;

export function manedTekst(maaned: string): string {
  const m = Number(maaned.slice(5, 7));
  return `${MANEDSNAVN[m - 1] ?? maaned} ${maaned.slice(0, 4)}`;
}

// ---------------------------------------------------------------------------------------
// Leverandørfakturaer
// ---------------------------------------------------------------------------------------

export const FAKTURA_STATUSER = ["mottatt", "godkjent", "avvist", "betalt"] as const;
export type FakturaStatus = (typeof FAKTURA_STATUSER)[number];

export const FAKTURA_STATUS_ETIKETT: Record<FakturaStatus, { etikett: string; merke: string }> = {
  mottatt: { etikett: "Til godkjenning", merke: "warn" },
  godkjent: { etikett: "Godkjent", merke: "info" },
  avvist: { etikett: "Avvist", merke: "danger" },
  betalt: { etikett: "Betalt", merke: "ok" },
};

/**
 * Lovlige overganger. Alt som ikke står her avvises av `lib/okonomi.ts` — en betalt
 * faktura kan ikke avvises, og en avvist kan ikke betales uten å gjenåpnes først.
 */
export const FAKTURA_OVERGANGER: Record<FakturaStatus, readonly FakturaStatus[]> = {
  mottatt: ["godkjent", "avvist"],
  godkjent: ["betalt", "mottatt"],
  avvist: ["mottatt"],
  betalt: [],
};

export const erForfalt = (forfall: string | null | undefined, status: string, iDag: string) =>
  !!forfall && (status === "mottatt" || status === "godkjent") && forfall < iDag;

// ---------------------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------------------

/**
 * Semikolon-separert med BOM — det Excel på norsk faktisk åpner riktig uten importveiviser.
 * Verdier med semikolon, anførselstegn eller linjeskift settes i anførselstegn.
 */
export function tilCsv(rader: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const celle = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\uFEFF" + rader.map((r) => r.map(celle).join(";")).join("\r\n") + "\r\n";
}
