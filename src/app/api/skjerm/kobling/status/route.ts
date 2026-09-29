import { z } from "zod";
import { lesKropp, tilSvar } from "@/lib/api";
import { sjekkKobling } from "@/lib/oppslagstavle";

/** POST og ikke GET: hemmeligheten skal ikke stå i en URL som havner i tilgangslogger. */
export async function POST(req: Request) {
  try {
    const { hemmelighet } = await lesKropp(req, z.object({ hemmelighet: z.string().min(20) }));
    return Response.json(await sjekkKobling(hemmelighet));
  } catch (e) {
    return tilSvar(e);
  }
}
