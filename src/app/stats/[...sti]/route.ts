import { type NextRequest } from "next/server";

/**
 * Umami-proxy — webanalyse servert FØRSTEPARTS under `/stats/`.
 *
 * ## Hvorfor en proxy og ikke skriptet direkte fra stats.driftiq.no
 *
 * Samme grunn som i v1: et `<script src="https://stats.…">` er tredjeparts, og blokkeres av
 * uBlock, Brave og Safaris «Forhindre sporing på tvers» på et flertall av besøkene. Da måler
 * du ikke trafikken din, du måler de besøkende som ikke bryr seg om å blokkere. Førsteparts
 * under eget domene er ikke et forsøk på å omgå blokkering av SPORING — Umami er cookieløs,
 * lagrer ingen IP og følger ingen på tvers av nettsteder (se personvernsiden) — det er at et
 * verktøy som ikke gjør noe galt heller ikke skal straffes for å ligne på ett som gjør det.
 *
 * ## Hvorfor en rutehandler og ikke `rewrites()` i next.config
 *
 * `rewrites()` løses ved BYGG og skrives inn i routes-manifest.json. En `destination` bygget
 * av `process.env` ville dermed frosset verdien fra byggetidspunktet — der miljøvariablene
 * fra compose ikke finnes i det hele tatt. Resultatet er en proxy som peker på tom streng,
 * uten at noe sier fra. Her leses adressen per forespørsel.
 *
 * ## v1 gjorde dette i nginx
 *
 * v2 har ingen nginx — Next serverer direkte bak Cloudflare-tunnelen. Derfor må videresendingen
 * skje i appen. `/stats/` må også stå i `alltidTillatt` i middleware.ts: den skal virke på
 * markedsverten OG appverten, og markedsverten slipper ellers bare gjennom `/` og `/personvern`.
 */

/** Umami-stacken (`~/umami/` på VPS-en), nådd på det delte `edge`-nettet. */
const UMAMI_URL = process.env.UMAMI_URL ?? "http://umami:3000";

/**
 * Videresender forespørselen og svaret mest mulig urørt.
 *
 * Klientopplysningene MÅ bli med: Umami utleder land av IP-en og bygger sesjons-hashen av
 * IP + user-agent + språk. Uten dem ser hver eneste besøkende ut som den samme personen fra
 * ingensteds — tallene finnes, men de betyr ikke noe.
 */
async function videresend(req: NextRequest, sti: string[]): Promise<Response> {
  const maal = `${UMAMI_URL}/${sti.join("/")}${req.nextUrl.search}`;

  const hoder = new Headers();
  for (const navn of ["content-type", "user-agent", "accept", "accept-language", "referer"]) {
    const verdi = req.headers.get(navn);
    if (verdi) hoder.set(navn, verdi);
  }
  // Bak Cloudflare er `x-forwarded-for` allerede satt av tunnelen; kjeden skal utvides, ikke
  // erstattes. Umami leser den fra venstre for å finne den opprinnelige klienten.
  const videre = req.headers.get("x-forwarded-for");
  if (videre) hoder.set("x-forwarded-for", videre);
  const ekte = req.headers.get("cf-connecting-ip");
  if (ekte) hoder.set("x-real-ip", ekte);

  try {
    const svar = await fetch(maal, {
      method: req.method,
      headers: hoder,
      // GET har ingen kropp; `duplex` kreves av undici når den har det.
      body: req.method === "GET" ? undefined : await req.text(),
      cache: "no-store",
    });

    const utHoder = new Headers();
    for (const navn of ["content-type", "cache-control", "etag", "last-modified"]) {
      const verdi = svar.headers.get(navn);
      if (verdi) utHoder.set(navn, verdi);
    }
    return new Response(svar.body, { status: svar.status, headers: utHoder });
  } catch {
    /**
     * Umami er nede, eller finnes ikke i dette miljøet (den kjører kun i prod).
     *
     * 204 og ikke 502: sporingsskriptet prøver på nytt og logger i konsollen ved feilstatus,
     * og en besøkende på landingssiden skal ikke se røde feil i konsollen fordi et
     * analyseverktøy er nede. Manglende statistikk skal aldri koste noe brukeren ser.
     */
    return new Response(null, { status: 204 });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ sti: string[] }> }) {
  return videresend(req, (await ctx.params).sti);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ sti: string[] }> }) {
  return videresend(req, (await ctx.params).sti);
}
