import { plattformRute } from "@/lib/api";
import { antallVenterPaSvar } from "@/lib/feilmelding";

/** Tellerne i panelmenyen, i ett kall. */
export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: async ({ db }) => ({ innmeldinger: await antallVenterPaSvar(db) }),
});
