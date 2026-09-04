import { lesKropp, orgRute } from "@/lib/api";
import { brokInn, hentSeksjon, settBrok } from "@/lib/okonomi";

type P = { unitId: string };

/** Alt om én seksjon — eiere, satser, fakturagrunnlag og tidslinje. Seksjonsmodalen. */
export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId, params }) => hentSeksjon(db, orgId, params.unitId),
});

/** Sameiebrøk og BRA. Ligger på enheten, men settes herfra — de er økonomimodulens grunnlag. */
export const PUT = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, params, req }) =>
    settBrok(db, orgId, params.unitId, await lesKropp(req, brokInn)),
});
