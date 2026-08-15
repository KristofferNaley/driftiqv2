"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  CalendarDays,
  ClipboardList,
  Clock,
  FileText,
  ListChecks,
  ShieldCheck,
  SquareParking,
  Truck,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { modulErAktivert } from "@/lib/moduler";
import {
  STANDARDOPPSETT,
  STORRELSER,
  WIDGETDEFS,
  WIDGETS,
  type Widgetvalg,
} from "@/lib/dashbordwidgets";
import { Feil, Tom, dato, useOrgData } from "@/components/felles";
import { dashbord, type Dashbord } from "@/lib/klient";

/**
 * Dashbordet.
 *
 * Widgetene tegnes bare når modulen deres er på — `hentDashbord` returnerer `null` for et
 * felt kunden ikke har. Forskjellen på `null` og tom liste er hele poenget: uten den ville
 * en kunde uten Avvik sett «0 åpne avvik» i stedet for ingenting.
 *
 * v1 har et lagret, redigerbart oppsett per bruker (`users.dashboard_layout`) med
 * drag-and-drop og en widgetkatalog. Det er ikke portert ennå — her er standardoppsettet.
 */

const ALVOR: Record<string, string> = {
  hoy: "var(--danger)",
  middels: "var(--warn)",
  lav: "var(--accent)",
};

const TG_FARGE: Record<string, string> = {
  TG0: "var(--accent2)",
  TG1: "var(--accent2)",
  TG2: "var(--warn)",
  TG3: "var(--danger)",
};

