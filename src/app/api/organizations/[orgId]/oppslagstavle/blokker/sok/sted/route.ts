import { orgRute } from "@/lib/api";
import { sokVaersted } from "@/lib/tavleblokker";

/** Adressesøk med koordinater (Kartverket) til værblokken. */
export const GET = orgRute({
  nivaa: "redigering",
  modul: "oppslagstavle",
  handler: ({ req }) => sokVaersted(new URL(req.url).searchParams.get("q") ?? ""),
});
