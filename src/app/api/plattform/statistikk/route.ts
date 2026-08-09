import { plattformRute } from "@/lib/api";
import { hentStatistikk } from "@/lib/plattform";

export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db }) => hentStatistikk(db),
});
