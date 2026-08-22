/**
 * Bakgrunnsjobber. Arvtakeren til APScheduler i v1s `main.py`.
 *
 * `register()` kjøres én gang når serveren starter. Det er Next sitt eneste innebygde
 * inngangspunkt for oppstartsarbeid — det finnes ingen «main» å henge en planlegger på.
 *
 * ## Tre ting dette oppsettet hviler på
 *
 * **Én instans.** Kjører appen i flere containere, kjører jobben i hver av dem, og styret
 * får e-posten flere ganger. v2 kjører som én tjeneste; skal det skaleres, må jobben flyttes
 * ut til en ekstern cron som treffer ett endepunkt, eller ta en lås i databasen først.
 *
 * **Kun i Node-runtimen.** Next kjører også instrumentering i Edge-runtimen, der verken
 * `node-cron` eller databasedriveren finnes. Sjekken på `NEXT_RUNTIME` er derfor ikke pynt.
 *
 * **Tidssone.** `Europe/Oslo` eksplisitt, som i v1. Containeren kjører i UTC, og uten dette
 * ville «kl. 07 på mandag» vært kl. 09 norsk tid om sommeren — og feil ukedag ved årsskiftet.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Planleggeren skal ikke starte under bygging. `next build` kjører instrumenteringen, og
  // uten dette ville byggesteget koblet seg til databasen og lagt seg til å vente.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const cron = await import("node-cron");
  const { kjorVarsler } = await import("./lib/varselsjobb");
  const { medKjoringslogg } = await import("./lib/jobbkjoring");
  const { JOBBER } = await import("./lib/jobber");
  const { sendDriftsvarsel } = await import("./lib/driftsvarsel");

  // Én melding per oppstart er deploy-/restartsignalet i Discord-kanalen. En restart ingen
  // ba om er verdt å se; en crash-loop synes som en strøm av disse. At meldingen sendes
  // beviser samtidig at oppstarten kom forbi migrasjoner og RLS-oppsett.
  void sendDriftsvarsel("Appen startet — deploy eller restart.");

  // Uttrykk og tidssone leses fra jobbregisteret — plattformpanelet viser samme liste,
  // og to kilder til «når kjører varslene» ville driftet fra hverandre.
  const varsler = JOBBER.find((j) => j.nokkel === "varsler")!;

  cron.schedule(
    varsler.cron,
    () => {
      void (async () => {
        try {
          // Kjøringen logges til job_runs — «kjørte varslene i natt?» skal kunne besvares
          // fra panelet, også etter en restart.
          await medKjoringslogg("varsler", async () => {
            const sendt = await kjorVarsler();
            const detalj =
              `${sendt.forsinkede} sammendrag, ${sendt.mine} personlige, ` +
              `${sendt.kontrakter} kontraktvarsler`;
            console.log(`[varsler] Ferdig — ${detalj}.`);
            return detalj;
          });
        } catch (e) {
          // Jobben skal aldri velte serveren. Feiler den én morgen, kjører den neste —
          // men stille skal det ikke være: kjøringsloggen i panelet leser ingen daglig.
          console.error("[varsler] Jobben feilet:", e);
          void sendDriftsvarsel(
            `⚠️ Bakgrunnsjobben «varsler» feilet: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      })();
    },
    { timezone: varsler.timezone },
  );

  console.log(`[varsler] Planlagt: ${varsler.plan}.`);
}
