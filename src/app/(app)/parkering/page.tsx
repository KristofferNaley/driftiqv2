"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { parkering, type Plass, type Ventende } from "@/lib/klient";

/**
 * Parkering — første modulside i v2, og mønsteret de andre skal følge.
 *
 * Ingen `fetch` her: alle kall går gjennom `lib/klient.ts`. Ingen inline `style` for noe som
 * må reagere på skjermbredde — kolonnene brekker av seg selv med `.auto-grid`.
 */

const STATUSMERKE: Record<string, string> = {
  ledig: "ok",
  utleid: "info",
  disponert: "muted",
};

export default function Parkering() {
  const { aktivOrg, laster: lasterOkt } = useOkt();
  const [plasser, setPlasser] = useState<Plass[]>([]);
  const [venteliste, setVenteliste] = useState<Ventende[]>([]);
  const [feil, setFeil] = useState<string | null>(null);
  const [laster, setLaster] = useState(true);
  const [nyttNummer, setNyttNummer] = useState("");

  const orgId = aktivOrg?.id;

  const hent = useCallback(async () => {
    if (!orgId) return;
    setLaster(true);
    setFeil(null);
    try {
      const [p, v] = await Promise.all([parkering.plasser(orgId), parkering.venteliste(orgId)]);
      setPlasser(p);
      setVenteliste(v);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente parkeringsdata");
    } finally {
      setLaster(false);
    }
  }, [orgId]);

  useEffect(() => {
    void hent();
  }, [hent]);

  async function leggTilPlass(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !nyttNummer.trim()) return;
    try {
      await parkering.nyPlass(orgId, { number: nyttNummer.trim() });
      setNyttNummer("");
      await hent();
    } catch (e) {
      // Duplikat plassnummer kommer hit med API-ets egen norske melding.
      setFeil(e instanceof Error ? e.message : "Kunne ikke legge til plassen");
    }
  }

  async function slett(id: string) {
    if (!orgId) return;
    try {
      await parkering.slettPlass(orgId, id);
      await hent();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke slette plassen");
    }
  }

  const ledige = plasser.filter((p) => p.status === "ledig").length;

  return (
    <Layout tittel="Parkering">
      <div className="page-content">
        {feil && <div className="feilmelding">{feil}</div>}

        <div className="auto-grid">
          <Nokkeltall etikett="Plasser totalt" verdi={plasser.length} />
          <Nokkeltall etikett="Ledige" verdi={ledige} />
          <Nokkeltall etikett="På venteliste" verdi={venteliste.length} />
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Plasser</div>
            <form onSubmit={leggTilPlass} style={{ display: "flex", gap: "8px" }}>
              <input
                className="input"
                style={{ width: "140px" }}
                placeholder="Plassnummer"
                value={nyttNummer}
                onChange={(e) => setNyttNummer(e.target.value)}
                aria-label="Nytt plassnummer"
              />
              <button className="btn btn-primary" disabled={!nyttNummer.trim()}>
                <Plus size={16} strokeWidth={2} aria-hidden />
                Legg til
              </button>
            </form>
          </div>

          {lasterOkt || laster ? (
            <div className="tom-melding">Henter …</div>
          ) : plasser.length === 0 ? (
            <div className="tom-melding">Ingen plasser registrert ennå.</div>
          ) : (
            plasser.map((p) => (
              <div className="list-item" key={p.id}>
                <div style={{ minWidth: 0 }}>
                  <div className="list-tittel">Plass {p.number}</div>
                  <div className="list-meta">
                    {[p.areaLabel, p.spotType, p.lease?.tenantName].filter(Boolean).join(" · ") ||
                      "Ingen detaljer"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span className={`badge ${STATUSMERKE[p.status] ?? "muted"}`}>{p.status}</span>
                  <button
                    className="btn btn-ghost"
                    onClick={() => slett(p.id)}
                    aria-label={`Slett plass ${p.number}`}
                  >
                    <Trash2 size={15} strokeWidth={1.9} aria-hidden />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Venteliste</div>
          </div>
          {venteliste.length === 0 ? (
            <div className="tom-melding">Ingen står på venteliste.</div>
          ) : (
            venteliste.map((v) => (
              <div className="list-item" key={v.id}>
                <div>
                  <div className="list-tittel">{v.name}</div>
                  <div className="list-meta">
                    Ønsker {v.requestedType} · meldt {v.requestedAt}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}

function Nokkeltall({ etikett, verdi }: { etikett: string; verdi: number }) {
  return (
    <div className="card">
      <div className="card-body">
        <div className="card-title">{etikett}</div>
        <div style={{ fontSize: "var(--fs-hero)", fontWeight: 700, marginTop: "4px" }}>{verdi}</div>
      </div>
    </div>
  );
}
