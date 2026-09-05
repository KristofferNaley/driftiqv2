import { orgRute } from "@/lib/api";
import { hentLaaser } from "@/lib/unlockobling";

/** Låsene i Unloc-prosjektet, live — til nedtrekket i «Del ut nøkkel». */
export const GET = orgRute({
  nivaa: "redigering",
  modul: "leverandorer",
  handler: ({ db, orgId }) => hentLaaser(db, orgId),
});
