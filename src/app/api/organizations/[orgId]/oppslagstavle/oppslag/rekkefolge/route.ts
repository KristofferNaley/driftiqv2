import { lesKropp, orgRute } from "@/lib/api";
import { rekkefolgeInn, settRekkefolge } from "@/lib/oppslagstavle";

/** Rekkefølgen i rotasjonen, for hele borettslaget. */
export const PUT = orgRute({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, req }) => settRekkefolge(db, orgId, (await lesKropp(req, rekkefolgeInn)).ider),
});
