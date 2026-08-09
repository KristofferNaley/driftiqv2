"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { Feil, Kort, Tom } from "@/components/felles";
import { aiRadgiver } from "@/lib/klient";

type Tur = { rolle: "bruker" | "assistent"; tekst: string; kilder?: string[] };

/**
 * AI-rådgiveren.
 *
 * Samtalen er PRIVAT per bruker — API-et filtrerer på både org og bruker, så en kollega
 * ser den ikke, og heller ikke plattformadmin i support-modus.
 */
export default function AiRadgiver() {
  const { aktivOrg } = useOkt();
  const [turer, setTurer] = useState<Tur[]>([]);
  const [samtaleId, setSamtaleId] = useState<string | null>(null);
  const [melding, setMelding] = useState("");
  const [venter, setVenter] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const tekst = melding.trim();
    if (!tekst || !aktivOrg || venter) return;

    setTurer((t) => [...t, { rolle: "bruker", tekst }]);
    setMelding("");
    setVenter(true);
    setFeil(null);
    try {
      const svar = await aiRadgiver.spor(aktivOrg.id, { melding: tekst, samtaleId });
      setSamtaleId(svar.samtaleId);
      setTurer((t) => [...t, { rolle: "assistent", tekst: svar.svar, kilder: svar.kilder }]);
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Rådgiveren svarte ikke");
    } finally {
      setVenter(false);
    }
  }

  return (
    <Layout tittel="AI-rådgiver">
      <div className="page-content">
        <Feil melding={feil} />

        <Kort tittel="Samtale">
          {turer.length === 0 ? (
            <Tom tekst="Spør om avtaler, avvik, oppgaver eller internkontroll. Rådgiveren henter faktiske data fra deres eget lag." />
          ) : (
            <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>
              {turer.map((t, n) => (
                <div key={n} style={{ maxWidth: "760px", alignSelf: t.rolle === "bruker" ? "flex-end" : "flex-start" }}>
                  <div
                    style={{
                      background: t.rolle === "bruker" ? "var(--surface2)" : "transparent",
                      border: t.rolle === "bruker" ? "1px solid var(--border)" : "none",
                      borderRadius: "12px",
                      padding: t.rolle === "bruker" ? "10px 14px" : "0",
                      fontSize: "var(--fs-sm)",
                      lineHeight: 1.65,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {t.tekst}
                  </div>
                  {t.kilder && t.kilder.length > 0 && (
                    <div style={{ marginTop: "8px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {t.kilder.map((k) => (
                        <span key={k} className="badge muted">
                          {k.replace(/^hent_/, "").replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {venter && <div className="list-meta">Rådgiveren henter data …</div>}
            </div>
          )}
        </Kort>

        <form onSubmit={send} style={{ display: "flex", gap: "10px" }}>
          <input
            className="input"
            placeholder="Still et spørsmål om laget deres"
            aria-label="Spørsmål til AI-rådgiveren"
            value={melding}
            onChange={(e) => setMelding(e.target.value)}
            disabled={venter}
          />
          <button className="btn btn-primary" disabled={!melding.trim() || venter}>
            <Send size={16} strokeWidth={2} aria-hidden />
            Send
          </button>
        </form>
      </div>
    </Layout>
  );
}
