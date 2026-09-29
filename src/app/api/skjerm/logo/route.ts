import { somSvar, tilSvar } from "@/lib/api";
import { logoForSkjerm } from "@/lib/oppslagstavle";

export async function GET(req: Request) {
  try {
    return somSvar(await logoForSkjerm(req), 200);
  } catch (e) {
    return tilSvar(e);
  }
}
