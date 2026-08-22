import { lesKropp, orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { dokumentEndring, endreDokument, hentDokument, slettDokument } from "@/lib/dokumenter";

type P = { docId: string };

export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "dokumentarkiv",
  handler: ({ db, orgId, params }) => hentDokument(db, orgId, params.docId),
});

export const PUT = orgRute<P>({
  nivaa: "redigering",
  modul: "dokumentarkiv",
  handler: async ({ db, orgId, params, req }) =>
    endreDokument(db, orgId, params.docId, await lesKropp(req, dokumentEndring)),
});

export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "dokumentarkiv",
  status: 204,
  handler: ({ db, orgId, bruker, params }) => slettDokument(db, orgId, params.docId, aktorFor(bruker)),
});
