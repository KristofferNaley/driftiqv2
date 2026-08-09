import { orgRute } from "@/lib/api";
import { hentArshjul } from "@/lib/arshjul";

export const GET = orgRute({
  nivaa: "lesing",
  modul: "arshjul",
  handler: ({ db, orgId, req }) => {
    const aar = Number(new URL(req.url).searchParams.get("aar"));
    return hentArshjul(db, orgId, Number.isFinite(aar) && aar > 2000 ? aar : new Date().getFullYear());
  },
});
