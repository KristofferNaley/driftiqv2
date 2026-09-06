import { orgRute } from "@/lib/api";
import { hentRapport, lesMaaned } from "@/lib/easeekobling";

/** Laderapporten for én måned: `?aar=2026&maaned=9`. */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "parkering",
  handler: ({ db, orgId, req }) => {
    const { aar, maaned } = lesMaaned(req);
    return hentRapport(db, orgId, aar, maaned);
  },
});
