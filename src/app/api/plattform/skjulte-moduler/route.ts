import { plattformRute } from "@/lib/api";
import { hentSkjulteModuler } from "@/lib/prismodell";

/**
 * Modulnøkler som er midlertidig skjult fra kundens meny.
 *
 * `nivaa: "alle"` — dette er det ENESTE fra prismodellen en vanlig innlogget bruker får se.
 * Satser og trappetrinn er forretningsdata en kunde aldri skal ha, og de ligger bak
 * `plattformadmin` på /api/plattform/prismodell. Samme skille som v1s platform_settings.py.
 */
export const GET = plattformRute({
  nivaa: "alle",
  handler: ({ db }) => hentSkjulteModuler(db),
});
