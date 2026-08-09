"use client";

import { use, useEffect, useState } from "react";
import { FREQ_ETIKETTER } from "@/lib/oppgaveregler";

/**
 * Utkvitteringsskjemaet bak QR-koden. **Ingen innlogging.**
 *
 * Dette er den eneste siden i systemet som møter noen som ikke er kunde: en montør som står
 * foran heisen med telefonen i hånda, ofte i dårlig lys og med hansker på. Derfor egen side
 * utenfor `Layout` — ingen sidemeny, ingen orgvelger, store trykkflater, ett spor gjennom.
 *
 * Tokenet i URL-en er tilgangskontrollen. Se `lib/qr.ts`.
 */
export default function Kvittering({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [kontekst, setKontekst] = useState<Kontekst | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [laster, setLaster] = useState(true);
  const [sendt, setSendt] = useState(false);

  const [avhuket, setAvhuket] = useState<Set<string>>(new Set());
  const [utfortAv, setUtfortAv] = useState("");
  const [notat, setNotat] = useState("");
  const [harAvvik, setHarAvvik] = useState(false);
  const [avviksTekst, setAvviksTekst] = useState("");
  const [alvorlighet, setAlvorlighet] = useState("");
  const [bilder, setBilder] = useState<File[]>([]);
  const [sender, setSender] = useState(false);

  useEffect(() => {
    fetch(`/api/qr/${token}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? "Ugyldig QR-kode");
        setKontekst(await r.json());
      })
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente oppgaven"))
      .finally(() => setLaster(false));
  }, [token]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSender(true);
    setFeil(null);
    try {
      const svar = await fetch(`/api/qr/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completedBy: utfortAv.trim() || null,
          notes: notat.trim() || null,
          hasDeviation: harAvvik,
          deviationDescription: harAvvik ? avviksTekst.trim() || null : null,
          severity: harAvvik && alvorlighet ? alvorlighet : null,
          checkedItemIds: [...avhuket],
        }),
      });
      if (!svar.ok) {
        throw new Error((await svar.json().catch(() => ({}))).detail ?? "Kunne ikke registrere");
      }
      const { id } = (await svar.json()) as { id: string };

      // Bildene er TILLEGGSdokumentasjon. Feiler en opplasting, er jobben likevel registrert
      // — da er det riktig å vise kvittering, ikke å rulle tilbake en utført oppgave.
      for (const fil of bilder) {
        const skjema = new FormData();
        skjema.append("fil", fil);
        await fetch(`/api/qr/${token}/bilder/${id}`, { method: "POST", body: skjema }).catch(
          () => {},
        );
      }
      setSendt(true);
    } catch (e) {
      /*
       * Nettverksfeil — typisk iOS «Load failed». Forespørselen ble sendt og serveren
       * behandlet den, men svaret nådde ikke telefonen. Viser vi feil her, kvitterer
       * montøren ut én gang til, og loggen får en dublett.
       *
       * Å vise kvittering er derfor det minst gale, men det er ikke gratis: gikk kallet
       * faktisk aldri gjennom, står jobben ulogget mens montøren tror den er registrert.
       * Den ekte løsningen er en idempotensnøkkel fra klienten, slik at et nytt forsøk er
       * trygt — da kan feilen vises ærlig. Ikke bygget ennå.
       */
      const melding = e instanceof Error ? e.message.toLowerCase() : "";
      const nettverk =
        e instanceof TypeError ||
        melding.includes("load failed") ||
        melding.includes("network") ||
        melding.includes("fetch");
      if (nettverk) setSendt(true);
      else setFeil(e instanceof Error ? e.message : "Kunne ikke registrere");
    } finally {
      setSender(false);
    }
  }

  if (laster) return <Ramme><p className="qr-dempet">Henter oppgaven …</p></Ramme>;

  if (feil && !kontekst) {
    return (
      <Ramme>
        <h1 className="qr-tittel">Ugyldig QR-kode</h1>
        <p className="qr-dempet">
          {feil} Koden kan være byttet ut eller oppgaven satt på pause. Ta kontakt med styret.
        </p>
      </Ramme>
    );
  }

  if (sendt) {
    return (
      <Ramme>
        <div className="qr-hake" aria-hidden>✓</div>
        <h1 className="qr-tittel">Takk — jobben er registrert</h1>
        <p className="qr-dempet">
          {kontekst?.tittel} er kvittert ut{utfortAv.trim() ? ` av ${utfortAv.trim()}` : ""}.
          {harAvvik && " Avviket er sendt til styret for oppfølging."}
        </p>
        <p className="qr-dempet">Du kan lukke denne siden.</p>
      </Ramme>
    );
  }

  const k = kontekst!;
  return (
    <Ramme>
      <div className="qr-hode">
        <div className="qr-org">{k.orgNavn}</div>
        <h1 className="qr-tittel">{k.tittel}</h1>
        <div className="qr-meta">
          {[k.sted, k.leverandor, FREQ_ETIKETTER[k.frekvens] ?? k.frekvens]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>

      <form onSubmit={send} className="qr-skjema">
        {k.beskrivelse && <p className="qr-beskrivelse">{k.beskrivelse}</p>}

        {k.sjekkliste.length > 0 && (
          <section>
            <h2 className="qr-seksjon">Sjekkliste</h2>
            {k.sjekkliste.map((punkt) => (
              <label key={punkt.id} className="qr-punkt">
                <input
                  type="checkbox"
                  checked={avhuket.has(punkt.id)}
                  onChange={(e) => {
                    const neste = new Set(avhuket);
                    if (e.target.checked) neste.add(punkt.id);
                    else neste.delete(punkt.id);
                    setAvhuket(neste);
                  }}
                />
                <span>{punkt.text}</span>
              </label>
            ))}
            <p className="qr-dempet">
              Punkter du ikke huker av føres som ikke utført. Det er et gyldig svar — logget
              er at de ikke ble gjort, ikke at de ble glemt.
            </p>
          </section>
        )}

        <label className="qr-felt">
          <span className="qr-etikett">Hvem utførte jobben?</span>
          <input
            className="qr-input"
            value={utfortAv}
            placeholder={k.leverandor ? `Valgfritt — ellers føres ${k.leverandor}` : "Valgfritt"}
            onChange={(e) => setUtfortAv(e.target.value)}
          />
        </label>

        <label className="qr-felt">
          <span className="qr-etikett">Kommentar</span>
          <textarea
            className="qr-input"
            rows={3}
            value={notat}
            placeholder="Valgfritt"
            onChange={(e) => setNotat(e.target.value)}
          />
        </label>

        <label className="qr-punkt qr-avvik-bryter">
          <input type="checkbox" checked={harAvvik} onChange={(e) => setHarAvvik(e.target.checked)} />
          <span>Jeg fant noe som må følges opp</span>
        </label>

        {harAvvik && (
          <div className="qr-avvik">
            <label className="qr-felt">
              <span className="qr-etikett">Hva fant du?</span>
              <textarea
                className="qr-input"
                rows={3}
                value={avviksTekst}
                onChange={(e) => setAvviksTekst(e.target.value)}
              />
            </label>
            <label className="qr-felt">
              <span className="qr-etikett">Alvorlighet</span>
              <select
                className="qr-input"
                value={alvorlighet}
                onChange={(e) => setAlvorlighet(e.target.value)}
              >
                <option value="">Ikke vurdert</option>
                <option value="lav">Lav</option>
                <option value="middels">Middels</option>
                <option value="akutt">Akutt</option>
              </select>
            </label>
            <p className="qr-dempet">Dette blir et avvik styret får varsel om.</p>
          </div>
        )}

        <label className="qr-felt">
          <span className="qr-etikett">Bilder ({bilder.length}/4)</span>
          <input
            className="qr-input"
            type="file"
            accept="image/*"
            multiple
            // `capture` er bevisst IKKE satt: montøren skal kunne velge et bilde tatt for
            // fem minutter siden, ikke tvinges inn i kameraet på nytt.
            onChange={(e) => {
              const valgte = [...(e.target.files ?? [])];
              setBilder((f) => [...f, ...valgte].slice(0, 4));
              e.target.value = "";
            }}
          />
          {bilder.length > 0 && (
            <ul className="qr-bilder">
              {bilder.map((b, i) => (
                <li key={`${b.name}-${i}`}>
                  <span>{b.name}</span>
                  <button
                    type="button"
                    onClick={() => setBilder((f) => f.filter((_, j) => j !== i))}
                    aria-label={`Fjern ${b.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </label>

        {feil && <div className="qr-feil">{feil}</div>}

        <button className="qr-knapp" disabled={sender}>
          {sender ? "Registrerer …" : "Registrer utført"}
        </button>
      </form>
    </Ramme>
  );
}

type Kontekst = {
  tittel: string;
  beskrivelse: string | null;
  frekvens: string;
  sted: string | null;
  orgNavn: string;
  leverandor: string | null;
  sjekkliste: Array<{ id: string; text: string }>;
};

function Ramme({ children }: { children: React.ReactNode }) {
  return (
    <main className="qr-side">
      <div className="qr-kort">{children}</div>
      <div className="qr-fot">
        <span className="logo-mark" aria-hidden>IQ</span>
        <span>DriftIQ</span>
      </div>
    </main>
  );
}
