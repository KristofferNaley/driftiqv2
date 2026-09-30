import { orgRute } from "@/lib/api";
import { aktorFor } from "@/lib/aktor";
import { opprettBildekladd } from "@/lib/oppslagstavle";

/** Kladden et nytt bildeoppslag begynner som, opprettet idet første fil lastes opp. */
export const POST = orgRute({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: ({ db, orgId, bruker }) => opprettBildekladd(db, orgId, aktorFor(bruker)),
});
