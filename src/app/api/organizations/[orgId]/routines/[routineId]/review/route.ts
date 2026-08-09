import { orgRute } from "@/lib/api";
import { markerGjennomgatt } from "@/lib/rutiner";

/** Nullstiller «trenger gjennomgang». Statusen regnes ut, så dette er eneste vei dit. */
export const POST = orgRute<{ routineId: string }>({
  nivaa: "redigering", modul: "rutiner",
  handler: ({ db, orgId, params }) => markerGjennomgatt(db, orgId, params.routineId),
});
