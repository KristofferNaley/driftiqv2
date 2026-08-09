import { lesKropp, plattformRute } from "@/lib/api";
import { hentSak, settStatus, statusInn, svarInn, svarPaSak } from "@/lib/feilmelding";
import { sendFeilmeldingSvar } from "@/lib/epost";

type P = { sakId: string };

export const GET = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: ({ db, params }) => hentSak(db, params.sakId),
});

export const PUT = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: async ({ db, bruker, params, req }) =>
    settStatus(db, params.sakId, (await lesKropp(req, statusInn)).status, bruker.name),
});

/**
 * Svar eller internt notat.
 *
 * Bare ikke-interne svar sendes til kunden. Notatet «samme sak som FM-0031» skal kunne
 * skrives uten at melderen får det på e-post.
 */
export const POST = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: async ({ db, bruker, params, req }) => {
    const data = await lesKropp(req, svarInn);
    const melding = await svarPaSak(db, params.sakId, bruker.name, data);
    if (!data.internal) {
      const sak = await hentSak(db, params.sakId);
      await sendFeilmeldingSvar(sak, data.body).catch((e) =>
        console.error("[feilmelding] Svarvarsel feilet:", e),
      );
    }
    return melding;
  },
});
