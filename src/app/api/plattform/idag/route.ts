import { plattformRute } from "@/lib/api";
import { hentKreverHandling, hentSidenSist } from "@/lib/plattform";

/** «I dag»: punktene som krever handling, og hva som har kommet til siden forrige innlogging. */
export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: async ({ db, bruker }) => {
    const naa = new Date();
    const [punkter, sidenSist] = await Promise.all([
      hentKreverHandling(db, naa),
      hentSidenSist(db, bruker.id, naa),
    ]);
    return { punkter, sidenSist };
  },
});
