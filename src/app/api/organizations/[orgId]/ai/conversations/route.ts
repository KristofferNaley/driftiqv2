import { orgRute } from "@/lib/api";
import { hentSamtaler } from "@/lib/ai";

/** Kun brukerens egne samtaler — se kommentaren på `aiConversations`. */
export const GET = orgRute({
  nivaa: "lesing", modul: "ai_radgiver",
  handler: ({ db, orgId, bruker }) => hentSamtaler(db, orgId, bruker.id),
});
