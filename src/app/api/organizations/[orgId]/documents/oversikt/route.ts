import { orgRute } from "@/lib/api";
import { hentArkivoversikt } from "@/lib/dokumenter";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "dokumentarkiv",
  handler: ({ db, orgId }) => hentArkivoversikt(db, orgId),
});
