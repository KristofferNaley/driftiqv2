"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import Layout from "@/components/Layout";
import { Feil, Kort, Rad, Tom, useOrgData } from "@/components/felles";
import { internkontroll } from "@/lib/klient";

/**
 * Vernerunde.
 *
 * En FULLFØRT runde er låst: den dokumenterer hva som ble observert den dagen. Avkryssing,
 * deltakere og sletting er derfor borte når status er `completed` — API-et nekter uansett,
 * men en knapp som alltid feiler er verre enn ingen knapp.
 */
export default function Vernerunde({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, feil, setFeil, laster, last, orgId } = useOrgData(
    (o) => internkontroll.hentRunde(o, id),
    [id],
  );
  const [lagrer, setLagrer] = useState<string | null>(null);

  async function kryssAv(punktId: string, avhuket: boolean) {
    if (!orgId) return;
    setLagrer(punktId);
    try {
      await internkontroll.kryssAv(orgId, id, punktId, { checked: avhuket });
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre avkryssingen");
    } finally {
      setLagrer(null);
    }
  }

  async function fullfor() {
    if (!orgId) return;
    try {
      await internkontroll.fullfor(orgId, id);
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke fullføre runden");
    }
  }

  if (laster || !data) {
    return (
      <Layout tittel="Vernerunde">
        <div className="page-content">
          <Feil melding={feil} />
          {!feil && <Tom tekst="Henter …" />}
        </div>
      </Layout>
    );
  }

  const last_ = data.status === "completed";
  const avhuket = data.punkter.filter((p) => p.checked).length;

  return (
    <Layout
      tittel={data.title}
      handlinger={
        last_ ? (
          <span className="badge ok">
            <Lock size={13} strokeWidth={2.2} aria-hidden /> Fullført og låst
          </span>
        ) : (
          <button className="btn btn-primary" onClick={fullfor}>
            Fullfør runden
          </button>
        )
      }
    >
      <div className="page-content">
        <Link href="/internkontroll" className="list-meta" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Internkontroll
        </Link>

        <Feil melding={feil} />

        {last_ && (
          <div className="card">
            <div className="card-body" style={{ color: "var(--muted)", fontSize: "var(--fs-sm)" }}>
              Runden er fullført og kan ikke endres. Den dokumenterer hva som ble observert den
              dagen — kunne den redigeres i ettertid, dokumenterte den ingenting.
            </div>
          </div>
        )}

        <Kort tittel={`Sjekkpunkter (${avhuket}/${data.punkter.length})`}>
          {data.punkter.length === 0 ? (
            <Tom tekst="Ingen sjekkpunkter. Opprett runden fra en HMS-mal for å få dem." />
          ) : (
            data.punkter.map((p) => (
              <label
                key={p.id}
                className="list-item"
                style={{ cursor: last_ ? "default" : "pointer" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "11px", minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={p.checked}
                    disabled={last_ || lagrer === p.id}
                    onChange={(e) => kryssAv(p.id, e.target.checked)}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="list-tittel">{p.text}</div>
                    {p.section && <div className="list-meta">{p.section}</div>}
                  </div>
                </div>
              </label>
            ))
          )}
        </Kort>

        <Kort tittel="Deltakere">
          {data.deltakere.length === 0 ? (
            <Tom tekst="Ingen deltakere registrert." />
          ) : (
            data.deltakere.map((d) => <Rad key={d.id} tittel={d.name} meta={d.role ?? undefined} />)
          )}
        </Kort>

        <Kort tittel="Avvik meldt under runden">
          {data.avvik.length === 0 ? (
            <Tom tekst="Ingen avvik meldt." />
          ) : (
            data.avvik.map((a) => (
              <Rad key={a.id} tittel={`#${a.number ?? "?"} ${a.title}`} meta={a.status} />
            ))
          )}
        </Kort>
      </div>
    </Layout>
  );
}
