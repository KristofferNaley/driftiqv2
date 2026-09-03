import { aktorFor } from "@/lib/aktor";
import { lesKropp, orgRute } from "@/lib/api";
import { budsjettInn, hentBudsjetter, opprettBudsjett } from "@/lib/okonomi";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId }) => hentBudsjetter(db, orgId),
});

export const POST = orgRute({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, bruker, req }) =>
    opprettBudsjett(db, orgId, aktorFor(bruker), await lesKropp(req, budsjettInn)),
});
