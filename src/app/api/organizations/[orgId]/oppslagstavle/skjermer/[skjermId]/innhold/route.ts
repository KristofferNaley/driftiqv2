import { orgRute } from "@/lib/api";
import { byggSkjerminnhold } from "@/lib/oppslagstavle";

/** Forhåndsvisningen i appen — samme funksjon som skjermen selv henter fra. */
export const GET = orgRute<{ skjermId: string }>({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId, params }) => byggSkjerminnhold(db, orgId, params.skjermId),
});
