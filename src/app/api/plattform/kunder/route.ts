import { plattformRute } from "@/lib/api";
import { hentKunder } from "@/lib/plattform";

/** Kundeoversikten. Kundeforhold, ikke kundedata — se lib/plattform.ts. */
export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db }) => hentKunder(db),
});
