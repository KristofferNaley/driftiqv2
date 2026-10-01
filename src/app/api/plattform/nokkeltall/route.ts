import { plattformRute } from "@/lib/api";
import { hentNokkeltall } from "@/lib/plattform";

/** Plattformtallene øverst på Statistikk (før: Dashboard). */
export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db }) => hentNokkeltall(db),
});
