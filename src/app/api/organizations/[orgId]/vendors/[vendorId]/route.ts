import { lesKropp, orgRute } from "@/lib/api";
import {
  endreLeverandor,
  hentLeverandor,
  leverandorEndring,
  slettLeverandor,
} from "@/lib/leverandorer";

type P = { vendorId: string };

export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "leverandorer",
  handler: ({ db, orgId, params }) => hentLeverandor(db, orgId, params.vendorId),
});

export const PUT = orgRute<P>({
  nivaa: "redigering",
  modul: "leverandorer",
  handler: async ({ db, orgId, params, req }) =>
    endreLeverandor(db, orgId, params.vendorId, await lesKropp(req, leverandorEndring)),
});

/** Blokkeres av aktive oppgaver og kontrakter — se kommentaren i lib/leverandorer.ts. */
export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "leverandorer",
  status: 204,
  handler: ({ db, orgId, params }) => slettLeverandor(db, orgId, params.vendorId),
});
