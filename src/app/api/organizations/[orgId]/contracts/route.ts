import { lesKropp, orgRute } from "@/lib/api";
import { hentKontrakter, kontraktInn, opprettKontrakt } from "@/lib/kontrakter";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "kontrakter",
  handler: ({ db, orgId, req }) => {
    const p = new URL(req.url).searchParams.get("arkiverte");
    return hentKontrakter(db, orgId, { arkiverte: p === null ? undefined : p === "true" });
  },
});

export const POST = orgRute({
  nivaa: "redigering",
  modul: "kontrakter",
  handler: async ({ db, orgId, req }) => opprettKontrakt(db, orgId, await lesKropp(req, kontraktInn)),
});
