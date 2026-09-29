"use client";

import { useState, type ReactNode } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Feil, Kort, Rad, Tom, dato, siden, useOrgData } from "@/components/felles";
import { bir, type BirTreff } from "@/lib/klient";

/**
 * Tømmedager fra BIR (docs/bir.md). Egen fil fordi integrasjonen er en fjernbar pakke —
 * tas den ut, forsvinner kortet og én linje i siden.
 *
 * Styret VELGER oppføringen: borettslag med fellesløsning er en egen oppføring hos BIR
 * («Borettslaget Håsteinsgate 9»), og en adresse i laget kan gi en annen henteordning.
 */
export function BirKort({
  erAdmin,
  onEndret,
  topp,
}: {
  erAdmin: boolean;
  onEndret: () => void;
  /** Plasseringslinja — vises bare når borettslaget er koblet (ellers er det ingenting å plassere). */
  topp?: ReactNode;
}) {
  const { data: status, setData, feil, setFeil, orgId } = useOrgData((o) => bir.status(o));
  const [q, setQ] = useState("");
  const [treff, setTreff] = useState<BirTreff[] | null>(null);
  const [jobber, setJobber] = useState(false);

  async function utfor<T>(handling: () => Promise<T>, etter?: (v: T) => void) {
    setJobber(true);
    setFeil(null);
    try {
      const v = await handling();
      etter?.(v);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Noe gikk galt");
    } finally {
      setJobber(false);
    }
  }

  const ferdig = (s: Awaited<ReturnType<typeof bir.status>>) => {
    setData(s);
    setTreff(null);
    onEndret();
  };

  return (
    <Kort
      tittel="Tømmedager fra BIR"
      handling={
        status &&
        erAdmin &&
        orgId && (
          <button className="btn btn-ghost btn-sm" disabled={jobber} onClick={() => void utfor(() => bir.hentNaa(orgId), ferdig)}>
            <RefreshCw size={14} aria-hidden /> Hent nå
          </button>
        )
      }
    >
      <Feil melding={feil} />
      {status ? (
        <>
          {topp}
          <div className="card-body" style={{ paddingBottom: 0 }}>
            <div className="list-tittel">{status.navn}</div>
            <div className="field-note">
              {[status.eiendom && `Eiendom ${status.eiendom}`, `Hentet ${siden(status.sistHentet, "aldri")}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {status.feil && (
              <div className="feilmelding" style={{ marginTop: "8px" }}>
                Siste henting feilet: {status.feil}. Skjermen viser datoene fra forrige vellykkede henting.
              </div>
            )}
          </div>
          {status.datoer.length === 0 && <Tom tekst="Ingen kommende tømmedager fra BIR." />}
          {/* Neste dato per fraksjon, med antallet bak — hele lista ble en vegg av rader. */}
          {nestePerFraksjon(status.datoer).map((d) => (
            <Rad
              key={d.fraksjon}
              tittel={d.etikett}
              meta={`Neste ${dato(d.dato)}${d.flere > 0 ? ` · ${d.flere} til hentet` : ""}`}
            />
          ))}
          <div className="card-body" style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
            <span className="field-note">
              Hentes hver natt. Slå på «Tømmedager» under hver skjerm for å vise dem.
            </span>
            {erAdmin && orgId && (
              <button
                className="btn btn-ghost btn-sm"
                disabled={jobber}
                onClick={() =>
                  window.confirm("Koble fra BIR? Tømmedagene forsvinner fra skjermene.") &&
                  void utfor(() => bir.kobleFra(orgId), () => ferdig(null))
                }
              >
                Koble fra
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="card-body">
          <div className="field-note" style={{ marginBottom: "10px" }}>
            For borettslag og sameier i BIR-kommunene. Søk på navnet til borettslaget slik BIR har det
            registrert (for eksempel «Borettslaget Håsteinsgate 9») — ikke bare adressen.
          </div>
          {erAdmin && orgId ? (
            <form
              style={{ display: "flex", gap: "8px" }}
              onSubmit={(e) => {
                e.preventDefault();
                void utfor(() => bir.sok(orgId, q), setTreff);
              }}
            >
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Borettslaget …" />
              <button type="submit" className="btn btn-primary" disabled={jobber || q.trim().length < 3}>
                <Search size={14} aria-hidden /> Søk
              </button>
            </form>
          ) : (
            <div className="field-note">Bare orgadmin kan koble til BIR.</div>
          )}
        </div>
      )}
      {treff && treff.length === 0 && <Tom tekst="Ingen treff hos BIR. Prøv navnet på borettslaget." />}
      {treff?.map((t) => (
        <Rad
          key={t.id}
          tittel={t.navn}
          meta={[t.sted, t.eiendom && `Eiendom ${t.eiendom}`].filter(Boolean).join(" · ")}
          hoyre={
            orgId && (
              <button className="btn btn-primary btn-sm" disabled={jobber} onClick={() => void utfor(() => bir.koble(orgId, t), ferdig)}>
                Velg
              </button>
            )
          }
        />
      ))}
    </Kort>
  );
}

function nestePerFraksjon(datoer: NonNullable<Awaited<ReturnType<typeof bir.status>>>["datoer"]) {
  const ut = new Map<string, { fraksjon: string; etikett: string; dato: string; flere: number }>();
  for (const d of datoer) {
    const f = ut.get(d.fraksjon);
    if (f) f.flere++;
    else ut.set(d.fraksjon, { ...d, flere: 0 });
  }
  return [...ut.values()];
}
