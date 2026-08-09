import { orgRute } from "@/lib/api";
import { slettArbeidsdok } from "@/lib/vedlikehold";

export const DELETE = orgRute<{ workId: string; docId: string }>({
  nivaa: "redigering", modul: "vedlikehold", status: 204,
  handler: ({ db, orgId, params }) => slettArbeidsdok(db, orgId, params.workId, params.docId),
});
