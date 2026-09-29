import { tilSvar } from "@/lib/api";
import { innholdForSkjerm } from "@/lib/oppslagstavle";

/** Skjermen henter alt den skal vise. Hver henting er også livstegnet. */
export async function GET(req: Request) {
  try {
    return Response.json(await innholdForSkjerm(req), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return tilSvar(e);
  }
}
