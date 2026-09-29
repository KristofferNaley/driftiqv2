import { orgRute } from "@/lib/api";
import { hentOppslagFil } from "@/lib/oppslagstavle";

export const GET = orgRute<{ postId: string }>({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId, params }) => hentOppslagFil(db, orgId, params.postId),
});
