import { orgRute } from "@/lib/api";
import { sokHoldeplasser } from "@/lib/tavleblokker";

/** Proxy mot Enturs holdeplassøk — nettleseren kaller aldri Entur selv. */
export const GET = orgRute({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: ({ req }) => sokHoldeplasser(new URL(req.url).searchParams.get("q") ?? ""),
});