export default function Dashbord() {
  const { aktivOrg } = useOkt();
  const { data, feil, laster } = useOrgData((o) => dashbord.hent(o));
  const orgId = aktivOrg?.id;

  const [oppsett, setOppsett] = useState<Widgetvalg[] | null>(null);
  const [redigerer, setRedigerer] = useState(false);
  const [drar, setDrar] = useState<string | null>(null);
  const [lagringsfeil, setLagringsfeil] = useState<string | null>(null);

  /**
   * Speiler `oppsett`.
   *
   * To raske endringer — fjern og så størrelse — havner ellers i samme render og lukker
   * begge over den samme gamle lista, så den siste overskriver den første. Samme felle som
   * i v1, og løsningen der var også en ref.
   */
  const oppsettRef = useRef<Widgetvalg[] | null>(null);

  const erPa = useCallback(
    (modul?: string) => !modul || modulErAktivert(aktivOrg?.enabledModules ?? null, modul as never),
    [aktivOrg],
  );

  const standard = useMemo(
    () => STANDARDOPPSETT.filter((w) => erPa(WIDGETS[w.nokkel]?.modul)),
    [erPa],
  );

  useEffect(() => {
    if (!orgId) return;
    let avbrutt = false;
    dashbord
      .oppsett(orgId)
      .then((lagret) => {
        if (avbrutt) return;
        const start = lagret ?? standard;
        oppsettRef.current = start;
        setOppsett(start);
      })
      .catch(() => {
        if (avbrutt) return;
        oppsettRef.current = standard;
        setOppsett(standard);
      });
    return () => {
      avbrutt = true;
    };
  }, [orgId, standard]);

  /** Lagrer optimistisk: flyttingen skal føles umiddelbar, ikke vente på nettverket. */
  const lagre = useCallback(
    (endre: (forrige: Widgetvalg[]) => Widgetvalg[]) => {
      const neste = endre(oppsettRef.current ?? standard);
      oppsettRef.current = neste;
      setOppsett(neste);
      setLagringsfeil(null);
      if (orgId) {
        dashbord
          .settOppsett(orgId, neste)
          .catch(() =>
            setLagringsfeil("Oppsettet ble ikke lagret. Endringen gjelder til du laster siden på nytt."),
          );
      }
    },
    [orgId, standard],
  );

  /**
   * NULLSTILLER lagringen, i stedet for å lagre standarden som et eget oppsett.
   *
   * Forskjellen er ikke synlig i dag, men blir det: legges en widget til standarden senere,
   * ville en som hadde «tilbakestilt» sittet fast med gårsdagens forside for alltid.
   */
  async function tilbakestill() {
    oppsettRef.current = [...standard];
    setOppsett([...standard]);
    setLagringsfeil(null);
    if (orgId) {
      await dashbord
        .settOppsett(orgId, null)
        .catch(() => setLagringsfeil("Oppsettet ble ikke tilbakestilt."));
    }
  }

  function slipp(mal: string) {
    if (!drar || drar === mal) return;
    lagre((forrige) => {
      const flyttet = forrige.find((w) => w.nokkel === drar);
      if (!flyttet) return forrige;
      const uten = forrige.filter((w) => w.nokkel !== drar);
      const i = uten.findIndex((w) => w.nokkel === mal);
      return [...uten.slice(0, i), flyttet, ...uten.slice(i)];
    });
    setDrar(null);
  }

  const bibliotek = WIDGETDEFS.filter(
    (d) => erPa(d.modul) && !(oppsett ?? []).some((w) => w.nokkel === d.nokkel),
  );

  // Widgets for moduler som er slått av siden oppsettet ble lagret, skal ikke tegnes.
  const synlige = (oppsett ?? []).filter((w) => WIDGETS[w.nokkel] && erPa(WIDGETS[w.nokkel]!.modul));

  return (
    <Layout
      tittel="Dashboard"
      handlinger={
        <button className="btn btn-ghost" onClick={() => setRedigerer((v) => !v)}>
          {redigerer ? "Ferdig" : "Tilpass"}
        </button>
      }
    >
      <div className="page-content">
        <Feil melding={feil ?? lagringsfeil} />

        {laster || !data || !oppsett ? (
          <Tom tekst="Henter …" />
        ) : (
          <>
            {/* Dashbordbanneret fra Innstillinger → Generelt. Bare et bilde, aldri et krav:
                uten banner starter siden rett på widgetene. Navnet ligger oppå som i v1 —
                en ren span, aldri en lenke: lag som heter noe adresseaktig
                («Håsteinsgate 9») ble av og til gjort trykkbare av iOS i v1. Beltet er
                formatDetection i rot-layouten; bukseselene er pointer-events i CSS-en. */}
            {data.banner && orgId && (
              <div className="dash-banner">
                <img src={`/api/organizations/${orgId}/banner/file`} alt="" />
                <div className="dash-banner-skygge" aria-hidden />
                <span className="dash-banner-navn">{aktivOrg?.name}</span>
              </div>
            )}
            {redigerer && (
              <div className="tips-stripe">
                <span style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
                  ✥ Dra kortene for å endre rekkefølge. Klikk på størrelsen for å bytte bredde,
                  eller ✕ for å fjerne. Oppsettet gjelder bare deg, i dette laget.
                </span>
                <button className="btn btn-ghost" onClick={() => void tilbakestill()}>
                  Tilbakestill
                </button>
              </div>
            )}

            <div className="dash-grid">
              {synlige.map((w) => (
                <div
                  key={w.nokkel}
                  className={`dash-plass dp-${w.storrelse}${drar === w.nokkel ? " drar" : ""}${redigerer ? " redigerer" : ""}`}
                  draggable={redigerer}
                  onDragStart={() => setDrar(w.nokkel)}
                  onDragOver={(e) => redigerer && e.preventDefault()}
                  onDrop={() => slipp(w.nokkel)}
                  onDragEnd={() => setDrar(null)}
                >
                  {redigerer && (
                    <div className="dash-verktoy">
                      <button
                        className="dash-str"
                        title="Bytt bredde"
                        onClick={() =>
                          lagre((forrige) =>
                            forrige.map((x) =>
                              x.nokkel === w.nokkel
                                ? {
                                    ...x,
                                    storrelse:
                                      STORRELSER[
                                        (STORRELSER.indexOf(x.storrelse) + 1) % STORRELSER.length
                                      ]!,
                                  }
                                : x,
                            ),
                          )
                        }
                      >
                        {w.storrelse.toUpperCase()}
                      </button>
                      <button
                        className="dash-fjern"
                        title={`Fjern ${WIDGETS[w.nokkel]!.navn}`}
                        onClick={() =>
                          lagre((forrige) => forrige.filter((x) => x.nokkel !== w.nokkel))
                        }
                      >
                        ✕
                      </button>
                    </div>
                  )}
                  <Widgetinnhold nokkel={w.nokkel} d={data} orgNavn={aktivOrg?.name ?? ""} />
                </div>
              ))}
            </div>

            {redigerer && bibliotek.length > 0 && (
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Legg til</div>
                </div>
                <div className="dash-bibliotek">
                  {bibliotek.map((d) => (
                    <button
                      key={d.nokkel}
                      className="dash-tilgjengelig"
                      onClick={() =>
                        lagre((forrige) => [...forrige, { nokkel: d.nokkel, storrelse: d.storrelse }])
                      }
                    >
                      <span className="dash-tilgjengelig-navn">＋ {d.navn}</span>
                      <span className="dash-tilgjengelig-under">{d.beskrivelse}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

/** Kobler en widgetnøkkel til komponenten som tegner den. */
function Widgetinnhold({ nokkel, d, orgNavn }: { nokkel: string; d: Dashbord; orgNavn: string }) {
  switch (nokkel) {
    case "kpi_oppgaver":
      return <Kpi etikett="Aktive oppgaver" verdi={d.kpi.oppgaver} farge="var(--accent)" sti="/oppgaver" />;
    case "kpi_ajour":
      return <Kpi etikett="À jour" verdi={d.kpi.aJour} farge="var(--accent2)" sti="/oppgaver" />;
    case "kpi_forsinket":
      return <Kpi etikett="Forsinket" verdi={d.kpi.forsinket} farge="var(--warn)" sti="/oppgaver" />;
    case "kpi_avvik":
      return <Kpi etikett="Åpne avvik" verdi={d.kpi.apneAvvik} farge="var(--danger)" sti="/avvik" />;
    case "oppfolging":
      return <Oppfolging d={d} />;
    case "frister":
      return <Frister d={d} />;
    case "oppgaver":
      return d.oppgaveliste ? <Oppgaver rader={d.oppgaveliste} /> : null;
    case "avvik":
      return d.avviksliste ? <Avvik rader={d.avviksliste} /> : null;
    case "kontrakter":
      return d.utlopende ? <Kontrakter rader={d.utlopende} /> : null;
    case "tilstand":
      return d.tilstand ? <Tilstand rader={d.tilstand} /> : null;
    case "rutiner":
      return d.rutinerTilRevisjon ? <Rutiner rader={d.rutinerTilRevisjon} /> : null;
    case "aktivitet":
      return d.aktivitet ? <Aktivitet rader={d.aktivitet} /> : null;
    case "smatall":
      return <Smatall d={d} orgNavn={orgNavn} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------

function Kpi({
  etikett,
  verdi,
  farge,
  sti,
}: {
  etikett: string;
  verdi: number | null;
  farge: string;
  sti: string;
}) {
  const router = useRouter();
  if (verdi === null) return null;
  return (
    <div className="card kpi-kort" style={{ ["--kpi-farge" as string]: farge }}>
      {/* KPI-tallene er inngangsdører, ikke bare pynt — de går til modulen sin. */}
      <button className="card-body" onClick={() => router.push(sti)}>
        <div className="card-title">{etikett}</div>
        <div className="kpi-tall">{verdi}</div>
      </button>
    </div>
  );
}

function Widget({
  tittel,
  ikon: Ikon,
  lenke,
  bred,
  children,
}: {
  tittel: string;
  ikon: LucideIcon;
  lenke?: { sti: string; tekst: string };
  bred?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <div className={`card${bred ? " bred" : ""}`}>
      <div className="card-header">
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: "7px" }}>
          <Ikon size={14} strokeWidth={2} aria-hidden />
          {tittel}
        </div>
        {lenke && (
          <button
            onClick={() => router.push(lenke.sti)}
            style={{
              all: "unset",
              cursor: "pointer",
              color: "var(--accent)",
              fontSize: "var(--fs-label)",
              fontWeight: 600,
            }}
          >
            {lenke.tekst}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Oppfolging({ d }: { d: Dashbord }) {
  const router = useRouter();
  return (
    <Widget tittel="Krever oppfølging" ikon={Zap} bred>
      {d.oppfolging.length === 0 ? (
        <Tom tekst="Ingenting krever oppfølging akkurat nå." />
      ) : (
        // Prioritert rekkefølge fra serveren: et nytt avvik ingen har sett på haster mer
        // enn en kontrakt som utløper om et halvår.
        d.oppfolging.map((o, n) => (
          <div
            key={n}
            className="oppf-rad"
            style={{ ["--oppf-farge" as string]: ALVOR[o.alvor] }}
            onClick={() => router.push(o.sti)}
          >
            <div style={{ minWidth: 0 }}>
              <div className="list-tittel">{o.tekst}</div>
              {o.detalj && <div className="list-meta">{o.detalj}</div>}
            </div>
          </div>
        ))
      )}
    </Widget>
  );
}

function Frister({ d }: { d: Dashbord }) {
  return (
    <Widget tittel="Kommende frister" ikon={Clock} bred>
      {d.frister.length === 0 ? (
        <Tom tekst="Ingen kommende frister." />
      ) : (
        // Kontraktsutløp, oppgavefrister og årshjul på én tidslinje.
        d.frister.map((f, n) => (
          <div className="list-item" key={n}>
            <div style={{ minWidth: 0 }}>
              <div className="list-tittel">{f.navn}</div>
              <div className="list-meta">{f.kilde}</div>
            </div>
            <span className="list-meta">{dato(f.dato)}</span>
          </div>
        ))
      )}
    </Widget>
  );
}

function Oppgaver({ rader }: { rader: NonNullable<Dashbord["oppgaveliste"]> }) {
  const router = useRouter();
  return (
    <Widget tittel="Oppgaver" ikon={ListChecks} lenke={{ sti: "/oppgaver", tekst: "Se alle →" }}>
      {rader.length === 0 ? (
        <Tom tekst="Ingen oppgaver." />
      ) : (
        rader.map((t) => (
          <div className="list-item" key={t.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/oppgaver/${t.id}`)}>
            <div style={{ minWidth: 0 }}>
              <div className="list-tittel">{t.title}</div>
              <div className="list-meta">
                {[t.vendorName, t.nesteFrist ? dato(t.nesteFrist) : null].filter(Boolean).join(" · ")}
              </div>
            </div>
            <span className={`badge ${t.forsinket ? "danger" : "ok"}`}>
              {t.forsinket ? "Forsinket" : "Å jour"}
            </span>
          </div>
        ))
      )}
    </Widget>
  );
}

function Avvik({ rader }: { rader: NonNullable<Dashbord["avviksliste"]> }) {
  const router = useRouter();
  return (
    <Widget tittel="Åpne avvik" ikon={AlertTriangle} lenke={{ sti: "/avvik", tekst: "Se alle →" }}>
      {rader.length === 0 ? (
        <Tom tekst="Ingen åpne avvik." />
      ) : (
        rader.map((a) => (
          <div className="list-item" key={a.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/avvik/${a.id}`)}>
            <div style={{ minWidth: 0 }}>
              <div className="list-tittel">
                #{a.number ?? "?"} {a.title}
              </div>
              <div className="list-meta">{a.status === "ny" ? "Ny" : "Under behandling"}</div>
            </div>
            {a.severity && <span className="badge muted">{a.severity}</span>}
          </div>
        ))
      )}
    </Widget>
  );
}

function Kontrakter({ rader }: { rader: NonNullable<Dashbord["utlopende"]> }) {
  const router = useRouter();
  return (
    <Widget tittel="Kontrakter som utløper" ikon={FileText} lenke={{ sti: "/kontrakter", tekst: "Se alle →" }}>
      {rader.length === 0 ? (
        <Tom tekst="Ingen avtaler utløper de neste seks månedene." />
      ) : (
        rader.map((k) => (
          <div className="list-item" key={k.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/kontrakter?apen=${k.id}`)}>
            <div style={{ minWidth: 0 }}>
              <div className="list-tittel">{k.title}</div>
              <div className="list-meta">{k.vendorName}</div>
            </div>
            <span className="badge warn">{dato(k.endDate)}</span>
          </div>
        ))
      )}
    </Widget>
  );
}

function Tilstand({ rader }: { rader: NonNullable<Dashbord["tilstand"]> }) {
  const maks = Math.max(1, ...rader.map((r) => r.antall));
  return (
    <Widget tittel="Tilstandsgrad (NS 3424)" ikon={Wrench} lenke={{ sti: "/vedlikehold", tekst: "Se alle →" }}>
      <div style={{ padding: "10px 0" }}>
        {rader.map((r) => (
          <div className="tg-rad" key={r.tg}>
            <span style={{ width: "34px", fontWeight: 600 }}>{r.tg}</span>
            <div className="tg-spor">
              {/* Fire tall trenger ikke et grafbibliotek. */}
              <div
                className="tg-fyll"
                style={{ width: `${(r.antall / maks) * 100}%`, ["--tg-farge" as string]: TG_FARGE[r.tg] }}
              />
            </div>
            <span style={{ width: "24px", textAlign: "right", color: "var(--muted)" }}>{r.antall}</span>
          </div>
        ))}
      </div>
    </Widget>
  );
}

function Rutiner({ rader }: { rader: NonNullable<Dashbord["rutinerTilRevisjon"]> }) {
  const router = useRouter();
  return (
    <Widget tittel="Rutiner å revidere" ikon={ClipboardList} lenke={{ sti: "/rutiner", tekst: "Se alle →" }}>
      {rader.length === 0 ? (
        <Tom tekst="Alle rutiner er à jour." />
      ) : (
        rader.map((r) => (
          <div className="list-item" key={r.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/rutiner/${r.id}`)}>
            <div style={{ minWidth: 0 }}>
              <div className="list-tittel">{r.title}</div>
              <div className="list-meta">
                {r.lastReviewedAt ? `sist ${dato(r.lastReviewedAt)}` : "aldri gjennomgått"}
              </div>
            </div>
            <span className="badge warn">Trenger gjennomgang</span>
          </div>
        ))
      )}
    </Widget>
  );
}

function Aktivitet({ rader }: { rader: NonNullable<Dashbord["aktivitet"]> }) {
  return (
    <Widget tittel="Siste aktivitet" ikon={Clock} lenke={{ sti: "/driftslogg", tekst: "Se alle →" }}>
      {rader.length === 0 ? (
        <Tom tekst="Ingen loggføringer." />
      ) : (
        rader.map((l) => (
          <div className="list-item" key={l.id}>
            <div style={{ minWidth: 0 }}>
              <div className="list-tittel">{l.title}</div>
              <div className="list-meta">
                {dato(l.entryDate)} · {l.createdBy}
              </div>
            </div>
          </div>
        ))
      )}
    </Widget>
  );
}

/** Småtallene som ikke fortjener hvert sitt kort. Bare de modulene kunden faktisk har. */
function Smatall({ d, orgNavn }: { d: Dashbord; orgNavn: string }) {
  const rader: Array<[LucideIcon, string, string, string]> = [];
  if (d.parkering) {
    rader.push([
      SquareParking,
      "Parkering",
      `${d.parkering.ledige} ledige av ${d.parkering.totalt}`,
      "/parkering",
    ]);
  }
  if (d.antallDokumenter !== null) {
    rader.push([Archive, "Dokumentarkiv", `${d.antallDokumenter} dokumenter`, "/dokumentarkiv"]);
  }
  if (d.leverandorer) {
    rader.push([
      Truck,
      "Leverandører",
      `${d.leverandorer.aktive} aktive${d.leverandorer.inaktive ? `, ${d.leverandorer.inaktive} inaktive` : ""}`,
      "/leverandorer",
    ]);
  }
  if (d.moduler.internkontroll) {
    rader.push([ShieldCheck, "Internkontroll", "Se § 5-status", "/internkontroll"]);
  }
  if (d.moduler.arshjul) {
    rader.push([CalendarDays, "Årshjul", "Se årets hendelser", "/arshjul"]);
  }

  const router = useRouter();
  if (rader.length === 0) return null;

  return (
    <Widget tittel={orgNavn || "Organisasjonen"} ikon={Zap}>
      {rader.map(([Ikon, navn, sub, sti]) => (
        <div className="list-item" key={navn} style={{ cursor: "pointer" }} onClick={() => router.push(sti)}>
          <div style={{ display: "flex", alignItems: "center", gap: "11px", minWidth: 0 }}>
            <Ikon size={16} strokeWidth={1.9} aria-hidden />
            <div style={{ minWidth: 0 }}>
              <div className="list-tittel">{navn}</div>
              <div className="list-meta">{sub}</div>
            </div>
          </div>
        </div>
      ))}
    </Widget>
  );
}
