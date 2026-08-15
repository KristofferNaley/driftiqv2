import { orgRute } from "@/lib/api";
import { publiserRutine } from "@/lib/rutiner";

type P = { routineId: string };

/**
 * Publiserer rutinen: dagens kladd fryses som versjon N i historikken (med navnet på den
 * som publiserte), status settes til publisert, og videre redigering kladdes mot N+1.
 */
export const POST = orgRute<P>({
  nivaa: "redigering",
  modul: "rutiner",
  handler: ({ db, orgId, params, bruker }) =>
    publiserRutine(db, orgId, params.routineId, bruker.name),
});
