/**
 * Leiligheter slik de VISES og SØKES i Avvik. Port av v1s `utils/leilighet.js`.
 *
 * Skilt fra navngivningen i enhetsregisteret med vilje. Registeret er et register over
 * *enheter*, og der er andelsnummeret den bærende identiteten — det er raden
 * forretningsføreren og årsberetningen kjenner igjen. I Avvik melder man derimot på en
 * bolig, og da er H-nummeret det folk faktisk leter etter. «Andel 3 · H0203» ba dessuten om
 * forveksling: to ulike tall ved siden av hverandre, og et søk på «305» kunne treffe
 * andelen 305 like gjerne som H0305.
 *
 * Ingen importer i denne fila — den brukes fra klientkomponenter. Se kommentaren i
 * `nivaer.ts` for hvorfor det er et krav.
 */

/** Det denne modulen trenger av en enhet. Bevisst løsere enn `Enhet` fra klienten. */
export type Enhetsnavn = {
  type?: string | null;
  navn?: string | null;
  andelsnr?: string | null;
  leilighetsnr?: string | null;
  oppgang?: string | null;
};

/** H-nummeret først, andelen bare når det ikke finnes noe annet å kjenne enheten på. */
export function enhetNavn(e: Enhetsnavn | null | undefined): string {
  if (!e) return "—";
  // Fellesarealer kjennes på navnet sitt, ikke på nummer.
  if (e.type === "fellesareal") return e.navn || "Fellesareal";
  const deler: string[] = [];
  if (e.leilighetsnr) deler.push(e.leilighetsnr);
  if (e.oppgang) deler.push(`oppg. ${e.oppgang}`);
  // Enheter uten H-nummer finnes: sameier bruker seksjonsnummer, og innlimte rader kan
  // mangle feltet. De må fortsatt kunne identifiseres, ellers står det bare «—» i lista.
  if (!deler.length && e.andelsnr) deler.push(`Andel ${e.andelsnr}`);
  return deler.join(" · ") || "Enhet uten nummer";
}

/**
 * Sammenligningsformen: bare bokstaver og tall, små bokstaver. Gjør at «305» treffer
 * «H0305», og at «h 03 05» treffer det samme — brukeren skal ikke måtte gjette formatet.
 */
const forenkle = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9æøå]/g, "");

/**
 * Delstrengsøk, ikke prefiks: man husker sjelden at H-nummeret starter med etasjen.
 * Andelsnummeret er fortsatt søkbart selv om det ikke vises — den som kjenner andelen skal
 * finne fram, uten at tallet trenger å stå i lista og forvirre alle andre.
 */
export function enhetTreffer(e: Enhetsnavn, sok: string): boolean {
  const q = forenkle(sok);
  if (!q) return true;
  return [e.leilighetsnr, e.oppgang, e.andelsnr, e.navn, enhetNavn(e)].some((v) =>
    forenkle(v).includes(q),
  );
}
