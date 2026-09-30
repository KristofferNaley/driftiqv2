import { lesKropp, orgRute, ugyldig } from "@/lib/api";
import { leggTilSider, settSiderekkefolge, siderekkefolgeInn } from "@/lib/oppslagstavle";

/** Én fil per kall (bilde eller PDF), så skjemaet kan vise fremdrift og feil per fil. */
export const POST = orgRute<{ postId: string }>({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, params, req }) => {
    const fil = (await req.formData()).get("fil");
    if (!(fil instanceof File)) throw ugyldig("Velg en fil");
    return leggTilSider(db, orgId, params.postId, fil);
  },
});

/** Rekkefølgen på sidene. */
export const PUT = orgRute<{ postId: string }>({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, params, req }) =>
    settSiderekkefolge(db, orgId, params.postId, (await lesKropp(req, siderekkefolgeInn)).ider),
});
