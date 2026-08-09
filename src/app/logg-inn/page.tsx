"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "@/lib/auth-klient";

function Skjema() {
  const router = useRouter();
  const retur = useSearchParams().get("retur") ?? "/";
  const [epost, setEpost] = useState("");
  const [passord, setPassord] = useState("");
  const [kode, setKode] = useState("");
  // Etter at 2FA er slått på, tar passordet deg bare til trinn to.
  const [trengerKode, setTrengerKode] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [laster, setLaster] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setFeil(null);
    setLaster(true);
    try {
      if (trengerKode) {
        const { error } = await authVerifiser(kode);
        if (error) throw new Error(error.message ?? "Feil kode");
        router.replace(retur);
        return;
      }

      const { data, error } = await signIn.email({ email: epost, password: passord });
      if (error) throw new Error(error.message ?? "Feil e-post eller passord");
      if ((data as { twoFactorRedirect?: boolean })?.twoFactorRedirect) {
        setTrengerKode(true);
        return;
      }
      router.replace(retur);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Innlogging feilet");
    } finally {
      setLaster(false);
    }
  }

  return (
    <form className="logg-inn-kort" onSubmit={send}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span className="logo-mark" aria-hidden>IQ</span>
        <span className="logo-tekst" style={{ fontSize: "var(--fs-lg)" }}>
          Drift<span className="iq">IQ</span>
        </span>
      </div>

      {feil && <div className="feilmelding">{feil}</div>}

      {trengerKode ? (
        <div className="field">
          <label className="field-label" htmlFor="kode">Engangskode</label>
          <input
            id="kode" className="input" inputMode="numeric" autoComplete="one-time-code"
            autoFocus value={kode} onChange={(e) => setKode(e.target.value)}
          />
          <div className="field-note">Åpne autentiseringsappen din og skriv inn koden.</div>
        </div>
      ) : (
        <>
          <div className="field">
            <label className="field-label" htmlFor="epost">E-postadresse</label>
            <input
              id="epost" className="input" type="email" autoComplete="email" autoFocus
              value={epost} onChange={(e) => setEpost(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="passord">Passord</label>
            <input
              id="passord" className="input" type="password" autoComplete="current-password"
              value={passord} onChange={(e) => setPassord(e.target.value)}
            />
          </div>
        </>
      )}

      <button className="btn btn-primary" style={{ justifyContent: "center" }} disabled={laster}>
        {laster ? "Logger inn …" : trengerKode ? "Bekreft" : "Logg inn"}
      </button>
    </form>
  );
}

/** Trinn to. Egen funksjon fordi klienten eksponerer den under twoFactor-navnerommet. */
async function authVerifiser(kode: string) {
  const { authKlient } = await import("@/lib/auth-klient");
  return authKlient.twoFactor.verifyTotp({ code: kode });
}

export default function LoggInn() {
  return (
    <main className="logg-inn-side">
      <Suspense fallback={null}>
        <Skjema />
      </Suspense>
    </main>
  );
}
