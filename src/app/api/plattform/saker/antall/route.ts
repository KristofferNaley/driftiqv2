import { plattformRute } from "@/lib/api";
import { antallApne } from "@/lib/feilmelding";

/** Antall åpne saker — telleren på menypunktet i panelet. */
export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: async ({ db }) => ({ antall: await antallApne(db) }),
});
