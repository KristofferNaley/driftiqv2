"use client";

import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { Faner, Feil, Kort, Rad, Tom, useOrgData } from "@/components/felles";
import { Avkryssing, Knapperad, Modal, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { enheter, organisasjon, type Enhet, type OrgInfo } from "@/lib/klient";
import { ALLE_MODULER, MENY, modulErAktivert } from "@/lib/moduler";
import { lesKategorier } from "@/lib/avvikkategorier";

/** Samme trinn som API-et — se `formatterStorrelse` i lib/lagring.ts. */
function storrelse(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / 1024 / 1024)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1).replace(".", ",")} GB`;
}

export default function Innstillinger() {
  const [fane, setFane] = useState<"org" | "kategorier" | "moduler" | "enheter">("org");
  return (
    <Layout
      tittel="Innstillinger"
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={[
            { nokkel: "org", etikett: "Organisasjonen" },
            { nokkel: "kategorier", etikett: "Avvikskategorier" },
            { nokkel: "moduler", etikett: "Moduler" },
            { nokkel: "enheter", etikett: "Enhetsregister" },
          ]}
        />
      }
    >
      <div className="page-content">
        {fane === "org" && <Organisasjonen />}
        {fane === "kategorier" && <Kategorier />}
        {fane === "moduler" && <Moduler />}
        {fane === "enheter" && <Enheter />}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------------------

function Organisasjonen() {
  const { aktivOrg } = useOkt();
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => organisasjon.hent(o));
  const [redigerer, setRedigerer] = useState(false);
  const erAdmin = aktivOrg?.nivaa === "orgadmin";

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
        tittel="Om organisasjonen"
        handling={
          <button className="btn btn-ghost" onClick={() => setRedigerer(true)}>
            Rediger
          </button>
        }
      >
        <Rad tittel="Navn" hoyre={data.name} />
        <Rad tittel="Organisasjonsnummer" hoyre={data.orgNr ?? "—"} />
        <Rad tittel="Organisasjonsform" hoyre={data.orgForm ?? "—"} />
        <Rad tittel="Kommune" hoyre={data.municipality ?? "—"} />
        <Rad tittel="Antall enheter" hoyre={data.unitCount ?? "—"} />
        <Rad
          tittel="Har ansatte"
          hoyre={
            data.hasEmployees ? <span className="badge info">Ja</span> : <span className="badge muted">Nei</span>
          }
        />
        {data.buildingInfo && (
          <div style={{ padding: "14px 20px", fontSize: "var(--fs-sm)", lineHeight: 1.6, color: "var(--muted)", whiteSpace: "pre-wrap" }}>
            {data.buildingInfo}
          </div>
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

      {!erAdmin && (
        <div className="field-note">
          Uten administratortilgang kan du bare endre «Om bygget» og «Har ansatte» — resten er
          kontooppsett.
        </div>
      )}

      {redigerer && (
        <RedigerOrg org={data} orgId={orgId!} erAdmin={erAdmin} onLukk={() => setRedigerer(false)} onLagret={last} setFeil={setFeil} />
      )}
    </>
  );
}

function RedigerOrg({
  org,
  orgId,
  erAdmin,
  onLukk,
  onLagret,
}: {
  org: OrgInfo;
  orgId: string;
  erAdmin: boolean;
  onLukk: () => void;
  onLagret: () => Promise<void>;
  setFeil: (f: string | null) => void;
}) {
  const [navn, setNavn] = useState(org.name);
  const [orgNr, setOrgNr] = useState(org.orgNr ?? "");
  const [kommune, setKommune] = useState(org.municipality ?? "");
  const [antall, setAntall] = useState(org.unitCount?.toString() ?? "");
  const [bygg, setBygg] = useState(org.buildingInfo ?? "");
  const [ansatte, setAnsatte] = useState(org.hasEmployees);
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Rediger organisasjon" onLukk={onLukk} bredde={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Sender bare DRIFTSFELT når brukeren ikke er admin. Sendes ett kontofelt med,
          // krever API-et orgadmin for hele kallet — og da ville lagringen feilet.
          const data = erAdmin
            ? {
                name: navn,
                orgNr: orgNr || null,
                municipality: kommune || null,
                unitCount: antall ? Number(antall) : null,
                buildingInfo: bygg || null,
                hasEmployees: ansatte,
              }
            : { buildingInfo: bygg || null, hasEmployees: ansatte };
          void send(() => organisasjon.endre(orgId, data));
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />

        {erAdmin ? (
          <>
            <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} />
            <div className="field-row">
              <Tekstfelt etikett="Organisasjonsnummer" verdi={orgNr} onEndre={setOrgNr} notat="Ni siffer." />
              <Tekstfelt etikett="Kommune" verdi={kommune} onEndre={setKommune} />
            </div>
            <Tekstfelt etikett="Antall enheter" type="number" verdi={antall} onEndre={setAntall} />
          </>
        ) : (
          <div className="field-note">
            Navn, organisasjonsnummer og antall enheter er kontooppsett og krever
            administratortilgang.
          </div>
        )}

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
              <span>{r.aktiv ? "I bruk" : "Av"}</span>
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

/**
 * Modulene kunden har — som LESEVISNING.
 *
 * Her sto tidligere avkryssingsbokser kunden kunne lagre selv. Det er feil modell: modulene
 * er det de har kjøpt, og styres fra plattformpanelet (samme sted som i v1). API-et avviser
 * nå kundens forsøk uansett, så boksene her ville bare vært knapper som svarte 403.
 *
 * Lista blir stående fordi kunden skal kunne SE hva de har. Moduler de ikke har, hører
 * hjemme i modulkatalogen, som selger dem — ikke i en avkryssingsliste her.
 */
function Moduler() {
  const { data, feil, laster } = useOrgData((o) => organisasjon.hent(o));

  if (laster || !data) {
    return (
      <>
        <Feil melding={feil} />
        {!feil && <Tom tekst="Henter …" />}
      </>
    );
  }

  const aktive = ALLE_MODULER.filter((n) => MENY[n] && modulErAktivert(data.enabledModules, n));

  return (
    <>
      <Feil melding={feil} />
      <Kort tittel="Moduler i abonnementet">
        {aktive.map((n) => (
          <div key={n} className="list-item">
            <div style={{ minWidth: 0 }}>
              <div className="list-tittel">{MENY[n]!.etikett}</div>
              <div className="list-meta">{MENY[n]!.gruppe}</div>
            </div>
            <span className="badge ok">Aktiv</span>
          </div>
        ))}
      </Kort>

      <div className="field-note">
        Modulene følger avtalen deres og settes av DriftIQ. Vil dere ha en modul til — eller
        fjerne en dere ikke bruker — ta kontakt, så ordner vi det.
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------

function Enheter() {
  const [medArkiverte, setMedArkiverte] = useState(false);
  const { data, feil, setFeil, laster, last, orgId } = useOrgData(
    (o) => enheter.liste(o, medArkiverte),
    [medArkiverte],
  );
  const [nyEnhet, setNyEnhet] = useState(false);
  const liste = data ?? [];

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
        tittel={`Enheter (${liste.length})`}
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
            <button className="btn btn-ghost" onClick={() => setNyEnhet(true)}>
              Ny enhet
            </button>
          </div>
        }
      >
        {laster ? (
          <Tom tekst="Henter …" />
        ) : liste.length === 0 ? (
          <Tom tekst="Ingen enheter registrert." />
        ) : (
          liste.map((e) => (
            <Rad
              key={e.id}
              tittel={e.navn ?? e.leilighetsnr ?? `Andel ${e.andelsnr ?? "?"}`}
              meta={[
                e.type === "fellesareal" ? "Fellesareal" : "Bolig",
                e.andelsnr && `andel ${e.andelsnr}`,
                e.oppgang && `oppg. ${e.oppgang}`,
                e.etasje && `${e.etasje}. etasje`,
                e.arealM2 && `${e.arealM2} m²`,
              ]
                .filter(Boolean)
                .join(" · ")}
              hoyre={
                <>
                  {e.apneAvvik > 0 && <span className="badge warn">{e.apneAvvik} åpne avvik</span>}
                  {e.archivedAt ? (
                    <span className="badge muted">Arkivert</span>
                  ) : (
                    <button className="btn btn-ghost" onClick={() => arkiver(e)}>
                      Arkiver
                    </button>
                  )}
                </>
              }
            />
          ))
        )}
      </Kort>

      <div className="field-note">
        Registeret inneholder bare fysiske fakta — ingen eiere, beboere eller
        kontaktopplysninger. Det er en forutsetning, ikke en mangel: uten personopplysninger
        må registeret verken holdes à jour ved eierskifte eller inn i databehandleravtalen.
        Enheter arkiveres, aldri slettes — avvikshistorikken skal overleve.
      </div>

      {nyEnhet && <NyEnhet orgId={orgId!} onLukk={() => setNyEnhet(false)} onLagret={last} />}
    </>
  );
}

function NyEnhet({ orgId, onLukk, onLagret }: { orgId: string; onLukk: () => void; onLagret: () => Promise<void> }) {
  const [type, setType] = useState<"bolig" | "fellesareal">("bolig");
  const [navn, setNavn] = useState("");
  const [andelsnr, setAndelsnr] = useState("");
  const [leilighetsnr, setLeilighetsnr] = useState("");
  const [oppgang, setOppgang] = useState("");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Ny enhet" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            enheter.ny(orgId, {
              type,
              navn: navn || null,
              andelsnr: andelsnr || null,
              leilighetsnr: leilighetsnr || null,
              oppgang: oppgang || null,
            }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Avkryssing
          etikett="Dette er et fellesareal"
          verdi={type === "fellesareal"}
          onEndre={(v) => setType(v ? "fellesareal" : "bolig")}
          notat="Bossrom, takterrasse, utleielokale. Fellesarealer identifiseres med navn; boliger med nummer."
        />
        {type === "fellesareal" ? (
          <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} plassholder="Bossrom oppgang B" />
        ) : (
          <>
            <div className="field-row">
              <Tekstfelt etikett="Andelsnummer" verdi={andelsnr} onEndre={setAndelsnr} />
              <Tekstfelt etikett="Leilighetsnummer" verdi={leilighetsnr} onEndre={setLeilighetsnr} plassholder="H0101" />
            </div>
            <Tekstfelt
              etikett="Oppgang"
              verdi={oppgang}
              onEndre={setOppgang}
              notat="Minst ett av de tre feltene må fylles ut — sameier uten andelsnummer bruker oppgang og leilighetsnummer."
            />
          </>
        )}
        <Knapperad onAvbryt={onLukk} sender={sender} />
      </form>
    </Modal>
  );
}
