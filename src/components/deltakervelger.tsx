"use client";

import { useState } from "react";
import { brukere } from "@/lib/klient";

/**
 * Deltakerne på en befaring eller gjennomgang — interne velges fra orgens brukerliste,
 * eksterne (vaktmester, leverandør) skrives inn med navn. Liste nedover, ikke små
 * merker: hvem som deltok er et hovedfelt i dokumentasjonen.
 *
 * Først bygget i «Ny vernerunde», delt her da risikogjennomgangen trengte det samme —
 * en egen kopi ville mistet brukeroppslaget eller driftet i oppførsel.
 */
export function DeltakerVelger({
  orgId,
  deltakere,
  onEndre,
  etikett = "Deltakere",
}: {
  orgId: string;
  deltakere: Array<{ name: string; role: string | null }>;
  onEndre: (d: Array<{ name: string; role: string | null }>) => void;
  etikett?: string;
}) {
  const [folk, setFolk] = useState<Array<{ id: string; name: string }> | null>(null);
  const [eksternNavn, setEksternNavn] = useState("");

  async function hentFolk() {
    if (folk !== null) return;
    try {
      setFolk(await brukere.liste(orgId));
    } catch {
      setFolk([]);
    }
  }

  function leggTil(name: string, role: string | null) {
    if (deltakere.some((d) => d.name === name)) return;
    onEndre([...deltakere, { name, role }]);
  }

  return (
    <div>
      <div className="field-label">{etikett}</div>
      {deltakere.length > 0 && (
        <div style={{ margin: "6px 0 4px" }}>
          {deltakere.map((d) => (
            <div key={d.name} className="list-item" style={{ padding: "7px 0" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="list-tittel">{d.name}</div>
                {d.role && <div className="list-meta">{d.role}</div>}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ color: "var(--muted)", padding: "2px 8px" }}
                aria-label={`Fjern ${d.name}`}
                onClick={() => onEndre(deltakere.filter((x) => x.name !== d.name))}
              >
                Fjern
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px" }}>
        <select
          className="select"
          aria-label="Legg til bruker i organisasjonen"
          value=""
          onFocus={() => void hentFolk()}
          onChange={(e) => {
            const b = folk?.find((f) => f.id === e.target.value);
            if (b) leggTil(b.name, null);
          }}
        >
          <option value="">Velg bruker i organisasjonen …</option>
          {(folk ?? [])
            .filter((f) => !deltakere.some((d) => d.name === f.name))
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </select>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Ekstern deltaker — navn"
            aria-label="Ekstern deltaker, navn"
            value={eksternNavn}
            onChange={(e) => setEksternNavn(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!eksternNavn.trim()}
            onClick={() => {
              leggTil(eksternNavn.trim(), null);
              setEksternNavn("");
            }}
          >
            ＋
          </button>
        </div>
      </div>
    </div>
  );
}
