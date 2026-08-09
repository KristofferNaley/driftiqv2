"use client";

import { useCallback, useEffect, useState } from "react";
import { datoTid } from "@/components/felles";
import { api } from "@/lib/klient";
import { TYPE_ETIKETT } from "@/lib/feilmeldingtyper";
import { Ramme } from "../ramme";

type Sak = {
  id: string;
  nummer: number | null;
  orgId: string;
  orgNavn: string;
  type: string;
  modul: string | null;
  beskrivelse: string;
  status: string;
  melderNavn: string;
  melderEpost: string | null;
  appVersjon: string | null;
  opprettet: string;
};

const STATUS: Record<string, { etikett: string; merke: string }> = {
  ny: { etikett: "Ny", merke: "danger" },
  under_arbeid: { etikett: "Under arbeid", merke: "warn" },
  venter_kunde: { etikett: "Venter på kunde", merke: "info" },
  lost: { etikett: "Løst", merke: "ok" },
};

/** Innmeldinger fra kundene. Uten denne siden er «Meld feil» en svart boks. */
export default function Saker() {
  const [liste, setListe] = useState<Sak[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [svar, setSvar] = useState<Record<string, string>>({});
  const [jobber, setJobber] = useState<string | null>(null);

  const last = useCallback(async () => {
    try {
      setListe(await api.hent<Sak[]>("/plattform/saker"));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente sakene");
    }
  }, []);

  useEffect(() => {
    void last();
  }, [last]);

  async function endre(id: string, fn: () => Promise<unknown>) {
    setJobber(id);
    setFeil(null);
    try {
      await fn();
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
    } finally {
      setJobber(null);
    }
  }

  return (
    <Ramme tittel="Innmeldinger">
      {feil && <div className="feilmelding">{feil}</div>}
      {!liste ? (
        <p className="pf-dempet">Henter …</p>
      ) : liste.length === 0 ? (
        <p className="pf-dempet">Ingen innmeldinger ennå.</p>
      ) : (
        liste.map((s) => (
          <div key={s.id} className="pf-kort">
            <div className="pf-kort-hode">
              <span>
                FM-{String(s.nummer ?? 0).padStart(4, "0")} · {TYPE_ETIKETT[s.type] ?? s.type}
                {s.modul ? ` · ${s.modul}` : ""}
              </span>
              <span className={`badge ${STATUS[s.status]?.merke ?? "muted"}`}>
                {STATUS[s.status]?.etikett ?? s.status}
              </span>
            </div>
            <div className="pf-kort-kropp">
              <p className="pf-tekst" style={{ whiteSpace: "pre-wrap" }}>{s.beskrivelse}</p>
              <p className="pf-under">
                {s.orgNavn} · {s.melderNavn}
                {s.melderEpost ? ` (${s.melderEpost})` : ""} · {datoTid(s.opprettet)}
                {s.appVersjon ? ` · v${s.appVersjon}` : ""}
              </p>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "12px" }}>
                {(["ny", "under_arbeid", "venter_kunde", "lost"] as const).map((st) => (
                  <button
                    key={st}
                    className={`pille${s.status === st ? " valgt" : ""}`}
                    disabled={jobber === s.id}
                    onClick={() =>
                      void endre(s.id, () => api.endre(`/plattform/saker/${s.id}`, { status: st }))
                    }
                  >
                    {STATUS[st]!.etikett}
                  </button>
                ))}
              </div>

              {/* Svar går på e-post til melderen, med deres egen beskrivelse gjentatt — de
                  husker sjelden ordlyden i en sak de meldte for to uker siden. */}
              <div style={{ display: "flex", gap: "10px", marginTop: "12px", flexWrap: "wrap" }}>
                <input
                  className="input"
                  style={{ flex: "1 1 260px" }}
                  placeholder="Svar til melderen …"
                  aria-label={`Svar på sak ${s.nummer}`}
                  value={svar[s.id] ?? ""}
                  onChange={(e) => setSvar({ ...svar, [s.id]: e.target.value })}
                />
                <button
                  className="btn btn-primary"
                  disabled={jobber === s.id || !(svar[s.id] ?? "").trim()}
                  onClick={() =>
                    void endre(s.id, async () => {
                      await api.send(`/plattform/saker/${s.id}`, {
                        body: (svar[s.id] ?? "").trim(),
                        internal: false,
                      });
                      setSvar({ ...svar, [s.id]: "" });
                    })
                  }
                >
                  Send svar
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </Ramme>
  );
}
