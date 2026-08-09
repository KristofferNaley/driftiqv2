"use client";

import { useEffect, useState } from "react";
import { sokEnheter, type Enhet } from "@/lib/brreg";

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
  const [treff, setTreff] = useState<Enhet[]>([]);
  const [valgt, setValgt] = useState<Enhet | null>(null);
  const [leter, setLeter] = useState(false);
  const [melding, setMelding] = useState("");
  const [felle, setFelle] = useState("");
  const [sender, setSender] = useState(false);
  const [sendt, setSendt] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);

  /**
   * Søker i Enhetsregisteret mens de skriver navnet på laget.
   *
   * Navn og ikke organisasjonsnummer: et styremedlem kan ikke nummeret sitt utenat, men vet
   * hva laget heter. Nummeret er noe de må lete etter — navnet har de i hodet.
   *
   * 350 ms forsinkelse. Uten den ville hvert tastetrykk blitt et kall til registeret, og de
   * fleste av dem ville vært utdaterte før svaret kom.
   */
  useEffect(() => {
    if (valgt || lag.trim().length < 3) {
      setTreff([]);
      return;
    }
    let avbrutt = false;
    setLeter(true);
    const t = setTimeout(() => {
      void sokEnheter(lag).then((res) => {
        if (avbrutt) return;
        setTreff(res);
        setLeter(false);
      });
    }, 350);
    return () => {
      avbrutt = true;
      clearTimeout(t);
    };
  }, [lag, valgt]);

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
          // Hele registeroppføringen følger med. Den er verdt å ha selv om besøkende lot
          // resten av skjemaet stå tomt.
          orgNr: valgt?.orgNr ?? null,
          orgForm: valgt?.orgForm ?? null,
          kommune: valgt?.kommune ?? null,
          adresse: valgt?.adresse ?? null,
          postnummer: valgt?.postnummer ?? null,
          poststed: valgt?.poststed ?? null,
          brregEpost: valgt?.epost ?? null,
          brregTelefon: valgt?.telefon ?? null,
          brregNettsted: valgt?.nettsted ?? null,
          brregRaa: valgt?.raa ?? null,
          felle,
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
        <label className="mk-felt mk-sok">
          <span>Borettslag / sameie</span>
          <input
            value={lag}
            autoComplete="off"
            placeholder="Skriv navnet — vi finner det i Enhetsregisteret"
            onChange={(e) => {
              setLag(e.target.value);
              // Endrer de navnet etter et valg, gjelder ikke valget lenger.
              setValgt(null);
            }}
          />

          {valgt ? (
            <span className="mk-valgt">
              <b>{valgt.navn}</b>
              <em>
                {[valgt.orgForm, valgt.kommune, `Org.nr. ${valgt.orgNr}`]
                  .filter(Boolean)
                  .join(" · ")}
              </em>
              <button type="button" onClick={() => setValgt(null)} aria-label="Fjern valget">
                ×
              </button>
            </span>
          ) : treff.length > 0 ? (
            <ul className="mk-treff">
              {treff.map((e) => (
                <li key={e.orgNr}>
                  <button
                    type="button"
                    onClick={() => {
                      setValgt(e);
                      setLag(e.navn);
                      setTreff([]);
                    }}
                  >
                    <b>{e.navn}</b>
                    <em>
                      {[e.orgForm, e.kommune, e.poststed].filter(Boolean).join(" · ")}
                    </em>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <span className="mk-hint">
              {leter && lag.trim().length >= 3
                ? "Søker i Enhetsregisteret …"
                : "Valgfritt. Finner vi laget, henter vi adresse og kontaktinfo automatisk."}
            </span>
          )}
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
            value={felle}
            onChange={(e) => setFelle(e.target.value)}
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
