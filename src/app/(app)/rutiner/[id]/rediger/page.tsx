"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Feil, Tom, dato, useOrgData } from "@/components/felles";
import { Modal } from "@/components/skjema";
import { useOkt } from "@/components/OktProvider";
import { dokumenter, kontrakter, leverandorer, oppgaver, rutiner } from "@/lib/klient";
import {
  ANSVARLIG_VALG,
  GJELDER_FOR_VALG,
  REVISJONSINTERVALLER,
  RUTINEKATEGORIER,
  RUTINEMALER,
  kategoriInfo,
} from "@/lib/rutinekonstanter";

/**
 * Rutinebyggeren — etter `mockups/rutinebygger-mockup.html`.
 *
 * Tre grep som styrer formen:
 *
 *  1. **Stegene er alltid åpne.** Overskriften ER inputfeltet i stegets topplinje, og
 *     forklaringen står rett under — ingen kollaps, ingen redigeringsmodus. Første utgave
 *     gjemte feltene bak et blyant-ikon, og det var nettopp det som gjorde den uintuitiv.
 *  2. **Forhåndsvisningen er sannheten.** Høyrekolonnen viser beboervisningen og oppslaget
 *     live mens man skriver — man redigerer til DEN ser riktig ut, ikke til skjemaet gjør.
 *  3. **Autolagring.** Kladden lagres av seg selv; versjonshistorikken skrives først ved
 *     publisering (`publiserRutine`) — det som fryses er det som gjaldt, ikke hver
 *     tastepause.
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

/** Måneder frem i tid, samme dag — for «neste gjennomgang settes til …». */
function omMndr(mndr: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + mndr);
  return d.toISOString().slice(0, 10);
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
  const [sistGjennomgatt, setSistGjennomgatt] = useState<string | null>(null);
  const [steg, setSteg] = useState<Steg[]>([]);

  const [drarKey, setDrarKey] = useState<string | null>(null);
  const drarRef = useRef<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const [lagrer, setLagrer] = useState(false);
  const [sistLagret, setSistLagret] = useState<Date | null>(null);
  // Autolagringen trigges av telleren, ikke av feltene: innlastingen fyller state uten å
  // røre den, så siden aldri lagrer noe brukeren ikke har skrevet.
  const [endringsteller, setEndringsteller] = useState(0);
  const [feil, setFeil] = useState<string | null>(null);
  const [visPublisering, setVisPublisering] = useState(false);
  const [visMaler, setVisMaler] = useState(false);
  const [pvFane, setPvFane] = useState<"mobil" | "oppslag">("mobil");

  const [leverandorValg, setLeverandorValg] = useState<Valg[]>([]);
  const [kontraktValg, setKontraktValg] = useState<Valg[]>([]);
  const [dokumentValg, setDokumentValg] = useState<Valg[]>([]);
  const [oppgaveValg, setOppgaveValg] = useState<Valg[]>([]);
  const [kontakt, setKontakt] = useState<{ navn: string; telefon: string | null } | null>(null);

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
    setSistGjennomgatt(data.lastReviewedAt);
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
  }, [data?.id]);

  useEffect(() => {
    if (!orgId) return;
    leverandorer.liste(orgId).then((r) => setLeverandorValg(r.map((v) => ({ id: v.id, navn: v.name })))).catch(() => {});
    kontrakter.liste(orgId).then((r) => setKontraktValg(r.map((k) => ({ id: k.id, navn: k.title })))).catch(() => {});
    dokumenter.liste(orgId).then((r) => setDokumentValg(r.map((d) => ({ id: d.id, navn: d.title })))).catch(() => {});
    oppgaver.liste(orgId).then((r) => setOppgaveValg(r.map((o) => ({ id: o.id, navn: o.title })))).catch(() => {});
  }, [orgId]);

  // Primærkontakten til valgt leverandør — forhåndsvisningens KONTAKT-kort. Hentes live,
  // aldri fra teksten: bytter firmaet nummer, viser rutinen det nye.
  useEffect(() => {
    if (!orgId || !leverandorId) {
      setKontakt(null);
      return;
    }
    leverandorer
      .hent(orgId, leverandorId)
      .then((l) => {
        const k = l.kontakter.find((x) => x.isPrimary) ?? l.kontakter[0];
        setKontakt(k ? { navn: k.name, telefon: k.phone } : { navn: l.name, telefon: null });
      })
      .catch(() => setKontakt(null));
  }, [orgId, leverandorId]);

  const merk = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setEndringsteller((n) => n + 1);
  };

  const endreSteg = (key: string, felt: keyof Steg, verdi: string | boolean) => {
    setSteg((liste) => liste.map((s) => (s.key === key ? { ...s, [felt]: verdi } : s)));
    setEndringsteller((n) => n + 1);
  };

  const flytt = (key: string, retning: -1 | 1) => {
    setSteg((liste) => {
      const i = liste.findIndex((s) => s.key === key);
      const j = i + retning;
      if (i < 0 || j < 0 || j >= liste.length) return liste;
      const ny = [...liste];
      [ny[i], ny[j]] = [ny[j]!, ny[i]!];
      return ny;
    });
    setEndringsteller((n) => n + 1);
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
    setSteg((liste) => {
      const uten = liste.filter((s) => s.key !== fraKey);
      const dratt = liste.find((s) => s.key === fraKey)!;
      const i = uten.findIndex((s) => s.key === malKey);
      return [...uten.slice(0, i), dratt, ...uten.slice(i)];
    });
    setEndringsteller((n) => n + 1);
    avsluttDrag();
  };

  async function lagre(): Promise<boolean> {
    if (!orgId) return false;
    setLagrer(true);
    setFeil(null);
    try {
      await rutiner.endre(orgId, id, {
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
        // Steg uten overskrift lagres ikke — publiseringssjekken sier fra om dem.
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
      setSistLagret(new Date());
      setEndringsteller(0);
      return true;
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre rutinen");
      return false;
    } finally {
      setLagrer(false);
    }
  }

  // Autolagringen: halvannet sekund etter siste tastetrykk. Kladding er fri — versjonen
  // skrives først ved publisering.
  useEffect(() => {
    if (endringsteller === 0 || !kanEndre) return;
    const t = setTimeout(() => void lagre(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endringsteller]);

  async function publiser(tilArk: boolean) {
    if (!orgId) return;
    if (!(await lagre())) return;
    try {
      const r = await rutiner.publiser(orgId, id);
      setStatus(r.status);
      setVersjon(r.version);
      setVisPublisering(false);
      if (tilArk) router.push(`/rutiner/${id}/ark`);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke publisere rutinen");
    }
  }

  const utenOverskrift = steg.filter((s) => !s.title.trim()).length;
  const utenTekst = steg.filter((s) => s.title.trim() && !s.description.trim()).length;
  const skitten = endringsteller > 0;
  const erUtkast = status === "utkast";
  const kat = kategoriInfo(kategori);
  const erBrann = kategori === "brann_sikkerhet";

  /* Faseindikatoren — status, ikke navigasjon: alt står uansett på samme side. */
  const faser = useMemo(() => {
    const grunnlag = Boolean(tittel.trim() && kategori && beskrivelse.trim());
    const stegOk = steg.length > 0 && utenOverskrift === 0 && utenTekst === 0;
    const knytt = Boolean(leverandorId || kontraktId || dokumentId || oppgaveId || ikNotat.trim());
    const publisert = !erUtkast && !skitten;
    const liste = [
      { navn: "Grunnlag", ferdig: grunnlag },
      { navn: "Steg", ferdig: stegOk },
      { navn: "Knytt til", ferdig: knytt },
      { navn: "Publiser", ferdig: publisert },
    ];
    const naaIdx = liste.findIndex((f) => !f.ferdig);
    return liste.map((f, i) => ({ ...f, naa: i === naaIdx }));
  }, [tittel, kategori, beskrivelse, steg.length, utenOverskrift, utenTekst, leverandorId, kontraktId, dokumentId, oppgaveId, ikNotat, erUtkast, skitten]);

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

  const dokumentNavn = dokumentValg.find((d) => d.id === dokumentId)?.navn ?? null;

  return (
    <Layout
      tittel={tittel || "Ny rutine"}
      handlinger={
        <>
          <span className={`badge ${erUtkast ? "warn" : skitten ? "warn" : "ok"}`}>
            {erUtkast ? "Kladd, ikke publisert ennå" : skitten ? "Publisert, med ulagrede endringer" : "Publisert"}
          </span>
          <span style={{ fontSize: "var(--fs-label)", color: "var(--muted)" }}>
            {lagrer
              ? "Lagrer …"
              : skitten
                ? "Ulagrede endringer"
                : sistLagret
                  ? "Lagret automatisk"
                  : ""}
          </span>
          <button className="btn btn-ghost" onClick={() => setVisMaler(true)}>
            Hent fra mal
          </button>
          <button className="btn btn-primary" onClick={() => setVisPublisering(true)} disabled={lagrer}>
            {erUtkast ? "Publiser" : "Publiser endringer"}
          </button>
        </>
      }
      aside={
        <>
          <div className="rb-pv-faner">
            <button
              className={`rb-pv-fane${pvFane === "mobil" ? " valgt" : ""}`}
              onClick={() => setPvFane("mobil")}
            >
              Slik ser beboeren den
            </button>
            <button
              className={`rb-pv-fane${pvFane === "oppslag" ? " valgt" : ""}`}
              onClick={() => setPvFane("oppslag")}
            >
              Oppslag til oppgangen
            </button>
          </div>

          {pvFane === "mobil" ? (
            <div className="rb-telefon">
              <div className="rb-pv">
                <div
                  className="rb-pv-hode"
                  style={{ background: `linear-gradient(180deg, ${kat.farge}2e, transparent)` }}
                >
                  <div className="rb-pv-kat" style={{ color: kat.farge }}>
                    {kategori ? kat.etikett.toUpperCase() : "UTEN KATEGORI"}
                  </div>
                  <h4>{tittel || "Uten navn"}</h4>
                  <div className="rb-pv-naar">{beskrivelse || "Når gjelder rutinen? Skriv én setning."}</div>
                </div>
                {erBrann && <a className="rb-nod" href="tel:110">Ring 110</a>}
                <div className="rb-pv-steg-liste">
                  {steg.length === 0 ? (
                    <p className="pf-dempet" style={{ fontSize: "var(--fs-label)" }}>
                      Stegene dukker opp her etter hvert som du legger dem til.
                    </p>
                  ) : (
                    steg.map((s, i) => (
                      <div key={s.key} className={`rb-pv-steg${s.isCritical ? " kritisk" : ""}`}>
                        <span className="n">{i + 1}</span>
                        <div style={{ minWidth: 0 }}>
                          <div className="t">{s.title || "Uten overskrift"}</div>
                          <div className="d">{s.description || "Ingen forklaring lagt inn"}</div>
                          {s.calloutType === "warning" && s.calloutText && (
                            <div className="rb-pv-advarsel">{s.calloutText}</div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {kontakt && (
                  <div className="rb-pv-kontakt">
                    <div className="l">KONTAKT</div>
                    <div className="r">
                      <span>{kontakt.navn}</span>
                      <span>{kontakt.telefon ?? "—"}</span>
                    </div>
                  </div>
                )}
                <div className="rb-pv-fot">
                  {dokumentNavn && <>{dokumentNavn}<br /></>}
                  {sistGjennomgatt
                    ? `Sist gjennomgått ${dato(sistGjennomgatt)}`
                    : "Ikke gjennomgått ennå"}
                </div>
              </div>
            </div>
          ) : (
            <div className="rb-plakat">
              <div className="k" style={{ color: erBrann ? "#c02b3f" : "#555" }}>
                {kategori ? kat.etikett.toUpperCase() : "RUTINE"}
              </div>
              <h4>{tittel || "Uten navn"}</h4>
              <div className="naar">{beskrivelse}</div>
              {erBrann && <div className="em">BRANN: RING 110</div>}
              <ol>
                {steg.map((s) => (
                  <li key={s.key}>
                    <b>{s.title || "Uten overskrift"}.</b> {s.description}
                  </li>
                ))}
              </ol>
              <div className="qrwrap">
                Skann QR-koden på rutinearket for full rutine på mobil
                <br />
                {aktivOrg?.name}
              </div>
            </div>
          )}

          <div className="rb-note blaa" style={{ marginTop: "12px" }}>
            Forhåndsvisningen oppdateres mens du skriver. <b>Rediger teksten til den ser
            riktig ut her</b> — ikke i skjemaet.
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

        <div className="rb-faser">
          {faser.map((f, i) => (
            <span key={f.navn} className={`rb-fase${f.naa ? " naa" : f.ferdig ? " ferdig" : ""}`}>
              <span className="n">{f.ferdig ? "✓" : i + 1}</span>
              {f.navn}
            </span>
          ))}
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Om rutinen</span></div>
          <div style={{ padding: "14px 20px 20px" }}>
            <p className="field-note" style={{ marginTop: 0 }}>
              Hva rutinen heter, når den gjelder, og hvem den er for. Selve fremgangsmåten
              hører hjemme under steg, ikke her.
            </p>
            <div className="field">
              <label className="field-label">Navn på rutinen</label>
              <input
                className="input"
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
            <div className="field">
              <label className="field-label">Når gjelder rutinen?</label>
              <input
                className="input"
                placeholder="F.eks. Ved brann eller røykutvikling i bygget."
                value={beskrivelse}
                onChange={(e) => merk(setBeskrivelse)(e.target.value)}
              />
              <span className="field-note">
                Én setning. Dette er det første beboeren leser, og det avgjør om hun er på
                riktig rutine.
              </span>
            </div>
            <div className="field-row" style={{ marginBottom: 0 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label">Hvem har ansvaret</label>
                <select className="select" value={ansvarlig} onChange={(e) => merk(setAnsvarlig)(e.target.value)}>
                  <option value="">Ikke satt …</option>
                  {ANSVARLIG_VALG.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label className="field-label">Hvem skal lese den</label>
                <select className="select" value={gjelderFor} onChange={(e) => merk(setGjelderFor)(e.target.value)}>
                  <option value="">Ikke satt …</option>
                  {GJELDER_FOR_VALG.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Steg</span>
            <span style={{ fontSize: "var(--fs-label)", color: "var(--muted)" }}>
              {steg.length} steg{steg.filter((s) => s.isCritical).length > 0 ? `, ${steg.filter((s) => s.isCritical).length} markert som kritiske` : ""}
            </span>
          </div>
          <div style={{ padding: "14px 20px 18px" }}>
            <p className="field-note" style={{ marginTop: 0 }}>
              Hvert steg har en overskrift og en forklaring. Overskriften er det man husker i
              en krise, forklaringen er det man leser når man er usikker. Dra i håndtaket for
              å endre rekkefølge.
            </p>
            {steg.map((s, i) => (
              <div
                key={s.key}
                className={[
                  "rb-steg",
                  s.isCritical ? " kritisk" : "",
                  drarKey === s.key ? " drar" : "",
                  overKey === s.key && drarKey && drarKey !== s.key ? " over" : "",
                ].join("")}
                draggable
                onDragStart={() => startDrag(s.key)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverKey(s.key);
                }}
                onDragLeave={() => setOverKey((k) => (k === s.key ? null : k))}
                onDrop={(e) => {
                  e.preventDefault();
                  slipp(s.key);
                }}
                onDragEnd={avsluttDrag}
              >
                <div className="rb-steg-linje">
                  <span className="rb-dra" title="Dra for å endre rekkefølge" aria-hidden>⠿</span>
                  <span className="rb-steg-nr">{i + 1}</span>
                  <input
                    className="rb-steg-inn"
                    placeholder="Overskrift, for eksempel «Varsle»"
                    aria-label={`Steg ${i + 1}, overskrift`}
                    value={s.title}
                    onChange={(e) => endreSteg(s.key, "title", e.target.value)}
                  />
                  <div className="rb-verktoy">
                    <button
                      type="button"
                      className={`rb-verktoyknapp${s.isCritical ? " paa" : ""}`}
                      title="Kritiske steg får rød markering i visningen"
                      onClick={() => endreSteg(s.key, "isCritical", !s.isCritical)}
                    >
                      {s.isCritical ? "Kritisk" : "Marker kritisk"}
                    </button>
                    <button
                      type="button"
                      className={`rb-verktoyknapp${s.calloutType === "warning" ? " paa" : ""}`}
                      title={s.calloutType === "warning" ? "Fjern advarselen" : "Legg til en advarsel under steget"}
                      onClick={() => {
                        endreSteg(s.key, "calloutType", s.calloutType === "warning" ? "" : "warning");
                        if (s.calloutType === "warning") endreSteg(s.key, "calloutText", "");
                      }}
                    >
                      ⚠
                    </button>
                    <button
                      type="button"
                      className={`rb-verktoyknapp${s.calloutType === "contact" ? " paa" : ""}`}
                      title="Vis leverandørens primærkontakt under steget"
                      onClick={() =>
                        endreSteg(s.key, "calloutType", s.calloutType === "contact" ? "" : "contact")
                      }
                    >
                      📞
                    </button>
                    <button type="button" className="rb-verktoyknapp" title="Flytt opp" onClick={() => flytt(s.key, -1)}>↑</button>
                    <button type="button" className="rb-verktoyknapp" title="Flytt ned" onClick={() => flytt(s.key, 1)}>↓</button>
                    <button
                      type="button"
                      className="rb-verktoyknapp"
                      title="Slett steget"
                      onClick={() => {
                        setSteg((liste) => liste.filter((x) => x.key !== s.key));
                        setEndringsteller((n) => n + 1);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="rb-steg-kropp">
                  <textarea
                    placeholder="Hva skal gjøres, konkret. Skriv som om leseren er stresset."
                    aria-label={`Steg ${i + 1}, forklaring`}
                    value={s.description}
                    onChange={(e) => endreSteg(s.key, "description", e.target.value)}
                  />
                  {s.calloutType === "warning" && (
                    <div className="rb-advarsel-inn">
                      ⚠
                      <input
                        placeholder="F.eks. Bruk aldri heis ved brann"
                        aria-label="Advarselstekst"
                        value={s.calloutText}
                        onChange={(e) => endreSteg(s.key, "calloutText", e.target.value)}
                      />
                    </div>
                  )}
                  {s.calloutType === "contact" && (
                    <div className="rb-meta">
                      📞 {kontakt
                        ? `Viser ${kontakt.navn}${kontakt.telefon ? ` · ${kontakt.telefon}` : ""} — hentes live fra Leverandører`
                        : "Velg leverandør under «Knytt til» for at kontakten skal vises"}
                    </div>
                  )}
                  <div className="rb-meta">
                    {s.description.length} tegn
                    {s.description.length > 260 ? " · vurder å dele opp i to steg" : ""}
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="rb-legg-til"
              onClick={() => {
                setSteg((liste) => [...liste, nyttSteg()]);
                setEndringsteller((n) => n + 1);
              }}
            >
              + Legg til steg
            </button>
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
          <div style={{ padding: "8px 20px 14px" }}>
            <p className="field-note">
              Koblingene gir rutinen kontekst. En leverandør som er knyttet til rutinen, får
              telefonnummeret sitt vist direkte i beboervisningen.
            </p>
            <Knytt etikett="Leverandør" forklaring="Vises med telefonnummer i rutinen" verdi={leverandorId} valg={leverandorValg} onVelg={merk(setLeverandorId)} />
            <Knytt etikett="Kontrakt eller forsikring" forklaring="F.eks. serviceavtalen som dekker rutinen" verdi={kontraktId} valg={kontraktValg} onVelg={merk(setKontraktId)} />
            <Knytt etikett="Dokument" forklaring="Vises som lenke nederst i rutinen" verdi={dokumentId} valg={dokumentValg} onVelg={merk(setDokumentId)} />
            <Knytt etikett="Oppgave" forklaring="Den gjentakende oppgaven rutinen hører til" verdi={oppgaveId} valg={oppgaveValg} onVelg={merk(setOppgaveId)} />
            <div className="rb-knytt">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: "var(--fs-sm)" }}>Internkontroll-referanse</div>
                <div className="field-note" style={{ margin: 0 }}>Fri tekst, f.eks. «Internkontroll: Vann og avløp»</div>
              </div>
              <div className="velger">
                <input
                  className="input"
                  value={ikNotat}
                  aria-label="Internkontroll-referanse"
                  onChange={(e) => merk(setIkNotat)(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Synlighet og gjennomgang</span></div>
          <div style={{ padding: "4px 20px 14px" }}>
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
                <div className="rb-bryter-sub">
                  Løftes øverst i rutinelisten og får rød merking. Bruk det bare på rutiner
                  som gjelder når noe skjer akkurat nå.
                </div>
              </div>
            </div>
            <div className="rb-bryter-rad">
              <div style={{ flex: 1 }}>
                <div className="rb-bryter-tittel">Åpen uten innlogging</div>
                <div className="rb-bryter-sub">
                  QR-koden åpner publiserte rutiner direkte, uten pålogging — det er hele
                  poenget med fysisk oppslag. Rutinen bør derfor ikke inneholde nøkkelkoder
                  eller personopplysninger.
                </div>
              </div>
            </div>
            <div className="rb-bryter-rad" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: "14px" }}>
              <div style={{ width: "180px" }}>
                <label className="field-label">Revideres</label>
                <select className="select" value={intervall} onChange={(e) => merk(setIntervall)(e.target.value)}>
                  {REVISJONSINTERVALLER.map((r) => (
                    <option key={String(r.verdi)} value={r.verdi === null ? "" : String(r.verdi)}>
                      {r.etikett}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ width: "180px" }}>
                <label className="field-label">Sist gjennomgått</label>
                <input className="input" value={sistGjennomgatt ? dato(sistGjennomgatt) : "Aldri"} disabled />
              </div>
              <div className="field-note" style={{ flex: 1, minWidth: "180px", margin: "0 0 8px" }}>
                Rutinen flagges som «Trenger gjennomgang» når fristen passeres. Versjon {versjon}
                {erUtkast ? " er under arbeid." : " kladdes nå — forrige ligger i historikken."}
              </div>
            </div>
          </div>
        </div>
      </div>

      {visPublisering && (
        <Modal
          tittel={`Publiser ${tittel || "rutinen"}`}
          onLukk={() => setVisPublisering(false)}
          bredde={520}
        >
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", marginTop: 0 }}>
            Rutinen blir synlig for alle i laget, QR-koden peker på den nye versjonen, og
            dagens kladd fryses som versjon {versjon} i historikken.
          </p>
          <Sjekk
            ok={Boolean(tittel.trim() && kategori)}
            navn="Rutinen har navn og kategori"
            forklaring={
              tittel.trim() && kategori
                ? `${tittel}, ${kat.etikett}`
                : !tittel.trim()
                  ? "Mangler navn"
                  : "Mangler kategori"
            }
          />
          <Sjekk
            ok={steg.length > 0 && utenOverskrift === 0 && utenTekst === 0}
            navn="Alle steg har overskrift og forklaring"
            forklaring={
              steg.length === 0
                ? "Ingen steg lagt inn ennå"
                : utenOverskrift > 0
                  ? `${utenOverskrift} steg uten overskrift blir ikke med`
                  : utenTekst > 0
                    ? `${utenTekst} steg mangler forklaring og blir tomme for leseren`
                    : `${steg.length} steg, alle utfylt`
            }
          />
          <Sjekk
            ok
            navn="Åpen uten innlogging"
            forklaring="QR-koden i oppgangen fungerer for alle som skanner den"
          />
          <Sjekk
            ok={intervall !== ""}
            navn={
              intervall !== ""
                ? `Neste gjennomgang settes til ${dato(omMndr(Number(intervall)))}`
                : "Påminnelse om gjennomgang er slått av"
            }
            forklaring={
              intervall !== ""
                ? "Rutinen flagges automatisk når fristen passeres"
                : "Rutinen flagges aldri som «trenger gjennomgang»"
            }
          />
          {!erUtkast && (
            <div className="rb-note" style={{ marginTop: "14px" }}>
              <b>QR-koden er den samme</b> — oppslaget i oppgangen trenger ikke skiftes ut.
              Bare skriv nytt hvis selve teksten på arket er utdatert.
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "18px", flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={() => setVisPublisering(false)}>Avbryt</button>
            <button className="btn" onClick={() => void publiser(true)} disabled={lagrer}>
              Publiser og åpne oppslag
            </button>
            <button className="btn btn-primary" onClick={() => void publiser(false)} disabled={lagrer}>
              Publiser
            </button>
          </div>
        </Modal>
      )}

      {visMaler && (
        <Modal tittel="Hent steg fra mal" onLukk={() => setVisMaler(false)} bredde={520}>
          <p style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", marginTop: 0 }}>
            Malene er laget av DriftIQ og kan endres fritt etterpå. Eksisterende steg
            beholdes — malens steg legges til under.
          </p>
          {RUTINEMALER.map((m) => (
            <button
              key={m.navn}
              className="rb-mal"
              onClick={() => {
                setSteg((liste) => [
                  ...liste,
                  ...m.steg.map((s) => ({ ...nyttSteg(), ...s })),
                ]);
                if (!kategori) setKategori(m.kategori);
                if (!tittel.trim()) setTittel(m.navn);
                setEndringsteller((n) => n + 1);
                setVisMaler(false);
              }}
            >
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: 600 }}>{m.navn}</span>
                <span style={{ display: "block", color: "var(--muted)", fontSize: "var(--fs-label)" }}>
                  {m.beskrivelse}
                </span>
              </span>
              <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: "var(--fs-label)" }}>
                {m.steg.length} steg
              </span>
            </button>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
            <button className="btn btn-ghost" onClick={() => setVisMaler(false)}>Avbryt</button>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

/** Knytt til-rad: forklaring til venstre, nedtrekk til høyre — som i mockupen. */
function Knytt({
  etikett,
  forklaring,
  verdi,
  valg,
  onVelg,
}: {
  etikett: string;
  forklaring: string;
  verdi: string;
  valg: Valg[];
  onVelg: (id: string) => void;
}) {
  return (
    <div className="rb-knytt">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: "var(--fs-sm)" }}>{etikett}</div>
        <div className="field-note" style={{ margin: 0 }}>{forklaring}</div>
      </div>
      <div className="velger">
        <select className="select" value={verdi} aria-label={etikett} onChange={(e) => onVelg(e.target.value)}>
          <option value="">Ingen valgt …</option>
          {valg.map((v) => (
            <option key={v.id} value={v.id}>{v.navn}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Sjekk({ ok, navn, forklaring }: { ok: boolean; navn: string; forklaring: string }) {
  return (
    <div className="rb-sjekk">
      <span className={`m ${ok ? "ok" : "mangler"}`}>{ok ? "✓" : "!"}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: "var(--fs-sm)" }}>{navn}</div>
        <div className="field-note" style={{ margin: 0 }}>{forklaring}</div>
      </div>
    </div>
  );
}
