/**
 * Enhetsregisteret. Ingen `modul` oppgis: registeret ligger som fane under Innstillinger og
 * er ikke en modul kunden kan slå av — samme grunn som at det ikke står i `ALLE_MODULER`.
 */
import { lesKropp, orgRute } from "@/lib/api";
import { enhetInn, hentEnheter, opprettEnhet } from "@/lib/enheter";

export const GET = orgRute({
  nivaa: "lesing",
  handler: ({ db, orgId, req }) =>
    hentEnheter(db, orgId, {
      medArkiverte: new URL(req.url).searchParams.get("arkiverte") === "true",
    }),
});

export const POST = orgRute({
  // `redigering`, ikke `admin`: registeret er driftsdata, ikke kontooppsett.
  nivaa: "redigering",
  handler: async ({ db, orgId, req }) => opprettEnhet(db, orgId, await lesKropp(req, enhetInn)),
});
