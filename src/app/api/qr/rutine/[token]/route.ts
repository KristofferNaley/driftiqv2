import { tilSvar } from "@/lib/api";
import { hentOffentligRutine } from "@/lib/qr";

/**
 * Offentlig rutinevisning. Anonym lesevisning — rutiner henges opp der de gjelder, slik at
 * den som står ved brannsentralen kan lese hva de skal gjøre.
 *
 * Ligger under `/qr/rutine/` og ikke `/qr/{token}` fordi rutinetokener og oppgavetokener er
 * to ulike nøkkelrom. Uten skillet måtte oppslaget prøve begge tabellene, og en kollisjon
 * ville gitt feil side.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    return Response.json(await hentOffentligRutine(token));
  } catch (e) {
    return tilSvar(e);
  }
}
