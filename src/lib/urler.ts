/**
 * Hvilken adresse en lenke skal peke på. **Ingen importer** — leses av både server og bygg.
 *
 * ## Hvorfor dette ikke kan være én variabel
 *
 * `BASE_URL` gjorde begge jobbene fram til vertene ble delt, og da kolliderer de: QR-koden
 * på et oppgaveark må peke på KUNDE-APPEN, mens sitemap og OG-metadata må peke på
 * MARKEDSSIDEN. Setter man `BASE_URL=app.driftiq.no`, lister sitemap sider som er 404 der,
 * og Google blir pekt mot feil domene. Setter man den til markedssiden, slutter QR-kodene å
 * treffe utkvitteringsskjemaet.
 *
 * Verdiene utledes derfor av `VERT_APP` og `VERT_MARKED` når vertene er delt, med `BASE_URL`
 * som reserve for enkeltvert og lokal utvikling.
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3008";

const fraVert = (vert: string | undefined) => (vert ? `https://${vert}` : null);

/** Kunde-appen. QR-lenker, passordreset, alle lenker i e-post. */
export const APP_URL = fraVert(process.env.VERT_APP) ?? BASE;

/** Markedssiden. Sitemap, robots og metadata for søkemotorer. */
export const MARKED_URL = fraVert(process.env.VERT_MARKED) ?? BASE;
