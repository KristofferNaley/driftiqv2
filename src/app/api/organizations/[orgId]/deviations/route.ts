import { lesKropp, orgRute } from "@/lib/api";
import { avvikInn, avvikSok, avvikStatistikk, hentAvvik, hentKategorier, opprettAvvik } from "@/lib/avvik";
import { aktorFor } from "@/lib/aktor";
import { APP_URL } from "@/lib/urler";
import { varsleWebhooks } from "@/lib/webhooks";

/**
 * Avvikslista med filtre, sortering, paginering og nøkkeltall — i ÉN forespørsel.
 *
 * Slått sammen med vilje. Siden trenger alle fire hver gang, og som separate kall ville de
 * kommet ut av takt: du sletter et avvik, lista oppdateres, men KPI-ene står igjen på gamle
 * tall til neste henting.
 */
export const GET = orgRute({
  nivaa: "lesing",
  modul: "avvik",
  handler: async ({ db, orgId, bruker, req }) => {
    const q = Object.fromEntries(new URL(req.url).searchParams);
    const sok = avvikSok.parse(q);
    const [liste, stats, kategorier] = await Promise.all([
      hentAvvik(db, orgId, sok),
      avvikStatistikk(db, orgId, bruker.id),
      hentKategorier(db, orgId),
    ]);
    return { ...liste, stats, kategorier };
  },
});

/**
 * `lesing`, ikke `redigering`: å MELDE et avvik skal alle med tilgang kunne gjøre — også
 * `visning`. Det er hele poenget med at nivået heter «visning» og ikke «lesetilgang».
 */
export const POST = orgRute({
  nivaa: "lesing",
  modul: "avvik",
  handler: async ({ db, orgId, bruker, req, etterCommit }) => {
    const ny = await opprettAvvik(db, orgId, aktorFor(bruker), await lesKropp(req, avvikInn));
    etterCommit(() =>
      varsleWebhooks(orgId, {
        hendelse: "avvik.nytt",
        tittel: `Nytt avvik #${ny.number}: ${ny.title}`,
        tekst: [
          `Meldt av ${ny.reportedBy}`,
          ny.severity ? `Alvorlighet: ${ny.severity}` : null,
          ny.category ? `Kategori: ${ny.category}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        lenke: `${APP_URL}/avvik/${ny.id}`,
        data: { avvikId: ny.id, nummer: ny.number, alvorlighet: ny.severity, kategori: ny.category },
      }),
    );
    return ny;
  },
});
