import { lesKropp, tilSvar } from "@/lib/api";
import { hentQrKontekst, qrUtkvittering, registrerViaQr } from "@/lib/qr";

/**
 * Det anonyme QR-endepunktet. **Ingen innlogging.**
 *
 * Bruker verken `orgRute` eller `plattformRute`: begge krever en sesjon, og hele poenget her
 * er at leverandøren som står foran heisen ikke har en konto. Tokenet i URL-en ER
 * tilgangskontrollen — se `lib/qr.ts` for hvorfor det er forsvarlig.
 *
 * Feilhåndteringen går fortsatt gjennom `tilSvar`, så en ugyldig kode svarer 404 med samme
 * form som resten av API-et.
 */
type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    return Response.json(await hentQrKontekst(token));
  } catch (e) {
    return tilSvar(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { token } = await ctx.params;
    return Response.json(await registrerViaQr(token, await lesKropp(req, qrUtkvittering)));
  } catch (e) {
    return tilSvar(e);
  }
}
