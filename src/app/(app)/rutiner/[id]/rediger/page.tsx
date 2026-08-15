"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Feil, Tom, useOrgData } from "@/components/felles";
import { Knapperad, Modal } from "@/components/skjema";
import { useOkt } from "@/components/OktProvider";
import { dokumenter, kontrakter, leverandorer, oppgaver, rutiner } from "@/lib/klient";
import {
  ANSVARLIG_VALG,
  GJELDER_FOR_VALG,
  REVISJONSINTERVALLER,
  RUTINEKATEGORIER,
} from "@/lib/rutinekonstanter";

/**
 * Rutinebyggeren — port av v1s `RutineBygger.jsx`. Egen side, ikke modal: steg bygges som
 * sorterbare bokser som kollapser når de ikke redigeres, slik at en rutine på 6–8 steg
 * fortsatt er mulig å overskue.
 *
 * Én forskjell fra v1 med vilje: v1 lagret kladd og versjon i to separate kall. v2s
 * `endreRutine` tar snapshot av forrige tilstand ved HVER lagring (se lib/rutiner.ts), så
 * «Lagre kladd» og «Publiser» er samme kall — publisering setter i tillegg status.
 */

let stegNokkel = 0;
type Steg = {
  key: string;
  title: string;
  description: string;
  isCritical: boolean;
  calloutType: string;
  calloutText: string;
};

const nyttSteg = (): Steg => ({
  key: `ny-${stegNokkel++}`,
  title: "",
  description: "",
  isCritical: false,
  calloutType: "",
  calloutText: "",
});

type Valg = { id: string; navn: string };

