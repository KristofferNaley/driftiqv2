import { orgRute, ugyldig } from "@/lib/api";
import { hentKontaktbilde, settKontaktbilde } from "@/lib/oppslagstavle";

export const GET = orgRute<{ kontaktId: string }>({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId, params }) => hentKontaktbilde(db, orgId, params.kontaktId),
});

export const POST = orgRute<{ kontaktId: string }>({
  nivaa: "admin",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, params, req }) => {
    const fil = (await req.formData()).get("fil");
    if (!(fil instanceof File)) throw ugyldig("Mangler fil");
    return settKontaktbilde(db, orgId, params.kontaktId, fil);
  },
});

export const DELETE = orgRute<{ kontaktId: string }>({
  nivaa: "admin",
  modul: "oppslagstavle",
  handler: ({ db, orgId, params }) => settKontaktbilde(db, orgId, params.kontaktId, null),
});
