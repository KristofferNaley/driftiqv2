"use client";

import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { Faner, Feil, Kort, Rad, Tom, datoTid, useOrgData } from "@/components/felles";
import { Avkryssing, Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { enheter, hendelser as hendelserApi, organisasjon, webhooks as webhooksApi, type Adressetreff, type Enhet, type OrgInfo, type Webhook } from "@/lib/klient";
import { lesKategorier } from "@/lib/avvikkategorier";
import { MENY } from "@/lib/moduler";
import {
  WEBHOOK_HENDELSER,
  WEBHOOK_HENDELSE_ETIKETT,
  WEBHOOK_TYPER,
  WEBHOOK_TYPE_ETIKETT,
  type WebhookType,
} from "@/lib/webhookvalg";
import UnlocKort from "./UnlocKort";

/** Samme trinn som API-et — se `formatterStorrelse` i lib/lagring.ts. */
function storrelse(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / 1024 / 1024)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1).replace(".", ",")} GB`;
}

export default function Innstillinger() {
  const [fane, setFane] = useState<"org" | "kategorier" | "leiligheter" | "fellesomrader" | "integrasjoner" | "hendelser">("org");
  const { aktivOrg } = useOkt();
  return (
    <Layout
      tittel="Innstillinger"
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={[
            { nokkel: "org", etikett: "Generelt" },
            { nokkel: "kategorier", etikett: "Avvikskategorier" },
            { nokkel: "leiligheter", etikett: "Leiligheter" },
            { nokkel: "fellesomrader", etikett: "Fellesområder" },
            // API-ene bak er admin-gatet uansett — fanene skjules så andre slipper en 403.
            ...(aktivOrg?.nivaa === "orgadmin"
              ? [
                  { nokkel: "integrasjoner" as const, etikett: "Integrasjoner" },
                  { nokkel: "hendelser" as const, etikett: "Hendelseslogg" },
                ]
              : []),
          ]}
        />
      }
    >
      <div className="page-content">
        {fane === "org" && <Organisasjonen />}
        {fane === "kategorier" && <Kategorier />}
        {fane === "leiligheter" && <Enheter visning="bolig" />}
        {fane === "fellesomrader" && <Enheter visning="fellesareal" />}
        {fane === "integrasjoner" && <Integrasjoner />}
        {fane === "hendelser" && <Hendelseslogg />}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------------------

function Organisasjonen() {
  const { aktivOrg } = useOkt();
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => organisasjon.hent(o));
  const [redigerer, setRedigerer] = useState(false);
  const [lasterBanner, setLasterBanner] = useState(false);
  const erAdmin = aktivOrg?.nivaa === "orgadmin";

  async function lastOppBanner(e: React.ChangeEvent<HTMLInputElement>) {
    const fil = e.target.files?.[0];
    if (!fil || !orgId) return;
    setLasterBanner(true);
    setFeil(null);
    const form = new FormData();
    form.append("file", fil);
    try {
      await organisasjon.lastOppBanner(orgId, form);
      await last();
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Opplasting feilet");
    } finally {
      setLasterBanner(false);
      e.target.value = "";
    }
  }

  async function fjernBanner() {
    if (!orgId) return;
    try {
      await organisasjon.fjernBanner(orgId);
      await last();
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Kunne ikke fjerne banneret");
    }
  }

  if (laster || !data) {
    return (
      <>
        <Feil melding={feil} />
        {!feil && <Tom tekst="Henter …" />}
      </>
    );
  }

  return (
    <>
      <Feil melding={feil} />

      {/* Kontooppsettet (navn, org.nr., antall enheter) vises IKKE her lenger — det eies og
          vedlikeholdes av plattformadmin, og kunden trenger ikke et forhold til det. Igjen
          står bare driftsfeltene styret selv eier: «Om bygget» og «Har ansatte». */}
      <Kort
        tittel="Om bygget"
        handling={
          <button className="btn btn-ghost" onClick={() => setRedigerer(true)}>
            Rediger
          </button>
        }
      >
        {data.buildingInfo ? (
          <div style={{ padding: "14px 20px 6px", fontSize: "var(--fs-sm)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {data.buildingInfo}
          </div>
        ) : (
          <Tom tekst="Ingenting om bygget ennå — byggeår, materialer, anlegg. Brukes i det daglige og av AI-rådgiveren." />
        )}
        <Rad
          tittel="Har ansatte"
          hoyre={
            data.hasEmployees ? <span className="badge info">Ja</span> : <span className="badge muted">Nei</span>
          }
        />
      </Kort>

      <Kort
        tittel="Dashbordbanner"
        handling={
          erAdmin && (
            <div style={{ display: "flex", gap: "8px" }}>
              {data.bannerFileName && (
                <button className="btn btn-ghost" style={{ color: "var(--muted)" }} onClick={() => void fjernBanner()}>
                  Fjern
                </button>
              )}
              <label className="btn btn-ghost" style={{ cursor: "pointer" }}>
                {lasterBanner ? "Laster opp …" : data.bannerFileName ? "Bytt bilde" : "Last opp bilde"}
                <input type="file" hidden accept="image/png,image/jpeg,image/webp" disabled={lasterBanner} onChange={(e) => void lastOppBanner(e)} />
              </label>
            </div>
          )
        }
      >
        {data.bannerFileName ? (
          <div style={{ padding: "0 20px 16px" }}>
            {/* Nøkkelen i src tvinger ny henting når bildet byttes — samme URL, ny fil. */}
            <img
              src={`/api/organizations/${orgId}/banner/file?v=${encodeURIComponent(data.bannerFileName)}`}
              alt={data.bannerOriginalName ?? "Dashbordbanner"}
              style={{ width: "100%", maxHeight: "180px", objectFit: "cover", borderRadius: "10px", display: "block" }}
            />
          </div>
        ) : (
          <Tom tekst="Ingen banner — dashbordet viser bare widgetene. Et bilde av bygget gjør forsiden til deres." />
        )}
      </Kort>

      <Kort tittel="Lagring">
        <div style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
            <span className="list-tittel">
              {storrelse(data.lagring.brukt)} av {storrelse(data.lagring.kvote)}
            </span>
            <span className="list-meta">{data.lagring.prosent} %</span>
          </div>
          <div className="tg-spor">
            <div
              className="tg-fyll"
              style={{
                width: `${Math.min(100, data.lagring.prosent)}%`,
                ["--tg-farge" as string]:
                  data.lagring.prosent > 90 ? "var(--danger)" : data.lagring.prosent > 70 ? "var(--warn)" : "var(--accent2)",
              }}
            />
          </div>
        </div>
      </Kort>

      {erAdmin && (
        <Kort
          tittel="Eksport og backup"
          handling={
            <a className="btn btn-ghost" href={`/api/organizations/${orgId}/eksport`}>
              ⬇ Last ned komplett arkiv (ZIP)
            </a>
          }
        >
          <div style={{ padding: "0 20px 16px", fontSize: "var(--fs-sm)", lineHeight: 1.6, color: "var(--muted)" }}>
            Alle lagets data i én fil: registrene som <code>data.json</code>, og hvert eneste
            dokument og bilde med lesbare navn i mapper — for backup, revisjon, meglerpakke
            eller flytting ut av DriftIQ. Dataene er deres; dere skal alltid kunne ta dem med.
          </div>
        </Kort>
      )}

      {redigerer && (
        <RedigerBygg org={data} orgId={orgId!} onLukk={() => setRedigerer(false)} onLagret={last} />
      )}
    </>
  );
}

/** Bare driftsfeltene — kontooppsettet (navn, org.nr., antall enheter) eies av plattformadmin. */
function RedigerBygg({
  org,
  orgId,
  onLukk,
  onLagret,
}: {
  org: OrgInfo;
  orgId: string;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [bygg, setBygg] = useState(org.buildingInfo ?? "");
  const [ansatte, setAnsatte] = useState(org.hasEmployees);
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Om bygget" onLukk={onLukk} bredde={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => organisasjon.endre(orgId, { buildingInfo: bygg || null, hasEmployees: ansatte }));
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstomrade
          etikett="Om bygget"
          verdi={bygg}
          onEndre={setBygg}
          notat="Brukes i det daglige og mates inn i AI-rådgiverens systemprompt."
        />
        <Avkryssing
          etikett="Laget har ansatte"
          verdi={ansatte}
          onEndre={setAnsatte}
          notat="Uten ansatte gjelder verken arbeidsmiljøloven eller forurensningsloven (internkontrollforskriften § 2), og vernerunde og verneombud er ikke reelle krav."
        />
        <Knapperad onAvbryt={onLukk} sender={sender} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------

/**
 * Avvikskategoriene kunden velger mellom.
 *
 * ## Navnet kan endres, verdien ikke
 *
 * Hver kategori har en `verdi` som lagres på avviket. Endres den, peker gamle avvik på noe
 * som ikke finnes lenger, og de mister merkelappen uten at noen får beskjed. Derfor sendes
 * verdien uendret tilbake for eksisterende kategorier, og utledes bare for nye.
 *
 * ## Ingen sletting, bare av
 *
 * Av samme grunn. «Av» tar kategorien ut av nedtrekket for NYE avvik; gamle beholder navnet
 * sitt i lista og i rapportene.
 */
function Kategorier() {
  const { aktivOrg } = useOkt();
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => organisasjon.hent(o));
  const [rader, setRader] = useState<Array<{ verdi?: string; etikett: string; aktiv: boolean }>>([]);
  const [lagrer, setLagrer] = useState(false);
  const kanEndre = aktivOrg?.nivaa === "orgadmin" || aktivOrg?.nivaa === "redigering";

  useEffect(() => {
    if (!data) return;
    setRader(lesKategorier(data.deviationCategories).map((k) => ({ ...k, aktiv: k.aktiv !== false })));
  }, [data]);

  async function lagre() {
    if (!orgId) return;
    setLagrer(true);
    setFeil(null);
    try {
      await organisasjon.settKategorier(orgId, rader.filter((r) => r.etikett.trim()));
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre kategoriene");
    } finally {
      setLagrer(false);
    }
  }

  if (laster || !data) {
    return (
      <>
        <Feil melding={feil} />
        {!feil && <Tom tekst="Henter …" />}
      </>
    );
  }

  return (
    <>
      <Feil melding={feil} />
      <Kort
        tittel="Avvikskategorier"
        handling={
          kanEndre && (
            <button className="btn btn-primary" onClick={() => void lagre()} disabled={lagrer}>
              {lagrer ? "Lagrer …" : "Lagre"}
            </button>
          )
        }
      >
        {rader.map((r, i) => (
          <div key={r.verdi ?? `ny-${i}`} className="list-item">
            <input
              className="input"
              style={{ flex: 1, minWidth: 0 }}
              value={r.etikett}
              disabled={!kanEndre}
              aria-label={`Navn på kategori ${i + 1}`}
              // En ny rad tar fokus selv. Uten det legger man til raden, skriver — og
              // ingenting skjer, fordi teksten gikk til siden i stedet for feltet.
              autoFocus={r.verdi === undefined && i === rader.length - 1}
              placeholder="Navn på kategorien"
              onChange={(e) =>
                setRader(rader.map((x, j) => (j === i ? { ...x, etikett: e.target.value } : x)))
              }
            />
            <label className="kategori-av">
              <input
                type="checkbox"
                checked={r.aktiv}
                disabled={!kanEndre}
                onChange={(e) =>
                  setRader(rader.map((x, j) => (j === i ? { ...x, aktiv: e.target.checked } : x)))
                }
              />
              <span>{r.aktiv ? "Aktiv" : "Av"}</span>
            </label>
          </div>
        ))}

        {kanEndre && (
          <div className="list-item">
            <button
              className="btn btn-ghost"
              onClick={() => setRader([...rader, { etikett: "", aktiv: true }])}
            >
              ＋ Ny kategori
            </button>
          </div>
        )}
      </Kort>

      <div className="field-note">
        Navnet kan endres når som helst — gamle avvik følger med. En kategori kan ikke
        slettes, bare settes til «Av»: da forsvinner den fra nedtrekket for nye avvik, mens
        avvikene som allerede bruker den beholder merkelappen sin.
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------

/**
 * Leiligheter og fellesområder — to faner over samme register.
 *
 * Delt fordi de svarer på ulike spørsmål og identifiseres ulikt: en leilighet kjennes på
 * nummer (H0305, andel 26), et fellesområde på navn («Bossrom oppgang B»). I én liste
 * blandet 84 leiligheter bort de fire fellesområdene folk faktisk leter etter.
 *
 * Samme tabell under — `units.type` skiller dem. Avvik peker hit via `unitId` uansett
 * hvilken av de to det er, og det er nettopp derfor de deler register.
 */
function Enheter({ visning }: { visning: "bolig" | "fellesareal" }) {
  const fellesareal = visning === "fellesareal";
  const [medArkiverte, setMedArkiverte] = useState(false);
  const { data, feil, setFeil, laster, last, orgId } = useOrgData(
    (o) => enheter.liste(o, medArkiverte),
    [medArkiverte],
  );
  const [nyEnhet, setNyEnhet] = useState(false);
  const [endrer, setEndrer] = useState<Enhet | null>(null);
  const [kartverk, setKartverk] = useState(false);
  const liste = (data ?? []).filter((e) =>
    fellesareal ? e.type === "fellesareal" : e.type !== "fellesareal",
  );

  async function arkiver(e: Enhet) {
    if (!orgId) return;
    try {
      await enheter.arkiver(orgId, e.id);
      await last();
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Kunne ikke arkivere enheten");
    }
  }

  return (
    <>
      <Feil melding={feil} />

      <Kort
        tittel={`${fellesareal ? "Fellesområder" : "Leiligheter"} (${liste.length})`}
        handling={
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "7px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={medArkiverte}
                onChange={(e) => setMedArkiverte(e.target.checked)}
              />
              <span className="list-meta">Vis arkiverte</span>
            </label>
            {!fellesareal && (
              <button className="btn btn-ghost" onClick={() => setKartverk(true)}>
                Hent fra Kartverket
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => setNyEnhet(true)}>
              {fellesareal ? "Nytt fellesområde" : "Ny leilighet"}
            </button>
          </div>
        }
      >
        {laster ? (
          <Tom tekst="Henter …" />
        ) : liste.length === 0 ? (
          <Tom
            tekst={
              fellesareal
                ? "Ingen fellesområder registrert. Bossrom, takterrasse, vaskeri — det man melder avvik på uten at det tilhører en bestemt leilighet."
                : "Ingen leiligheter registrert."
            }
          />
        ) : (
          <>
            <div className="enhet-hode" aria-hidden>
              <span>{fellesareal ? "Navn" : "Leilighet"}</span>
              <span className="enhet-oppgang">Oppgang</span>
              <span className="enhet-etasje">Etasje</span>
              {/* Totalen er historikken (gjentakende fukt over år), de åpne er nå. */}
              <span className="enhet-tall">Avvik</span>
              <span className="enhet-tall">Åpne</span>
              <span />
            </div>
            {liste.map((e) => (
              <div key={e.id} className="enhet-rad">
                <div style={{ minWidth: 0 }}>
                  <div className="list-tittel">{e.navn ?? e.leilighetsnr ?? `Andel ${e.andelsnr ?? "?"}`}</div>
                  {/* Kvadratmeterne står i basen, men ikke her — de svarer ikke på noe man
                      leter etter i denne lista. */}
                  {(e.andelsnr || e.brokTeller !== null) && (
                    <div className="list-meta">
                      {[e.andelsnr && `andel ${e.andelsnr}`, e.brokTeller !== null && `brøk ${e.brokTeller}/${e.brokNevner}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                </div>
                <span className="enhet-celle enhet-oppgang">{e.oppgang ?? "—"}</span>
                <span className="enhet-celle enhet-etasje">{e.etasje ?? "—"}</span>
                <span className="enhet-tall">{e.antallAvvik || "—"}</span>
                <span className="enhet-tall" style={e.apneAvvik ? { fontWeight: 600 } : undefined}>
                  {e.apneAvvik || "—"}
                </span>
                <span className="enhet-handling">
                  {e.archivedAt ? (
                    <span className="badge muted">Arkivert</span>
                  ) : (
                    <>
                      <button className="btn btn-ghost" onClick={() => setEndrer(e)}>
                        Endre
                      </button>
                      <button className="btn btn-ghost" style={{ color: "var(--muted)" }} onClick={() => arkiver(e)}>
                        Arkiver
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </>
        )}
      </Kort>

      <div className="field-note">
        Registeret inneholder bare fysiske fakta og sameiebrøken — ingen eiere, beboere eller
        kontaktopplysninger. Eierne ligger i Økonomi → Seksjoner og eiere, med egen
        databehandleravtale. Enheter arkiveres, aldri slettes — avvikshistorikken skal overleve.
      </div>

      {nyEnhet && (
        <EnhetSkjema
          orgId={orgId!}
          fellesareal={fellesareal}
          onLukk={() => setNyEnhet(false)}
          onLagret={last}
        />
      )}
      {endrer && (
        <EnhetSkjema
          orgId={orgId!}
          fellesareal={fellesareal}
          utgangspunkt={endrer}
          onLukk={() => setEndrer(null)}
          onLagret={last}
        />
      )}
      {kartverk && (
        <KartverketImport
          orgId={orgId!}
          eksisterende={liste}
          onLukk={() => setKartverk(false)}
          onImportert={last}
        />
      )}
    </>
  );
}

