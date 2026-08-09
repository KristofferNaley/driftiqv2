"use client";

import { useState } from "react";
import Layout from "@/components/Layout";
import { Faner, Feil, Hurtigskjema, Kort, Nokkeltall, Rad, Tom, dato, kr, useOrgData } from "@/components/felles";
import { vedlikehold } from "@/lib/klient";

const GARANTIMERKE: Record<string, string> = { aktiv: "ok", utløpt: "muted", ukjent: "muted" };

function Bygningsdeler() {
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => vedlikehold.elementer(o));
  const liste = data ?? [];

  async function nyttElement(navn: string) {
    if (!orgId) return;
    try {
      await vedlikehold.nyttElement(orgId, { name: navn });
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke legge til bygningsdelen");
    }
  }

  return (
    <>
      <Feil melding={feil} />
      <div className="auto-grid">
        <Nokkeltall etikett="Bygningsdeler" verdi={liste.length} />
        <Nokkeltall
          etikett="Estimert tiltakskost"
          verdi={
            <span style={{ fontSize: "var(--fs-xl)" }}>
              {kr(liste.reduce((s, e) => s + (e.estimatedCost ?? 0), 0))}
            </span>
          }
        />
        <Nokkeltall
          etikett="FDV komplett"
          verdi={`${Math.round(
            liste.length ? liste.reduce((s, e) => s + e.fdv.prosent, 0) / liste.length : 0,
          )} %`}
        />
      </div>

      <Kort
        tittel="Bygningsdeler"
        handling={<Hurtigskjema plassholder="Navn på bygningsdel" onSend={nyttElement} />}
      >
        {laster ? (
          <Tom tekst="Henter …" />
        ) : liste.length === 0 ? (
          <Tom tekst="Ingen bygningsdeler registrert ennå." />
        ) : (
          liste.map((e) => (
            <Rad
              key={e.id}
              tittel={`${e.icon} ${e.name}`}
              meta={[
                e.category,
                e.conditionGrade,
                e.installedYear && `montert ${e.installedYear}`,
                e.nextActionYear && `tiltak ${e.nextActionYear}`,
                e.estimatedCost && kr(e.estimatedCost),
              ]
                .filter(Boolean)
                .join(" · ")}
              hoyre={
                <>
                  {/* FDV-prosenten teller ikke «annet»-sloten — se lib/vedlikehold.ts. */}
                  <span className="badge muted">
                    FDV {e.fdv.fylt}/{e.fdv.av}
                  </span>
                  <span className={`badge ${GARANTIMERKE[e.garanti]}`}>Garanti {e.garanti}</span>
                </>
              }
            />
          ))
        )}
      </Kort>
    </>
  );
}

function Enhetsarbeid() {
  const { data, feil, laster } = useOrgData((o) => vedlikehold.arbeider(o));
  const liste = data ?? [];

  return (
    <>
      <Feil melding={feil} />
      <div className="auto-grid">
        <Nokkeltall
          etikett="Vedlikehold"
          verdi={
            <span style={{ fontSize: "var(--fs-xl)" }}>
              {kr(liste.filter((a) => a.workType === "vedlikehold").reduce((s, a) => s + (a.cost ?? 0), 0))}
            </span>
          }
        />
        {/* Skillet avgjør regnskapsføringen: vedlikehold er driftskostnad, påkostning aktiveres. */}
        <Nokkeltall
          etikett="Påkostning"
          verdi={
            <span style={{ fontSize: "var(--fs-xl)" }}>
              {kr(liste.filter((a) => a.workType === "påkostning").reduce((s, a) => s + (a.cost ?? 0), 0))}
            </span>
          }
        />
      </div>

      <Kort tittel="Arbeid i enkeltenheter">
        {laster ? (
          <Tom tekst="Henter …" />
        ) : liste.length === 0 ? (
          <Tom tekst="Ingen registrerte arbeider." />
        ) : (
          liste.map((a) => (
            <Rad
              key={a.id}
              tittel={`${a.unitLabel} — ${a.title}`}
              meta={[dato(a.workDate), a.vendorName, kr(a.cost), `betalt av ${a.paidBy}`]
                .filter(Boolean)
                .join(" · ")}
              hoyre={
                <span className={`badge ${a.workType === "påkostning" ? "info" : "muted"}`}>
                  {a.workType}
                </span>
              }
            />
          ))
        )}
      </Kort>
    </>
  );
}

export default function Vedlikehold() {
  const [fane, setFane] = useState<"deler" | "enheter">("deler");
  return (
    <Layout
      tittel="Vedlikehold"
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={[
            { nokkel: "deler", etikett: "Bygningsdeler" },
            { nokkel: "enheter", etikett: "Arbeid i enheter" },
          ]}
        />
      }
    >
      <div className="page-content">{fane === "deler" ? <Bygningsdeler /> : <Enhetsarbeid />}</div>
    </Layout>
  );
}
