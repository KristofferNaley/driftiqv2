import { orgRute } from "@/lib/api";
import { hentOkter, lesMaaned } from "@/lib/easeekobling";

/** Ladeøktene for én lader i en måned — «hvem ladet når». */
export const GET = orgRute<{ chargerId: string }>({
  nivaa: "lesing",
  modul: "parkering",
  handler: ({ db, orgId, params, req }) => {
    const { aar, maaned } = lesMaaned(req);
    return hentOkter(db, orgId, params.chargerId, aar, maaned);
  },
});
