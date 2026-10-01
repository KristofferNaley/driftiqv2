import { aktorFor } from "@/lib/aktor";
import { lesKropp, plattformRute } from "@/lib/api";
import { kundeSletting, slettKunde, slettKundefiler } from "@/lib/kundesletting";

/**
 * Slett kunden for godt. POST med kropp (ikke DELETE) fordi bekreftelsen — kundens navn —
 * skal i kroppen. Filene på disk fjernes først etter commit; se `lib/kundesletting.ts`.
 */
export const POST = plattformRute<{ orgId: string }>({
  nivaa: "plattformadmin",
  handler: async ({ db, bruker, params, req, etterCommit }) => {
    const svar = await slettKunde(db, params.orgId, await lesKropp(req, kundeSletting), aktorFor(bruker));
    etterCommit(() => slettKundefiler(params.orgId));
    return svar;
  },
});
