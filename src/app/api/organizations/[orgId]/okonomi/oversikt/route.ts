import { orgRute } from "@/lib/api";
import { hentOkonomioversikt } from "@/lib/okonomi";

/** Oversiktsfanen — alt i ett kall. Lesing for alle med tilgang til modulen. */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId }) => hentOkonomioversikt(db, orgId),
});
