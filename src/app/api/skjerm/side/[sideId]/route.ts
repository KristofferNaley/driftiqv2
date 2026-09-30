import { somSvar, tilSvar } from "@/lib/api";
import { sideForSkjerm } from "@/lib/oppslagstavle";

export async function GET(req: Request, ctx: { params: Promise<{ sideId: string }> }) {
  try {
    const { sideId } = await ctx.params;
    return somSvar(await sideForSkjerm(req, sideId), 200);
  } catch (e) {
    return tilSvar(e);
  }
}
