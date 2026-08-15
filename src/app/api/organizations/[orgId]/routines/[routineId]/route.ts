import { lesKropp, orgRute } from "@/lib/api";
import { endreRutine, hentRutine, rutineEndring, slettRutine } from "@/lib/rutiner";

type P = { routineId: string };

export const GET = orgRute<P>({
  nivaa: "lesing", modul: "rutiner",
  handler: ({ db, orgId, params }) => hentRutine(db, orgId, params.routineId),
});

/** Fri kladding — versjonshistorikken skrives kun av publiseringsendepunktet. */
export const PUT = orgRute<P>({
  nivaa: "redigering", modul: "rutiner",
  handler: async ({ db, orgId, params, req }) =>
    endreRutine(db, orgId, params.routineId, await lesKropp(req, rutineEndring)),
});

export const DELETE = orgRute<P>({
  nivaa: "redigering", modul: "rutiner", status: 204,
  handler: ({ db, orgId, params }) => slettRutine(db, orgId, params.routineId),
});
