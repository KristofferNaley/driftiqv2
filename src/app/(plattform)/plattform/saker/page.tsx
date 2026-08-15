"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { dato, datoTid, dagerSiden } from "@/components/felles";
import { api } from "@/lib/klient";
import { STATUS_ETIKETT, TYPE_ETIKETT } from "@/lib/feilmeldingtyper";
import { MENY } from "@/lib/moduler";
import { Ramme } from "../ramme";

/**
 * Innmeldinger — etter `mockups/innmeldinger-v3-mockup.html`: master–detalj i stedet for
 * kortlista. Lista viser hvem som venter på svar; detaljen samler hele saken — teknisk
 * kontekst som ble lagt ved automatisk, samtaletråden med kunden, og interne notater som
 * aldri sendes ut. Statusendringer føres som trådinnlegg av serveren (`settStatus`), og
 * «Løst» utløser automatisk e-post til melderen — det kvitteringen i «Meld feil» lover.
 */

type Sak = {
  id: string;
  nummer: number | null;
  orgId: string;
  orgNavn: string;
  type: string;
  modul: string | null;
  beskrivelse: string;
  status: string;
  melderNavn: string;
  melderEpost: string | null;
  appVersjon: string | null;
  nettleser: string | null;
  side: string | null;
  skjerm: string | null;
  iBacklog: boolean;
  opprettet: string;
  /** Første ikke-interne svar. `null` = melderen har aldri hørt fra oss. */
  forsteSvar: string | null;
};

type Melding = {
  id: string;
  internal: boolean;
  authorName: string;
  body: string;
  createdAt: string;
};

const STATUS_MERKE: Record<string, string> = {
  ny: "danger",
  under_arbeid: "warn",
  venter_kunde: "info",
  lost: "ok",
};
const TYPE_MERKE: Record<string, string> = { bug: "danger", idea: "pf", question: "info" };
const STATUSER = ["ny", "under_arbeid", "venter_kunde", "lost"] as const;
const FILTRE = ["alle", ...STATUSER] as const;

/** Svarene man skriver ti ganger i uka — ett trykk, så kan de tilpasses før sending. */
const MALER: Array<{ etikett: string; tekst: string }> = [
  {
    etikett: "Bekreftet feil",
    tekst: "Takk for at du meldte fra. Jeg klarte å gjenskape feilen og retter den denne uken.",
  },
  {
    etikett: "Forslag mottatt",
    tekst: "Takk for forslaget! Jeg har lagt det inn i arbeidslista, og gir beskjed når det er på plass.",
  },
  {
    etikett: "Be om mer info",
    tekst: "Kan du beskrive hva du gjorde rett før dette skjedde? Da finner jeg det raskere.",
  },
  {
    etikett: "Rettet og ute",
    tekst: "Dette er nå rettet og ligger ute. Si fra hvis du fortsatt ser problemet.",
  },
];

function fmNr(n: number | null): string {
  return `FM-${String(n ?? 0).padStart(4, "0")}`;
}

function modulEtikett(nokkel: string | null): string | null {
  if (!nokkel) return null;
  return (MENY as Record<string, { etikett: string }>)[nokkel]?.etikett ?? nokkel;
}

/**
 * «Chrome 141 / Android» ut av en user agent-streng. Grov med vilje — den skal svare på
 * «hvilken nettleser omtrent», ikke være et parserbibliotek. Hele strengen ligger i title.
 */
function lesbarUA(ua: string | null): string {
  if (!ua) return "—";
  const os = ua.includes("Windows")
    ? "Windows"
    : ua.includes("Android")
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : ua.includes("Mac")
          ? "macOS"
          : ua.includes("Linux")
            ? "Linux"
            : null;
  let nettleser: string | null = null;
  const v = (re: RegExp) => ua.match(re)?.[1];
  if (ua.includes("Edg/")) nettleser = `Edge ${v(/Edg\/(\d+)/) ?? ""}`;
  else if (ua.includes("OPR/")) nettleser = `Opera ${v(/OPR\/(\d+)/) ?? ""}`;
  else if (ua.includes("Firefox/")) nettleser = `Firefox ${v(/Firefox\/(\d+)/) ?? ""}`;
  else if (ua.includes("Chrome/")) nettleser = `Chrome ${v(/Chrome\/(\d+)/) ?? ""}`;
  else if (ua.includes("Safari") && ua.includes("Version/"))
    nettleser = `Safari ${v(/Version\/(\d+(?:\.\d+)?)/) ?? ""}`;
  const ut = [nettleser?.trim(), os].filter(Boolean).join(" / ");
  return ut || ua.slice(0, 40);
}

