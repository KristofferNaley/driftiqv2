import { orgRute, ugyldig } from "@/lib/api";
import { hentKontakter, kontaktInn, opprettKontakt } from "@/lib/oppslagstavle";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId }) => hentKontakter(db, orgId),
});

/**
 * Multipart: feltene i `data` (JSON), bildet valgfritt i `fil`. Orgadmin — det er
 * personopplysninger som publiseres på veggen i oppgangen.
 */
export const POST = orgRute({
  nivaa: "admin",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, req }) => {
    const skjema = await req.formData();
    const fil = skjema.get("fil");
    const data = kontaktInn.safeParse(JSON.parse(String(skjema.get("data") ?? "{}")));
    if (!data.success) throw ugyldig(data.error.issues[0]?.message ?? "Ugyldige data");
    return opprettKontakt(db, orgId, data.data, fil instanceof File && fil.size > 0 ? fil : null);
  },
});
