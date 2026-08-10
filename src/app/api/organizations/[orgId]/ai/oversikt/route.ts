import { orgRute } from "@/lib/api";
import { hentAiOversikt } from "@/lib/ai";

/** Inngangskortene på rådgiversiden — ekte tall, regnet av serveren. Se `hentAiOversikt`. */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "ai_radgiver",
  handler: ({ db, orgId }) => hentAiOversikt(db, orgId),
});
