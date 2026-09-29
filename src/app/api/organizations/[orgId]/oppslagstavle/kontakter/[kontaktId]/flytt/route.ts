import { z } from "zod";
import { lesKropp, orgRute } from "@/lib/api";
import { flyttKontakt } from "@/lib/oppslagstavle";

export const POST = orgRute<{ kontaktId: string }>({
  nivaa: "admin",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, params, req }) => {
    const { retning } = await lesKropp(req, z.object({ retning: z.enum(["opp", "ned"]) }));
    return flyttKontakt(db, orgId, params.kontaktId, retning);
  },
});
