import { aktorFor } from "@/lib/aktor";
import { lesKropp, plattformRute } from "@/lib/api";
import { hentLeadAktiviteter, leadNotatInn, leggTilLeadNotat } from "@/lib/leads";

type P = { leadId: string };

export const GET = plattformRute<P>({
  nivaa: "plattformadmin",
  handler: ({ db, params }) => hentLeadAktiviteter(db, params.leadId),
});

export const POST = plattformRute<P>({
  nivaa: "plattformadmin",
  status: 201,
  handler: async ({ db, bruker, params, req }) =>
    leggTilLeadNotat(db, params.leadId, (await lesKropp(req, leadNotatInn)).tekst, aktorFor(bruker)),
});
