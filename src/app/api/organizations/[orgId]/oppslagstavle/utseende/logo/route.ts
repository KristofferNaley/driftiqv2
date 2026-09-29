import { orgRute, ugyldig } from "@/lib/api";
import { hentLogo, lastOppLogo, slettLogo } from "@/lib/oppslagstavle";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "oppslagstavle",
  handler: ({ db, orgId }) => hentLogo(db, orgId),
});

export const POST = orgRute({
  nivaa: "admin",
  modul: "oppslagstavle",
  handler: async ({ db, orgId, req }) => {
    const fil = (await req.formData()).get("fil");
    if (!(fil instanceof File)) throw ugyldig("Mangler fil");
    return lastOppLogo(db, orgId, fil);
  },
});

export const DELETE = orgRute({
  nivaa: "admin",
  modul: "oppslagstavle",
  handler: ({ db, orgId }) => slettLogo(db, orgId),
});