function alder(iso: string): string {
  const d = dagerSiden(iso) ?? 0;
  if (d <= 0) return "i dag";
  if (d === 1) return "i går";
  return `${d} dager`;
}

/** Uten ikke-internt svar og ikke løst: melderen venter fortsatt på oss. */
const erUbesvart = (s: Sak) => !s.forsteSvar && s.status !== "lost";

export default function Saker() {
  const [liste, setListe] = useState<Sak[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTRE)[number]>("alle");
  const [typeFilter, setTypeFilter] = useState("");
  const [sok, setSok] = useState("");
  const [valgtId, setValgtId] = useState<string | null>(null);
  const [trad, setTrad] = useState<Record<string, Melding[]>>({});
  const [jobber, setJobber] = useState(false);

  const [modus, setModus] = useState<"svar" | "intern">("svar");
  const [melding, setMelding] = useState("");

  const last = useCallback(async () => {
    try {
      setListe(await api.hent<Sak[]>("/plattform/saker"));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente sakene");
    }
  }, []);

  useEffect(() => {
    void last();
  }, [last]);

  const lastTrad = useCallback(async (id: string) => {
    try {
      const sak = await api.hent<{ meldinger: Melding[] }>(`/plattform/saker/${id}`);
      setTrad((f) => ({ ...f, [id]: sak.meldinger }));
    } catch {
      // Tråden er tilbehør — detaljen skal ikke velte om den feiler.
    }
  }, []);

  useEffect(() => {
    if (valgtId && !trad[valgtId]) void lastTrad(valgtId);
  }, [valgtId, trad, lastTrad]);

  const alle = useMemo(() => liste ?? [], [liste]);

  const filtrert = useMemo(() => {
    const q = sok.trim().toLowerCase();
    return alle.filter((s) => {
      if (filter !== "alle" && s.status !== filter) return false;
      if (typeFilter && s.type !== typeFilter) return false;
      if (!q) return true;
      return `${s.beskrivelse} ${s.orgNavn} ${s.melderNavn} ${modulEtikett(s.modul) ?? ""} ${fmNr(s.nummer)}`
        .toLowerCase()
        .includes(q);
    });
  }, [alle, filter, typeFilter, sok]);

  // Valget skal alltid peke på noe synlig — forsvinner raden ut av filteret, velges den øverste.
  useEffect(() => {
    if (filtrert.length === 0) return;
    if (!valgtId || !filtrert.some((s) => s.id === valgtId)) setValgtId(filtrert[0]!.id);
  }, [filtrert, valgtId]);

  const valgt = alle.find((s) => s.id === valgtId) ?? null;

  // Halvskrevne meldinger hører til én sak — de skal ikke bli med over til neste.
  useEffect(() => {
    setMelding("");
    setModus("svar");
  }, [valgtId]);

  async function utfor(fn: () => Promise<unknown>, ellers = "Kunne ikke lagre") {
    setJobber(true);
    setFeil(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setFeil(e instanceof Error ? e.message : ellers);
      return false;
    } finally {
      setJobber(false);
    }
  }

  async function settStatus(id: string, status: string) {
    return utfor(async () => {
      await api.endre(`/plattform/saker/${id}`, { status });
      await Promise.all([last(), lastTrad(id)]);
    });
  }

  async function settBacklog(id: string, iBacklog: boolean) {
    return utfor(async () => {
      await api.lapp(`/plattform/saker/${id}`, { iBacklog });
      await last();
    });
  }

  async function send(id: string) {
    const tekst = melding.trim();
    if (!tekst) return;
    const ok = await utfor(async () => {
      await api.send(`/plattform/saker/${id}`, { body: tekst, internal: modus === "intern" });
      await Promise.all([last(), lastTrad(id)]);
    });
    if (ok) setMelding("");
  }

  /** Semikolon og BOM — kombinasjonen norsk Excel faktisk åpner riktig. */
  function eksporter() {
    const felt = (v: string | null) => `"${(v ?? "").replaceAll('"', '""')}"`;
    const linjer = [
      ["Sak", "Type", "Modul", "Status", "Kunde", "Melder", "Registrert", "Beskrivelse"].join(";"),
      ...filtrert.map((s) =>
        [
          felt(fmNr(s.nummer)),
          felt(TYPE_ETIKETT[s.type] ?? s.type),
          felt(modulEtikett(s.modul)),
          felt(STATUS_ETIKETT[s.status] ?? s.status),
          felt(s.orgNavn),
          felt(s.melderNavn),
          felt(dato(s.opprettet)),
          felt(s.beskrivelse),
        ].join(";"),
      ),
    ];
    const blob = new Blob(["\uFEFF" + linjer.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `innmeldinger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ── KPI-ene ── */
  const ubesvarte = alle.filter(erUbesvart);
  const eldsteUbesvart = ubesvarte.reduce((n, s) => Math.max(n, dagerSiden(s.opprettet) ?? 0), 0);
  const apne = alle.filter((s) => s.status !== "lost");
  const venterKunde = alle.filter((s) => s.status === "venter_kunde").length;
  const besvarte = alle.filter((s) => s.forsteSvar);
  const snittTimer = besvarte.length
    ? Math.round(
        besvarte.reduce(
          (n, s) => n + (new Date(s.forsteSvar!).getTime() - new Date(s.opprettet).getTime()),
          0,
        ) /
          besvarte.length /
          3_600_000,
      )
    : null;
  const loste30 = alle.filter(
    (s) => s.status === "lost" && (dagerSiden(s.opprettet) ?? 0) < 30,
  ).length;
  const inn30 = alle.filter((s) => (dagerSiden(s.opprettet) ?? 0) < 30).length;

  const antall = (f: (typeof FILTRE)[number]) =>
    f === "alle" ? alle.length : alle.filter((s) => s.status === f).length;

  return (
    <Ramme tittel="Innmeldinger">
      {feil && <div className="feilmelding">{feil}</div>}

      <div style={{ display: "flex", gap: "14px", alignItems: "flex-start", flexWrap: "wrap" }}>
        <p className="pf-dempet" style={{ maxWidth: "74ch" }}>
          Feil, forslag og spørsmål fra kundene. Teknisk kontekst legges ved automatisk, så du
          slipper å spørre om versjon og nettleser.
        </p>
        <button
          className="btn btn-ghost"
          style={{ marginLeft: "auto" }}
          onClick={eksporter}
          disabled={filtrert.length === 0}
        >
          Eksporter
        </button>
      </div>

      <div className="pf-kpi-grid">
        <div className={`pf-kpi${ubesvarte.length > 0 ? " pf-kpi-varsel" : ""}`}>
          <div className="pf-kpi-etikett">Ubesvart</div>
          <div className="pf-kpi-verdi">{ubesvarte.length}</div>
          <div className="pf-dempet">
            {ubesvarte.length > 0
              ? eldsteUbesvart > 0
                ? `Eldste er ${eldsteUbesvart} dager gammel`
                : "alle kom i dag"
              : "alle har fått svar"}
          </div>
        </div>
        <div className="pf-kpi">
          <div className="pf-kpi-etikett">Åpne saker</div>
          <div className="pf-kpi-verdi">{apne.length}</div>
          <div className="pf-dempet">
            {venterKunde > 0 ? `${venterKunde} venter på kunde` : "ingen venter på kunde"}
          </div>
        </div>
        <div className="pf-kpi">
          <div className="pf-kpi-etikett">Snitt svartid</div>
          <div className="pf-kpi-verdi">
            {snittTimer === null ? "—" : snittTimer < 48 ? snittTimer : Math.round(snittTimer / 24)}{" "}
            {snittTimer !== null && (
              <small style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", fontWeight: 400 }}>
                {snittTimer < 48 ? "timer" : "dager"}
              </small>
            )}
          </div>
          <div className="pf-dempet">Mål: samme arbeidsdag</div>
        </div>
        <div className="pf-kpi">
          <div className="pf-kpi-etikett">Løst siste 30 dager</div>
          <div className="pf-kpi-verdi">{loste30}</div>
          <div className="pf-dempet">av {inn30} innmeldte</div>
        </div>
      </div>

      <div className="pf-verktoylinje">
        {FILTRE.map((f) => (
          <button
            key={f}
            className={`pf-chip${filter === f ? " valgt" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "alle" ? "Alle" : STATUS_ETIKETT[f]}{" "}
            <span className="pf-dempet">{antall(f)}</span>
          </button>
        ))}
        <select
          className="select"
          style={{ width: "auto" }}
          aria-label="Filtrer på type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">Alle typer</option>
          <option value="bug">Feil</option>
          <option value="idea">Forslag</option>
          <option value="question">Spørsmål</option>
        </select>
        <input
          className="input pf-sok"
          style={{ marginLeft: "auto" }}
          placeholder="Søk tittel, kunde eller modul"
          aria-label="Søk i innmeldinger"
          value={sok}
          onChange={(e) => setSok(e.target.value)}
        />
      </div>

      {!liste ? (
        <p className="pf-dempet">Henter …</p>
      ) : (
        <div className="pf-md-split">
          <div className="pf-kort">
            <div className="pf-kort-hode">
              <span>Innmeldinger</span>
              <span style={{ fontWeight: 400, letterSpacing: 0 }}>
                {filtrert.length} av {alle.length}
              </span>
            </div>
            {filtrert.length === 0 ? (
              <p className="pf-dempet" style={{ padding: "28px 16px", textAlign: "center" }}>
                {alle.length === 0 ? "Ingen innmeldinger ennå." : "Ingen saker passer søket."}
              </p>
            ) : (
              filtrert.map((s) => (
                <button
                  key={s.id}
                  className={`pf-md-rad${s.id === valgtId ? " valgt" : ""}`}
                  onClick={() => setValgtId(s.id)}
                >
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span className="pf-sak-id">{fmNr(s.nummer)}</span>
                      <span className={`badge ${TYPE_MERKE[s.type] ?? "muted"}`}>
                        {TYPE_ETIKETT[s.type] ?? s.type}
                      </span>
                      {s.modul && <span className="pf-under">{modulEtikett(s.modul)}</span>}
                      <span className="pf-md-nar">{alder(s.opprettet)}</span>
                    </span>
                    <span className="pf-navn" style={{ marginTop: "4px" }}>
                      {s.beskrivelse.length > 90 ? `${s.beskrivelse.slice(0, 90)} …` : s.beskrivelse}
                    </span>
                    <span className="pf-under">
                      {s.orgNavn}, {s.melderNavn}
                    </span>
                    {erUbesvart(s) && <span className="pf-sak-flagg">Ikke besvart</span>}
                  </span>
                </button>
              ))
            )}
          </div>

          {!valgt ? (
            <div className="pf-kort pf-md-detalj">
              <p className="pf-dempet">Velg en sak i lista.</p>
            </div>
          ) : (
            <div className="pf-kort pf-md-detalj">
              <div className="pf-md-hode" style={{ display: "block" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span className="pf-sak-id">{fmNr(valgt.nummer)}</span>
                  <span className={`badge ${TYPE_MERKE[valgt.type] ?? "muted"}`}>
                    {TYPE_ETIKETT[valgt.type] ?? valgt.type}
                  </span>
                  {valgt.modul && <span className="badge muted">{modulEtikett(valgt.modul)}</span>}
                  {valgt.iBacklog && <span className="badge pf">I backloggen</span>}
                  <span
                    className={`badge ${STATUS_MERKE[valgt.status] ?? "muted"}`}
                    style={{ marginLeft: "auto" }}
                  >
                    {STATUS_ETIKETT[valgt.status] ?? valgt.status}
                  </span>
                </div>
                <p
                  className="pf-tekst"
                  style={{ whiteSpace: "pre-wrap", margin: "12px 0 6px", fontWeight: 600 }}
                >
                  {valgt.beskrivelse}
                </p>
                <span className="pf-under">
                  {valgt.orgNavn} · {valgt.melderNavn}
                  {valgt.melderEpost && (
                    <>
                      {" · "}
                      <a className="pf-lenke-inline" href={`mailto:${valgt.melderEpost}`}>
                        {valgt.melderEpost}
                      </a>
                    </>
                  )}
                  {" · "}
                  {datoTid(valgt.opprettet)}
                </span>
              </div>

              <div className="pf-md-seksjon">
                <h3>Status</h3>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {STATUSER.map((st) => (
                    <button
                      key={st}
                      className={`pille${valgt.status === st ? " valgt" : ""}`}
                      disabled={jobber}
                      onClick={() => void settStatus(valgt.id, st)}
                    >
                      {STATUS_ETIKETT[st]}
                    </button>
                  ))}
                </div>
                <p className="pf-under" style={{ marginTop: "10px" }}>
                  Melderen får automatisk e-post når saken settes til løst.
                </p>
              </div>

              <div className="pf-md-seksjon">
                <h3>
                  Teknisk kontekst <span className="pf-md-kilde">Lagt ved automatisk</span>
                </h3>
                <dl className="pf-md-par">
                  <div>
                    <dt>Versjon</dt>
                    <dd className={valgt.appVersjon ? "" : "tom"}>{valgt.appVersjon ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Nettleser</dt>
                    <dd className={valgt.nettleser ? "" : "tom"} title={valgt.nettleser ?? undefined}>
                      {lesbarUA(valgt.nettleser)}
                    </dd>
                  </div>
                  <div>
                    <dt>Side</dt>
                    <dd className={valgt.side ? "" : "tom"}>{valgt.side ?? "Ikke registrert"}</dd>
                  </div>
                  <div>
                    <dt>Vindusstørrelse</dt>
                    <dd className={valgt.skjerm ? "" : "tom"}>{valgt.skjerm ?? "Ikke registrert"}</dd>
                  </div>
                </dl>
              </div>

              <div className="pf-md-seksjon">
                <h3>Backlog</h3>
                <div className="pf-md-infokort">
                  <div>
                    <span className="pf-under">
                      {valgt.iBacklog ? "Bekreftet — skal gjøres noe med" : "Ikke i backloggen"}
                    </span>
                    <span className="pf-navn">
                      {valgt.iBacklog
                        ? "Ligger i arbeidslista"
                        : "Marker saken når den skal føres videre"}
                    </span>
                  </div>
                  <div className="pf-md-handling">
                    <button
                      className="btn"
                      disabled={jobber}
                      onClick={() => void settBacklog(valgt.id, !valgt.iBacklog)}
                    >
                      {valgt.iBacklog ? "Fjern fra backloggen" : "Legg i backloggen"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="pf-md-seksjon">
                <h3>Samtale</h3>
                {!trad[valgt.id] ? (
                  <p className="pf-dempet">Henter …</p>
                ) : (
                  <ul className="pf-sak-trad">
                    <li>
                      <span className="pf-sak-avatar" aria-hidden>K</span>
                      <span className="pf-sak-kropp">
                        <span style={{ display: "flex", gap: "8px", fontWeight: 600 }}>
                          {valgt.melderNavn}
                          <span className="pf-md-nar">{datoTid(valgt.opprettet)}</span>
                        </span>
                        <span style={{ whiteSpace: "pre-wrap" }}>{valgt.beskrivelse}</span>
                      </span>
                    </li>
                    {trad[valgt.id]!.map((m) => (
                      <li key={m.id} className={m.internal ? "intern" : ""}>
                        <span
                          className={`pf-sak-avatar ${m.internal ? "intern" : "oss"}`}
                          aria-hidden
                        >
                          {m.internal ? "!" : "DIQ"}
                        </span>
                        <span className="pf-sak-kropp">
                          <span style={{ display: "flex", gap: "8px", fontWeight: 600 }}>
                            {m.authorName}
                            {m.internal && <span className="badge warn">Internt</span>}
                            <span className="pf-md-nar">{datoTid(m.createdAt)}</span>
                          </span>
                          <span style={{ whiteSpace: "pre-wrap" }}>{m.body}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="pf-sak-svarboks">
                  <div className="pf-sak-faner">
                    <button
                      className={`pf-sak-fane${modus === "svar" ? " valgt" : ""}`}
                      onClick={() => setModus("svar")}
                    >
                      Svar til melderen
                    </button>
                    <button
                      className={`pf-sak-fane${modus === "intern" ? " valgt" : ""}`}
                      onClick={() => setModus("intern")}
                    >
                      Internt notat
                    </button>
                  </div>
                  <textarea
                    placeholder={
                      modus === "svar"
                        ? `Svaret sendes på e-post til ${valgt.melderEpost ?? "melderen"}`
                        : "Notatet er bare synlig i panelet"
                    }
                    aria-label={modus === "svar" ? "Svar til melderen" : "Internt notat"}
                    value={melding}
                    onChange={(e) => setMelding(e.target.value)}
                  />
                  {modus === "svar" && (
                    <div className="pf-sak-maler">
                      {MALER.map((m) => (
                        <button key={m.etikett} onClick={() => setMelding(m.tekst)}>
                          {m.etikett}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="pf-sak-fot">
                    <span className="hint">
                      {modus === "svar"
                        ? "Sendes på e-post og lagres i saken"
                        : "Sendes ikke til kunden"}
                    </span>
                    <button
                      className="btn btn-primary"
                      style={{ marginLeft: "auto" }}
                      disabled={jobber || !melding.trim()}
                      onClick={() => void send(valgt.id)}
                    >
                      {modus === "svar" ? "Send svar" : "Lagre notat"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Ramme>
  );
}
