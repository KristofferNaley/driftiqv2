"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, History, Plus, ShieldCheck, Trash2 } from "lucide-react";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { Feil, Tom, siden } from "@/components/felles";
import { Modal } from "@/components/skjema";
import { aiRadgiver, type AiKort, type Samtale } from "@/lib/klient";

type Tur = { rolle: "bruker" | "assistent"; tekst: string; kilder?: string[] };

/**
 * Lettvekts markdown-visning for rådgiverens svar — overskrifter, punktlister og fet.
 *
 * Systemprompten ber om ren tekst, men modellen glipper: første testsvar kom med #-over-
 * skrifter til tross for et eksplisitt forbud. En prompt er en bønn, ikke en garanti — og
 * rå «## Avvik» i fjeset på et styremedlem ser ødelagt ut. Dette er derfor en FORMATTERER,
 * ikke en parser: React-noder hele veien (aldri dangerouslySetInnerHTML), og alt den ikke
 * kjenner igjen vises som teksten den er.
 */
function Svartekst({ tekst }: { tekst: string }) {
  const fet = (linje: string, n: number) =>
    linje.split("**").map((del, i) => (i % 2 === 1 ? <b key={`${n}-${i}`}>{del}</b> : del));

  return (
    <>
      {tekst.split("\n").map((linje, n) => {
        const overskrift = linje.match(/^#{1,4}\s+(.*)$/);
        if (overskrift) {
          return (
            <span key={n} className="ai-overskrift">
              {fet(overskrift[1]!, n)}
            </span>
          );
        }
        const punkt = linje.match(/^(\s*)[-*]\s+(.*)$/);
        if (punkt) {
          return (
            <span key={n} className="ai-punkt" style={{ paddingLeft: `${14 + (punkt[1]!.length > 0 ? 14 : 0)}px` }}>
              {fet(punkt[2]!, n)}
            </span>
          );
        }
        return (
          <span key={n} className="ai-linje">
            {fet(linje, n)}
          </span>
        );
      })}
    </>
  );
}

/** Forslag når ingenting skiller seg ut — og under kortene når noe gjør det. */
const FORSLAG = [
  "Har noen leverandør uvanlig mange avvik?",
  "Oppsummer driften siste kvartal",
  "Hva sier vedtektene om utleie?",
];

/**
 * AI-rådgiveren — redesignet etter mockups/ai-radgiver-redesign.html.
 *
 * ## Startbildet er kort med EKTE tall, ikke et blankt chatfelt
 *
 * Et tomt felt forutsetter at styret vet hva som er verdt å spørre om. Kortene snur det:
 * serveren regner ut det som skiller seg ut nå (gamle avvik, utløpende kontrakter, hull i
 * internkontrollen), og et klikk på kortet ER spørsmålet — ferdig formulert, sendt med en
 * gang. Chipsene under er de gode spørsmålene folk ikke visste de kunne stille.
 *
 * Samtalen er PRIVAT per bruker — API-et filtrerer på både org og bruker, så en kollega ser
 * den ikke, og heller ikke plattformadmin i support-modus.
 */
export default function AiRadgiver() {
  const { aktivOrg } = useOkt();
  const [turer, setTurer] = useState<Tur[]>([]);
  const [samtaleId, setSamtaleId] = useState<string | null>(null);
  const [melding, setMelding] = useState("");
  const [venter, setVenter] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [kort, setKort] = useState<AiKort[] | null>(null);
  const [samtaler, setSamtaler] = useState<Samtale[]>([]);
  const [viserSamtaler, setViserSamtaler] = useState(false);
  const bunn = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aktivOrg) return;
    // Feiler kortene, står chipsene der — startbildet skal aldri blokkere på et regnestykke.
    aiRadgiver.oversikt(aktivOrg.id).then(setKort).catch(() => setKort([]));
    aiRadgiver.samtaler(aktivOrg.id).then(setSamtaler).catch(() => {});
  }, [aktivOrg]);

  useEffect(() => {
    bunn.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turer, venter]);

  async function spor(tekst: string) {
    if (!tekst.trim() || !aktivOrg || venter) return;
    setTurer((t) => [...t, { rolle: "bruker", tekst }]);
    setMelding("");
    setVenter(true);
    setFeil(null);
    try {
      const svar = await aiRadgiver.spor(aktivOrg.id, { melding: tekst, samtaleId });
      const nySamtale = samtaleId === null;
      setSamtaleId(svar.samtaleId);
      setTurer((t) => [...t, { rolle: "assistent", tekst: svar.svar, kilder: svar.kilder }]);
      if (nySamtale) aiRadgiver.samtaler(aktivOrg.id).then(setSamtaler).catch(() => {});
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Rådgiveren svarte ikke");
    } finally {
      setVenter(false);
    }
  }

  async function apneSamtale(id: string) {
    if (!aktivOrg) return;
    setFeil(null);
    try {
      const s = await aiRadgiver.hent(aktivOrg.id, id);
      setSamtaleId(s.id);
      setTurer(
        s.meldinger.map((m) => ({
          rolle: m.role === "user" ? ("bruker" as const) : ("assistent" as const),
          tekst: m.content,
          kilder: m.sources ? (JSON.parse(m.sources) as string[]) : undefined,
        })),
      );
      setViserSamtaler(false);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente samtalen");
    }
  }

  return (
    <Layout
      tittel="AI-rådgiver"
      handlinger={
        <>
          {turer.length > 0 && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setTurer([]);
                setSamtaleId(null);
              }}
            >
              <Plus size={16} strokeWidth={1.9} aria-hidden />
              Ny samtale
            </button>
          )}
          {samtaler.length > 0 && (
            <button className="btn btn-ghost" onClick={() => setViserSamtaler(true)}>
              <History size={16} strokeWidth={1.9} aria-hidden />
              Tidligere samtaler ({samtaler.length})
            </button>
          )}
        </>
      }
    >
      <div className="page-content ai-side">
        <Feil melding={feil} />

        {turer.length === 0 ? (
          <div className="ai-start">
            <h3 className="ai-hilsen">Spør om driften deres</h3>
            <p className="ai-ingress">
              Rådgiveren leser kontrakter, avvik, internkontroll og driftslogg for{" "}
              {aktivOrg?.name ?? "laget"}, og viser hvilke kilder svaret bygger på.
            </p>

            {kort && kort.length > 0 && (
              <>
                <div className="ai-eyebrow">
                  <span>Det som skiller seg ut nå</span>
                  <i aria-hidden />
                  <time>{new Date().toLocaleDateString("nb-NO")}</time>
                </div>
                <div className="ai-kort-stabel">
                  {kort.map((k) => (
                    <button key={k.tittel} className={`ai-kort ${k.tone}`} onClick={() => void spor(k.sporsmal)}>
                      <span className="ai-tall">
                        {k.antall}
                        <small>{k.enhet}</small>
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <b>{k.tittel}</b>
                        <span className="ai-kort-detalj">{k.detalj}</span>
                      </span>
                      <ArrowRight size={16} strokeWidth={1.9} aria-hidden className="ai-pil" />
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="ai-chips">
              {FORSLAG.map((f) => (
                <button key={f} className="ai-chip" onClick={() => void spor(f)}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ai-samtale">
            {turer.map((t, n) => (
              <div key={n} className={`ai-tur ${t.rolle}`}>
                <div className="ai-boble">
                  {t.rolle === "assistent" ? <Svartekst tekst={t.tekst} /> : t.tekst}
                </div>
                {t.kilder && t.kilder.length > 0 && (
                  <div className="ai-kilder">
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
            <div ref={bunn} />
          </div>
        )}

        {/* Feltet står nederst og BLIR der — `sticky` mot sidens scrollflate, så det er
            innen rekkevidde også midt i en lang samtale. */}
        <div className="ai-fot">
          <form
            className="ai-felt"
            onSubmit={(e) => {
              e.preventDefault();
              void spor(melding.trim());
            }}
          >
            <input
              placeholder="Still et konkret spørsmål om drift, kontrakter, HMS eller avvik"
              aria-label="Spørsmål til AI-rådgiveren"
              value={melding}
              onChange={(e) => setMelding(e.target.value)}
              disabled={venter}
            />
            <button className="ai-send" aria-label="Send" disabled={!melding.trim() || venter}>
              <ArrowUp size={16} strokeWidth={2.2} aria-hidden />
            </button>
          </form>
          <div className="ai-notat">
            <ShieldCheck size={13} strokeWidth={1.9} aria-hidden />
            <span>
              Rådgiveren ser kun data fra {aktivOrg?.name ?? "deres eget lag"}. Svarene støtter
              styrets egne vurderinger og er ikke bindende juridisk rådgivning.
            </span>
          </div>
        </div>
      </div>

      {viserSamtaler && (
        <Modal tittel="Tidligere samtaler" onLukk={() => setViserSamtaler(false)}>
          {samtaler.length === 0 ? (
            <Tom tekst="Ingen samtaler ennå." />
          ) : (
            samtaler.map((s) => (
              <div key={s.id} className="ai-samtalerad">
                <button className="ai-samtalevalg" onClick={() => void apneSamtale(s.id)}>
                  <span className="list-tittel">{s.title}</span>
                  <span className="list-meta">Sist aktiv {siden(s.updatedAt)}</span>
                </button>
                <button
                  className="ikon-btn"
                  aria-label={`Slett samtalen «${s.title}»`}
                  onClick={() => {
                    if (!aktivOrg) return;
                    void aiRadgiver
                      .slett(aktivOrg.id, s.id)
                      .then(() => {
                        setSamtaler((liste) => liste.filter((x) => x.id !== s.id));
                        // Sto den åpen, skal den ikke fortsette som spøkelse i chatten.
                        if (samtaleId === s.id) {
                          setTurer([]);
                          setSamtaleId(null);
                        }
                      })
                      .catch(() => {});
                  }}
                >
                  <Trash2 size={15} strokeWidth={1.9} aria-hidden />
                </button>
              </div>
            ))
          )}
          <div className="field-note">
            Samtaler er private — kollegene dine ser ikke dine. De slettes automatisk etter et
            halvt år.
          </div>
        </Modal>
      )}
    </Layout>
  );
}
