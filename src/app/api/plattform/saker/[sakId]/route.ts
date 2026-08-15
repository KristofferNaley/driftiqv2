import { z } from "zod";
import { lesKropp, plattformRute } from "@/lib/api";
import { hentSak, settBacklog, settStatus, statusInn, svarInn, svarPaSak } from "@/lib/feilmelding";
import { sendFeilmeldingLost, sendFeilmeldingSvar } from "@/lib/epost";

type P = { sakId: string };

export const GET = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: ({ db, params }) => hentSak(db, params.sakId),
});

/**
 * Statusendring. Settes saken til løst, får melderen automatisk e-post — kvitteringen i
 * «Meld feil» lover svar når saken er løst, og løftet skal ikke avhenge av at noen husker
 * å skrive et svar i tillegg. Gjenlukking (løst → løst) sender ikke på nytt.
 */
export const PUT = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: async ({ db, bruker, params, req }) => {
    const { status } = await lesKropp(req, statusInn);
    const { sak, bleLost } = await settStatus(db, params.sakId, status, bruker.name);
    if (bleLost) {
      await sendFeilmeldingLost(sak).catch((e) =>
        console.error("[feilmelding] Løst-varsel feilet:", e),
      );
    }
    return sak;
  },
});

const backlogInn = z.object({ iBacklog: z.boolean() });

/** Backlog-bryteren — «dette skal vi gjøre noe med». */
export const PATCH = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: async ({ db, params, req }) =>
    settBacklog(db, params.sakId, (await lesKropp(req, backlogInn)).iBacklog),
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
