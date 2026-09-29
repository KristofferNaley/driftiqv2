import { orgRute } from "@/lib/api";
import { kontaktkandidater } from "@/lib/oppslagstavle";

/** Medlemmene som kan velges som kontaktperson, med kontaktinfoen fra profilen. */
export const GET = orgRute({
  nivaa: "admin",
  modul: "oppslagstavle",
  handler: ({ db, orgId }) => kontaktkandidater(db, orgId),
});
