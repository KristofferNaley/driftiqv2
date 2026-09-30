"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Koblingsskjerm, Tavleskjerm } from "@/components/Tavleskjerm";
import { ApiKlientFeil, skjermklient } from "@/lib/klient";
import { HENT_SEKUNDER, type Skjerminnhold } from "@/lib/oppslagstavleregler";

/**
 * Oppslagstavla slik den henger på veggen. **Ingen innlogging** — åpnes i fullskjerm i
 * nettleseren på skjermen (Samsung URL Launcher, en Android-boks, en Raspberry Pi i kiosk).
 *
 * Tilstanden bor i skjermens `localStorage`, som er denne enhetens egen: tokenet (det er
 * tilgangen) og siste innhold, så en skjerm som starter uten nett etter et strømbrudd viser
 * oppslagene i stedet for en blank flate. Det er ikke appens regel om org-valget — dette er
 * en annen enhet med én jobb.
 *
 * Utenfor `(app)` av samme grunn som QR-sidene: ingen sidemeny, ingen `OktProvider`.
 */
const TOKEN = "driftiqSkjermToken";
const SISTE = "driftiqSkjermSiste";
/** En skjerm står på i månedsvis. Last siden på nytt av og til, så ny kode kommer ut. */
const LAST_PAA_NYTT_TIMER = 12;

export default function Skjermside() {
  const [montert, setMontert] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  // localStorage kan ikke leses i en useState-initialverdi (hydreringsfeil) — les etter montering.
  useEffect(() => {
    setToken(les(TOKEN));
    setMontert(true);
    const t = setTimeout(() => window.location.reload(), LAST_PAA_NYTT_TIMER * 3_600_000);
    return () => clearTimeout(t);
  }, []);

  if (!montert) return <div className="ot-vegg" />;
  return (
    <div className="ot-vegg" style={{ cursor: "none" }}>
      {token ? (
        <Koblet
          token={token}
          onFrakoblet={() => {
            fjern(TOKEN);
            fjern(SISTE);
            setToken(null);
          }}
        />
      ) : (
        <Kobling
          onKoblet={(t) => {
            skriv(TOKEN, t);
            setToken(t);
          }}
        />
      )}
    </div>
  );
}

function Kobling({ onKoblet }: { onKoblet: (token: string) => void }) {
  const [kobling, setKobling] = useState<{ kode: string; hemmelighet: string; utloper: string } | null>(null);
  const [runde, setRunde] = useState(0);

  useEffect(() => {
    let avbrutt = false;
    skjermklient
      .startKobling()
      .then((k) => !avbrutt && setKobling(k))
      // Uten nett: prøv igjen om litt. Skjermen har ingen å spørre.
      .catch(() => setTimeout(() => !avbrutt && setRunde((r) => r + 1), 10_000));
    return () => {
      avbrutt = true;
    };
  }, [runde]);

  useEffect(() => {
    if (!kobling) return;
    const t = window.setInterval(async () => {
      try {
        const svar = await skjermklient.koblingsstatus(kobling.hemmelighet);
        if (svar.status === "koblet") onKoblet(svar.token);
        else if (svar.status === "utlopt" || new Date(kobling.utloper) < new Date()) setRunde((r) => r + 1);
      } catch {
        // Nettbrudd underveis — neste runde prøver igjen.
      }
    }, 3000);
    return () => window.clearInterval(t);
  }, [kobling, onKoblet]);

  return <Koblingsskjerm kode={kobling?.kode ?? null} gyldigTil={kobling?.utloper ?? null} />;
}

function Koblet({ token, onFrakoblet }: { token: string; onFrakoblet: () => void }) {
  const [innhold, setInnhold] = useState<Skjerminnhold | null>(() => null);
  const [utenNett, setUtenNett] = useState(false);
  const [bilder, setBilder] = useState<Record<string, string>>({});
  const [logo, setLogo] = useState<string | null>(null);
  const bilderRef = useRef(bilder);
  bilderRef.current = bilder;

  const hent = useCallback(async () => {
    try {
      const nytt = await skjermklient.innhold(token);
      setInnhold(nytt);
      setUtenNett(false);
      skriv(SISTE, JSON.stringify(nytt));
    } catch (e) {
      if (e instanceof ApiKlientFeil && e.status === 401) return onFrakoblet();
      setUtenNett(true);
    }
  }, [token, onFrakoblet]);

  useEffect(() => {
    const lagret = les(SISTE);
    if (lagret) {
      try {
        setInnhold(JSON.parse(lagret) as Skjerminnhold);
      } catch {
        fjern(SISTE);
      }
    }
    void hent();
    const t = window.setInterval(() => void hent(), HENT_SEKUNDER * 1000);
    return () => window.clearInterval(t);
  }, [hent]);

  // Bildene hentes med tokenet og holdes som blob-URL-er — de overlever et nettbrudd så
  // lenge siden står. Bilder som ikke lenger er i bruk, slippes.
  // Nøkkelen er API-stien: `/side/{side}` og `/kontakt/{person}` hentes likt. Kontakt-
  // bildet kan byttes under samme id, så versjonen er med i nøkkelen (ruta ignorerer den).
  const kontaktNokkel = (k: Skjerminnhold["kontakter"][number]) => `/kontakt/${k.id}?v=${k.bildeVersjon}`;
  const bildeIder = [
    ...(innhold?.oppslag ?? []).flatMap((p) => (p.sider ?? []).map((s) => `/side/${s.id}`)),
    ...(innhold?.kontakter ?? []).filter((k) => k.harBilde).map(kontaktNokkel),
  ].join(",");
  useEffect(() => {
    const onsket = bildeIder ? bildeIder.split(",") : [];
    const naa = bilderRef.current;
    for (const [id, url] of Object.entries(naa)) {
      if (!onsket.includes(id)) URL.revokeObjectURL(url);
    }
    setBilder((b) => Object.fromEntries(Object.entries(b).filter(([id]) => onsket.includes(id))));
    for (const id of onsket.filter((id) => !naa[id])) {
      skjermklient
        .fil(id, token)
        .then((blob) => setBilder((b) => ({ ...b, [id]: URL.createObjectURL(blob) })))
        .catch(() => {});
    }
  }, [bildeIder, token]);

  const harLogo = innhold?.utseende.harLogo ?? false;
  useEffect(() => {
    if (!harLogo) return setLogo(null);
    let url: string | null = null;
    skjermklient
      .fil("/logo", token)
      .then((blob) => setLogo((url = URL.createObjectURL(blob))))
      .catch(() => {});
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [harLogo, token]);

  if (!innhold) return null;
  return (
    <Tavleskjerm
      innhold={innhold}
      sideUrl={(id) => bilder[`/side/${id}`] ?? null}
      kontaktbildeUrl={(id) => {
        const k = innhold.kontakter?.find((x) => x.id === id);
        return k ? (bilder[kontaktNokkel(k)] ?? null) : null;
      }}
      logoUrl={logo}
      utenNett={utenNett ? innhold.hentet : null}
    />
  );
}

// localStorage kan kaste (privat modus, blokkert lagring). Skjermen skal virke likevel.
function les(n: string): string | null {
  try {
    return localStorage.getItem(n);
  } catch {
    return null;
  }
}
function skriv(n: string, v: string) {
  try {
    localStorage.setItem(n, v);
  } catch {
    // Blokkert lagring: skjermen virker, men husker ikke til neste oppstart.
  }
}
function fjern(n: string) {
  try {
    localStorage.removeItem(n);
  } catch {
    // Blokkert lagring: skjermen virker, men husker ikke til neste oppstart.
  }
}
