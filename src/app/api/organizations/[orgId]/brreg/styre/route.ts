import { orgRute } from "@/lib/api";
import { hentStyre } from "@/lib/brreg";
import { hentOrg } from "@/lib/organisasjon";

/**
 * Styret slik det står i Enhetsregisteret.
 *
 * Endepunktet tar INGEN parameter — org.nr. leses fra organisasjonen i basen. Det er hele
 * poenget med å legge kallet her og ikke i nettleseren: uten en parameter kan ruta ikke
 * brukes som en åpen proxy til å slå opp hvilket som helst norsk selskap.
 *
 * `redigering`, ikke `admin`: å opprette brukere krever bare redigering (HMS-ansvaret ligger
 * ofte hos et styremedlem), og dette er første steg i nettopp den flyten.
 */
export const GET = orgRute({
  nivaa: "redigering",
  handler: async ({ db, orgId }) => {
    const org = await hentOrg(db, orgId);
    if (!org.orgNr) return { status: "mangler-orgnr" as const, orgNr: null, styre: [] };

    const styre = await hentStyre(org.orgNr);
    // `null` = registeret svarte ikke. Tom liste = det står ingen styreroller der. To
    // ulike beskjeder til brukeren, så de må skilles her og ikke slås sammen.
    if (styre === null) return { status: "ingen-svar" as const, orgNr: org.orgNr, styre: [] };
    return { status: "ok" as const, orgNr: org.orgNr, styre };
  },
});
