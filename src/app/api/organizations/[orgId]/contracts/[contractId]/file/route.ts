import { readFile } from "node:fs/promises";
import { ApiFeil, orgRute } from "@/lib/api";
import { hentKontrakt, lastOppDokument, slettDokument } from "@/lib/kontrakter";
import { contentTypeForFilnavn, filSti } from "@/lib/lagring";

type P = { contractId: string };

/**
 * Nedlasting — eller visning med `?inline`, som er det dokumentviseren bruker. Fila serveres
 * gjennom API-et og ikke som en statisk lenke, fordi tilgangen må gjennom de samme gatene
 * som resten av modulen — en direkte URL ville vært lesbar for hvem som helst som fikk tak
 * i den. Innloggingen sitter i cookien, så en `<iframe>` mot ruta virker uten videre.
 */
export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "kontrakter",
  handler: async ({ db, orgId, params, req }) => {
    const kontrakt = await hentKontrakt(db, orgId, params.contractId);
    if (!kontrakt.fileName) throw new ApiFeil(404, "Ingen fil lastet opp");

    let innhold: Buffer;
    try {
      innhold = await readFile(filSti(orgId, "contracts", kontrakt.fileName));
    } catch {
      // Raden finnes, fila gjør ikke. Si det ærlig i stedet for å svare 500.
      throw new ApiFeil(404, "Fil ikke funnet på disk");
    }
    return {
      innhold,
      navn: kontrakt.fileOriginalName ?? kontrakt.fileName,
      // Typen utledes av det LAGREDE navnet — endelsen er satt av opplastingen, ikke brukeren.
      contentType: contentTypeForFilnavn(kontrakt.fileName),
      disposition: new URL(req.url).searchParams.has("inline") ? ("inline" as const) : ("attachment" as const),
    };
  },
});

export const POST = orgRute<P>({
  nivaa: "redigering",
  modul: "kontrakter",
  handler: async ({ db, orgId, params, req }) => {
    const form = await req.formData();
    const fil = form.get("file");
    if (!(fil instanceof File)) throw new ApiFeil(400, "Ingen fil i forespørselen");
    return lastOppDokument(db, orgId, params.contractId, fil);
  },
});

export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "kontrakter",
  handler: ({ db, orgId, params }) => slettDokument(db, orgId, params.contractId),
});
