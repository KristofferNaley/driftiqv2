import { plattformRute } from "@/lib/api";
import { hentDashbord } from "@/lib/plattform";

export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db }) => hentDashbord(db),
});
