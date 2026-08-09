"use client";

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

  return (
    <Layout tittel="Dashboard">
      <div className="page-content">
        <Feil melding={feil} />

        {laster || !data ? (
          <Tom tekst="Henter …" />
        ) : (
          <>
            <Kpier d={data} />
            <div className="dash-grid">
              <Oppfolging d={data} />
              <Frister d={data} />
              {data.oppgaveliste && <Oppgaver rader={data.oppgaveliste} />}
              {data.avviksliste && <Avvik rader={data.avviksliste} />}
              {data.utlopende && <Kontrakter rader={data.utlopende} />}
              {data.tilstand && <Tilstand rader={data.tilstand} />}
              {data.rutinerTilRevisjon && <Rutiner rader={data.rutinerTilRevisjon} />}
              {data.aktivitet && <Aktivitet rader={data.aktivitet} />}
              <Smatall d={data} orgNavn={aktivOrg?.name ?? ""} />
            </div>
          </>
        )}
      </div>
    </Layout>
  );
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

function Kpier({ d }: { d: Dashbord }) {
  return (
    <div className="dash-kpi">
      <Kpi etikett="Aktive oppgaver" verdi={d.kpi.oppgaver} farge="var(--accent)" sti="/oppgaver" />
      <Kpi etikett="À jour" verdi={d.kpi.aJour} farge="var(--accent2)" sti="/oppgaver" />
      <Kpi etikett="Forsinket" verdi={d.kpi.forsinket} farge="var(--warn)" sti="/oppgaver" />
      <Kpi etikett="Åpne avvik" verdi={d.kpi.apneAvvik} farge="var(--danger)" sti="/avvik" />
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
          <div className="list-item" key={k.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/kontrakter/${k.id}`)}>
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
