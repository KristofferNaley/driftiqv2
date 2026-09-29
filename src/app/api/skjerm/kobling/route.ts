import { tilSvar } from "@/lib/api";
import { startKobling } from "@/lib/oppslagstavle";

/**
 * En ny skjerm ber om koblingskode. Anonymt — skjermen har ingenting annet å vise fram.
 * Raden bærer ingen kundedata, og koden utløper etter et kvarter (se lib/oppslagstavle.ts).
 */
export async function POST() {
  try {
    return Response.json(await startKobling());
  } catch (e) {
    return tilSvar(e);
  }
}
