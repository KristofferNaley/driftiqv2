import { orgRute } from "@/lib/api";
import { synkKjop } from "@/lib/fikenkobling";

/**
 * «Synk nå». Kallet mot Fiken skjer INNE i handleren, ikke i etterCommit, fordi det er en
 * lesing som skal skrives til basen i samme transaksjon — feiler Fiken, ruller ingenting.
 */
export const POST = orgRute({
  nivaa: "admin",
  modul: "okonomi",
  handler: ({ db, orgId }) => synkKjop(db, orgId),
});