/**
 * H0101 → «1», U0101 → «U1», K0101 → «K1», L0101 → «L1». H-prefikset er hovedetasje og
 * trenger ingen bokstav i visningen; de andre beholder den (underetasje/kjeller/loft).
 */
function etasjeFraBruksenhet(nr: string): string {
  const m = /^([HULK])(\d{2})\d{2}$/.exec(nr.trim().toUpperCase());
  if (!m) return "";
  const etasje = String(parseInt(m[2]!, 10));
  return m[1] === "H" ? etasje : `${m[1]}${etasje}`;
}

/**
 * Autofyll fra Kartverkets adresse-API (via vår proxy): hver vegadresse har en liste
 * bruksenhetsnummer (H0101 …) som blir leilighetsnummer, med etasje utledet av nummeret og
 * oppgang fra husbokstaven — eller husnummeret der bokstav mangler (Gata 9 og Gata 11 er to
 * innganger). Andelsnummer finnes ikke i det åpne API-et og fylles inn etterpå.
 */
function KartverketImport({
  orgId,
  eksisterende,
  onLukk,
  onImportert,
}: {
  orgId: string;
  eksisterende: Enhet[];
  onLukk: () => void;
  onImportert: () => Promise<void>;
}) {
  const [sok, setSok] = useState("");
  const [soker, setSoker] = useState(false);
  const [adresser, setAdresser] = useState<Adressetreff[] | null>(null);
  const [valgte, setValgte] = useState<Set<string>>(new Set());
  const [sender, setSender] = useState(false);
  const [resultat, setResultat] = useState<{ opprettet: number; hoppetOver: number } | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  async function kjorSok(e: React.FormEvent) {
    e.preventDefault();
    setSoker(true);
    setFeil(null);
    setValgte(new Set());
    try {
      setAdresser(await enheter.adressesok(orgId, sok));
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Søket feilet");
    } finally {
      setSoker(false);
    }
  }

  // Radene som ville blitt opprettet fra valgte adresser — og hvor mange som alt finnes
  // (nøkkel oppgang + leilighetsnummer, samme som serverens hopp-over-regel).
  const rader = (adresser ?? [])
    .filter((a) => a.adressetekst && valgte.has(a.adressetekst))
    .flatMap((a) =>
      a.bruksenhetsnummer.map((b) => ({
        leilighetsnr: b,
        oppgang: a.bokstav || String(a.nummer ?? ""),
        etasje: etasjeFraBruksenhet(b),
      })),
    );
  const opptatt = new Set(
    eksisterende.map((e) => `${(e.oppgang ?? "").toLowerCase()}|${(e.leilighetsnr ?? "").toLowerCase()}`),
  );
  const nye = rader.filter((r) => !opptatt.has(`${r.oppgang.toLowerCase()}|${r.leilighetsnr.toLowerCase()}`));

  async function importer() {
    setSender(true);
    setFeil(null);
    try {
      const res = await enheter.importer(orgId, rader);
      setResultat(res);
      await onImportert();
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Importen feilet");
    } finally {
      setSender(false);
    }
  }

  return (
    <Modal tittel="Hent leiligheter fra Kartverket" onLukk={onLukk} bredde={560}>
      {resultat ? (
        <>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, margin: 0 }}>
            Opprettet <b>{resultat.opprettet}</b> leilighet{resultat.opprettet === 1 ? "" : "er"}
            {resultat.hoppetOver > 0 && (
              <> — {resultat.hoppetOver} fantes fra før og ble hoppet over</>
            )}
            . Andelsnummer finnes ikke hos Kartverket; de legges inn med «Endre» på hver rad.
          </p>
          <Knapperad onAvbryt={onLukk} avbrytEtikett="Lukk" sendEtikett="Nytt søk" onSend={() => { setResultat(null); setAdresser(null); setSok(""); }} />
        </>
      ) : (
        <>
          <form onSubmit={kjorSok} style={{ display: "flex", gap: "10px" }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Gateadresse, f.eks. «Håsteinsgate 9, Bergen»"
              aria-label="Adresse"
              autoFocus
              value={sok}
              onChange={(e) => setSok(e.target.value)}
            />
            <button className="btn btn-primary" disabled={soker || sok.trim().length < 3}>
              {soker ? "Søker …" : "Søk"}
            </button>
          </form>
          <div className="field-note">
            Kartverkets adresseregister har bruksenhetsnumrene (H0101 …) per oppgang — de blir
            leilighetsnummer, med etasje og oppgang utledet. Leiligheter som alt finnes hoppes over.
          </div>

          <Feil melding={feil} />

          {adresser !== null &&
            (adresser.length === 0 ? (
              <Tom tekst="Ingen adresser funnet. Prøv med gatenavn og husnummer." />
            ) : (
              <div style={{ maxHeight: "280px", overflowY: "auto" }}>
                {adresser.map((a) => (
                  <label
                    key={a.adressetekst ?? ""}
                    style={{ display: "flex", alignItems: "center", gap: "10px", padding: "7px 2px", cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={valgte.has(a.adressetekst ?? "")}
                      onChange={(e) => {
                        const neste = new Set(valgte);
                        if (e.target.checked) neste.add(a.adressetekst ?? "");
                        else neste.delete(a.adressetekst ?? "");
                        setValgte(neste);
                      }}
                    />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="varsel-navn">{a.adressetekst}</span>
                      <span className="varsel-desc">
                        {[a.postnummer && `${a.postnummer} ${a.poststed}`, `${a.bruksenhetsnummer.length} bruksenhet${a.bruksenhetsnummer.length === 1 ? "" : "er"}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ))}

          {rader.length > 0 && (
            <div className="field-note">
              {nye.length} nye opprettes{rader.length - nye.length > 0 && <>, {rader.length - nye.length} finnes fra før og hoppes over</>}.
            </div>
          )}

          <Knapperad
            onAvbryt={onLukk}
            sendEtikett={`Opprett ${nye.length || ""} leilighet${nye.length === 1 ? "" : "er"}`.replace("  ", " ")}
            sender={sender}
            deaktivert={nye.length === 0}
            onSend={() => void importer()}
          />
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------

/**
 * Webhooks — «varsle styrets Teams-kanal når …». Kun for kontoadmin: URL-ene gir
 * skrivetilgang til styrets kanaler og skal ikke leses av alle.
 */
function Integrasjoner() {
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => webhooksApi.liste(o));
  const [ny, setNy] = useState(false);
  const [endrer, setEndrer] = useState<Webhook | null>(null);
  const [tester, setTester] = useState<string | null>(null);
  const [testresultat, setTestresultat] = useState<Record<string, string>>({});

  async function test(w: Webhook) {
    if (!orgId) return;
    setTester(w.id);
    setFeil(null);
    try {
      const res = await webhooksApi.test(orgId, w.id);
      setTestresultat((t) => ({ ...t, [w.id]: res.ok ? "Testmelding levert ✓" : `Feilet: ${res.feil}` }));
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Testen feilet");
    } finally {
      setTester(null);
    }
  }

  async function slett(w: Webhook) {
    if (!orgId) return;
    setFeil(null);
    try {
      await webhooksApi.slett(orgId, w.id);
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke slette webhooken");
    }
  }

  return (
    <>
      <Feil melding={feil} />
      <Kort
        tittel="Webhooks"
        handling={
          <button className="btn btn-ghost" onClick={() => setNy(true)}>
            ＋ Ny webhook
          </button>
        }
      >
        {laster || !data ? (
          <Tom tekst="Henter …" />
        ) : data.length === 0 ? (
          <Tom tekst="Ingen webhooks ennå. Få varsler rett i styrets Teams-kanal, Slack eller Discord når det meldes avvik eller oppgaver kvitteres ut." />
        ) : (
          data.map((w) => (
            <div key={w.id} className="list-item">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="list-tittel">
                  {w.name}
                  {!w.active && (
                    <span className="badge muted" style={{ marginLeft: "8px" }}>Av</span>
                  )}
                </div>
                <div className="list-meta">
                  {WEBHOOK_TYPE_ETIKETT[w.targetType as WebhookType] ?? w.targetType} ·{" "}
                  {w.events
                    .map((e) => WEBHOOK_HENDELSE_ETIKETT[e as (typeof WEBHOOK_HENDELSER)[number]] ?? e)
                    .join(", ")}
                </div>
                <div className="list-meta">
                  {testresultat[w.id] ??
                    (w.lastAttemptAt
                      ? w.lastOk
                        ? `Siste sending levert (${datoTid(w.lastAttemptAt)})`
                        : `Siste sending feilet: ${w.lastError} (${datoTid(w.lastAttemptAt)})`
                      : "Ikke sendt ennå — bruk «Test»")}
                </div>
              </div>
              <span style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                <button className="btn btn-ghost" disabled={tester === w.id} onClick={() => void test(w)}>
                  {tester === w.id ? "Tester …" : "Test"}
                </button>
                <button className="btn btn-ghost" onClick={() => setEndrer(w)}>
                  Endre
                </button>
                <button className="btn btn-ghost" style={{ color: "var(--muted)" }} onClick={() => void slett(w)}>
                  Slett
                </button>
              </span>
            </div>
          ))
        )}
      </Kort>

      <div className="field-note">
        En webhook sender et varsel til en adresse dere velger når noe skjer i DriftIQ. Et
        varsel som ikke kommer frem stopper aldri handlingen det gjelder — feiler adressen,
        vises det her. Oppsett og endringer føres i hendelsesloggen.
      </div>

      <UnlocKort />

      {ny && <WebhookSkjema orgId={orgId!} onLukk={() => setNy(false)} onLagret={last} />}
      {endrer && (
        <WebhookSkjema
          orgId={orgId!}
          utgangspunkt={endrer}
          onLukk={() => setEndrer(null)}
          onLagret={last}
        />
      )}
    </>
  );
}

/** Hvordan man får tak i webhook-URL-en, per måltype — vises under adressefeltet. */
const WEBHOOK_HJELP: Record<WebhookType, string> = {
  teams:
    "I Teams: åpne Workflows-appen og lag flyten «When a Teams webhook request is received» mot kanalen eller gruppechatten, og lim inn URL-en du får. Gruppechat krever at alle deltakerne er i samme organisasjon — bruk en kanal hvis noen er eksterne.",
  slack:
    "I Slack: lag en app med «Incoming Webhooks» (api.slack.com/apps), aktiver den for kanalen og lim inn URL-en. Avsendernavnet og ikonet i Slack styres av appen dere lager — kall den gjerne DriftIQ.",
  discord:
    "I Discord: kanalinnstillinger → Integrasjoner → Webhooks → Ny webhook, og kopier URL-en.",
  generisk:
    "Sender rå JSON ({ hendelse, tidspunkt, organisasjon, tittel, tekst, lenke, data }) — for Zapier, Make, n8n eller egne systemer.",
};

function WebhookSkjema({
  orgId,
  utgangspunkt,
  onLukk,
  onLagret,
}: {
  orgId: string;
  utgangspunkt?: Webhook;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [navn, setNavn] = useState(utgangspunkt?.name ?? "");
  const [type, setType] = useState<string>(utgangspunkt?.targetType ?? "teams");
  const [url, setUrl] = useState(utgangspunkt?.url ?? "");
  const [valgte, setValgte] = useState<Set<string>>(new Set(utgangspunkt?.events ?? []));
  const [aktiv, setAktiv] = useState(utgangspunkt?.active ?? true);
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel={utgangspunkt ? "Endre webhook" : "Ny webhook"} onLukk={onLukk} bredde={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = { name: navn, targetType: type, url, events: [...valgte], active: aktiv };
          void send(() =>
            utgangspunkt ? webhooksApi.endre(orgId, utgangspunkt.id, data) : webhooksApi.ny(orgId, data),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} plassholder="Styrets Teams-kanal" />
        <Nedtrekk
          etikett="Mål"
          verdi={type}
          onEndre={setType}
          valg={WEBHOOK_TYPER.map((t) => ({ verdi: t, etikett: WEBHOOK_TYPE_ETIKETT[t] }))}
        />
        <Tekstfelt
          etikett="Webhook-URL"
          verdi={url}
          onEndre={setUrl}
          plassholder="https://…"
          notat={WEBHOOK_HJELP[type as WebhookType]}
        />
        <div className="field">
          <span className="field-label">Send varsel ved</span>
          {WEBHOOK_HENDELSER.map((h) => (
            <label
              key={h}
              style={{ display: "flex", alignItems: "center", gap: "9px", padding: "3px 0", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={valgte.has(h)}
                onChange={(e) => {
                  const neste = new Set(valgte);
                  if (e.target.checked) neste.add(h);
                  else neste.delete(h);
                  setValgte(neste);
                }}
              />
              <span style={{ fontSize: "var(--fs-sm)" }}>{WEBHOOK_HENDELSE_ETIKETT[h]}</span>
            </label>
          ))}
        </div>
        <Avkryssing
          etikett="Aktiv"
          verdi={aktiv}
          onEndre={setAktiv}
          notat="Skru av i stedet for å slette hvis kanalen bare skal pause varslene."
        />
        <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={valgte.size === 0 || !navn.trim() || !url.trim()} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------

/** Modulnavnet i filteret og på radene. «org» er ikke en modul — bruker- og org-administrasjon. */
function modulEtikett(nokkel: string): string {
  if (nokkel === "org") return "Administrasjon";
  return MENY[nokkel as keyof typeof MENY]?.etikett ?? nokkel;
}

/**
 * Hendelsesloggen — «hvem gjorde hva». Kun for kontoadmin; skrives av systemet og kan ikke
 * redigeres eller slettes herfra. Radene ELDES ut automatisk (3 år — se lib/hendelser.ts).
 */
function Hendelseslogg() {
  const [modul, setModul] = useState("");
  const [side, setSide] = useState(0);
  const { data, feil, laster } = useOrgData(
    (o) => hendelserApi.liste(o, { modul: modul || undefined, side }),
    [modul, side],
  );

  const sisteSide = data ? side >= Math.ceil(data.antall / data.sideStorrelse) - 1 : true;
  const moduler = [...new Set(["org", ...Object.keys(MENY)])];

  return (
    <>
      <Feil melding={feil} />
      <Kort
        tittel={`Hendelser${data ? ` (${data.antall})` : ""}`}
        handling={
          <select
            className="input"
            aria-label="Filtrer på modul"
            value={modul}
            onChange={(e) => {
              setModul(e.target.value);
              setSide(0);
            }}
          >
            <option value="">Alle moduler</option>
            {moduler.map((m) => (
              <option key={m} value={m}>
                {modulEtikett(m)}
              </option>
            ))}
          </select>
        }
      >
        {laster || !data ? (
          <Tom tekst="Henter …" />
        ) : data.hendelser.length === 0 ? (
          <Tom tekst="Ingen hendelser ennå. Tilgangsendringer, slettinger, tildelinger og eksport havner her etter hvert som de skjer." />
        ) : (
          data.hendelser.map((h) => (
            <div key={h.id} className="list-item">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="list-tittel">{h.event}</div>
                <div className="list-meta">
                  {h.actorName} · {modulEtikett(h.module)} · {datoTid(h.occurredAt)}
                </div>
              </div>
            </div>
          ))
        )}
      </Kort>

      {data && data.antall > data.sideStorrelse && (
        <div style={{ display: "flex", justifyContent: "center", gap: "10px" }}>
          <button className="btn btn-ghost" disabled={side === 0} onClick={() => setSide(side - 1)}>
            ← Nyere
          </button>
          <button className="btn btn-ghost" disabled={sisteSide} onClick={() => setSide(side + 1)}>
            Eldre →
          </button>
        </div>
      )}

      <div className="field-note">
        Loggen føres av systemet og kan ikke endres. Hendelser slettes automatisk etter tre
        år; innloggingshistorikk lagres separat og kortere.
      </div>
    </>
  );
}

/** Ett skjema for ny og endre — utgangspunktet avgjør hvilket API-kall som gjøres. */
function EnhetSkjema({
  orgId,
  fellesareal,
  utgangspunkt,
  onLukk,
  onLagret,
}: {
  orgId: string;
  fellesareal: boolean;
  utgangspunkt?: Enhet;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  // Typen følger av fanen man står i — ingen avkryssingsboks å glemme.
  const type = fellesareal ? "fellesareal" : "bolig";
  const [navn, setNavn] = useState(utgangspunkt?.navn ?? "");
  const [andelsnr, setAndelsnr] = useState(utgangspunkt?.andelsnr ?? "");
  const [leilighetsnr, setLeilighetsnr] = useState(utgangspunkt?.leilighetsnr ?? "");
  const [oppgang, setOppgang] = useState(utgangspunkt?.oppgang ?? "");
  const [etasje, setEtasje] = useState(utgangspunkt?.etasje ?? "");
  const [brokTeller, setBrokTeller] = useState(utgangspunkt?.brokTeller?.toString() ?? "");
  const [brokNevner, setBrokNevner] = useState(utgangspunkt?.brokNevner?.toString() ?? "");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal
      tittel={
        utgangspunkt
          ? fellesareal ? "Endre fellesområde" : "Endre leilighet"
          : fellesareal ? "Nytt fellesområde" : "Ny leilighet"
      }
      onLukk={onLukk}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const felter = {
            type,
            navn: navn || null,
            andelsnr: andelsnr || null,
            leilighetsnr: leilighetsnr || null,
            oppgang: oppgang || null,
            etasje: etasje || null,
            ...(fellesareal
              ? {}
              : {
                  brokTeller: brokTeller.trim() === "" ? null : Number(brokTeller),
                  brokNevner: brokNevner.trim() === "" ? null : Number(brokNevner),
                }),
          };
          void send(() =>
            utgangspunkt ? enheter.endre(orgId, utgangspunkt.id, felter) : enheter.ny(orgId, felter),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        {fellesareal ? (
          <Tekstfelt
            etikett="Navn"
            verdi={navn}
            onEndre={setNavn}
            plassholder="Bossrom oppgang B"
            notat="Fellesområder kjennes på navn, ikke nummer — bossrom, takterrasse, vaskeri."
          />
        ) : (
          <div className="field-row">
            <Tekstfelt
              etikett="Andelsnummer"
              verdi={andelsnr}
              onEndre={setAndelsnr}
              notat="Fra andelsregisteret hos forretningsføreren."
            />
            <Tekstfelt
              etikett="Leilighetsnummer"
              verdi={leilighetsnr}
              onEndre={setLeilighetsnr}
              plassholder="H0101"
              notat="Kartverkets bruksenhetsnummer (H-nr) — står også i matrikkelen."
            />
          </div>
        )}
        {/* Oppgang og etasje gjelder begge: også et bossrom ligger et sted i bygget. */}
        <div className="field-row">
          <Tekstfelt etikett="Oppgang" verdi={oppgang} onEndre={setOppgang} />
          <Tekstfelt etikett="Etasje" verdi={etasje} onEndre={setEtasje} />
        </div>
        {!fellesareal && (
          <>
            <div className="field-note">
              Minst ett av andelsnummer, leilighetsnummer eller oppgang må fylles ut — sameier
              uten andelsnummer bruker oppgang og leilighetsnummer.
            </div>
            <div className="field-row">
              <Tekstfelt
                etikett="Sameiebrøk, teller"
                verdi={brokTeller}
                onEndre={setBrokTeller}
                type="number"
                plassholder="125"
                notat="Tinglyst brøk. Grunnlaget for felleskostnadene i Økonomi."
              />
              <Tekstfelt etikett="Nevner" verdi={brokNevner} onEndre={setBrokNevner} type="number" plassholder="1000" />
            </div>
          </>
        )}
        <Knapperad onAvbryt={onLukk} sender={sender} />
      </form>
    </Modal>
  );
}
