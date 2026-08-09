import { orgRute } from "@/lib/api";
import { slettNotat } from "@/lib/leverandorer";

export const DELETE = orgRute<{ vendorId: string; noteId: string }>({
  nivaa: "redigering",
  modul: "leverandorer",
  status: 204,
  handler: ({ db, orgId, params }) => slettNotat(db, orgId, params.vendorId, params.noteId),
});
