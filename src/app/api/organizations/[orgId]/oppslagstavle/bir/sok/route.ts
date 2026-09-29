import { orgRute } from "@/lib/api";
import { sokIBir } from "@/lib/birkobling";

/** Søk i BIRs register — borettslag er egne oppføringer, så styret søker på selskapet. */
export const GET = orgRute({
  nivaa: "admin",
  modul: "oppslagstavle",
  handler: ({ req }) => sokIBir(new URL(req.url).searchParams.get("q") ?? ""),
});
