import { ApiFeil, orgRute } from "@/lib/api";
import { lastOppArbeidsdok } from "@/lib/vedlikehold";

export const POST = orgRute<{ workId: string }>({
  nivaa: "redigering", modul: "vedlikehold",
  handler: async ({ db, orgId, params, bruker, req }) => {
    const form = await req.formData();
    const fil = form.get("file");
    if (!(fil instanceof File)) throw new ApiFeil(400, "Ingen fil i forespørselen");
    return lastOppArbeidsdok(db, orgId, params.workId, bruker.name, fil, {
      docType: String(form.get("docType") ?? "annet"),
      title: form.get("title") ? String(form.get("title")) : undefined,
    });
  },
});
