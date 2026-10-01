import { plattformRute } from "@/lib/api";
import { antallVenterPaSvar } from "@/lib/feilmelding";
import { hentKreverHandling } from "@/lib/plattform";

/** Tellerne i panelmenyen, i ett kall. */
export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: async ({ db }) => {
    const [punkter, innmeldinger] = await Promise.all([
      hentKreverHandling(db, new Date()),
      antallVenterPaSvar(db),
    ]);
    return { iDag: punkter.length, innmeldinger };
  },
});
