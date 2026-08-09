import { ApiFeil, lesKropp, orgRute } from "@/lib/api";
import { endreOrg, hentOrg, krevGyldigOrgnr, kreverAdmin, orgEndring } from "@/lib/organisasjon";
import { lagringsstatus } from "@/lib/lagring";
import { krevOrgAdmin } from "@/lib/tilgang";

export const GET = orgRute({
  nivaa: "lesing",
  handler: async ({ db, orgId }) => ({
    ...(await hentOrg(db, orgId)),
    lagring: await lagringsstatus(db, orgId),
  }),
});

/**
 * `nivaa: "redigering"` er MINSTEKRAVET — admin-kravet avgjøres av hvilke felter som faktisk
 * sendes. Sendes ett kontofelt (navn, org.nr., …), kreves orgadmin for hele kallet. Det er
 * bevisst strengt: ellers kunne et driftsfelt brukes som følgesvenn for en navneendring.
 */
export const PUT = orgRute({
  nivaa: "redigering",
  handler: async ({ db, orgId, bruker, req }) => {
    const data = await lesKropp(req, orgEndring);
    const felter = Object.keys(data);
    if (felter.length === 0) throw new ApiFeil(400, "Ingen felter å endre");
    if (kreverAdmin(felter)) await krevOrgAdmin(db, orgId, bruker);
    krevGyldigOrgnr(data.orgNr);
    return endreOrg(db, orgId, data);
  },
});
