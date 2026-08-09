import { ApiFeil, orgRute } from "@/lib/api";
import { lastOppFdv } from "@/lib/vedlikehold";

export const POST = orgRute<{ elementId: string }>({
  nivaa: "redigering", modul: "vedlikehold",
  handler: async ({ db, orgId, params, bruker, req }) => {
    const form = await req.formData();
    const fil = form.get("file");
    if (!(fil instanceof File)) throw new ApiFeil(400, "Ingen fil i forespørselen");
    return lastOppFdv(db, orgId, params.elementId, bruker.name, fil, {
      fdvType: String(form.get("fdvType") ?? "annet"),
      title: form.get("title") ? String(form.get("title")) : undefined,
    });
  },
});
