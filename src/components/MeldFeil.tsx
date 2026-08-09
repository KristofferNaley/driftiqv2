"use client";

import { useState } from "react";
import { useOkt } from "./OktProvider";
import { Feil } from "./felles";
import { Knapperad, Modal, Nedtrekk, Tekstomrade } from "./skjema";
import { api } from "@/lib/klient";
import { MENY, type ModulNokkel } from "@/lib/moduler";

/**
 * «Meld feil» — kundens vei til oss.
 *
 * Tre typer i samme skjema. Et styremedlem som opplever at noe ikke virker skiller ikke
 * mellom «bug» og «det jeg trodde skulle skje»; å tvinge fram riktig innboks gir
 * feilsorterte saker og færre innmeldinger.
 *
 * Modul er valgfritt. Vet de ikke hvor feilen hører hjemme, er det VÅR jobb å finne ut av
 * det — ikke en betingelse for å få melde fra.
 */
export function MeldFeil({ versjon }: { versjon: string }) {
  const { aktivOrg } = useOkt();
  const [apen, setApen] = useState(false);
  const [type, setType] = useState("bug");
  const [modul, setModul] = useState("");
  const [tekst, setTekst] = useState("");
  const [sender, setSender] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [sendt, setSendt] = useState<number | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!aktivOrg) return;
    setSender(true);
    setFeil(null);
    try {
      const sak = await api.send<{ number: number | null }>(
        `/organizations/${aktivOrg.id}/feilmelding`,
        { kind: type, module: modul || null, description: tekst.trim(), appVersion: versjon },
      );
      setSendt(sak.number ?? 0);
      setTekst("");
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke sende inn");
    } finally {
      setSender(false);
    }
  }

  function lukk() {
    setApen(false);
    setSendt(null);
    setFeil(null);
  }

  return (
    <>
      <button className="btn btn-ghost" onClick={() => setApen(true)} title="Meld feil eller forslag">
        ⚙ Meld feil
      </button>

      {apen && (
        <Modal tittel={sendt !== null ? "Takk for tilbakemeldingen" : "Meld feil"} onLukk={lukk}>
          {sendt !== null ? (
            <>
              <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
                Saken er registrert som <b>FM-{String(sendt).padStart(4, "0")}</b>. Du får svar
                på e-post.
              </p>
              <Knapperad onAvbryt={lukk} avbrytEtikett="Lukk" sendEtikett="Meld én til" onSend={() => setSendt(null)} />
            </>
          ) : (
            <form onSubmit={send} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
              <Feil melding={feil} />
              <Nedtrekk
                etikett="Hva gjelder det?"
                verdi={type}
                onEndre={setType}
                valg={[
                  { verdi: "bug", etikett: "Noe virker ikke" },
                  { verdi: "idea", etikett: "Forslag til forbedring" },
                  { verdi: "question", etikett: "Spørsmål" },
                ]}
              />
              <Nedtrekk
                etikett="Hvor i systemet?"
                verdi={modul}
                onEndre={setModul}
                valg={[
                  { verdi: "", etikett: "Vet ikke / gjelder generelt" },
                  ...(Object.keys(MENY) as ModulNokkel[]).map((n) => ({
                    verdi: n,
                    etikett: MENY[n]!.etikett,
                  })),
                ]}
                notat="Valgfritt. Vet du ikke hvor det hører hjemme, finner vi ut av det."
              />
              <Tekstomrade
                etikett="Hva skjedde?"
                verdi={tekst}
                onEndre={setTekst}
                notat="Skriv gjerne hva du gjorde og hva du forventet. Nettleser og versjon legges ved automatisk."
              />
              <Knapperad
                onAvbryt={lukk}
                sendEtikett="Send inn"
                sender={sender}
                deaktivert={tekst.trim().length < 5}
              />
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
