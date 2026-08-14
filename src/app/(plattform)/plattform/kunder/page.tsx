"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/klient";
import { Ramme } from "../ramme";

/**
 * Kundelista — etter `mockups/kundeliste-v3-mockup.html`.
 *
 * Alt over tabellen svarer på «hvem trenger meg nå»: KPI-ene, og oppfølgingskortet med
 * grunnene (rabatt som utløper, onboarding som står, kunder som ikke logger inn). Tallene
 * er kundeforhold, aldri innhold — grunnene regnes server-side i `hentKunder`.
 *
 * Sortering, søk, chips og gruppering skjer i klienten: lista er kort (titalls kunder),
 * og en rundtur per tastetrykk ville gjort søket tregere enn å la være.
 */

type Kunde = {
  id: string;
  navn: string;
  orgNr: string | null;
  orgForm: string | null;
  kommune: string | null;
  andeler: number | null;
  aktiv: boolean;
  opprettet: string;
  antallBrukere: number;
  harAktivSupport: boolean;
  antallModuler: number;
  totaltModuler: number;
  onboarding: number;
  prisAar: number | null;
  prisNotat: string | null;
  sistAktiv: string | null;
  status: "Aktiv" | "Pilot" | "Onboarding" | "Inaktiv";
  oppfolging: string[];
};

const STATUSMERKE: Record<Kunde["status"], string> = {
  Aktiv: "ok",
  Pilot: "info",
  Onboarding: "warn",
  Inaktiv: "danger",
};

type Sortnokkel = "navn" | "orgForm" | "andeler" | "antallModuler" | "onboarding" | "prisAar" | "sistAktiv" | "status";

const kr = (n: number | null) => (n === null ? "—" : n === 0 ? "0" : n.toLocaleString("nb-NO"));

function sidenAktiv(iso: string | null): string {
  if (!iso) return "Aldri";
  const dager = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return dager <= 0 ? "I dag" : dager === 1 ? "I går" : `${dager} dager siden`;
}

