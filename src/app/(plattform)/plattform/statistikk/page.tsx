"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/klient";
import { kroner } from "@/lib/prisregler";
import { Ramme } from "../ramme";

/**
 * Bruken på tvers av alle kunder.
 *
 * Poenget er å se hvem som faktisk BRUKER systemet, ikke bare hvem som betaler for det. En
 * kunde med abonnement og null utkvitteringer er en oppsigelse som ikke har skjedd ennå.
 */

type Rad = {
  id: string;
  navn: string;
  aktiv: boolean;
  antallAndeler: number | null;
  antallOppgaver: number;
  antallApneAvvik: number;
  antallUtkvitteringer: number;
  arssum: number | null;
};

type Sortering = "navn" | "andeler" | "oppgaver" | "avvik" | "utkvitteringer" | "arssum";

export default function Statistikk() {
  const [rader, setRader] = useState<Rad[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [sorter, setSorter] = useState<Sortering>("navn");

  useEffect(() => {
    api
      .hent<Rad[]>("/plattform/statistikk")
      .then(setRader)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente statistikken"));
  }, []);

  const sortert = useMemo(() => {
    if (!rader) return null;
    const tall = (r: Rad) =>
      sorter === "andeler"
        ? (r.antallAndeler ?? 0)
        : sorter === "oppgaver"
          ? r.antallOppgaver
          : sorter === "avvik"
            ? r.antallApneAvvik
            : sorter === "utkvitteringer"
              ? r.antallUtkvitteringer
              : (r.arssum ?? 0);
    // Navn stigende, tall synkende — man leter etter de største, ikke de minste.
    return [...rader].sort((a, b) =>
      sorter === "navn" ? a.navn.localeCompare(b.navn, "nb") : tall(b) - tall(a),
    );
  }, [rader, sorter]);

  const sum = useMemo(() => {
    if (!rader) return null;
    return {
      kunder: rader.filter((r) => r.aktiv).length,
      andeler: rader.reduce((n, r) => n + (r.antallAndeler ?? 0), 0),
      avvik: rader.reduce((n, r) => n + r.antallApneAvvik, 0),
      arssum: rader.reduce((n, r) => n + (r.arssum ?? 0), 0),
    };
  }, [rader]);

  const KOLONNER: Array<{ nokkel: Sortering; etikett: string }> = [
    { nokkel: "navn", etikett: "Kunde" },
    { nokkel: "andeler", etikett: "Andeler" },
    { nokkel: "oppgaver", etikett: "Oppgaver" },
    { nokkel: "avvik", etikett: "Åpne avvik" },
    { nokkel: "utkvitteringer", etikett: "Utkvitteringer" },
    { nokkel: "arssum", etikett: "Årssum" },
  ];

  return (
    <Ramme tittel="Statistikk">
      {feil && <div className="feilmelding">{feil}</div>}

      {sum && (
        <div className="pf-grid">
          <Tall etikett="Aktive kunder" verdi={String(sum.kunder)} />
          <Tall etikett="Andeler totalt" verdi={sum.andeler.toLocaleString("nb-NO")} />
          <Tall etikett="Åpne avvik" verdi={String(sum.avvik)} />
          <Tall etikett="Årlig omsetning" verdi={kroner(sum.arssum)} />
        </div>
      )}

      <div className="pf-kort">
        <div className="pf-kort-hode">
          <span>Per kunde</span>
        </div>
        {!sortert ? (
          <p className="pf-dempet" style={{ padding: "16px" }}>
            Henter …
          </p>
        ) : (
          <>
            <div className="pf-stat-rad hode">
              {KOLONNER.map((k) => (
                <button
                  key={k.nokkel}
                  className={`pf-sorter${sorter === k.nokkel ? " valgt" : ""}`}
                  onClick={() => setSorter(k.nokkel)}
                >
                  {k.etikett}
                </button>
              ))}
            </div>
            {sortert.map((r) => (
              <div key={r.id} className="pf-stat-rad">
                <Link href={`/plattform/kunder/${r.id}`} className="pf-navn-lenke">
                  {r.navn}
                  {!r.aktiv && <span className="pf-merkelapp utgatt"> Inaktiv</span>}
                </Link>
                <span className="pf-tall">{r.antallAndeler ?? "—"}</span>
                <span className="pf-tall">{r.antallOppgaver}</span>
                <span className="pf-tall">{r.antallApneAvvik}</span>
                {/* Null utkvitteringer på en kunde med oppgaver: systemet står ubrukt. */}
                <span
                  className={`pf-tall${r.antallUtkvitteringer === 0 && r.antallOppgaver > 0 ? " advarsel" : ""}`}
                >
                  {r.antallUtkvitteringer}
                </span>
                <span className="pf-tall">{r.arssum === null ? "—" : kroner(r.arssum)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </Ramme>
  );
}

function Tall({ etikett, verdi }: { etikett: string; verdi: string }) {
  return (
    <div className="pf-kort">
      <div className="pf-kort-kropp">
        <span className="pf-snarvei-tittel">{etikett}</span>
        <div className="pf-snarvei-tall">{verdi}</div>
      </div>
    </div>
  );
}
