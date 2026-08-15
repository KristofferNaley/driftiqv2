"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { dato, datoTid, dagerSiden } from "@/components/felles";
import { Knapperad, Modal, Tekstfelt, Tekstomrade } from "@/components/skjema";
import { api } from "@/lib/klient";
import { Ramme } from "../ramme";

/**
 * Leads — etter `mockups/leads-v3-mockup.html`: master–detalj i stedet for kortlista.
 *
 * Lista til venstre svarer på «hvem venter på meg» (statusprikk, avtalt neste steg, hvor
 * lenge en ny lead har ligget ubesvart); detaljen til høyre samler alt om den valgte —
 * pipeline, oppfølging, selskapsdata fra Enhetsregisteret, kontaktperson og aktivitetslogg.
 * Loggen skrives av serveren ved hver flytting (`oppdaterLead`), så historikken ikke
 * avhenger av at noen husket å notere.
 */

type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string | null;
  status: string;
  createdAt: string;
  convertedOrgId: string | null;
  orgNr: string | null;
  orgForm: string | null;
  kommune: string | null;
  adresse: string | null;
  postnummer: string | null;
  poststed: string | null;
  brregEpost: string | null;
  brregTelefon: string | null;
  nettsted: string | null;
  nextAction: string | null;
  nextDate: string | null;
};

type Aktivitet = {
  id: string;
  text: string;
  note: string | null;
  actorName: string | null;
  createdAt: string;
};

const STATUS: Record<string, { etikett: string; merke: string }> = {
  ny: { etikett: "Ny", merke: "danger" },
  kontaktet: { etikett: "Kontaktet", merke: "warn" },
  kvalifisert: { etikett: "Kvalifisert", merke: "ok" },
  avslatt: { etikett: "Avslått", merke: "muted" },
  // Settes av «Lag kunde» — aldri manuelt, derfor utenfor flytteknappene.
  konvertert: { etikett: "Kunde", merke: "info" },
};
const LOP = ["ny", "kontaktet", "kvalifisert", "konvertert"] as const;
const FILTRE = ["alle", "ny", "kontaktet", "kvalifisert", "konvertert", "avslatt"] as const;

/** Kort alder til høyrekolonnen i lista — «for 3 dager siden» er for lang der. */
function alder(iso: string): string {
  const d = dagerSiden(iso) ?? 0;
  if (d <= 0) return "i dag";
  if (d === 1) return "i går";
  return `${d} dager`;
}

