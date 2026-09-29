import { orgRute } from "@/lib/api";
import { hentBirStatus, synkBir } from "@/lib/birkobling";

/** «Hent nå». En feil fra BIR lagres på koblingen og vises — svaret er status uansett. */
export const POST = orgRute({
  nivaa: "admin",
  modul: "oppslagstavle",
  handler: async ({ db, orgId }) => {
    await synkBir(db, orgId);
    return hentBirStatus(db, orgId);
  },
});
