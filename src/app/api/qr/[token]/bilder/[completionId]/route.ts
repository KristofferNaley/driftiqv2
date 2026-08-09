import { tilSvar, ugyldig } from "@/lib/api";
import { lastOppQrBilde } from "@/lib/qr";

/**
 * Bilde som dokumentasjon på utført arbeid. Anonymt, som resten av QR-flyten.
 *
 * Lastes opp ETTER registreringen — utførelsens id finnes ikke før da. Feiler dette, står
 * utførelsen igjen uten bilde, og det er riktig vei å feile: jobben ER utført.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string; completionId: string }> },
) {
  try {
    const { token, completionId } = await ctx.params;
    const skjema = await req.formData();
    const fil = skjema.get("fil");
    if (!(fil instanceof File)) throw ugyldig("Mangler fil");
    return Response.json(await lastOppQrBilde(token, completionId, fil));
  } catch (e) {
    return tilSvar(e);
  }
}
