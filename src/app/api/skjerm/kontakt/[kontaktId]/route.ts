import { somSvar, tilSvar } from "@/lib/api";
import { kontaktbildeForSkjerm } from "@/lib/oppslagstavle";

export async function GET(req: Request, ctx: { params: Promise<{ kontaktId: string }> }) {
  try {
    const { kontaktId } = await ctx.params;
    return somSvar(await kontaktbildeForSkjerm(req, kontaktId), 200);
  } catch (e) {
    return tilSvar(e);
  }
}
