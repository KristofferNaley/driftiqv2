"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Bug, CheckCircle2, HelpCircle, Lightbulb, type LucideIcon } from "lucide-react";
import { useOkt } from "./OktProvider";
import { Feil } from "./felles";
import { Felt, Knapperad, Modal, Nedtrekk, Tekstomrade } from "./skjema";
import { api } from "@/lib/klient";
import { MENY, type ModulNokkel } from "@/lib/moduler";

/**
 * «Meld feil» — kundens vei til oss. Skjemaet er v1s `MeldFeilModal` i v2-drakt.
 *
 * Tre typer i samme skjema, som BRIKKER med ikon og ikke et nedtrekk: valget er det første
 * man tar, og tre synlige alternativer leses raskere enn en lukket liste. Et styremedlem
 * som opplever at noe ikke virker skiller uansett ikke mellom «bug» og «det jeg trodde
 * skulle skje» — å tvinge fram riktig innboks gir feilsorterte saker og færre innmeldinger.
 *
 * Modulen gjettes fra ruten man står på (`/avvik/abc` → Avvik), så feltet oftest er riktig
 * før man ser det. Den er fortsatt valgfri: vet de ikke hvor feilen hører hjemme, er det
 * VÅR jobb å finne ut av det.
 */

const TYPER: Array<{ verdi: string; etikett: string; Ikon: LucideIcon }> = [
  { verdi: "bug", etikett: "Noe virker ikke", Ikon: Bug },
  { verdi: "idea", etikett: "Forslag til forbedring", Ikon: Lightbulb },
  { verdi: "question", etikett: "Spørsmål", Ikon: HelpCircle },
];

function modulFraSti(sti: string): string {
  const rot = `/${sti.split("/")[1] ?? ""}`;
  return (Object.keys(MENY) as ModulNokkel[]).find((n) => MENY[n]!.sti === rot) ?? "";
}

export function MeldFeil({ versjon }: { versjon: string }) {
  const { aktivOrg } = useOkt();
  const sti = usePathname();
  const [apen, setApen] = useState(false);
  const [type, setType] = useState("bug");
  const [modul, setModul] = useState("");
  const [tekst, setTekst] = useState("");
  const [sender, setSender] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [sendt, setSendt] = useState<number | null>(null);

  function start() {
    setModul(modulFraSti(sti ?? ""));
    setApen(true);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!aktivOrg) return;
    setSender(true);
    setFeil(null);
    try {
      const sak = await api.send<{ number: number | null }>(
        `/organizations/${aktivOrg.id}/feilmelding`,
        {
          kind: type,
          module: modul || null,
          description: tekst.trim(),
          appVersion: versjon,
          // «Hvor sto du, og på hvor stor skjerm» — de to spørsmålene vi ellers må stille i
          // hver eneste sak. Stien, ikke hele adressen: verten vet vi selv.
          url: sti || null,
          screen: `${window.innerWidth} × ${window.innerHeight}`,
        },
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
      {/* Lucide-ikon i 16px som alle andre knappeikoner — tegnet «⚙» fulgte skriftstørrelsen
          og så både større og fremmed ut. Teksten vek for plassen på mobil 13.08.2026:
          toppbaren har tittel, sidehandlinger og denne, og på 375px var det teksten eller
          knappene. aria-label og title bærer meningen når bare insektet står igjen. */}
      <button
        className="btn btn-ghost meldfeil-knapp"
        onClick={start}
        title="Meld feil eller forslag"
        aria-label="Meld feil eller forslag"
      >
        <Bug size={16} strokeWidth={1.9} aria-hidden />
        <span className="skjul-mobil">Meld feil</span>
      </button>

      {apen && (
        <Modal tittel={sendt !== null ? "Takk for tilbakemeldingen" : "Meld feil til DriftIQ"} onLukk={lukk}>
          {sendt !== null ? (
            <div style={{ textAlign: "center", padding: "16px 8px 4px" }}>
              <CheckCircle2 size={44} strokeWidth={1.6} aria-hidden style={{ color: "var(--accent2)" }} />
              <div style={{ fontSize: "var(--fs-md)", fontWeight: 700, marginTop: "12px" }}>
                Vi har fått meldingen
              </div>
              <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", lineHeight: 1.6, marginTop: "8px" }}>
                Saken din har nummer <b>FM-{String(sendt).padStart(4, "0")}</b>. Vi tar kontakt
                på e-post når den er løst.
              </p>
              <Knapperad onAvbryt={lukk} avbrytEtikett="Lukk" sendEtikett="Meld én til" onSend={() => setSendt(null)} />
            </div>
          ) : (
            <form onSubmit={send} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
              <div className="field-note" style={{ marginTop: "-4px" }}>
                Fungerer ikke noe som det skal? Fortell oss hva som skjedde, så fikser vi det.
                Du får svar på e-post når saken er løst.
              </div>

              <Feil melding={feil} />

              <Felt etikett="Hva gjelder det?">
                <div className="pille-gruppe" style={{ marginLeft: 0 }}>
                  {TYPER.map(({ verdi, etikett, Ikon }) => (
                    <button
                      key={verdi}
                      type="button"
                      className={`pille${type === verdi ? " valgt" : ""}`}
                      onClick={() => setType(verdi)}
                    >
                      <Ikon size={14} strokeWidth={1.9} aria-hidden /> {etikett}
                    </button>
                  ))}
                </div>
              </Felt>

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
                notat="Forhåndsutfylt fra siden du sto på. Vet du ikke hvor det hører hjemme, finner vi ut av det."
              />
              <Tekstomrade
                etikett="Hva skjedde?"
                verdi={tekst}
                onEndre={setTekst}
                notat="Skriv gjerne hva du gjorde, hva du forventet — og hva som skjedde i stedet."
              />

              <div
                style={{
                  background: "var(--surface2)",
                  borderRadius: "9px",
                  padding: "10px 12px",
                  fontSize: "var(--fs-label)",
                  color: "var(--muted)",
                  lineHeight: 1.6,
                }}
              >
                Teknisk info legges ved automatisk: versjon <b>{versjon}</b>, nettleser,
                siden du står på og boligselskap — så finner vi feilen raskere.
              </div>

              <Knapperad
                onAvbryt={lukk}
                sendEtikett="Send til DriftIQ"
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
