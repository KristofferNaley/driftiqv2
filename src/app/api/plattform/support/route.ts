import { lesKropp, plattformRute, ugyldig } from "@/lib/api";
import { avsluttSupport, startSupport, supportStart } from "@/lib/plattform";

/**
 * Start support-sesjon.
 *
 * Dette er handlingen som gir plattformadmin innsyn i én kundes data. Selve håndhevingen
 * ligger i `tilgang.ts` — her opprettes bare loggraden gaten leser.
 */
export const POST = plattformRute({
  nivaa: "plattformadmin",
  handler: async ({ db, bruker, req }) =>
    startSupport(db, { id: bruker.id, name: bruker.name }, await lesKropp(req, supportStart)),
});

/** Avslutt egen sesjon. `orgId` som query, siden DELETE ikke skal ha kropp. */
export const DELETE = plattformRute({
  nivaa: "plattformadmin",
  handler: ({ db, bruker, req }) => {
    const orgId = new URL(req.url).searchParams.get("orgId");
    if (!orgId) throw ugyldig("Mangler orgId");
    return avsluttSupport(db, bruker.id, orgId);
  },
});
