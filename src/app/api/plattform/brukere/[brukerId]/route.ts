import { lesKropp, plattformRute } from "@/lib/api";
import { endrePlattformbruker, plattformbrukerEndring } from "@/lib/plattform";

export const PUT = plattformRute<{ brukerId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, bruker, params, req }) =>
    endrePlattformbruker(db, bruker.id, params.brukerId, await lesKropp(req, plattformbrukerEndring)),
});
