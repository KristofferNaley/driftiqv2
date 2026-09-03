import { lesKropp, orgRute } from "@/lib/api";
import { brokInn, hentEierhistorikk, settBrok } from "@/lib/okonomi";

type P = { unitId: string };

/** Eierhistorikken for én seksjon. */
export const GET = orgRute<P>({
  nivaa: "lesing",
  modul: "okonomi",
  handler: ({ db, orgId, params }) => hentEierhistorikk(db, orgId, params.unitId),
});

/** Sameiebrøken. Ligger på enheten, men settes herfra — den er økonomimodulens grunnlag. */
export const PUT = orgRute<P>({
  nivaa: "admin",
  modul: "okonomi",
  handler: async ({ db, orgId, params, req }) =>
    settBrok(db, orgId, params.unitId, await lesKropp(req, brokInn)),
});
