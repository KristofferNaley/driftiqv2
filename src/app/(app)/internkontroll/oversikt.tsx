"use client";

/**
 * Oversikt — internkontrollens forside, etter `mockups/internkontroll-oversikt-mockup.html`.
 *
 * Alt regnes server-side i `hentOversikt` (ett kall, som dashbordet), og tallene gjelder
 * hovedvurderingen — prosjektene har egne chips på risikofanen. Fristkortet er
 * lovkrav-varslingen som ble tatt ut av runde-skjemaet: neste vernerunde og neste årlige
 * risikovurdering UTLEDES av forrige gjennomføring, ingen felt å huske.
 */

import Link from "next/link";
import { Feil, Tom, dato, useOrgData } from "@/components/felles";
import { internkontroll } from "@/lib/klient";
import { Kpi } from "./risiko";

const KORT_DATO: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

/** «om 7 mnd» — fristene leses som avstand, ikke som kalenderoppslag. */
function omTid(iso: string): string {
  const mnd = Math.round((new Date(iso).getTime() - Date.now()) / (30.44 * 86_400_000));
  if (mnd <= 0) return "nå";
  return mnd === 1 ? "om 1 mnd" : `om ${mnd} mnd`;
}

export function Oversikt({ onVisRisiko, onVisRunder }: { onVisRisiko: () => void; onVisRunder: () => void }) {
  const { data, feil, laster } = useOrgData((o) => internkontroll.oversikt(o));

  if (laster || !data) {
    return (
      <>
        <Feil melding={feil} />
        {!feil && <Tom tekst="Henter …" />}
      </>
    );
  }

  const g = data.sisteGjennomgang;
  const forhold = [
    data.oppfolging.risikoerUtenTiltak > 0,
    data.oppfolging.apneAvvik > 0,
    data.kpi.forfalteTiltak > 0,
  ].filter(Boolean).length;
  const fordelingTotal = g ? g.fordeling.lav + g.fordeling.middels + g.fordeling.hoy + g.fordeling.uvurdert : 0;
  const maksOmrade = g ? Math.max(1, ...g.perOmrade.map((a) => a.antall)) : 1;

  return (
    <>
      <Feil melding={feil} />

      {/* Statusbanneret — én setning om hvorvidt noe venter. */}
      {forhold > 0 ? (
        <div className="iko-banner">
          <span className="iko-banner-ico" aria-hidden>!</span>
          <div>
            <div className="iko-banner-t">
              {forhold === 1 ? "Ett forhold trenger oppfølging" : `${forhold} forhold trenger oppfølging`}
            </div>
            <div className="iko-banner-s">
              {[
                data.oppfolging.risikoerUtenTiltak > 0 && `${data.oppfolging.risikoerUtenTiltak} risikoer mangler tiltak`,
                data.oppfolging.apneAvvik > 0 && `${data.oppfolging.apneAvvik} åpne avvik`,
                data.kpi.forfalteTiltak > 0 && `${data.kpi.forfalteTiltak} forfalte tiltak`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>
      ) : (
        <div className="iko-banner ok">
          <span className="iko-banner-ico" aria-hidden>✓</span>
          <div>
            <div className="iko-banner-t">Internkontrollen er à jour</div>
            <div className="iko-banner-s">Ingen risikoer uten tiltak, ingen åpne avvik, ingen forfalte frister.</div>
          </div>
        </div>
      )}

      <div className="kpi-grid">
        <Kpi
          farge="blaa"
          etikett="Registrerte risikoer"
          verdi={data.kpi.registrerte}
          under={g ? `vurdert ${dato(g.reviewDate)}` : "ingen gjennomgang ennå"}
        />
        <Kpi farge="roed" etikett="Høy risiko" verdi={data.kpi.hoyRisiko} under="åpne farer" />
        <Kpi farge="gul" etikett="Forfalte tiltak" verdi={data.kpi.forfalteTiltak} under="frist passert" />
        <Kpi farge="gronn" etikett="Håndtert" verdi={data.kpi.handtert} under="under kontroll eller lukket" />
      </div>

      <div className="iko-kolonner">
        <div className="iko-stabel">
          <div className="card">
            <div className="card-header">
              <div className="card-title">Siste risikovurdering</div>
              <button className="sp-lenke" onClick={onVisRisiko}>Åpne risikovurderingen</button>
            </div>
            <div className="card-body">
              {!g ? (
                <Tom tekst="Ingen gjennomgang protokollert ennå. Fullfør en gjennomgang på risikofanen — det er den årlige dokumentasjonen." />
              ) : (
                <>
                  <div className="iko-dato">{dato(g.reviewDate)}</div>
                  <div className="iko-av">
                    Årlig gjennomgang{g.participants ? `, gjennomført av ${g.participants}` : ""}
                  </div>

                  <div className="iko-split">
                    <div className="lav"><div className="iko-n">{g.fordeling.lav}</div><div className="iko-l">Lav risiko</div></div>
                    <div className="mid"><div className="iko-n">{g.fordeling.middels}</div><div className="iko-l">Middels risiko</div></div>
                    <div className="hoy"><div className="iko-n">{g.fordeling.hoy}</div><div className="iko-l">Høy risiko</div></div>
                    {g.fordeling.uvurdert > 0 && (
                      <div><div className="iko-n">{g.fordeling.uvurdert}</div><div className="iko-l">Ikke vurdert</div></div>
                    )}
                    <div><div className="iko-n">{g.utenTiltak}</div><div className="iko-l">Uten tiltak</div></div>
                  </div>
                  {fordelingTotal > 0 && (
                    <div className="iko-dist" aria-hidden>
                      <i className="lav" style={{ width: `${(100 * g.fordeling.lav) / fordelingTotal}%` }} />
                      <i className="mid" style={{ width: `${(100 * g.fordeling.middels) / fordelingTotal}%` }} />
                      <i className="hoy" style={{ width: `${(100 * g.fordeling.hoy) / fordelingTotal}%` }} />
                    </div>
                  )}

                  {g.perOmrade.length > 0 && (
                    <div className="iko-omrader">
                      <div className="iko-omrader-h">Farer per område</div>
                      {g.perOmrade.map((a) => (
                        <div key={a.omrade} className="iko-arad">
                          <span className="iko-arad-navn">{a.omrade}</span>
                          <span className="iko-arad-spor">
                            <i style={{ width: `${(100 * a.antall) / maksOmrade}%` }} />
                          </span>
                          <span className="iko-arad-tall">{a.antall}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-title">Krever oppfølging</div></div>
            {data.oppfolging.risikoerUtenTiltak === 0 && data.oppfolging.apneAvvik === 0 ? (
              <Tom tekst="Ingenting venter — alle risikoer har tiltak, og ingen avvik står åpne." />
            ) : (
              <>
                {data.oppfolging.risikoerUtenTiltak > 0 && (
                  <button className="iko-folg gul" onClick={onVisRisiko}>
                    <span className="iko-folg-tall">{data.oppfolging.risikoerUtenTiltak}</span>
                    <span className="iko-folg-t">
                      Risikoer uten tiltak
                      <small>Registrert som fare, men ingenting er planlagt</small>
                    </span>
                    <span className="iko-folg-pil" aria-hidden>›</span>
                  </button>
                )}
                {data.oppfolging.apneAvvik > 0 && (
                  <Link href="/avvik" className="iko-folg roed">
                    <span className="iko-folg-tall">{data.oppfolging.apneAvvik}</span>
                    <span className="iko-folg-t">
                      Åpne avvik
                      <small>
                        {data.oppfolging.avvikFraRunder > 0
                          ? `${data.oppfolging.avvikFraRunder} av dem kom fra vernerunder`
                          : "Følges opp i avviksmodulen"}
                      </small>
                    </span>
                    <span className="iko-folg-pil" aria-hidden>›</span>
                  </Link>
                )}
              </>
            )}
          </div>
        </div>

        <div className="iko-stabel">
          <div className="card">
            <div className="card-header"><div className="card-title">Frister</div></div>
            {data.frister.map((f) => (
              <div key={`${f.tittel}-${f.status}`} className="iko-frist">
                <span className={`iko-merke ${f.status}`} aria-hidden />
                <span className="iko-frist-t">
                  <span>{f.tittel}</span>
                  <span className="iko-frist-d">{f.dato ? dato(f.dato) : "ingen gjennomføring å regne fra"}</span>
                </span>
                {f.status === "fullfort" ? (
                  <span className="badge ok">Fullført</span>
                ) : f.dato ? (
                  <span className="badge muted">{omTid(f.dato)}</span>
                ) : (
                  <span className="badge warn">mangler</span>
                )}
              </div>
            ))}
            <div className="iko-frist-note">
              Neste frister regnes fra forrige gjennomføring: vernerunde hvert halvår,
              risikovurdering hvert år. <button className="sp-lenke" onClick={onVisRunder}>Planlegg neste runde</button>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-title">Siste aktivitet</div></div>
            {data.aktivitet.length === 0 ? (
              <Tom tekst="Ingen aktivitet ennå." />
            ) : (
              data.aktivitet.map((a, i) => (
                <div key={i} className="iko-akt">
                  <span className="iko-akt-d">
                    {new Date(a.dato).toLocaleDateString("nb-NO", KORT_DATO)}
                  </span>
                  <span className="iko-akt-t">{a.tekst}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
