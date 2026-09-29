import { lesKropp, orgRute, ugyldig } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { hentOppslag, oppslagInn, opprettOppslag } from "@/lib/oppslagstavle";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId }) => hentOppslag(db, orgId),
});

/**
 * Tekstoppslag kommer som JSON, bildeoppslag som multipart med feltene i `data` (JSON) og
 * bildet i `fil` — ett kall, så et oppslag aldri står halvferdig uten bildet sitt.
 */
export const POST = orgRute({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, bruker, req }) => {
    if (!req.headers.get("content-type")?.startsWith("multipart/form-data")) {
      return opprettOppslag(db, orgId, aktorFor(bruker), "tekst", await lesKropp(req, oppslagInn), null);
    }
    const skjema = await req.formData();
    const fil = skjema.get("fil");
    if (!(fil instanceof File)) throw ugyldig("Velg et bilde");
    const data = oppslagInn.safeParse(JSON.parse(String(skjema.get("data") ?? "{}")));
    if (!data.success) throw ugyldig(data.error.issues[0]?.message ?? "Ugyldige data");
    return opprettOppslag(db, orgId, aktorFor(bruker), "bilde", data.data, fil);
  },
});
