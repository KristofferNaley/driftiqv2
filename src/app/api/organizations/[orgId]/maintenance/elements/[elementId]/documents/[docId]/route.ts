import { orgRute } from "@/lib/api";
import { slettFdv } from "@/lib/vedlikehold";

export const DELETE = orgRute<{ elementId: string; docId: string }>({
  nivaa: "redigering", modul: "vedlikehold", status: 204,
  handler: ({ db, orgId, params }) => slettFdv(db, orgId, params.elementId, params.docId),
});
