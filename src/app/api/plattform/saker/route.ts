import { plattformRute } from "@/lib/api";
import { hentAlleSaker } from "@/lib/feilmelding";

export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db }) => hentAlleSaker(db),
});
