import { aktorFor } from "@/lib/aktor";
import { orgRute } from "@/lib/api";
import { slettSats } from "@/lib/okonomi";

export const DELETE = orgRute<{ rateId: string }>({
  nivaa: "admin",
  modul: "okonomi",
  status: 204,
  handler: ({ db, orgId, bruker, params }) => slettSats(db, orgId, params.rateId, aktorFor(bruker)),
});
