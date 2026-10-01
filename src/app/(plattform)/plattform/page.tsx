"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/klient";
import { sidenSistTekst, tidspunkt, type IDagPunkt, type SidenSist } from "@/lib/idag";
import { Ramme } from "./ramme";

/**
 * «I dag» — forsiden i panelet, en arbeidsliste (01.10.2026, erstatter Dashboard).
 *
 * Siden skal virke uansett hvor lenge siden du var innom: «Krever handling» er tilstanden NÅ
 * (reglene i `lib/idag.ts`), og «Siden sist» regnes fra forrige innlogging, ikke fra i går.
 * Nøkkeltallene som sto her, er flyttet til Statistikk.
 */
export default function IDag() {
  const [data, setData] = useState<{ punkter: IDagPunkt[]; sidenSist: SidenSist } | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    api
      .hent<{ punkter: IDagPunkt[]; sidenSist: SidenSist }>("/plattform/idag")
      .then(setData)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente arbeidslista"));
  }, []);

  return (
    <Ramme tittel="I dag">
      {feil && <div className="feilmelding">{feil}</div>}
      {!data ? (
        !feil && <p className="pf-dempet">Henter …</p>
      ) : (
        <>
          <KreverHandling punkter={data.punkter} />
          <div className="pf-kort">
            <div className="pf-kort-kropp pf-idag-siden">
              <b>
                Siden sist du var her
                {data.sidenSist.fra ? ` (${tidspunkt(new Date(data.sidenSist.fra))})` : " (siste 90 dager)"}:
              </b>{" "}
              <span className="pf-dempet">{sidenSistTekst(data.sidenSist)}</span>
            </div>
          </div>
        </>
      )}
    </Ramme>
  );
}

function KreverHandling({ punkter }: { punkter: IDagPunkt[] }) {
  if (punkter.length === 0) {
    return (
      <div className="pf-kort">
        <div className="pf-kort-hode"><span>Krever handling</span></div>
        <div className="pf-kort-kropp">
          <p className="pf-dempet">Alt er i orden.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="pf-kort pf-handling-kort">
      <div className="pf-kort-hode">
        <span>Krever handling</span>
        <span className="pf-under">
          {punkter.length} {punkter.length === 1 ? "punkt" : "punkter"}
        </span>
      </div>
      {punkter.map((p) => (
        <div key={p.nokkel} className="pf-handling">
          <span className={`pf-handling-prikk ${p.nivaa}`} aria-hidden>
            !
          </span>
          <div style={{ minWidth: 0 }}>
            <b>{p.tittel}</b>
            <div className="pf-dempet">{p.forklaring}</div>
          </div>
          <div className="pf-handling-kontroll">
            <Link href={p.knapp.href} className="btn btn-ghost">
              {p.knapp.etikett}
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
