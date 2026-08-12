import { lesKropp, orgRute } from "@/lib/api";
import { feilmeldingInn, hentEgneSaker, meldFeil } from "@/lib/feilmelding";
import { plattformVarslingsadresser } from "@/lib/prismodell";
import { sendNyFeilmelding } from "@/lib/epost";

/** Kunden ser bare SINE saker. Gaten er her — tabellen har ingen RLS-policy. */
export const GET = orgRute({
  nivaa: "lesing",
  handler: ({ db, orgId }) => hentEgneSaker(db, orgId),
});

/**
 * `lesing`: alle med tilgang skal kunne melde fra at noe ikke virker. Å kreve
 * redigeringsrett for å si «denne knappen gjør ingenting» ville filtrert bort nettopp de
 * som oftest ser feilene.
 */
export const POST = orgRute({
  nivaa: "lesing",
  handler: async ({ db, orgId, bruker, req, etterCommit }) => {
    const data = await lesKropp(req, feilmeldingInn);
    const sak = await meldFeil(
      db,
      orgId,
      { id: bruker.id, name: bruker.name, email: bruker.email },
      data,
      req.headers.get("user-agent"),
    );
    // Mottakerne slås opp FØR etterCommit: callbacken kjører etter at db-håndtaket er
    // levert tilbake. `pricing_config` står i UNNTATT, så oppslaget går også i org-kontekst.
    const mottakere = await plattformVarslingsadresser(db);
    etterCommit(() => sendNyFeilmelding(sak, mottakere));
    return sak;
  },
});
