import { plattformRute } from "@/lib/api";
import { hentSystemhelse } from "@/lib/systemhelse";

export const GET = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db }) => hentSystemhelse(db),
});
