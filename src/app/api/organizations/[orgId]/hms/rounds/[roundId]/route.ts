import { hentRunde, slettRunde } from "@/lib/internkontroll";
import { orgRute } from "@/lib/api";

type P = { roundId: string };
export const GET = orgRute<P>({ nivaa: "lesing", modul: "internkontroll", handler: ({ db, orgId, params }) => hentRunde(db, orgId, params.roundId) });
export const DELETE = orgRute<P>({
  nivaa: "redigering", modul: "internkontroll", status: 204,
  handler: ({ db, orgId, params }) => slettRunde(db, orgId, params.roundId),
});