export default function Kunder() {
  const router = useRouter();
  const [kunder, setKunder] = useState<Kunde[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [sok, setSok] = useState("");
  const [filter, setFilter] = useState<"alle" | Kunde["status"]>("alle");
  const [gruppering, setGruppering] = useState<"" | "status" | "orgForm">("");
  const [sortNokkel, setSortNokkel] = useState<Sortnokkel>("navn");
  const [sortRetning, setSortRetning] = useState(1);

  useEffect(() => {
    api
      .hent<Kunde[]>("/plattform/kunder")
      .then(setKunder)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente kundene"));
  }, []);

  const alle = useMemo(() => kunder ?? [], [kunder]);
  const trengerOppfolging = alle.filter((k) => k.oppfolging.length > 0);

  const synlige = useMemo(() => {
    let r = alle.filter((k) => filter === "alle" || k.status === filter);
    if (sok.trim()) {
      const q = sok.trim().toLowerCase();
      r = r.filter((k) =>
        `${k.navn} ${k.kommune ?? ""} ${k.orgNr ?? ""} ${k.orgForm ?? ""}`.toLowerCase().includes(q),
      );
    }
    return [...r].sort((a, b) => {
      const A = a[sortNokkel];
      const B = b[sortNokkel];
      if (A === null && B === null) return 0;
      if (A === null) return 1;
      if (B === null) return -1;
      if (typeof A === "number" && typeof B === "number") return (A - B) * sortRetning;
      return String(A).localeCompare(String(B), "nb") * sortRetning;
    });
  }, [alle, filter, sok, sortNokkel, sortRetning]);

  // Gruppene beholder sorteringen internt — grupperingen er bare skillelinjer.
  const grupper = useMemo(() => {
    if (!gruppering) return [["", synlige]] as Array<[string, Kunde[]]>;
    const kart = new Map<string, Kunde[]>();
    for (const k of synlige) {
      const nokkel = (gruppering === "status" ? k.status : (k.orgForm ?? "Uten selskapsform")) as string;
      if (!kart.has(nokkel)) kart.set(nokkel, []);
      kart.get(nokkel)!.push(k);
    }
    return [...kart.entries()].sort((a, b) => a[0].localeCompare(b[0], "nb"));
  }, [synlige, gruppering]);

  function sorterPaa(nokkel: Sortnokkel) {
    if (sortNokkel === nokkel) setSortRetning((r) => -r);
    else {
      setSortNokkel(nokkel);
      setSortRetning(1);
    }
  }

  const pil = (nokkel: Sortnokkel) => (sortNokkel === nokkel ? (sortRetning === 1 ? " ↑" : " ↓") : "");

  const aktive = alle.filter((k) => k.status === "Aktiv" || k.status === "Pilot").length;
  const nyeSiste90 = alle.filter((k) => Date.now() - new Date(k.opprettet).getTime() < 90 * 86_400_000).length;
  const inntekt = alle.reduce((n, k) => n + (k.prisAar ?? 0), 0);
  const onboardingKunder = alle.filter((k) => k.status === "Onboarding");
  const snittOnboarding = onboardingKunder.length
    ? Math.round(onboardingKunder.reduce((n, k) => n + k.onboarding, 0) / onboardingKunder.length)
    : 0;

  const antall = (s: Kunde["status"] | "alle") =>
    s === "alle" ? alle.length : alle.filter((k) => k.status === s).length;

  return (
    <Ramme tittel="Kunder">
      {feil && <div className="feilmelding">{feil}</div>}
      {!kunder ? (
        <p className="pf-dempet">Henter …</p>
      ) : (
        <>
          <div className="pf-kpi-grid">
            <div className="pf-kpi">
              <div className="pf-kpi-etikett">Aktive kunder</div>
              <div className="pf-kpi-verdi">{aktive}</div>
              <div className="pf-dempet">{nyeSiste90} nye siste 90 dager</div>
            </div>
            <div className="pf-kpi">
              <div className="pf-kpi-etikett">Årlig inntekt</div>
              <div className="pf-kpi-verdi">{kr(inntekt)} kr</div>
              <div className="pf-dempet">etter rabatter</div>
            </div>
            <div className="pf-kpi">
              <div className="pf-kpi-etikett">Under onboarding</div>
              <div className="pf-kpi-verdi">{onboardingKunder.length}</div>
              <div className="pf-dempet">
                {onboardingKunder.length > 0 ? `snitt ${snittOnboarding} % fullført` : "alle er i gang"}
              </div>
            </div>
            <div className={`pf-kpi${trengerOppfolging.length > 0 ? " pf-kpi-varsel" : ""}`}>
              <div className="pf-kpi-etikett">Trenger oppfølging</div>
              <div className="pf-kpi-verdi">{trengerOppfolging.length}</div>
              <div className="pf-dempet">{trengerOppfolging.length > 0 ? "se lista under" : "ingenting venter"}</div>
            </div>
          </div>

          {trengerOppfolging.length > 0 && (
            <div className="pf-kort">
              <div className="pf-kort-hode">
                <span>Trenger oppfølging</span>
              </div>
              {trengerOppfolging.map((k) => (
                <button key={k.id} className="pf-oppfolging" onClick={() => router.push(`/plattform/kunder/${k.id}`)}>
                  <span className="pf-oppfolging-prikk" aria-hidden />
                  <span style={{ minWidth: 0 }}>
                    <span className="pf-navn">{k.navn}</span>
                    <span className="pf-under">{k.oppfolging.join(" ")}</span>
                  </span>
                  <span className="pf-lenke-inline">Åpne kunde ›</span>
                </button>
              ))}
            </div>
          )}

          <div className="pf-verktoylinje">
            <input
              className="input pf-sok"
              placeholder="Søk på navn, kommune eller org.nr"
              aria-label="Søk i kundelista"
              value={sok}
              onChange={(e) => setSok(e.target.value)}
            />
            {(["alle", "Aktiv", "Pilot", "Onboarding", "Inaktiv"] as const).map((s) => (
              <button
                key={s}
                className={`pf-chip${filter === s ? " valgt" : ""}`}
                onClick={() => setFilter(s)}
              >
                {s === "alle" ? "Alle" : s === "Aktiv" ? "Aktive" : s === "Inaktiv" ? "Inaktive" : s}{" "}
                <span className="pf-dempet">{antall(s)}</span>
              </button>
            ))}
            <select
              className="select"
              style={{ marginLeft: "auto", width: "auto" }}
              aria-label="Gruppering"
              value={gruppering}
              onChange={(e) => setGruppering(e.target.value as typeof gruppering)}
            >
              <option value="">Ingen gruppering</option>
              <option value="status">Grupper etter status</option>
              <option value="orgForm">Grupper etter selskapsform</option>
            </select>
          </div>

          <div className="pf-kort" style={{ overflowX: "auto" }}>
            <div className="pf-kunderad hode">
              <button className="pf-sorter" onClick={() => sorterPaa("navn")}>Kunde{pil("navn")}</button>
              <button className="pf-sorter" onClick={() => sorterPaa("orgForm")}>Form{pil("orgForm")}</button>
              <button className="pf-sorter" onClick={() => sorterPaa("andeler")}>Andeler{pil("andeler")}</button>
              <button className="pf-sorter" onClick={() => sorterPaa("antallModuler")}>Moduler{pil("antallModuler")}</button>
              <button className="pf-sorter" onClick={() => sorterPaa("onboarding")}>Onboarding{pil("onboarding")}</button>
              <button className="pf-sorter" onClick={() => sorterPaa("prisAar")}>Pris/år{pil("prisAar")}</button>
              <button className="pf-sorter" onClick={() => sorterPaa("sistAktiv")}>Sist aktiv{pil("sistAktiv")}</button>
              <button className="pf-sorter" onClick={() => sorterPaa("status")}>Status{pil("status")}</button>
            </div>

            {synlige.length === 0 ? (
              <p className="pf-dempet" style={{ padding: "28px 18px", textAlign: "center" }}>
                Ingen kunder passer søket. Prøv et annet navn, eller fjern filteret.
              </p>
            ) : (
              grupper.map(([navn, rader]) => (
                <div key={navn || "alle"}>
                  {navn && (
                    <div className="pf-kunderad gruppe">
                      <span style={{ gridColumn: "1 / -1" }}>
                        {navn.toUpperCase()} · {rader.length}
                      </span>
                    </div>
                  )}
                  {rader.map((k) => (
                    <button key={k.id} className="pf-kunderad" onClick={() => router.push(`/plattform/kunder/${k.id}`)}>
                      <span style={{ minWidth: 0, textAlign: "left" }}>
                        <span className="pf-navn">{k.navn}</span>
                        <span className="pf-under">
                          {k.orgNr ?? "Uten org.nr."} · {k.kommune ?? "—"}
                          {k.harAktivSupport && <span className="badge warn" style={{ marginLeft: "6px" }}>Support aktiv</span>}
                        </span>
                      </span>
                      <span className="pf-celle">{k.orgForm ?? "—"}</span>
                      <span className="pf-celle tall">{k.andeler ?? "—"}</span>
                      <span className="pf-celle tall">{k.antallModuler}/{k.totaltModuler}</span>
                      <span className="pf-prog">
                        <span className="pf-stolpe" style={{ flex: 1, marginBottom: 0 }}>
                          <span
                            className="pf-stolpe-fyll"
                            style={{
                              display: "block",
                              width: `${k.onboarding}%`,
                              background: k.onboarding === 100 ? "var(--ok)" : k.onboarding < 60 ? "var(--warn)" : "var(--accent)",
                            }}
                          />
                        </span>
                        <span className="pf-celle tall">{k.onboarding}%</span>
                      </span>
                      <span className="pf-celle tall">
                        {kr(k.prisAar)}
                        {k.prisNotat && <span className="pf-under">{k.prisNotat}</span>}
                      </span>
                      <span className="pf-celle">{sidenAktiv(k.sistAktiv)}</span>
                      <span>
                        <span className={`badge ${STATUSMERKE[k.status]}`}>{k.status}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}

            <div className="pf-listefot">
              Viser {synlige.length} av {alle.length} kunder
            </div>
          </div>
        </>
      )}
    </Ramme>
  );
}
