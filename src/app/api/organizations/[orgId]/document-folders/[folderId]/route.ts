import { lesKropp, orgRute } from "@/lib/api";
import { endreMappe, mappeEndring, slettMappe } from "@/lib/dokumenter";

type P = { folderId: string };

export const PUT = orgRute<P>({
  nivaa: "redigering",
  modul: "dokumentarkiv",
  handler: async ({ db, orgId, params, req }) =>
    endreMappe(db, orgId, params.folderId, await lesKropp(req, mappeEndring)),
});

/** Svarer med hvor mange dokumenter som ble flyttet til «Annet» — de går aldri tapt. */
export const DELETE = orgRute<P>({
  nivaa: "redigering",
  modul: "dokumentarkiv",
  handler: ({ db, orgId, params }) => slettMappe(db, orgId, params.folderId),
});
