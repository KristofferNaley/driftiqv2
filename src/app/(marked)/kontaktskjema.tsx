"use client";

import { useState } from "react";

/**
 * Kontaktskjemaet — den eneste klientøya på landingssiden.
 *
 * Resten av siden er serverrendret for SEO; dette feltet trenger tilstand, så det er skilt
 * ut i stedet for å gjøre hele siden til en klientkomponent.
 *
 * `nettsted` er en honningkrukke: skjult for mennesker, men skjemaroboter fyller den ut
 * fordi de leser HTML-en og ikke CSS-en. Serveren later som alt gikk bra og lagrer ingenting
 * — en robot som får feilmelding, prøver på nytt med en annen taktikk.
 */
export function Kontaktskjema() {
  const [navn, setNavn] = useState("");
  const [epost, setEpost] = useState("");
  const [telefon, setTelefon] = useState("");
  const [lag, setLag] = useState("");
  const [melding, setMelding] = useState("");
  const [nettsted, setNettsted] = useState("");
  const [sender, setSender] = useState(false);
  const [sendt, setSendt] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSender(true);
    setFeil(null);
    try {
      const svar = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: navn.trim(),
          email: epost.trim(),
          phone: telefon.trim() || null,
          company: lag.trim() || null,
          message: melding.trim() || null,
          nettsted,
        }),
      });
      if (!svar.ok) {
        throw new Error((await svar.json().catch(() => ({}))).detail ?? "Kunne ikke sende");
      }
      setSendt(true);
    } catch (e) {
      setFeil(
        e instanceof Error
          ? e.message
          : "Noe gikk galt. Send gjerne en e-post til post@driftiq.no i stedet.",
      );
    } finally {
      setSender(false);
    }
  }

  if (sendt) {
    return (
      <div className="mk-kvittering">
        <div className="mk-hake" aria-hidden>✓</div>
        <h3>Takk — meldingen er mottatt</h3>
        <p>Du får svar fra utvikleren selv, normalt innen én virkedag.</p>
      </div>
    );
  }

  return (
    <form className="mk-skjema" onSubmit={send}>
      <div className="mk-felt-rad">
        <label className="mk-felt">
          <span>Navn *</span>
          <input value={navn} onChange={(e) => setNavn(e.target.value)} autoComplete="name" />
        </label>
        <label className="mk-felt">
          <span>E-post *</span>
          <input type="email" value={epost} onChange={(e) => setEpost(e.target.value)} autoComplete="email" />
        </label>
      </div>
      <div className="mk-felt-rad">
        <label className="mk-felt">
          <span>Telefon</span>
          <input value={telefon} onChange={(e) => setTelefon(e.target.value)} autoComplete="tel" />
        </label>
        <label className="mk-felt">
          <span>Borettslag / sameie</span>
          <input value={lag} onChange={(e) => setLag(e.target.value)} autoComplete="organization" />
        </label>
      </div>
      <label className="mk-felt">
        <span>Melding</span>
        <textarea rows={4} value={melding} onChange={(e) => setMelding(e.target.value)} />
      </label>

      {/* Honningkrukka. `aria-hidden` + `tabIndex={-1}` så den heller ikke finnes for
          skjermlesere eller tastaturnavigasjon — den skal bare eksistere i HTML-en. */}
      <div className="mk-honning" aria-hidden>
        <label>
          Nettsted
          <input
            tabIndex={-1}
            autoComplete="off"
            value={nettsted}
            onChange={(e) => setNettsted(e.target.value)}
          />
        </label>
      </div>

      {feil && <p className="mk-feil">{feil}</p>}

      <button className="mk-knapp" disabled={sender || !navn.trim() || !epost.trim()}>
        {sender ? "Sender …" : "Send henvendelse"}
      </button>
      <p className="mk-liten">
        Vi bruker opplysningene kun til å svare deg. Se{" "}
        <a href="/personvern">personvernerklæringen</a>.
      </p>
    </form>
  );
}
