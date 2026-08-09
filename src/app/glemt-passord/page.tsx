"use client";

import { useState } from "react";
import Link from "next/link";
import { authKlient } from "@/lib/auth-klient";

/**
 * «Glemt passord» — steg én.
 *
 * Svaret er ALLTID det samme, uansett om adressen finnes. Sa siden «finnes ikke», ville den
 * vært et oppslagsverk over hvem som har konto hos hvilket borettslag — og det er nettopp
 * den slags lekkasje som gjør en ellers ufarlig side til et rekognoseringsverktøy.
 */
export default function GlemtPassord() {
  const [epost, setEpost] = useState("");
  const [sendt, setSendt] = useState(false);
  const [laster, setLaster] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setLaster(true);
    // Feil svelges med vilje — se kommentaren over. Brukeren skal ikke kunne skille
    // «ukjent adresse» fra «e-post sendt».
    await authKlient.requestPasswordReset({ email: epost.trim() }).catch(() => {});
    setLaster(false);
    setSendt(true);
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

        {sendt ? (
          <>
            <div className="field-note" style={{ lineHeight: 1.6 }}>
              Finnes det en konto på <strong>{epost.trim()}</strong>, har vi sendt en lenke dit
              for å velge nytt passord. Lenken er gyldig i én time.
              <br />
              <br />
              Sjekk søppelposten hvis den ikke dukker opp.
            </div>
            <Link className="btn btn-ghost" style={{ justifyContent: "center" }} href="/logg-inn">
              Tilbake til innlogging
            </Link>
          </>
        ) : (
          <>
            <div className="field">
              <label className="field-label" htmlFor="epost">E-postadresse</label>
              <input
                id="epost" className="input" type="email" autoComplete="email" autoFocus
                value={epost} onChange={(e) => setEpost(e.target.value)}
              />
              <div className="field-note">
                Vi sender en lenke der du velger nytt passord selv.
              </div>
            </div>
            <button
              className="btn btn-primary"
              style={{ justifyContent: "center" }}
              disabled={laster || !epost.trim()}
            >
              {laster ? "Sender …" : "Send lenke"}
            </button>
            <Link className="btn btn-ghost" style={{ justifyContent: "center" }} href="/logg-inn">
              Tilbake
            </Link>
          </>
        )}
      </form>
    </main>
  );
}
