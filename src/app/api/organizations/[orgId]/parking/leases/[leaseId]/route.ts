import { orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { avsluttAvtale } from "@/lib/parkering";

/** Sletting av avtalen ER avslutningen av leieforholdet — samme semantikk som v1. */
export const DELETE = orgRute<{ leaseId: string }>({
  nivaa: "redigering",
  modul: "parkering",
  status: 204,
  handler: ({ db, orgId, bruker, params }) => avsluttAvtale(db, orgId, params.leaseId, aktorFor(bruker)),
});
