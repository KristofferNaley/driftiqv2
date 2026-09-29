import { somSvar, tilSvar } from "@/lib/api";
import { filForSkjerm } from "@/lib/oppslagstavle";

export async function GET(req: Request, ctx: { params: Promise<{ postId: string }> }) {
  try {
    const { postId } = await ctx.params;
    return somSvar(await filForSkjerm(req, postId), 200);
  } catch (e) {
    return tilSvar(e);
  }
}
