import { plattformRute } from "@/lib/api";
import { hentBblValg } from "@/lib/kundedetalj";

export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db }) => hentBblValg(db),
});
