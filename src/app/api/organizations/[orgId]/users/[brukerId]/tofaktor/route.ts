import { orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { resettTofaktor } from "@/lib/brukere";

type P = { brukerId: string };

/**
 * Nullstiller tofaktor for en annen bruker — mistet telefon er grunnen til å stå her.
 * Kun DELETE, med vilje: en kontoadmin kan fjerne sperren så brukeren setter den opp på
 * nytt selv, men aldri sette den opp for dem. Se resettTofaktor i lib/brukere.ts.
 */
export const DELETE = orgRute<P>({
  nivaa: "admin",
  status: 204,
  handler: ({ db, orgId, bruker, params }) => resettTofaktor(db, orgId, params.brukerId, aktorFor(bruker)),
});
