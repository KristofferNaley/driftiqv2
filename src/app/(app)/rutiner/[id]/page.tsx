"use client";

import { use } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Phone } from "lucide-react";
import Layout from "@/components/Layout";
import { Feil, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { rutiner } from "@/lib/klient";

const MERKE: Record<string, string> = { utkast: "muted", aktiv: "ok", trenger_gjennomgang: "warn" };

export default function Rutinedetalj({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, feil, laster, last, orgId } = useOrgData((o) => rutiner.hent(o, id), [id]);

  if (laster || !data) {
    return (
      <Layout tittel="Rutine">
        <div className="page-content">
          <Feil melding={feil} />
          {!feil && <Tom tekst="Henter …" />}
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      tittel={data.title}
      handlinger={
        <>
        <Link className="btn btn-ghost" href={`/rutiner/${id}/ark`}>
          🖨 Rutineark
        </Link>
        {data.effektivStatus === "trenger_gjennomgang" && (
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (orgId) {
                await rutiner.markerGjennomgatt(orgId, id);
                await last();
              }
            }}
          >
            Marker gjennomgått
          </button>
        )}
        </>
      }
    >
      <div className="page-content">
        <Link href="/rutiner" className="list-meta" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Alle rutiner
        </Link>

        <Feil melding={feil} />

        <Kort tittel="Om rutinen">
          <Rad
            tittel="Status"
            hoyre={<span className={`badge ${MERKE[data.effektivStatus]}`}>{data.effektivStatus}</span>}
          />
          <Rad tittel="Ansvarlig" hoyre={data.responsible ?? "—"} />
          <Rad tittel="Versjon" hoyre={`v${data.version}`} />
          <Rad tittel="Sist gjennomgått" hoyre={dato(data.lastReviewedAt)} />
          {data.description && (
            <div style={{ padding: "14px 20px", fontSize: "var(--fs-sm)", lineHeight: 1.6, color: "var(--muted)" }}>
              {data.description}
            </div>
          )}
        </Kort>

        <Kort tittel="Fremgangsmåte">
          {data.steg.length === 0 ? (
            <Tom tekst="Ingen steg lagt inn." />
          ) : (
            data.steg.map((s, n) => (
              <div key={s.id} style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
                <div className="list-tittel" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span className="badge muted">{n + 1}</span>
                  {s.isCritical && (
                    <AlertTriangle size={14} strokeWidth={2.2} color="var(--danger)" aria-label="Kritisk steg" />
                  )}
                  {s.title}
                </div>
                {s.description && (
                  <div className="list-meta" style={{ marginTop: "5px", lineHeight: 1.6 }}>{s.description}</div>
                )}
                {s.calloutType === "warning" && s.calloutText && (
                  <div className="feilmelding" style={{ marginTop: "9px" }}>{s.calloutText}</div>
                )}
                {/* Kontaktinfo hentes LIVE fra leverandørens primærkontakt — den er aldri
                    frosset i teksten. Bytter firmaet nummer, viser rutinen det nye. */}
                {s.calloutType === "contact" && (
                  <div
                    style={{
                      marginTop: "9px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "7px",
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      borderRadius: "9px",
                      padding: "8px 13px",
                      fontSize: "var(--fs-sm)",
                    }}
                  >
                    <Phone size={14} strokeWidth={2} aria-hidden />
                    {s.kontakt ? (
                      <span>
                        {s.kontakt.name}
                        {s.kontakt.phone ? ` · ${s.kontakt.phone}` : ""}
                      </span>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>
                        Ingen primærkontakt satt på leverandøren
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </Kort>

        <Kort tittel="Versjonshistorikk">
          {data.versjoner.length === 0 ? (
            <Tom tekst="Ingen tidligere versjoner." />
          ) : (
            // Snapshotet tas FØR hver endring — ved tilsyn kan styret vise hvilken rutine
            // som gjaldt på et gitt tidspunkt.
            data.versjoner.map((v) => (
              <Rad key={v.id} tittel={`Versjon ${v.versionNumber}`} meta={`${v.changedBy} · ${dato(v.changedAt)}`} />
            ))
          )}
        </Kort>
      </div>
    </Layout>
  );
}
