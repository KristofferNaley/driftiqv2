"use client";

import { useState, type ReactNode } from "react";
import { api } from "@/lib/klient";
import { ER_EPOST, type HandlingPunkt } from "@/lib/kundehandlinger";
import type { Fane } from "./deler";

/**
 * «Krever handling» — øverst på Oversikt, og bare når det finnes punkter. Regelsettet er
 * `kreverHandling()` i `lib/kundehandlinger.ts`; her er bare visningen og knappene.
 */
export function KreverHandling({
  orgId,
  punkter,
  onEndret,
  onGaTil,
  onRediger,
  onUkjentKode,
}: {
  orgId: string;
  punkter: HandlingPunkt[];
  onEndret: () => Promise<void>;
  onGaTil: (f: Fane) => void;
  onRediger: () => void;
  onUkjentKode: (kode: string | null) => void;
}) {
  if (punkter.length === 0) return null;
  return (
    <div className="pf-kort pf-handling-kort">
      <div className="pf-kort-hode">
        <span>Krever handling</span>
        <span className="pf-under">
          {punkter.length} {punkter.length === 1 ? "punkt" : "punkter"}
        </span>
      </div>
      {punkter.map((p) => (
        <Punkt
          key={p.nokkel}
          orgId={orgId}
          punkt={p}
          onEndret={onEndret}
          onGaTil={onGaTil}
          onRediger={onRediger}
          onUkjentKode={onUkjentKode}
        />
      ))}
    </div>
  );
}

function Punkt({
  orgId,
  punkt,
  onEndret,
  onGaTil,
  onRediger,
  onUkjentKode,
}: {
  orgId: string;
  punkt: HandlingPunkt;
  onEndret: () => Promise<void>;
  onGaTil: (f: Fane) => void;
  onRediger: () => void;
  onUkjentKode: (kode: string | null) => void;
}) {
  const [verdi, setVerdi] = useState("");
  const [jobber, setJobber] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const h = punkt.handling;

  async function kjor(fn: () => Promise<void>) {
    setJobber(true);
    setFeil(null);
    setMelding(null);
    try {
      await fn();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Noe gikk galt");
    } finally {
      setJobber(false);
    }
  }

  let kontroll: ReactNode = null;
  if (h.type === "epost") {
    kontroll = (
      <form
        className="pf-handling-fiks"
        onSubmit={(e) => {
          e.preventDefault();
          const epost = verdi.trim();
          if (!ER_EPOST.test(epost)) {
            setFeil("Skriv en gyldig e-postadresse");
            return;
          }
          void kjor(async () => {
            await api.endre(`/plattform/kunder/${orgId}`, { contactEmail: epost });
            await onEndret();
          });
        }}
      >
        <input
          className="input"
          type="email"
          placeholder="post@borettslaget.no"
          aria-label="Kundens e-post"
          value={verdi}
          onChange={(e) => setVerdi(e.target.value)}
        />
        <button className="btn btn-primary" disabled={jobber || !verdi.trim()}>
          Lagre
        </button>
      </form>
    );
  } else if (h.type === "orgnr") {
    kontroll = (
      <form
        className="pf-handling-fiks"
        onSubmit={(e) => {
          e.preventDefault();
          const orgNr = verdi.replace(/\s/g, "");
          if (!/^\d{9}$/.test(orgNr)) {
            setFeil("Org.nr har 9 siffer");
            return;
          }
          void kjor(async () => {
            const svar = await api.send<{ ukjentBrregKode?: string | null }>(
              `/plattform/kunder/${orgId}/brreg`,
              { orgNr },
            );
            onUkjentKode(svar.ukjentBrregKode ?? null);
            await onEndret();
          });
        }}
      >
        <input
          className="input"
          inputMode="numeric"
          placeholder="9 siffer"
          aria-label="Org.nr"
          value={verdi}
          onChange={(e) => setVerdi(e.target.value)}
        />
        <button className="btn btn-ghost" disabled={jobber || !verdi.trim()}>
          Slå opp
        </button>
      </form>
    );
  } else if (h.type === "selskapsform") {
    kontroll = (
      <button className="btn btn-ghost" onClick={onRediger}>
        Velg selskapsform
      </button>
    );
  } else if (h.type === "paaminnelse") {
    kontroll = (
      <button
        className="btn btn-ghost"
        disabled={jobber || melding !== null}
        onClick={() =>
          void kjor(async () => {
            const svar = await api.send<{ mottakere: number }>(
              `/plattform/kunder/${orgId}/paaminnelse`,
              { punkt: h.punkt },
            );
            setMelding(
              `Sendt til ${svar.mottakere} ${svar.mottakere === 1 ? "orgadmin" : "orgadmins"}`,
            );
          })
        }
      >
        {h.etikett}
      </button>
    );
  } else if (h.type === "fane") {
    kontroll = (
      <button className="btn btn-ghost" onClick={() => onGaTil(h.fane)}>
        {h.etikett}
      </button>
    );
  } else if (h.type === "rediger") {
    kontroll = (
      <button className="btn btn-ghost" onClick={onRediger}>
        {h.etikett}
      </button>
    );
  }

  return (
    <div className="pf-handling">
      <span className={`pf-handling-prikk ${punkt.nivaa}`} aria-hidden>
        !
      </span>
      <div style={{ minWidth: 0 }}>
        <span className="pf-navn">{punkt.tittel}</span>
        <span className="pf-under">{punkt.konsekvens}</span>
        {feil && <span className="pf-handling-feil">{feil}</span>}
        {melding && <span className="pf-handling-ok">{melding}</span>}
      </div>
      <div className="pf-handling-kontroll">{kontroll}</div>
    </div>
  );
}
