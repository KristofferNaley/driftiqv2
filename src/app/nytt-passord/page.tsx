"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authKlient } from "@/lib/auth-klient";

/**
 * «Glemt passord» — steg to. Brukes også av nye kontoer som aldri har hatt et passord;
 * teknisk er det samme handling, og velkomst-e-posten peker hit.
 *
 * Tokenet leses fra `window.location` i en `useEffect`, ikke med `useSearchParams()`.
 * Sistnevnte tvinger hele treet til klientrendring, og da er siden BLANK til JS-en har
 * lastet — samme felle som innloggingssiden gikk i.
 */
export default function NyttPassord() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [nytt, setNytt] = useState("");
  const [gjenta, setGjenta] = useState("");
  const [feil, setFeil] = useState<string | null>(null);
  const [laster, setLaster] = useState(false);
  const [ferdig, setFerdig] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (nytt.length < 8) return setFeil("Passordet må være minst 8 tegn.");
    if (nytt !== gjenta) return setFeil("De to passordene er ikke like.");
    setFeil(null);
    setLaster(true);
    const { error } = await authKlient.resetPassword({ newPassword: nytt, token: token! });
    setLaster(false);
    if (error) {
      setFeil(
        error.message ??
          "Lenken er ugyldig eller utløpt. Be om en ny fra «Glemt passord».",
      );
      return;
    }
    setFerdig(true);
    setTimeout(() => router.replace("/logg-inn"), 1800);
  }

  return (
    <main className="logg-inn-side">
      <form className="logg-inn-kort" onSubmit={send}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className="logo-mark" aria-hidden>IQ</span>
          <span className="logo-tekst" style={{ fontSize: "var(--fs-lg)" }}>
            Drift<span className="iq">IQ</span>
          </span>
        </div>

        {ferdig ? (
          <div className="field-note" style={{ lineHeight: 1.6 }}>
            Passordet er satt. Sender deg til innloggingen …
          </div>
        ) : token === null ? (
          <>
            <div className="field-note" style={{ lineHeight: 1.6 }}>
              Denne lenken mangler et gyldig token. Be om en ny fra «Glemt passord».
            </div>
            <Link className="btn btn-primary" style={{ justifyContent: "center" }} href="/glemt-passord">
              Glemt passord
            </Link>
          </>
        ) : (
          <>
            {feil && <div className="feilmelding">{feil}</div>}
            <div className="field">
              <label className="field-label" htmlFor="nytt">Nytt passord</label>
              <input
                id="nytt" className="input" type="password" autoComplete="new-password" autoFocus
                value={nytt} onChange={(e) => setNytt(e.target.value)}
              />
              <div className="field-note">Minst 8 tegn.</div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="gjenta">Gjenta nytt passord</label>
              <input
                id="gjenta" className="input" type="password" autoComplete="new-password"
                value={gjenta} onChange={(e) => setGjenta(e.target.value)}
              />
            </div>
            <button
              className="btn btn-primary"
              style={{ justifyContent: "center" }}
              disabled={laster || !nytt || !gjenta}
            >
              {laster ? "Lagrer …" : "Sett passord"}
            </button>
          </>
        )}
      </form>
    </main>
  );
}
