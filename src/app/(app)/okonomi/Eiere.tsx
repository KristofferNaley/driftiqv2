"use client";

import { useState } from "react";
import { Feil, Kort, Tom, dato, useOrgData } from "@/components/felles";
import { okonomi, type Seksjon } from "@/lib/klient";
import { brokStemmer, brokTekst, kroner } from "@/lib/okonomiregler";
import SeksjonModal from "./SeksjonModal";
import Kpi from "./Kpi";

type Filter = "alle" | "oppfolging";

/**
 * Seksjonsregisteret — «andelsregisteret» for sameiet. Én rad per seksjon; alt om seksjonen
 * (eier, satser, fakturagrunnlag, eierskifte, historikk) ligger i fanemodalen som åpnes
 * ved klikk på raden. Brøken er seksjonens (tinglyst) og redigeres der.
 *
 * Personopplysninger: kun kontoadmin skriver. Lesing for alle med modulen — styret må
 * kunne slå opp hvem som eier seksjon 12.
 */
export default function Eiere({ erAdmin }: { erAdmin: boolean }) {
  const { data, feil, laster, last, orgId } = useOrgData((o) => okonomi.eiere(o));
  const [apen, setApen] = useState<string | null>(null);
  const [sok, setSok] = useState("");
  const [filter, setFilter] = useState<Filter>("alle");

  const brokOk = data ? brokStemmer(data.brokSum) : true;
  const mangler = (s: Seksjon) => !s.eier || s.brokTeller === null || s.satsMnd === null;

  const seksjoner = (data?.seksjoner ?? []).filter((s) => {
    if (filter === "oppfolging" && !mangler(s)) return false;
    const q = sok.trim().toLowerCase();
    if (!q) return true;
    return [s.navn, s.andelsnr, s.oppgang, s.eier?.name, s.eier?.email].some((v) => v?.toLowerCase().includes(q));
  });

  const antallMangler = (data?.seksjoner ?? []).filter(mangler).length;
  const antallEiere = (data?.seksjoner ?? []).filter((s) => s.eier).length;
  const nevner = data?.seksjoner.find((s) => s.brokNevner !== null)?.brokNevner ?? null;

  return (
    <>
      <Feil melding={feil} />

      {data && (
        <div className="ok-kpi-grid">
          <Kpi tone="blaa" etikett="Seksjoner" verdi={String(data.seksjoner.length)} under={`${antallEiere} med eier`} />
          <Kpi tone="blaa" etikett="Eiere" verdi={String(antallEiere)} under={data.utenEier > 0 ? `${data.utenEier} seksjoner uten eier` : "alle seksjoner har eier"} />
          <Kpi
            tone={brokOk && data.utenBrok === 0 ? "gronn" : "gul"}
            etikett="Sameiebrøk"
            verdi={nevner !== null ? nevner.toLocaleString("nb-NO") : "—"}
            under={data.utenBrok > 0 ? `${data.utenBrok} uten brøk` : brokOk ? "nevner · brøkene summerer til 1" : `summerer til ${data.brokSum.toFixed(3)}, skal være 1`}
          />
          <Kpi tone={antallMangler > 0 ? "gul" : "gronn"} etikett="Mangler" verdi={String(antallMangler)} under={antallMangler > 0 ? "uten eier, brøk eller sats" : "alt er på plass"} />
        </div>
      )}

      <Kort
        tittel="Seksjonsregister"
        handling={
          <div className="ok-handlinger">
            <input
              className="input"
              placeholder="Søk seksjon eller eier …"
              aria-label="Søk"
              value={sok}
              onChange={(e) => setSok(e.target.value)}
            />
            <select className="input" aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="alle">Alle</option>
              <option value="oppfolging">Trenger oppfølging</option>
            </select>
          </div>
        }
      >
        {laster || !data ? (
          <Tom tekst="Henter …" />
        ) : data.seksjoner.length === 0 ? (
          <Tom tekst="Ingen seksjoner registrert. Leiligheter legges inn under Innstillinger — eiere og brøk kommer hit." />
        ) : seksjoner.length === 0 ? (
          <Tom tekst="Ingen treff." />
        ) : (
          <>
            <div className="ok-eier-hode" aria-hidden>
              <span>Seksjon</span>
              <span>Eier</span>
              <span className="ok-eier-fra">Eier fra</span>
              <span className="ok-eier-bra">BRA m²</span>
              <span className="ok-eier-brok">Brøk</span>
              <span className="ok-belop-celle ok-eier-sats">Felleskost/mnd</span>
              <span>Status</span>
              <span />
            </div>
            {seksjoner.map((s) => (
              <div
                key={s.unitId}
                className="ok-eier-rad klikkbar"
                role="button"
                tabIndex={0}
                onClick={() => setApen(s.unitId)}
                onKeyDown={(e) => e.key === "Enter" && setApen(s.unitId)}
              >
                <div style={{ minWidth: 0 }}>
                  <div className="list-tittel">{s.navn}</div>
                  {(s.oppgang || s.andelsnr) && (
                    <div className="list-meta">
                      {[s.oppgang && `oppg. ${s.oppgang}`, s.andelsnr && `seksjon ${s.andelsnr}`].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  {s.eier ? (
                    <>
                      <div className="list-tittel">{s.eier.name}</div>
                      <div className="list-meta">{[s.eier.email, s.eier.phone].filter(Boolean).join(" · ") || "ingen kontaktinfo"}</div>
                    </>
                  ) : (
                    <span className="list-meta">Ingen eier registrert</span>
                  )}
                </div>
                <span className="ok-eier-fra list-meta">{s.eier ? dato(s.eier.ownerFrom) : "—"}</span>
                <span className="ok-eier-bra list-meta">{s.arealM2 ? Number(s.arealM2).toLocaleString("nb-NO") : "—"}</span>
                <span className="ok-eier-brok list-meta">{brokTekst({ teller: s.brokTeller, nevner: s.brokNevner })}</span>
                <span className="ok-belop-celle ok-eier-sats">{s.satsMnd !== null ? kroner(s.satsMnd) : <span className="list-meta">—</span>}</span>
                <span>
                  {!s.eier ? (
                    <span className="badge warn">Ingen eier</span>
                  ) : s.brokTeller === null ? (
                    <span className="badge warn">Uten brøk</span>
                  ) : s.satsMnd === null ? (
                    <span className="badge warn">Uten sats</span>
                  ) : (
                    <span className="badge ok">À jour</span>
                  )}
                </span>
                <span className="ok-pil" aria-hidden>
                  ›
                </span>
              </div>
            ))}
            <div className="ok-eier-rad ok-eier-sum" aria-label="Sum">
              <span className="list-tittel">{seksjoner.length} seksjoner</span>
              <span />
              <span className="ok-eier-fra" />
              <span className="ok-eier-bra list-meta">
                {seksjoner.some((s) => s.arealM2) ? seksjoner.reduce((sum, s) => sum + Number(s.arealM2 ?? 0), 0).toLocaleString("nb-NO") : ""}
              </span>
              <span className={`ok-eier-brok${brokOk ? "" : " ok-mangler"}`}>{data.brokSum.toFixed(3)}</span>
              <span className="ok-belop-celle ok-eier-sats">{kroner(data.satsSumMnd)}</span>
              <span />
              <span />
            </div>
          </>
        )}
        <p className="ok-tekst" style={{ borderTop: "1px solid var(--border)" }}>
          Klikk på en seksjon for eier, fakturagrunnlag, eierskifte og historikk. Eieropplysningene behandles etter
          databehandleravtalen med sameiet; hele overtakelsesmåneden faktureres den som eide seksjonen den 1.
        </p>
      </Kort>

      {apen && orgId && (
        <SeksjonModal orgId={orgId} unitId={apen} erAdmin={erAdmin} onLukk={() => setApen(null)} onEndret={last} />
      )}
    </>
  );
}