function StegBoks({
  steg,
  indeks,
  redigeres,
  harLeverandor,
  onToggle,
  onEndre,
  onSlett,
  drarKey,
  overKey,
  setOverKey,
  onStartDrag,
  onAvsluttDrag,
  onSlipp,
}: {
  steg: Steg;
  indeks: number;
  redigeres: boolean;
  harLeverandor: boolean;
  onToggle: () => void;
  onEndre: (felt: keyof Steg, verdi: string | boolean) => void;
  onSlett: () => void;
  drarKey: string | null;
  overKey: string | null;
  setOverKey: (fn: (k: string | null) => string | null) => void;
  onStartDrag: (key: string) => void;
  onAvsluttDrag: () => void;
  onSlipp: (key: string) => void;
}) {
  const merker: Array<{ tekst: string; klasse: string }> = [];
  if (steg.isCritical) merker.push({ tekst: "Kritisk", klasse: "krit" });
  if (steg.calloutType === "warning") merker.push({ tekst: "Advarsel", klasse: "call" });
  if (steg.calloutType === "contact") merker.push({ tekst: "Kontakt", klasse: "call" });

  // Ett innfelt varsel per steg — å velge det som allerede er valgt slår det av igjen.
  const settCallout = (type: string) => {
    onEndre("calloutType", steg.calloutType === type ? "" : type);
    if (type !== "warning") onEndre("calloutText", "");
  };

  return (
    <div
      className={[
        "rb-steg",
        redigeres ? " redigerer" : "",
        drarKey === steg.key ? " drar" : "",
        overKey === steg.key && drarKey && drarKey !== steg.key ? " over" : "",
      ].join("")}
      draggable
      onDragStart={() => onStartDrag(steg.key)}
      onDragOver={(e) => {
        e.preventDefault();
        setOverKey(() => steg.key);
      }}
      onDragLeave={() => setOverKey((k) => (k === steg.key ? null : k))}
      onDrop={(e) => {
        e.preventDefault();
        onSlipp(steg.key);
      }}
      onDragEnd={onAvsluttDrag}
    >
      <div className="rb-steg-linje" onClick={onToggle}>
        <span className="rb-dra" title="Dra for å endre rekkefølge" aria-hidden>⠿</span>
        <span className={`rb-steg-nr${steg.isCritical ? " kritisk" : ""}`}>{indeks + 1}</span>
        <span className={`rb-steg-tittel${steg.title.trim() ? "" : " tom"}`}>
          {steg.title.trim() || "Uten overskrift — ikke ferdig"}
        </span>
        {!redigeres &&
          merker.map((m) => (
            <span key={m.tekst} className={`rb-merke ${m.klasse}`}>{m.tekst}</span>
          ))}
        <div className="rb-verktoy">
          <button
            type="button"
            className="rb-miniknapp"
            aria-label={redigeres ? "Lukk steget" : "Rediger steget"}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {redigeres ? "▾" : "✎"}
          </button>
          <button
            type="button"
            className="rb-miniknapp fare"
            aria-label="Slett steget"
            onClick={(e) => {
              e.stopPropagation();
              onSlett();
            }}
          >
            🗑
          </button>
        </div>
      </div>

      {redigeres && (
        <div className="rb-steg-editor" onClick={(e) => e.stopPropagation()}>
          <div className="field">
            <label className="field-label">Overskrift</label>
            <input
              className="input"
              placeholder="Hva skal gjøres i dette steget?"
              value={steg.title}
              onChange={(e) => onEndre("title", e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label">Beskrivelse</label>
            <textarea
              className="textarea"
              style={{ minHeight: "66px" }}
              placeholder="Utdyp steget om det trengs …"
              value={steg.description}
              onChange={(e) => onEndre("description", e.target.value)}
            />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label className="field-label">Marker og legg til</label>
            <div className="rb-callout-valg">
              <button
                type="button"
                className={`rb-callout-chip${steg.isCritical ? " paa" : ""}`}
                onClick={() => onEndre("isCritical", !steg.isCritical)}
              >
                🔴 Kritisk steg{steg.isCritical ? " ✓" : ""}
              </button>
              <button type="button" className="rb-callout-chip" onClick={() => settCallout("warning")}>
                ⚠ {steg.calloutType === "warning" ? "Fjern advarsel" : "Legg til advarsel"}
              </button>
              <button type="button" className="rb-callout-chip" onClick={() => settCallout("contact")}>
                📞 {steg.calloutType === "contact" ? "Fjern kontakt" : "Legg til kontakt"}
              </button>
            </div>

            {steg.calloutType === "warning" && (
              <div className="rb-callout">
                ⚠
                <input
                  placeholder="F.eks. Ikke bruk elektriske apparater i stående vann"
                  aria-label="Advarselstekst"
                  value={steg.calloutText}
                  onChange={(e) => onEndre("calloutText", e.target.value)}
                />
                <button type="button" className="fjern" aria-label="Fjern advarselen" onClick={() => settCallout("warning")}>
                  ✕
                </button>
              </div>
            )}
            {steg.calloutType === "contact" && (
              <>
                <div className="rb-callout kontakt">
                  📞
                  <span style={{ flex: 1 }}>
                    {harLeverandor ? "Primærkontakt hos valgt leverandør" : "Ingen leverandør valgt ennå"}
                  </span>
                  <button type="button" className="fjern" aria-label="Fjern kontakten" onClick={() => settCallout("contact")}>
                    ✕
                  </button>
                </div>
                <div className="field-note">
                  Kontakten hentes fra Leverandører — endres nummeret der, oppdateres rutinen
                  automatisk.
                  {!harLeverandor && " Velg leverandør under «Knytt til» for at dette skal vise noe."}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Valgt: kompakt rad med ✕. Ikke valgt: nedtrekk. Som i v1 — lenken er unntaket, ikke regelen. */
function LenkeFelt({
  ikon,
  etikett,
  verdi,
  valg,
  onVelg,
}: {
  ikon: string;
  etikett: string;
  verdi: string;
  valg: Valg[];
  onVelg: (id: string) => void;
}) {
  const valgt = valg.find((v) => v.id === verdi);
  if (valgt) {
    return (
      <div className="rb-lenke-rad">
        <span aria-hidden>{ikon}</span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {valgt.navn}
        </span>
        <button type="button" className="fjern" aria-label={`Fjern ${etikett}`} onClick={() => onVelg("")}>
          ✕
        </button>
      </div>
    );
  }
  return (
    <div className="field" style={{ marginBottom: "8px" }}>
      <label className="field-label">
        {ikon} {etikett}
      </label>
      <select className="select" value="" onChange={(e) => onVelg(e.target.value)}>
        <option value="">Ingen valgt …</option>
        {valg.map((v) => (
          <option key={v.id} value={v.id}>{v.navn}</option>
        ))}
      </select>
    </div>
  );
}

export default function Rutinebygger({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { aktivOrg } = useOkt();
  const kanEndre = aktivOrg?.nivaa === "orgadmin" || aktivOrg?.nivaa === "redigering";

  const { data, feil: lastefeil, laster, orgId } = useOrgData((o) => rutiner.hent(o, id), [id]);

  const [tittel, setTittel] = useState("");
  const [beskrivelse, setBeskrivelse] = useState("");
  const [kategori, setKategori] = useState("");
  const [ansvarlig, setAnsvarlig] = useState("");
  const [gjelderFor, setGjelderFor] = useState("");
  const [akutt, setAkutt] = useState(false);
  const [intervall, setIntervall] = useState<string>("12");
  const [leverandorId, setLeverandorId] = useState("");
  const [kontraktId, setKontraktId] = useState("");
  const [dokumentId, setDokumentId] = useState("");
  const [oppgaveId, setOppgaveId] = useState("");
  const [ikNotat, setIkNotat] = useState("");
  const [status, setStatus] = useState("utkast");
  const [versjon, setVersjon] = useState(1);
  const [steg, setSteg] = useState<Steg[]>([]);

  const [redigererKey, setRedigererKey] = useState<string | null>(null);
  // Hvilket steg som dras ligger BÅDE i state (for CSS) og i en ref. Ref-en er den
  // funksjonelle kilden: dragstart og drop kan havne i samme React-batch, og da ser
  // drop-handleren fortsatt den gamle state-verdien i closuren sin.
  const [drarKey, setDrarKey] = useState<string | null>(null);
  const drarRef = useRef<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const [lagrer, setLagrer] = useState(false);
  const [sistLagret, setSistLagret] = useState<Date | null>(null);
  const [skitten, setSkitten] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [visPublisering, setVisPublisering] = useState(false);

  const [leverandorValg, setLeverandorValg] = useState<Valg[]>([]);
  const [kontraktValg, setKontraktValg] = useState<Valg[]>([]);
  const [dokumentValg, setDokumentValg] = useState<Valg[]>([]);
  const [oppgaveValg, setOppgaveValg] = useState<Valg[]>([]);

  // Innlastingen fyller state ETT sted, og «ulagrede endringer» settes eksplisitt av hver
  // endringsfunksjon — et useEffect på feltene ville påstått ulagrede endringer før
  // brukeren rørte noe.
  useEffect(() => {
    if (!data) return;
    setTittel(data.title);
    setBeskrivelse(data.description ?? "");
    setKategori(data.category ?? "");
    setAnsvarlig(data.responsible ?? "");
    setGjelderFor(data.appliesTo ?? "");
    setAkutt(data.isCritical);
    setIntervall(data.reviewIntervalMonths === null ? "" : String(data.reviewIntervalMonths));
    setLeverandorId(data.vendorId ?? "");
    setKontraktId(data.contractId ?? "");
    setDokumentId(data.documentId ?? "");
    setOppgaveId(data.taskId ?? "");
    setIkNotat(data.internkontrollNote ?? "");
    setStatus(data.status);
    setVersjon(data.version);
    setSteg(
      data.steg.map((s) => ({
        key: s.id,
        title: s.title,
        description: s.description ?? "",
        isCritical: s.isCritical,
        calloutType: s.calloutType ?? "",
        calloutText: s.calloutText ?? "",
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, data?.version]);

  useEffect(() => {
    if (!orgId) return;
    leverandorer.liste(orgId).then((r) => setLeverandorValg(r.map((v) => ({ id: v.id, navn: v.name })))).catch(() => {});
    kontrakter.liste(orgId).then((r) => setKontraktValg(r.map((k) => ({ id: k.id, navn: k.title })))).catch(() => {});
    dokumenter.liste(orgId).then((r) => setDokumentValg(r.map((d) => ({ id: d.id, navn: d.title })))).catch(() => {});
    oppgaver.liste(orgId).then((r) => setOppgaveValg(r.map((o) => ({ id: o.id, navn: o.title })))).catch(() => {});
  }, [orgId]);

  const merk = <T,>(setter: (v: T) => void) => (v: T) => {
    setSkitten(true);
    setter(v);
  };

  const endreSteg = (key: string, felt: keyof Steg, verdi: string | boolean) => {
    setSkitten(true);
    setSteg((liste) => liste.map((s) => (s.key === key ? { ...s, [felt]: verdi } : s)));
  };

  const slettSteg = (key: string) => {
    setSkitten(true);
    setSteg((liste) => liste.filter((s) => s.key !== key));
    setRedigererKey((k) => (k === key ? null : k));
  };

  const leggTilSteg = () => {
    const s = nyttSteg();
    setSkitten(true);
    setSteg((liste) => [...liste, s]);
    setRedigererKey(s.key);
  };

  const startDrag = (key: string) => {
    drarRef.current = key;
    setDrarKey(key);
  };
  const avsluttDrag = () => {
    drarRef.current = null;
    setDrarKey(null);
    setOverKey(null);
  };
  const slipp = (malKey: string) => {
    const fraKey = drarRef.current;
    setOverKey(null);
    if (!fraKey || fraKey === malKey) return;
    setSkitten(true);
    setSteg((liste) => {
      const uten = liste.filter((s) => s.key !== fraKey);
      const dratt = liste.find((s) => s.key === fraKey)!;
      const i = uten.findIndex((s) => s.key === malKey);
      return [...uten.slice(0, i), dratt, ...uten.slice(i)];
    });
    avsluttDrag();
  };

  const utenOverskrift = useMemo(() => steg.filter((s) => !s.title.trim()).length, [steg]);

  async function lagre(nyStatus?: string): Promise<boolean> {
    if (!orgId) return false;
    setLagrer(true);
    setFeil(null);
    try {
      const oppdatert = await rutiner.endre(orgId, id, {
        title: tittel.trim() || "Uten navn",
        description: beskrivelse.trim() || null,
        category: kategori || null,
        responsible: ansvarlig || null,
        appliesTo: gjelderFor || null,
        isCritical: akutt,
        reviewIntervalMonths: intervall === "" ? null : Number(intervall),
        vendorId: leverandorId || null,
        contractId: kontraktId || null,
        documentId: dokumentId || null,
        taskId: oppgaveId || null,
        internkontrollNote: ikNotat.trim() || null,
        ...(nyStatus ? { status: nyStatus } : {}),
        // Steg uten overskrift lagres ikke — sidepanelet sier fra om dem.
        steps: steg
          .filter((s) => s.title.trim())
          .map((s) => ({
            title: s.title.trim(),
            description: s.description.trim() || null,
            isCritical: s.isCritical,
            calloutType: s.calloutType || null,
            calloutText: s.calloutType === "warning" ? s.calloutText.trim() || null : null,
          })),
      });
      setStatus(oppdatert.status);
      setVersjon(oppdatert.version);
      setSistLagret(new Date());
      setSkitten(false);
      return true;
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre rutinen");
      return false;
    } finally {
      setLagrer(false);
    }
  }

  async function publiser() {
    if (await lagre("publisert")) router.push(`/rutiner/${id}`);
  }

  if (laster || !data) {
    return (
      <Layout tittel="Rutine">
        <div className="page-content">
          <Feil melding={lastefeil} />
          {!lastefeil && <Tom tekst="Henter …" />}
        </div>
      </Layout>
    );
  }

  if (!kanEndre) {
    return (
      <Layout tittel={data.title}>
        <div className="page-content">
          <Tom tekst="Du har lesetilgang — rutinen redigeres av noen med redigeringsrett." />
        </div>
      </Layout>
    );
  }

  const erUtkast = status === "utkast";

  return (
    <Layout
      tittel={tittel || "Ny rutine"}
      handlinger={
        <>
          <span style={{ fontSize: "var(--fs-label)", color: "var(--muted)" }}>
            {lagrer
              ? "Lagrer …"
              : skitten
                ? "Ulagrede endringer"
                : sistLagret
                  ? `Lagret ${String(sistLagret.getHours()).padStart(2, "0")}:${String(sistLagret.getMinutes()).padStart(2, "0")}`
                  : ""}
          </span>
          <button className="btn btn-ghost" onClick={() => void lagre()} disabled={lagrer}>
            {erUtkast ? "Lagre kladd" : "Lagre"}
          </button>
          {erUtkast && (
            <button className="btn btn-primary" onClick={() => setVisPublisering(true)} disabled={lagrer}>
              Publiser rutine
            </button>
          )}
        </>
      }
      aside={
        <>
          <div className="card">
            <div className="card-header"><span className="card-title">Publisering</span></div>
            <div style={{ padding: "4px 18px 12px" }}>
              <div className="rb-bryter-rad">
                <button
                  type="button"
                  className={`rb-bryter${akutt ? " paa" : ""}`}
                  role="switch"
                  aria-checked={akutt}
                  aria-label="Akuttrutine"
                  onClick={() => merk(setAkutt)(!akutt)}
                />
                <div style={{ flex: 1 }}>
                  <div className="rb-bryter-tittel">Akuttrutine</div>
                  <div className="rb-bryter-sub">Markeres for fysisk oppslag i oppgangen</div>
                </div>
              </div>
              <div className="rb-bryter-rad">
                <div style={{ flex: 1 }}>
                  <div className="rb-bryter-tittel">Åpen uten innlogging</div>
                  <div className="rb-bryter-sub">
                    QR-koden åpner alltid rutinen uten pålogging — det er hele poenget med
                    fysisk oppslag.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">Gjennomgang</span></div>
            <div style={{ padding: "10px 18px 14px" }}>
              <div className="field" style={{ marginBottom: "10px" }}>
                <label className="field-label">Revideres</label>
                <select
                  className="select"
                  value={intervall}
                  onChange={(e) => merk(setIntervall)(e.target.value)}
                >
                  {REVISJONSINTERVALLER.map((r) => (
                    <option key={String(r.verdi)} value={r.verdi === null ? "" : String(r.verdi)}>
                      {r.etikett}
                    </option>
                  ))}
                </select>
                <span className="field-note">
                  Rutinen flagges som «Trenger gjennomgang» når fristen passeres.
                </span>
              </div>
              {utenOverskrift > 0 && (
                <div className="rb-note">
                  <b>{utenOverskrift} steg mangler overskrift.</b> Steg uten overskrift blir
                  ikke lagret — fyll dem ut eller slett dem.
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">Knytt til</span></div>
            <div style={{ padding: "12px 18px 14px" }}>
              <LenkeFelt ikon="🏗" etikett="Leverandør" verdi={leverandorId} valg={leverandorValg} onVelg={merk(setLeverandorId)} />
              <LenkeFelt ikon="📄" etikett="Kontrakt / forsikring" verdi={kontraktId} valg={kontraktValg} onVelg={merk(setKontraktId)} />
              <LenkeFelt ikon="🗄" etikett="Dokument" verdi={dokumentId} valg={dokumentValg} onVelg={merk(setDokumentId)} />
              <LenkeFelt ikon="📋" etikett="Oppgave" verdi={oppgaveId} valg={oppgaveValg} onVelg={merk(setOppgaveId)} />
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label">🛡 Internkontroll-referanse</label>
                <input
                  className="input"
                  placeholder="F.eks. Internkontroll: Vann og avløp"
                  value={ikNotat}
                  onChange={(e) => merk(setIkNotat)(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">Historikk</span></div>
            <div style={{ padding: "12px 18px 14px" }}>
              <div className="rb-bryter-tittel">
                Versjon {versjon} · {erUtkast ? "utkast" : "publisert"}
              </div>
              <div className="rb-bryter-sub">
                Hver lagring fryser forrige tilstand i historikken — ved tilsyn kan styret
                vise hvilken rutine som gjaldt på et gitt tidspunkt.
              </div>
            </div>
          </div>
        </>
      }
    >
      <div className="page-content">
        <div style={{ fontSize: "var(--fs-label)", color: "var(--muted)" }}>
          <Link href="/rutiner" style={{ color: "var(--accent)" }}>Rutiner</Link> /{" "}
          {tittel || "Ny rutine"}
        </div>

        <Feil melding={feil} />

        <div className="card">
          <div className="card-header"><span className="card-title">Grunnlag</span></div>
          <div style={{ padding: "16px 20px 20px" }}>
            <div className="field">
              <label className="field-label">Navn på rutinen *</label>
              <input
                className="input rb-tittel-input"
                placeholder="F.eks. Ved vannlekkasje i leilighet"
                value={tittel}
                onChange={(e) => merk(setTittel)(e.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label">Kategori</label>
              <div className="rb-chip-rad">
                {RUTINEKATEGORIER.map((k) => {
                  const valgt = kategori === k.verdi;
                  return (
                    <button
                      type="button"
                      key={k.verdi}
                      className={`rb-chip${valgt ? " valgt" : ""}`}
                      style={valgt ? { background: `${k.farge}22`, color: k.farge } : undefined}
                      onClick={() => merk(setKategori)(valgt ? "" : k.verdi)}
                    >
                      {k.etikett}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label className="field-label">Ansvarlig</label>
                <select className="select" value={ansvarlig} onChange={(e) => merk(setAnsvarlig)(e.target.value)}>
                  <option value="">Ikke satt …</option>
                  {ANSVARLIG_VALG.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label">Gjelder for</label>
                <select className="select" value={gjelderFor} onChange={(e) => merk(setGjelderFor)(e.target.value)}>
                  <option value="">Ikke satt …</option>
                  {GJELDER_FOR_VALG.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label">Kort beskrivelse</label>
              <textarea
                className="textarea"
                placeholder="Én til to setninger om når denne rutinen gjelder …"
                value={beskrivelse}
                onChange={(e) => merk(setBeskrivelse)(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Steg</span>
            <span style={{ fontSize: "var(--fs-label)", color: "var(--muted)" }}>
              {steg.length} steg{steg.length > 1 ? " · dra for å endre rekkefølge" : ""}
            </span>
          </div>
          <div style={{ padding: "14px 20px 18px" }}>
            {steg.length === 0 && (
              <div style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", marginBottom: "12px" }}>
                Ingen steg ennå. Stegene vises nummerert i rutinen, på utskriftsarket og i
                QR-visningen.
              </div>
            )}
            {steg.map((s, i) => (
              <StegBoks
                key={s.key}
                steg={s}
                indeks={i}
                redigeres={redigererKey === s.key}
                harLeverandor={Boolean(leverandorId)}
                onToggle={() => setRedigererKey((k) => (k === s.key ? null : s.key))}
                onEndre={(felt, verdi) => endreSteg(s.key, felt, verdi)}
                onSlett={() => slettSteg(s.key)}
                drarKey={drarKey}
                overKey={overKey}
                setOverKey={setOverKey}
                onStartDrag={startDrag}
                onAvsluttDrag={avsluttDrag}
                onSlipp={slipp}
              />
            ))}
            <button type="button" className="rb-legg-til" onClick={leggTilSteg}>
              ＋ Legg til steg
            </button>
          </div>
        </div>
      </div>

      {visPublisering && (
        <Modal tittel="Publiser rutine" onLukk={() => setVisPublisering(false)} bredde={420}>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, marginTop: 0 }}>
            Publiserer <strong>{tittel || "rutinen"}</strong>. Da åpnes den for QR-visning, og
            forrige tilstand fryses i historikken — det kan ikke endres i ettertid.
          </p>
          {utenOverskrift > 0 && (
            <div className="rb-note" style={{ marginBottom: "12px" }}>
              {utenOverskrift} steg uten overskrift blir ikke med.
            </div>
          )}
          <Knapperad
            onAvbryt={() => setVisPublisering(false)}
            sendEtikett="Publiser"
            sender={lagrer}
            onSend={() => {
              setVisPublisering(false);
              void publiser();
            }}
          />
        </Modal>
      )}
    </Layout>
  );
}
