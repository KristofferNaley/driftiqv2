import { lesKropp, orgRute } from "@/lib/api";
import { arkiverInn, arkiverKontrakt, gjenopprettKontrakt } from "@/lib/kontrakter";

type P = { contractId: string };

/** Arkiverer — sletter aldri. Utløpte avtaler har verdi som historikk. */
export const POST = orgRute<P>({
  nivaa: "redigering",
  modul: "kontrakter",
  handler: async ({ db, orgId, params, req }) =>
    arkiverKontrakt(db, orgId, params.contractId, await lesKropp(req, arkiverInn)),
});

export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "kontrakter",
  handler: ({ db, orgId, params }) => gjenopprettKontrakt(db, orgId, params.contractId),
});
