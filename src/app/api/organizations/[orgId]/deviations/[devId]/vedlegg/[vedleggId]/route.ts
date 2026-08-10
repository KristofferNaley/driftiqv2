import { orgRute } from "@/lib/api";
import { slettVedlegg } from "@/lib/avvik";
import { aktorFor } from "@/lib/aktor";

export const DELETE = orgRute<{ devId: string; vedleggId: string }>({
  nivaa: "redigering",
  modul: "avvik",
  status: 204,
  handler: ({ db, orgId, bruker, params }) =>
    slettVedlegg(db, orgId, params.devId, params.vedleggId, aktorFor(bruker)),
});
