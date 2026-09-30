import { orgRute } from "@/lib/api";
import { byggSkjerminnhold } from "@/lib/oppslagstavle";

/**
 * Forhåndsvisningen i appen — samme funksjon som skjermen selv henter fra, men med data for
 * alle blokkene, så et felt styret nettopp har valgt (og ikke lagret) har noe å vise.
 */
export const GET = orgRute<{ skjermId: string }>({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId, params }) => byggSkjerminnhold(db, orgId, params.skjermId, { alt: true }),
});
