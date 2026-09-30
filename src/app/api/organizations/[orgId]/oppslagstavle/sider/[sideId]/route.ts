import { orgRute } from "@/lib/api";
import { hentSidefil } from "@/lib/oppslagstavle";

/** Bildet i én side av et bildeoppslag, til lista, panelet og forhåndsvisningen i appen. */
export const GET = orgRute<{ sideId: string }>({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId, params }) => hentSidefil(db, orgId, params.sideId),
});
