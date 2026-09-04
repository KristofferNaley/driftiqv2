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

  // Regnskapskoblingen: orgene én om gangen i egen withOrg — withoutRls kun for å finne dem.
  // Fiken bremser over 4 kall/s, så ingen parallellitet. Feil per org lagres på raden og
  // varsles; jobben fortsetter med neste org.
  const fikenSynk = JOBBER.find((j) => j.nokkel === "fiken-synk")!;
  cron.schedule(
    fikenSynk.cron,
    () => {
      void (async () => {
        try {
          await medKjoringslogg("fiken-synk", async () => {
            const { withOrg, withoutRls } = await import("./db/client");
            const { fikenConnections } = await import("./db/schema/okonomi");
            const { synkKjop } = await import("./lib/fikenkobling");
            const orger = await withoutRls("bakgrunnsjobb", (db) =>
              db.select({ orgId: fikenConnections.orgId }).from(fikenConnections),
            );
            let ok = 0;
            const feil: string[] = [];
            for (const { orgId } of orger) {
              try {
                const r = await withOrg(orgId, (db) => synkKjop(db, orgId));
                if (r.ok) ok++;
                else feil.push(`${orgId}: ${r.feil}`);
              } catch (e) {
                feil.push(`${orgId}: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
            if (feil.length > 0) void sendDriftsvarsel(`⚠️ Fiken-synk feilet for ${feil.length} org(er): ${feil.join("; ")}`);
            const detalj = `${ok} av ${orger.length} orger synkronisert`;
            console.log(`[fiken-synk] Ferdig — ${detalj}.`);
            return detalj;
          });
        } catch (e) {
          console.error("[fiken-synk] Jobben feilet:", e);
          void sendDriftsvarsel(`⚠️ Bakgrunnsjobben «fiken-synk» feilet: ${e instanceof Error ? e.message : String(e)}`);
        }
      })();
    },
    { timezone: fikenSynk.timezone },
  );
  console.log(`[fiken-synk] Planlagt: ${fikenSynk.plan}.`);

  const rydding = JOBBER.find((j) => j.nokkel === "hendelsesrydding")!;

  cron.schedule(
    rydding.cron,
    () => {
      void (async () => {
        try {
          await medKjoringslogg("hendelsesrydding", async () => {
            const { withoutRls } = await import("./db/client");
            const { slettGamleHendelser, slettGamleAuthHendelser } = await import("./lib/hendelser");
            // Oppbevaringsgrensene er policy og bor som konstanter i lib/hendelser.ts.
            const naa = new Date();
            const [hendelser, innlogginger] = await withoutRls("bakgrunnsjobb", async (db) => [
              await slettGamleHendelser(db, naa),
              await slettGamleAuthHendelser(db, naa),
            ]);
            const detalj = `${hendelser} hendelser, ${innlogginger} innloggingsrader slettet`;
            console.log(`[hendelsesrydding] Ferdig — ${detalj}.`);
            return detalj;
          });
        } catch (e) {
          console.error("[hendelsesrydding] Jobben feilet:", e);
          void sendDriftsvarsel(
            `⚠️ Bakgrunnsjobben «hendelsesrydding» feilet: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      })();
    },
    { timezone: rydding.timezone },
  );

  console.log(`[hendelsesrydding] Planlagt: ${rydding.plan}.`);
}
