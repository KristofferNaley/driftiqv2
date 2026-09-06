import { aktorFor } from "@/lib/aktor";
import { orgRute } from "@/lib/api";
import { sendLadekjoring } from "@/lib/ladekjoring";

/**
 * Sender kjøringen til regnskapssystemet orgen er koblet til — hvilket som helst
 * (`regnskapskobling.ts`). Kontoadmin: dette oppretter fakturaer hos kunden.
 */
export const POST = orgRute<{ runId: string }>({
  nivaa: "admin",
  modul: "okonomi",
  handler: ({ db, orgId, bruker, params }) => sendLadekjoring(db, orgId, params.runId, aktorFor(bruker)),
});
