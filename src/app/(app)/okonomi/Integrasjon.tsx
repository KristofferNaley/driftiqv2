"use client";

import { useEffect, useState } from "react";
import { FileSpreadsheet, Link2, Sheet } from "lucide-react";
import { useOkt } from "@/components/OktProvider";
import { Feil, Kort, Tom, dato, datoTid, useOrgData } from "@/components/felles";
import { Kommer, Tekstfelt } from "@/components/skjema";
import { okonomi, type FikenKjop } from "@/lib/klient";
import { kroner } from "@/lib/okonomiregler";

/**
 * Regnskapskoblingen. Fiken-kortet er LIVE (steg 2: lesing — kjøp speiles inn som «faktisk»
 * i budsjettet); det som krever skriving mot Fiken (fakturaer, betalingsstatus, kreditnota
 * ved eierskifte) står som Kommer under. Rekkefølgen og grensene er docs/fiken.md.
 */
export default function Integrasjon() {
  const { aktivOrg } = useOkt();
  const erAdmin = aktivOrg?.nivaa === "orgadmin";
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => okonomi.fiken.status(o));
  const [melding, setMelding] = useState<string | null>(null);
  const [jobber, setJobber] = useState(false);

  // Feil fra OAuth-callbacken kommer som `?fikenfeil=` — leses ved innsending/montering,
  // ikke via useSearchParams (se CLAUDE.md om klientrendring).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("fikenfeil");
    if (p) setFeil(p);
  }, [setFeil]);

  async function utfor(fn: () => Promise<string | void>) {
    if (!orgId) return;
    setFeil(null);
    setMelding(null);
    setJobber(true);
    try {
      const m = await fn();
      if (m) setMelding(m);
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Noe gikk galt");
    } finally {
      setJobber(false);
    }
  }

  const k = data?.kobling ?? null;

  return (
    <>
      <Feil melding={feil} />
      {melding && <div className="ok-melding">{melding}</div>}

      <div className="ok-to-kolonner">
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Kort
            tittel="Fiken"
            handling={
              data && (
                <span className={`badge ${k ? (k.lastSyncError ? "danger" : "ok") : "muted"}`}>
                  {k ? (k.lastSyncError ? "Feil ved synk" : "Tilkoblet") : "Ikke tilkoblet"}
                </span>
              )
            }
          >
            {laster || !data ? (
              <Tom tekst="Henter …" />
            ) : k ? (
              <div className="ok-seksjon-panel" style={{ padding: "14px" }}>
                <div className="ok-fakta">
                  <div>
                    <span className="ok-fakta-et">Foretak</span>
                    <div className="ok-fakta-v">{k.companyName}</div>
                    <div className="list-meta">{k.companyOrgNumber ? `org.nr ${k.companyOrgNumber} · ` : ""}{k.companySlug}</div>
                  </div>
                  <div>
                    <span className="ok-fakta-et">Siste synk</span>
                    <div className="ok-fakta-v">{k.lastSyncAt ? datoTid(k.lastSyncAt) : "Aldri"}</div>
                    <div className="list-meta">automatisk hver natt kl. 05:30</div>
                  </div>
                  <div>
                    <span className="ok-fakta-et">Kjøp speilet</span>
                    <div className="ok-fakta-v">{data.kjop.antall}</div>
                    <div className="list-meta">{kroner(data.kjop.sum)} totalt</div>
                  </div>
                  <div>
                    <span className="ok-fakta-et">Kobling</span>
                    <div className="ok-fakta-v mut">{k.authMode === "oauth" ? "OAuth" : "API-nøkkel (test)"}</div>
                    <div className="list-meta">av {k.connectedBy}, {dato(k.createdAt)}</div>
                  </div>
                </div>
                {k.vatType && k.vatType !== "no" && k.vatType !== "none" && (
                  <div className="field-note">
                    Foretaket er mva-registrert i Fiken ({k.vatType}). Et sameie er normalt utenfor mva-området; sjekk
                    innstillingen i Fiken hvis det ikke stemmer.
                  </div>
                )}
                {k.lastSyncError && <div className="feilmelding">Siste synk feilet: {k.lastSyncError}</div>}
                <p className="ok-tekst" style={{ padding: 0 }}>
                  Bokførte kjøp fra Fiken er nå «faktisk» i budsjettet, per konto. DriftIQ leser bare — ingenting
                  skrives til Fiken i dette steget.
                </p>
                {erAdmin && (
                  <div className="ok-handlinger">
                    <button
                      className="btn btn-primary"
                      disabled={jobber}
                      onClick={() =>
                        void utfor(async () => {
                          const r = await okonomi.fiken.synk(orgId!);
                          if (!r.ok) throw new Error(`Synk feilet: ${r.feil}`);
                          return `Synkronisert: ${r.hentet} kjøp hentet, ${r.nye} nye, ${r.oppdaterte} oppdatert.`;
                        })
                      }
                    >
                      {jobber ? "Synkroniserer …" : "Synk nå"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      disabled={jobber}
                      onClick={() =>
                        window.confirm("Koble fra Fiken? Speilede kjøp slettes; budsjettet går tilbake til godkjente fakturaer som faktisk.") &&
                        void utfor(async () => {
                          await okonomi.fiken.kobleFra(orgId!);
                          return "Koblet fra Fiken.";
                        })
                      }
                    >
                      Koble fra
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <KobleTil
                erAdmin={erAdmin}
                konfigurert={data.konfigurert}
                startUrl={orgId ? okonomi.fiken.startUrl(orgId) : "#"}
                onNokkel={(apiKey, slug) =>
                  utfor(async () => {
                    await okonomi.fiken.kobleTilMedNokkel(orgId!, { apiKey, slug: slug || null });
                    return "Koblet til. Trykk «Synk nå» for å hente kjøpene.";
                  })
                }
              />
            )}
          </Kort>

          {k && orgId && <Kjopsliste orgId={orgId} />}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <Kort tittel="Neste steg med Fiken">
            <Kommer
              Ikon={Link2}
              tekst="Steg 3: DriftIQ oppretter fakturaene i Fiken og leser betalingsstatus tilbake. Budsjett, brøk, sats og fakturagrunnlag lever her — bokføring, utsending og purring lever i Fiken."
              punkter={[
                "Eiere som er fakturamottakere opprettes som kontakter i Fiken, merket med seksjonen",
                "Halvårskjøringen oppretter seks fakturaer per seksjon med fremtidig dato og forfall den 15.",
                "Betalingsstatus leses tilbake hver natt — «hvem har ikke betalt» per seksjon",
                "Eierskifte midt i halvåret krediterer resterende fakturaer og lager nye til ny eier",
              ]}
              notat="Krever produksjonsgodkjenning av OAuth-appen hos Fiken. KID og AvtaleGiro avklares med banken."
            />
          </Kort>
          <Kort tittel="Tripletex">
            <Kommer
              Ikon={Sheet}
              tekst="Samme kobling bak samme grensesnitt, for sameier med regnskapsfører på Tripletex."
              punkter={["Eiere blir kunder, felleskostnader blir fakturaer, kontoplanen leses fra Tripletex"]}
              notat="Bygges etter Fiken, når adapteret er bevist i drift."
            />
          </Kort>
          <Kort tittel="Virker uten regnskapssystem">
            <ul className="kommer-liste" style={{ padding: "12px 14px 14px 30px" }}>
              <li className="kommer-punkt">
                <FileSpreadsheet size={14} strokeWidth={1.9} aria-hidden style={{ verticalAlign: "-2px", marginRight: "6px" }} />
                CSV per halvår til forretningsfører: seksjon, eier, måned, forfall, beløp og referanse
              </li>
              <li className="kommer-punkt">Kontointervallene følger NS 4102 — samme nummer i Fiken, Tripletex og hos forretningsfører</li>
              <li className="kommer-punkt">Uten kobling er godkjente fakturaer «faktisk» i budsjettet</li>
            </ul>
          </Kort>
        </div>
      </div>
    </>
  );
}

function KobleTil({
  erAdmin,
  konfigurert,
  startUrl,
  onNokkel,
}: {
  erAdmin: boolean;
  konfigurert: { kryptering: boolean; oauth: boolean; apiNokkel: boolean };
  startUrl: string;
  onNokkel: (apiKey: string, slug: string) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [slug, setSlug] = useState("");
  const [sender, setSender] = useState(false);

  if (!erAdmin) return <Tom tekst="Regnskapskoblingen settes opp av kontoadmin." />;
  if (!konfigurert.kryptering) {
    return <Tom tekst="Koblingen er ikke satt opp på serveren (mangler nøkkel for tokenkryptering)." />;
  }

  return (
    <div className="ok-seksjon-panel" style={{ padding: "14px" }}>
      <p className="ok-tekst" style={{ padding: 0 }}>
        Koble sameiets eget Fiken-foretak. DriftIQ leser bokførte kjøp og viser dem som «faktisk» mot budsjettet.
        Ingenting skrives til Fiken.
      </p>
      {konfigurert.oauth ? (
        <a className="btn btn-primary" href={startUrl} style={{ alignSelf: "flex-start" }}>
          Koble til med Fiken-innlogging
        </a>
      ) : (
        <div className="field-note">Fiken-innlogging (OAuth) er ikke satt opp på denne serveren ennå.</div>
      )}
      {konfigurert.apiNokkel && (
        <form
          style={{ display: "flex", flexDirection: "column", gap: "12px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}
          onSubmit={(e) => {
            e.preventDefault();
            setSender(true);
            void onNokkel(apiKey.trim(), slug.trim()).finally(() => setSender(false));
          }}
        >
          <div className="field-note">
            <strong>Testmiljø:</strong> personlig API-nøkkel mot et demoforetak. Finnes ikke i produksjon — Fikens
            vilkår forbyr personlig nøkkel i en tredjepartsapp.
          </div>
          <Tekstfelt etikett="API-nøkkel" verdi={apiKey} onEndre={setApiKey} type="password" />
          <Tekstfelt etikett="Foretak (slug)" verdi={slug} onEndre={setSlug} plassholder="fiken-demo-venstre-sky-esek" notat="Tom = det ene foretaket nøkkelen har tilgang til." />
          <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} disabled={sender || !apiKey.trim()}>
            {sender ? "Kobler …" : "Koble til med nøkkel"}
          </button>
        </form>
      )}
    </div>
  );
}

function Kjopsliste({ orgId }: { orgId: string }) {
  const [aar, setAar] = useState(new Date().getFullYear());
  const [rader, setRader] = useState<FikenKjop[] | null>(null);
  useEffect(() => {
    let aktiv = true;
    okonomi.fiken.kjop(orgId, aar).then((r) => aktiv && setRader(r)).catch(() => aktiv && setRader([]));
    return () => {
      aktiv = false;
    };
  }, [orgId, aar]);

  return (
    <Kort
      tittel={`Kjøp fra Fiken ${aar}`}
      handling={
        <div className="ok-handlinger">
          <button className="btn btn-ghost" onClick={() => setAar((a) => a - 1)}>‹</button>
          <button className="btn btn-ghost" onClick={() => setAar((a) => a + 1)}>›</button>
        </div>
      }
    >
      {!rader ? (
        <Tom tekst="Henter …" />
      ) : rader.length === 0 ? (
        <Tom tekst={`Ingen kjøp i ${aar}. Trykk «Synk nå» hvis koblingen er ny.`} />
      ) : (
        <>
          <div className="ok-seksfakt-hode" aria-hidden>
            <span>Leverandør</span>
            <span>Dato</span>
            <span className="ok-belop-celle">Brutto</span>
            <span>Konto</span>
          </div>
          {rader.slice(0, 50).map((r) => (
            <div key={r.id} className="ok-seksfakt-rad">
              <span style={{ minWidth: 0 }}>
                <span className="list-tittel">{r.supplierName ?? "Ukjent"}</span>
                <span className="list-meta"> {r.identifier ? `· ${r.identifier}` : ""}{r.linjer[0]?.description ? ` · ${r.linjer[0].description}` : ""}</span>
              </span>
              <span className="list-meta">{dato(r.date)}{r.settled ? "" : r.paid ? "" : " · ubetalt"}</span>
              <span className="ok-belop-celle">{kroner(r.gross)}</span>
              <span className="list-meta">{[...new Set(r.linjer.map((l) => l.account).filter(Boolean))].join(", ") || "—"}</span>
            </div>
          ))}
          {rader.length > 50 && <div className="list-meta" style={{ padding: "8px 12px" }}>Viser 50 av {rader.length}.</div>}
        </>
      )}
    </Kort>
  );
}