/** Dagens dato lokalt — `toISOString()` er UTC og bommer med én dag om natten. */
function iDag(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/** Ny lead som har ligget to døgn uten at noen har rørt den — panelets viktigste tall. */
const venterDager = (l: Lead) => (l.status === "ny" ? (dagerSiden(l.createdAt) ?? 0) : 0);

export default function Leads() {
  const router = useRouter();
  const [liste, setListe] = useState<Lead[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTRE)[number]>("alle");
  const [sok, setSok] = useState("");
  const [valgtId, setValgtId] = useState<string | null>(null);
  const [logg, setLogg] = useState<Record<string, Aktivitet[]>>({});
  const [jobber, setJobber] = useState(false);

  const [notat, setNotat] = useState("");
  const [nesteApen, setNesteApen] = useState(false);
  const [nesteTekst, setNesteTekst] = useState("");
  const [nesteDato, setNesteDato] = useState("");
  const [avslaaApen, setAvslaaApen] = useState(false);
  const [avslaaGrunn, setAvslaaGrunn] = useState("");
  const [bekreftSlett, setBekreftSlett] = useState(false);
  const [manuellApen, setManuellApen] = useState(false);
  const [manuell, setManuell] = useState({ navn: "", epost: "", telefon: "", selskap: "", orgnr: "", melding: "" });

  const last = useCallback(async () => {
    try {
      setListe(await api.hent<Lead[]>("/plattform/leads"));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente henvendelsene");
    }
  }, []);

  useEffect(() => {
    void last();
  }, [last]);

  const lastLogg = useCallback(async (id: string) => {
    try {
      const rader = await api.hent<Aktivitet[]>(`/plattform/leads/${id}/aktivitet`);
      setLogg((f) => ({ ...f, [id]: rader }));
    } catch {
      // Loggen er tilbehør — detaljen skal ikke velte om den feiler.
    }
  }, []);

  useEffect(() => {
    if (valgtId && !logg[valgtId]) void lastLogg(valgtId);
  }, [valgtId, logg, lastLogg]);

  const alle = useMemo(() => liste ?? [], [liste]);

  const filtrert = useMemo(() => {
    const q = sok.trim().toLowerCase();
    return alle.filter((l) => {
      if (filter !== "alle" && l.status !== filter) return false;
      if (!q) return true;
      return `${l.name} ${l.email} ${l.company ?? ""} ${l.orgNr ?? ""}`.toLowerCase().includes(q);
    });
  }, [alle, filter, sok]);

  // Valget skal alltid peke på noe synlig — forsvinner raden ut av filteret, velges den øverste.
  useEffect(() => {
    if (filtrert.length === 0) return;
    if (!valgtId || !filtrert.some((l) => l.id === valgtId)) setValgtId(filtrert[0]!.id);
  }, [filtrert, valgtId]);

  const valgt = alle.find((l) => l.id === valgtId) ?? null;

  // Skjemastate hører til én lead — bytt lead, og halvskrevne felter skal ikke bli med.
  useEffect(() => {
    setNesteApen(false);
    setAvslaaApen(false);
    setBekreftSlett(false);
    setNotat("");
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

  async function oppdater(id: string, kropp: unknown) {
    return utfor(async () => {
      await api.endre(`/plattform/leads/${id}`, kropp);
      await Promise.all([last(), lastLogg(id)]);
    });
  }

  async function leggTilNotat(id: string, tekst: string) {
    return utfor(async () => {
      const rader = await api.send<Aktivitet[]>(`/plattform/leads/${id}/aktivitet`, { tekst });
      setLogg((f) => ({ ...f, [id]: rader }));
    });
  }

  async function markerGjort(l: Lead) {
    return utfor(async () => {
      const rader = await api.send<Aktivitet[]>(`/plattform/leads/${l.id}/aktivitet`, {
        tekst: `Gjort: ${l.nextAction}`,
      });
      setLogg((f) => ({ ...f, [l.id]: rader }));
      await api.endre(`/plattform/leads/${l.id}`, { neste: null });
      await last();
    });
  }

  async function oppdaterBrreg(id: string) {
    return utfor(async () => {
      await api.send(`/plattform/leads/${id}/brreg`, {});
      await Promise.all([last(), lastLogg(id)]);
    }, "Kunne ikke oppdatere fra Enhetsregisteret");
  }

  async function konverter(id: string) {
    setJobber(true);
    setFeil(null);
    try {
      const org = await api.send<{ id: string }>(`/plattform/leads/${id}/konverter`, {});
      router.push(`/plattform/kunder/${org.id}`);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke opprette kunden");
      setJobber(false);
    }
  }

  async function slett(id: string) {
    const ok = await utfor(async () => {
      await api.slett(`/plattform/leads/${id}`);
      await last();
    });
    if (ok) {
      setBekreftSlett(false);
      setValgtId(null);
    }
  }

  async function opprettManuell() {
    const ok = await utfor(async () => {
      const rad = await api.send<{ id: string }>("/plattform/leads", {
        name: manuell.navn,
        email: manuell.epost,
        phone: manuell.telefon || null,
        company: manuell.selskap || null,
        orgNr: manuell.orgnr || null,
        message: manuell.melding || null,
      });
      await last();
      setFilter("alle");
      setSok("");
      setValgtId(rad.id);
    }, "Kunne ikke registrere leaden");
    if (ok) {
      setManuellApen(false);
      setManuell({ navn: "", epost: "", telefon: "", selskap: "", orgnr: "", melding: "" });
    }
  }

  /** Semikolon og BOM — den kombinasjonen norsk Excel faktisk åpner riktig. */
  function eksporter() {
    const felt = (v: string | null) => `"${(v ?? "").replaceAll('"', '""')}"`;
    const linjer = [
      ["Navn", "E-post", "Telefon", "Selskap", "Org.nr", "Status", "Registrert", "Neste steg", "Melding"].join(";"),
      ...filtrert.map((l) =>
        [
          felt(l.name), felt(l.email), felt(l.phone), felt(l.company), felt(l.orgNr),
          felt(STATUS[l.status]?.etikett ?? l.status), felt(dato(l.createdAt)),
          felt(l.nextAction && `${l.nextAction} ${dato(l.nextDate)}`), felt(l.message),
        ].join(";"),
      ),
    ];
    const blob = new Blob(["\uFEFF" + linjer.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `leads-${iDag()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ── KPI-ene ── */
  const venter = alle.filter((l) => venterDager(l) >= 2);
  const eldsteVenter = venter.reduce((n, l) => Math.max(n, venterDager(l)), 0);
  const dagerGamle = (fra: number, til: number) =>
    alle.filter((l) => {
      const d = dagerSiden(l.createdAt) ?? 0;
      return d >= fra && d < til;
    }).length;
  const denneUken = dagerGamle(0, 7);
  const forrigeUke = dagerGamle(7, 14);
  const underArbeid = alle.filter((l) => l.status === "kontaktet" || l.status === "kvalifisert").length;
  const siste90 = alle.filter((l) => (dagerSiden(l.createdAt) ?? 0) < 90);
  const kunder90 = siste90.filter((l) => l.status === "konvertert").length;

  const antall = (f: (typeof FILTRE)[number]) =>
    f === "alle" ? alle.length : alle.filter((l) => l.status === f).length;

  const overForfall = (l: Lead) => Boolean(l.nextDate && l.nextDate < iDag());
  const lukket = valgt ? valgt.status === "konvertert" || valgt.status === "avslatt" : false;
  const stegIdx = valgt ? LOP.indexOf(valgt.status as (typeof LOP)[number]) : -1;

  return (
    <Ramme tittel="Leads">
      {feil && <div className="feilmelding">{feil}</div>}

      <div style={{ display: "flex", gap: "14px", alignItems: "flex-start", flexWrap: "wrap" }}>
        <p className="pf-dempet" style={{ maxWidth: "70ch" }}>
          Interessenter fra landingssiden — selskapsdata hentes fra Enhetsregisteret,
          kontaktinfo skriver de inn selv. Hvem som varsles på e-post styres under{" "}
          <Link className="pf-lenke-inline" href="/plattform/prismodell">Prismodell</Link>.
        </p>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <button className="btn btn-ghost" onClick={eksporter} disabled={filtrert.length === 0}>
            Eksporter
          </button>
          <button className="btn" onClick={() => setManuellApen(true)}>
            Legg inn lead manuelt
          </button>
        </div>
      </div>

      <div className="pf-kpi-grid">
        <div className={`pf-kpi${venter.length > 0 ? " pf-kpi-varsel" : ""}`}>
          <div className="pf-kpi-etikett">Venter på svar</div>
          <div className="pf-kpi-verdi">{venter.length}</div>
          <div className="pf-dempet">
            {venter.length > 0 ? `Eldste er ${eldsteVenter} dager gammel` : "ingen ubesvarte"}
          </div>
        </div>
        <div className="pf-kpi">
          <div className="pf-kpi-etikett">Nye denne uken</div>
          <div className="pf-kpi-verdi">{denneUken}</div>
          <div className="pf-dempet">Forrige uke: {forrigeUke}</div>
        </div>
        <div className="pf-kpi">
          <div className="pf-kpi-etikett">Under arbeid</div>
          <div className="pf-kpi-verdi">{underArbeid}</div>
          <div className="pf-dempet">kontaktet og kvalifisert</div>
        </div>
        <div className="pf-kpi">
          <div className="pf-kpi-etikett">Blir kunde</div>
          <div className="pf-kpi-verdi">
            {siste90.length > 0 ? Math.round((kunder90 / siste90.length) * 100) : 0}{" "}
            <small style={{ fontSize: "var(--fs-sm)", color: "var(--muted)", fontWeight: 400 }}>%</small>
          </div>
          <div className="pf-dempet">{kunder90} av {siste90.length} siste 90 dager</div>
        </div>
      </div>

      <div className="pf-verktoylinje">
        {FILTRE.map((f) => (
          <button
            key={f}
            className={`pf-chip${filter === f ? " valgt" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "alle" ? "Alle" : STATUS[f]!.etikett}{" "}
            <span className="pf-dempet">{antall(f)}</span>
          </button>
        ))}
        <input
          className="input pf-sok"
          style={{ marginLeft: "auto" }}
          placeholder="Søk navn, selskap eller org.nr"
          aria-label="Søk i leads"
          value={sok}
          onChange={(e) => setSok(e.target.value)}
        />
      </div>

      {!liste ? (
        <p className="pf-dempet">Henter …</p>
      ) : (
        <div className="pf-ld-split">
          <div className="pf-kort">
            <div className="pf-kort-hode">
              <span>Leads</span>
              <span style={{ fontWeight: 400, letterSpacing: 0 }}>
                {filtrert.length} av {alle.length}
              </span>
            </div>
            {filtrert.length === 0 ? (
              <p className="pf-dempet" style={{ padding: "28px 16px", textAlign: "center" }}>
                {alle.length === 0 ? "Ingen henvendelser ennå." : "Ingen leads passer søket."}
              </p>
            ) : (
              filtrert.map((l) => (
                <button
                  key={l.id}
                  className={`pf-ld-rad${l.id === valgtId ? " valgt" : ""}`}
                  onClick={() => setValgtId(l.id)}
                >
                  <span className={`pf-ld-prikk ${l.status}`} aria-hidden />
                  <span style={{ minWidth: 0 }}>
                    <span className="pf-navn">{l.name}</span>
                    <span className="pf-under">{l.company ?? l.email}</span>
                    {l.nextAction ? (
                      <span className={`pf-ld-neste${overForfall(l) ? " over" : ""}`} style={{ display: "block" }}>
                        Neste: {l.nextAction} {dato(l.nextDate)}
                      </span>
                    ) : venterDager(l) >= 2 ? (
                      <span className="pf-ld-neste over" style={{ display: "block" }}>
                        Venter på svar i {venterDager(l)} dager
                      </span>
                    ) : null}
                  </span>
                  <span className="pf-ld-nar">{alder(l.createdAt)}</span>
                </button>
              ))
            )}
          </div>

          {!valgt ? (
            <div className="pf-kort pf-ld-detalj">
              <p className="pf-dempet">Velg en lead i lista.</p>
            </div>
          ) : (
            <div className="pf-kort pf-ld-detalj">
              <div className="pf-ld-hode">
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ margin: 0, fontSize: "var(--fs-lg)", fontWeight: 700 }}>{valgt.name}</h2>
                  <span className="pf-dempet">{valgt.company ?? valgt.email}</span>
                </div>
                <div className="pf-ld-handling">
                  <span className={`badge ${STATUS[valgt.status]?.merke ?? "muted"}`}>
                    {STATUS[valgt.status]?.etikett ?? valgt.status}
                  </span>
                  {valgt.status === "konvertert" ? (
                    valgt.convertedOrgId && (
                      <Link href={`/plattform/kunder/${valgt.convertedOrgId}`} className="btn">
                        Åpne kundesiden
                      </Link>
                    )
                  ) : valgt.status === "avslatt" ? (
                    <button
                      className="btn"
                      disabled={jobber}
                      onClick={() => void oppdater(valgt.id, { status: "ny" })}
                    >
                      Gjenåpne
                    </button>
                  ) : (
                    <>
                      {valgt.status === "kvalifisert" ? (
                        <button className="btn btn-primary" disabled={jobber} onClick={() => void konverter(valgt.id)}>
                          {jobber ? "Oppretter …" : "Opprett kunde"}
                        </button>
                      ) : (
                        <button
                          className="btn"
                          disabled={jobber}
                          onClick={() =>
                            void oppdater(valgt.id, {
                              status: valgt.status === "ny" ? "kontaktet" : "kvalifisert",
                            })
                          }
                        >
                          Flytt til {valgt.status === "ny" ? "Kontaktet" : "Kvalifisert"}
                        </button>
                      )}
                      <button
                        className="btn btn-ghost"
                        style={{ color: "var(--danger)" }}
                        disabled={jobber}
                        onClick={() => {
                          setAvslaaGrunn("");
                          setAvslaaApen(true);
                        }}
                      >
                        Avslå
                      </button>
                    </>
                  )}
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--danger)" }}
                    disabled={jobber}
                    onClick={() => setBekreftSlett(true)}
                  >
                    Slett
                  </button>
                </div>
              </div>

              <div className="pf-ld-seksjon">
                <h3>Status</h3>
                <div className="pf-ld-steg">
                  {LOP.map((s, i) => (
                    <span key={s} className={valgt.status !== "avslatt" && i === stegIdx ? "naa" : ""}>
                      {STATUS[s]!.etikett}
                    </span>
                  ))}
                  {valgt.status === "avslatt" && <span className="dod">Avslått</span>}
                </div>
              </div>

              <div className="pf-ld-seksjon">
                <h3>Neste steg</h3>
                {nesteApen ? (
                  <form
                    className="pf-ld-nestekort"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void oppdater(valgt.id, { neste: { tekst: nesteTekst.trim(), dato: nesteDato } }).then(
                        (ok) => ok && setNesteApen(false),
                      );
                    }}
                  >
                    <input
                      className="input"
                      style={{ flex: 2, minWidth: "160px" }}
                      placeholder="Hva er avtalt? F.eks. «Ringe tilbake»"
                      aria-label="Neste steg"
                      value={nesteTekst}
                      onChange={(e) => setNesteTekst(e.target.value)}
                    />
                    <input
                      className="input"
                      style={{ flex: 1, minWidth: "130px" }}
                      type="date"
                      aria-label="Dato"
                      value={nesteDato}
                      onChange={(e) => setNesteDato(e.target.value)}
                    />
                    <div className="pf-ld-handling">
                      <button type="button" className="btn btn-ghost" onClick={() => setNesteApen(false)}>
                        Avbryt
                      </button>
                      <button
                        className="btn btn-primary"
                        disabled={jobber || !nesteTekst.trim() || !nesteDato}
                      >
                        Lagre
                      </button>
                    </div>
                  </form>
                ) : valgt.nextAction ? (
                  <div className={`pf-ld-nestekort${overForfall(valgt) ? " over" : ""}`}>
                    <div>
                      <span className="pf-under">Avtalt</span>
                      <span className="pf-navn">
                        {valgt.nextAction}, {dato(valgt.nextDate)}
                      </span>
                    </div>
                    <div className="pf-ld-handling">
                      <button
                        className="btn btn-ghost"
                        disabled={jobber}
                        onClick={() => {
                          setNesteTekst(valgt.nextAction ?? "");
                          setNesteDato(valgt.nextDate ?? "");
                          setNesteApen(true);
                        }}
                      >
                        Endre
                      </button>
                      <button className="btn" disabled={jobber} onClick={() => void markerGjort(valgt)}>
                        Marker som gjort
                      </button>
                    </div>
                  </div>
                ) : lukket ? (
                  <div className="pf-ld-nestekort">
                    <div>
                      <span className="pf-under">Ingen oppfølging trengs</span>
                      <span className="pf-navn">Saken er lukket</span>
                    </div>
                  </div>
                ) : (
                  <div className="pf-ld-nestekort over">
                    <div>
                      <span className="pf-under">Ingen oppfølging er satt</span>
                      <span className="pf-navn">
                        {venterDager(valgt) >= 2
                          ? `Leaden har ventet i ${venterDager(valgt)} dager`
                          : "Sett et neste steg før du går videre"}
                      </span>
                    </div>
                    <div className="pf-ld-handling">
                      <button
                        className="btn btn-primary"
                        disabled={jobber}
                        onClick={() => {
                          setNesteTekst("");
                          setNesteDato("");
                          setNesteApen(true);
                        }}
                      >
                        Sett neste steg
                      </button>
                    </div>
                  </div>
                )}
                <div className="pf-ld-kontakt">
                  <a href={`mailto:${valgt.email}`}>
                    Send e-post <span>{valgt.email}</span>
                  </a>
                  {valgt.phone && (
                    <a href={`tel:${valgt.phone.replaceAll(" ", "")}`}>
                      Ring <span>{valgt.phone}</span>
                    </a>
                  )}
                </div>
              </div>

              <div className="pf-ld-seksjon">
                <h3>
                  Selskap
                  {valgt.orgNr && <span className="pf-ld-kilde">Hentet fra Enhetsregisteret</span>}
                  {valgt.orgNr && (
                    <span className="pf-ld-hoyre">
                      <button
                        className="btn btn-ghost"
                        style={{ padding: "2px 8px", fontSize: "var(--fs-label)" }}
                        disabled={jobber}
                        onClick={() => void oppdaterBrreg(valgt.id)}
                      >
                        Oppdater
                      </button>
                    </span>
                  )}
                </h3>
                <dl className="pf-ld-par">
                  <div>
                    <dt>Navn</dt>
                    <dd className={valgt.company ? "" : "tom"}>{valgt.company ?? "Ikke oppgitt"}</dd>
                  </div>
                  <div>
                    <dt>Organisasjonsnummer</dt>
                    <dd className={valgt.orgNr ? "" : "tom"}>{valgt.orgNr ?? "Ikke funnet"}</dd>
                  </div>
                  <div>
                    <dt>Selskapsform</dt>
                    <dd className={valgt.orgForm ? "" : "tom"}>{valgt.orgForm ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Kommune</dt>
                    <dd className={valgt.kommune ? "" : "tom"}>{valgt.kommune ?? "—"}</dd>
                  </div>
                  <div className="pf-ld-bred">
                    <dt>Adresse</dt>
                    <dd className={valgt.adresse ? "" : "tom"}>
                      {[valgt.adresse, [valgt.postnummer, valgt.poststed].filter(Boolean).join(" ")]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Registerets e-post</dt>
                    <dd className={valgt.brregEpost ? "" : "tom"}>{valgt.brregEpost ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Registerets telefon</dt>
                    <dd className={valgt.brregTelefon ? "" : "tom"}>{valgt.brregTelefon ?? "—"}</dd>
                  </div>
                  <div className="pf-ld-bred">
                    <dt>Nettsted</dt>
                    <dd className={valgt.nettsted ? "" : "tom"}>{valgt.nettsted ?? "—"}</dd>
                  </div>
                </dl>
                {!valgt.orgNr && (
                  <div className="pf-ld-obs">
                    <b>Fant ikke selskapet i Enhetsregisteret.</b> Navnet er skrevet inn manuelt av
                    interessenten. Slå opp org.nr før du oppretter kunde — ellers blir onboardingen tom.
                  </div>
                )}
              </div>

              <div className="pf-ld-seksjon">
                <h3>
                  Kontaktperson <span className="pf-ld-kilde">Skrevet inn av interessenten</span>
                </h3>
                <dl className="pf-ld-par">
                  <div>
                    <dt>Navn</dt>
                    <dd>{valgt.name}</dd>
                  </div>
                  <div>
                    <dt>E-post</dt>
                    <dd>
                      <a className="pf-lenke-inline" href={`mailto:${valgt.email}`}>{valgt.email}</a>
                    </dd>
                  </div>
                  <div>
                    <dt>Telefon</dt>
                    <dd className={valgt.phone ? "" : "tom"}>{valgt.phone ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Registrert</dt>
                    <dd>{datoTid(valgt.createdAt)}</dd>
                  </div>
                </dl>
                {valgt.message && (
                  <div className="pf-ld-sitat">
                    <span className="pf-under">Skrev i skjemaet</span>
                    {valgt.message}
                  </div>
                )}
              </div>

              <div className="pf-ld-seksjon">
                <h3>Aktivitet</h3>
                {!logg[valgt.id] ? (
                  <p className="pf-dempet">Henter …</p>
                ) : logg[valgt.id]!.length === 0 ? (
                  <p className="pf-dempet">Ingen aktivitet registrert.</p>
                ) : (
                  <ul className="pf-ld-logg">
                    {logg[valgt.id]!.map((a) => (
                      <li key={a.id}>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ fontWeight: 500 }}>{a.text}</span>
                          {a.note && <span className="pf-under">{a.note}</span>}
                        </span>
                        <span className="pf-ld-nar">
                          {datoTid(a.createdAt)}
                          {a.actorName && <span className="pf-under">{a.actorName}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <form
                  className="pf-ld-notat"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!notat.trim()) return;
                    void leggTilNotat(valgt.id, notat.trim()).then((ok) => ok && setNotat(""));
                  }}
                >
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    placeholder="Skriv et notat — f.eks. hva som ble sagt i telefonen"
                    aria-label="Nytt notat"
                    value={notat}
                    onChange={(e) => setNotat(e.target.value)}
                  />
                  <button className="btn btn-primary" disabled={jobber || !notat.trim()}>
                    Legg til
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {avslaaApen && valgt && (
        <Modal tittel="Avslå lead" onLukk={() => setAvslaaApen(false)} bredde={460}>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, marginTop: 0 }}>
            Skriv gjerne hvorfor — det er verdt mye den dagen {valgt.name} tar kontakt igjen.
          </p>
          <Tekstomrade
            etikett="Begrunnelse"
            verdi={avslaaGrunn}
            onEndre={setAvslaaGrunn}
            plassholder="F.eks. bundet i avtale med annen leverandør til mars 2028"
            rader={3}
          />
          <Knapperad
            onAvbryt={() => setAvslaaApen(false)}
            sendEtikett="Avslå"
            farlig
            sender={jobber}
            onSend={() =>
              void oppdater(valgt.id, {
                status: "avslatt",
                notat: avslaaGrunn.trim() || undefined,
              }).then((ok) => ok && setAvslaaApen(false))
            }
          />
        </Modal>
      )}

      {bekreftSlett && valgt && (
        <Modal tittel="Slett lead" onLukk={() => setBekreftSlett(false)} bredde={420}>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
            Slette interessenten <strong>{valgt.name}</strong> og hele aktivitetsloggen
            permanent? Dette kan ikke angres.
          </p>
          <Knapperad
            onAvbryt={() => setBekreftSlett(false)}
            sendEtikett="Slett"
            farlig
            sender={jobber}
            onSend={() => void slett(valgt.id)}
          />
        </Modal>
      )}

      {manuellApen && (
        <Modal tittel="Legg inn lead manuelt" onLukk={() => setManuellApen(false)} bredde={520}>
          <p className="pf-dempet" style={{ marginTop: 0 }}>
            For henvendelser som kom på telefon eller e-post. Oppgir du org.nr, hentes
            selskapsdata fra Enhetsregisteret med én gang.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void opprettManuell();
            }}
          >
            <Tekstfelt etikett="Navn" verdi={manuell.navn} onEndre={(v) => setManuell((m) => ({ ...m, navn: v }))} />
            <Tekstfelt
              etikett="E-post"
              type="email"
              verdi={manuell.epost}
              onEndre={(v) => setManuell((m) => ({ ...m, epost: v }))}
            />
            <Tekstfelt
              etikett="Telefon"
              verdi={manuell.telefon}
              onEndre={(v) => setManuell((m) => ({ ...m, telefon: v }))}
            />
            <Tekstfelt
              etikett="Borettslag eller sameie"
              verdi={manuell.selskap}
              onEndre={(v) => setManuell((m) => ({ ...m, selskap: v }))}
            />
            <Tekstfelt
              etikett="Org.nr"
              notat="Ni siffer — brukes til oppslaget mot Enhetsregisteret"
              verdi={manuell.orgnr}
              onEndre={(v) => setManuell((m) => ({ ...m, orgnr: v }))}
            />
            <Tekstomrade
              etikett="Hva gjelder det?"
              verdi={manuell.melding}
              onEndre={(v) => setManuell((m) => ({ ...m, melding: v }))}
              rader={3}
            />
            <Knapperad
              onAvbryt={() => setManuellApen(false)}
              sendEtikett="Registrer"
              sender={jobber}
              deaktivert={!manuell.navn.trim() || !manuell.epost.trim()}
            />
          </form>
        </Modal>
      )}
    </Ramme>
  );
}
