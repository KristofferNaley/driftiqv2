import { readFile } from "node:fs/promises";
import { ApiFeil, orgRute } from "@/lib/api";
import { contentTypeForFilnavn, filSti } from "@/lib/lagring";
import { FAKTURA_FILMAPPE, hentFaktura, lastOppFakturafil, slettFakturafil } from "@/lib/okonomi";

type P = { invoiceId: string };

/** Vedlegget — vises inline i dokumentviseren med `?inline`, ellers nedlasting. */
export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "okonomi",
  handler: async ({ db, orgId, params, req }) => {
    const f = await hentFaktura(db, orgId, params.invoiceId);
    if (!f.fileName) throw new ApiFeil(404, "Ingen fil lastet opp");
    let innhold: Buffer;
    try {
      innhold = await readFile(filSti(orgId, FAKTURA_FILMAPPE, f.fileName));
    } catch {
      throw new ApiFeil(404, "Fil ikke funnet på disk");
    }
    return {
      innhold,
      navn: f.fileOriginalName ?? f.fileName,
      contentType: contentTypeForFilnavn(f.fileName),
      disposition: new URL(req.url).searchParams.has("inline") ? ("inline" as const) : ("attachment" as const),
    };
  },
});

export const POST = orgRute<P>({
  nivaa: "redigering",
  modul: "okonomi",
  handler: async ({ db, orgId, params, req }) => {
    const form = await req.formData();
    const fil = form.get("file");
    if (!(fil instanceof File)) throw new ApiFeil(400, "Ingen fil i forespørselen");
    return lastOppFakturafil(db, orgId, params.invoiceId, fil);
  },
});

export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "okonomi",
  handler: ({ db, orgId, params }) => slettFakturafil(db, orgId, params.invoiceId),
});
