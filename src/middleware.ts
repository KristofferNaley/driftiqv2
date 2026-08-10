import { NextResponse, type NextRequest } from "next/server";

/**
 * Vertsbasert ruting: markedsside, kunde-app og plattformpanel på hvert sitt domene.
 *
 * ## Hvorfor ikke bare tre DNS-navn mot samme app
 *
 * Et rent DNS-alias gir en penere URL og ingenting mer — `app.driftiq.no/plattform` ville
 * fortsatt svart. Verdien ligger i at rutene som ikke hører hjemme på en vert **ikke finnes
 * der**: en kompromittert kundesesjon kan ikke nå panelet, fordi panelet er 404 på den
 * verten uansett hvem du er.
 *
 * Origin-separasjonen kommer på kjøpet. Better Auth setter vertsbundne cookies, så hver vert
 * får sin egen sesjon — samme egenskap som v1 fikk av at admin var en egen build på egen
 * port. Kostnaden er at du må logge inn to ganger, og det er riktig: å lese kundedata bør ha
 * en fartsdump.
 *
 * ## ENKELTVERT er standard
 *
 * Er ingen verter satt i miljøet, slipper alt gjennom. Det er ikke en glipp — det er
 * hvordan lokal utvikling og tilgang via IP-adresse fungerer. Vertsdeling skrus PÅ i
 * produksjon, ikke av lokalt, slik at en glemt miljøvariabel gir en app som virker og ikke
 * en som er utilgjengelig.
 *
 * Sikkerheten hviler uansett ikke her: hver plattformrute krever `plattformadmin` på
 * serveren, og layouten svarer 404. Dette laget er dybde, ikke førstelinje.
 */

const VERT_APP = process.env.VERT_APP?.toLowerCase();
const VERT_ADMIN = process.env.VERT_ADMIN?.toLowerCase();
const VERT_MARKED = process.env.VERT_MARKED?.toLowerCase();

/** Stier alle verter må ha: innlogging, API og Next sine egne filer. */
function alltidTillatt(sti: string): boolean {
  return (
    sti.startsWith("/api/") ||
    sti.startsWith("/_next/") ||
    sti === "/favicon.ico" ||
    sti === "/robots.txt" ||
    sti === "/sitemap.xml" ||
    erInnlogging(sti)
  );
}

/** Innloggingsflyten. Må finnes på app- og panelverten, men hører ikke hjemme på marked. */
function erInnlogging(sti: string): boolean {
  return sti === "/logg-inn" || sti === "/glemt-passord" || sti === "/nytt-passord";
}

const erPanel = (sti: string) => sti === "/plattform" || sti.startsWith("/plattform/");

/** Markedssidene. Alt annet under appen er kundeflater. */
const erMarked = (sti: string) => sti === "/" || sti === "/personvern";

export function middleware(req: NextRequest) {
  // Ingen verter konfigurert ⇒ enkeltvert. Se kommentaren øverst.
  if (!VERT_APP && !VERT_ADMIN && !VERT_MARKED) return NextResponse.next();

  const vert = req.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  const sti = req.nextUrl.pathname;

  if (alltidTillatt(sti)) {
    // Innlogging på markedsverten er en felle, ikke en tjeneste: skjemaet virker, men
    // Better Auth sin cookie er vertsbunden og settes på feil origin, og `/dashboard`
    // etterpå er 404 her. Brukeren har rett ærend på feil dør — send dem til riktig vert
    // i stedet for å la innloggingen lykkes ubrukelig.
    if (vert === VERT_MARKED && VERT_APP && VERT_APP !== VERT_MARKED && erInnlogging(sti)) {
      return NextResponse.redirect(`https://${VERT_APP}${sti}${req.nextUrl.search}`);
    }
    return NextResponse.next();
  }

  // Ukjent vert (IP-adresse, localhost, en ny CNAME) behandles som enkeltvert. Å svare 404
  // på alt her ville gjort appen utilgjengelig i det noen når den på en måte vi ikke listet.
  const kjent = [VERT_APP, VERT_ADMIN, VERT_MARKED].filter(Boolean).includes(vert);
  if (!kjent) return NextResponse.next();

  if (vert === VERT_ADMIN) {
    // Panelvertet serverer BARE panelet. Rot sender videre dit, så adressen uten sti virker.
    if (sti === "/") return tilSti(req, "/plattform");
    return erPanel(sti) ? NextResponse.next() : ikkeFunnet(req);
  }

  if (vert === VERT_MARKED) {
    return erMarked(sti) ? NextResponse.next() : ikkeFunnet(req);
  }

  if (vert === VERT_APP) {
    // Panelet finnes ikke på kundeverten — det er hele poenget med delingen.
    if (erPanel(sti)) return ikkeFunnet(req);
    // Rot på appverten er dashbordet, ikke markedssiden.
    if (sti === "/") return tilSti(req, "/dashboard");
    return NextResponse.next();
  }

  return NextResponse.next();
}

/**
 * Omdirigering som beholder VERTEN brukeren faktisk kom til.
 *
 * `new URL(sti, req.url)` er fella: bak en proxy er `req.url` den interne adressen, ikke
 * den utadvendte. Verifisert lokalt — en forespørsel med `Host: v2-app.driftiq.no` ga en
 * redirect til `http://192.168.1.158:3008/dashboard`. Bak Cloudflare ville brukeren blitt
 * kastet ut av domenet sitt og til en adresse som ikke er nåbar utenfra.
 */
function tilSti(req: NextRequest, sti: string) {
  const vert = req.headers.get("host") ?? req.nextUrl.host;
  // Cloudflare terminerer TLS og sender `x-forwarded-proto`. Uten den antar vi http, som er
  // riktig lokalt.
  const protokoll = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  // Query-strengen blir med: `/?utm=x` skal bli `/dashboard?utm=x`, ikke miste sporingen.
  return NextResponse.redirect(`${protokoll}://${vert}${sti}${req.nextUrl.search}`);
}

/**
 * `rewrite` til en sti som ikke finnes, framfor `new Response(404)`: da får brukeren Next
 * sin egen 404-side i stedet for blank tekst, og svaret er umulig å skille fra en rute som
 * aldri har eksistert.
 */
function ikkeFunnet(req: NextRequest) {
  return NextResponse.rewrite(new URL("/_ikke-funnet", req.url));
}

export const config = {
  // Alt unntatt statiske filer. Matcheren er bred med vilje: en ny rute skal være dekket
  // uten at noen må huske å føre den opp.
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
