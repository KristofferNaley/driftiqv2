"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-klient";

/**
 * Hvor innlogging lander, når `?retur=` ikke sier noe annet.
 *
 * Verten avgjør: `/dashboard` finnes ikke på panelverten, og `/plattform` finnes ikke på
 * kundeverten. Uten dette ble man logget inn på admin og kastet rett i en 404 — man kom inn,
 * men så det aldri.
 *
 * `adminVert` kommer fra SERVEREN. En `NEXT_PUBLIC_`-variabel ville blitt bakt inn ved bygg,
 * og da måtte imaget bygges på nytt for å endre et domenenavn.
 */
function standardSti(adminVert: string | null): string {
  if (typeof window === "undefined") return "/dashboard";
  return adminVert && window.location.hostname.toLowerCase() === adminVert.toLowerCase()
    ? "/plattform"
    : "/dashboard";
}

/**
 * Retur-stien leses fra `window.location` ved innsending, ikke med `useSearchParams()`.
 *
 * `useSearchParams` tvinger hele treet under seg til klientrendring — Next svarer da med
 * `BAILOUT_TO_CLIENT_SIDE_RENDERING`, og innloggingssiden er BLANK til JS-en har lastet.
 * Verifisert i den kjørende containeren: skjemaet fantes ikke i HTML-en i det hele tatt.
 *
 * Stien trengs bare i det øyeblikket vi navigerer, så et oppslag der er nok — og da kan
 * hele skjemaet server-rendres som resten av appen.
 */
function returSti(adminVert: string | null): string {
  if (typeof window === "undefined") return "/dashboard";
  return new URLSearchParams(window.location.search).get("retur") || standardSti(adminVert);
}

export default function LoggInnSkjema({ adminVert }: { adminVert: string | null }) {
  const router = useRouter();
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
        router.replace(returSti(adminVert));
        return;
      }

      const { data, error } = await signIn.email({ email: epost, password: passord });
      if (error) throw new Error(error.message ?? "Feil e-post eller passord");
      if ((data as { twoFactorRedirect?: boolean })?.twoFactorRedirect) {
        setTrengerKode(true);
        return;
      }
      router.replace(returSti(adminVert));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Innlogging feilet");
    } finally {
      setLaster(false);
    }
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

        {!trengerKode && (
          <Link className="glemt-lenke" href="/glemt-passord">
            Glemt passord?
          </Link>
        )}
      </form>
    </main>
  );
}

/** Trinn to. Egen funksjon fordi klienten eksponerer den under twoFactor-navnerommet. */
async function authVerifiser(kode: string) {
  const { authKlient } = await import("@/lib/auth-klient");
  return authKlient.twoFactor.verifyTotp({ code: kode });
}
