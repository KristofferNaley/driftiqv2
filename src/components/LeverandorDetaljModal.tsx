"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, FileText, KeyRound, NotebookPen, Pencil, Receipt, UserPlus, Users } from "lucide-react";
import { useOkt } from "@/components/OktProvider";
import { Feil, Rad, Tom, dato, kr } from "@/components/felles";
import { Avkryssing, Fanemodal, Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending, type Fanevalg } from "@/components/skjema";
import KontraktDetaljModal from "@/components/KontraktDetaljModal";
import { kontrakter, leverandorer, okonomi, type Kontrakt, type Leverandor } from "@/lib/klient";
import { modulErAktivert } from "@/lib/moduler";
import { kroner } from "@/lib/okonomiregler";
import { kontraktKategoriEtikett, kontraktStatus } from "@/lib/kontraktregler";

type Fane = "om" | "avtaler" | "kontakter" | "adgang" | "notater" | "kjop";

type Kontaktperson = { id: string; name: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean };
type Adgangsobjekt = { id: string; title: string; status: string; issuedTo: string | null; areas: string | null; issuedAt: string | null };

type Detalj = Leverandor & {
  kontakter: Kontaktperson[];
  adgang: Adgangsobjekt[];
  notater: Array<{ id: string; text: string; authorName: string | null; createdAt: string }>;
};

// Visningsnavn — samme sett som leverandørlista; databaseverdiene ligger fast.
const RELASJON: Record<string, string> = {
  avtale: "Faste leverandører",
  handelskonto: "Innkjøpssteder",
  adhoc: "Ved behov",
};

const ADGANGSSTATUS: Record<string, { etikett: string; merke: string }> = {
  utlevert: { etikett: "Utlevert", merke: "warn" },
  "bør_sjekkes": { etikett: "Bør sjekkes", merke: "danger" },
  innlevert: { etikett: "Innlevert", merke: "ok" },
};

/**
 * Leverandørdetaljen — fanemodal over lista, samme grep som kontraktdetaljen: en leverandør
 * er noe man slår opp mens man står i lista, ikke et sted man drar til. Fanene speiler de
 * fire kortene den gamle siden stablet under hverandre — nå med full forvaltning i hver:
 * feltene redigeres i «Om leverandøren» (samme inline-mønster som kontraktene), kontakter
 * og adgangsobjekter kan endres og fjernes, notater kan fjernes.
 */
export default function LeverandorDetaljModal({
  orgId,
  id,
  onLukk,
  onEndret,
}: {
  orgId: string;
  id: string;
  onLukk: () => void;
  /** Lista bak modalen — kalles etter skrivinger, så radene stemmer når modalen lukkes. */
  onEndret: () => Promise<void>;
}) {
  const { aktivOrg } = useOkt();
  const kanRedigere = aktivOrg?.nivaa === "orgadmin" || aktivOrg?.nivaa === "redigering";

  const [fane, setFane] = useState<Fane>("om");
  const [data, setData] = useState<Detalj | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  /**
   * Leverandørens avtaler — hentes først når fanen åpnes, og `null` betyr «ikke hentet».
   * Filtreringen skjer her: kontrakt-API-et har ingen leverandørparameter, og lista er
   * uansett liten nok til at hele hentes.
   */
  const [avtaler, setAvtaler] = useState<Kontrakt[] | null>(null);
  const [apenKontrakt, setApenKontrakt] = useState<string | null>(null);

  /**
   * Kjøpene fra Fiken — bare når økonomimodulen er på, og hentet først når fanen åpnes.
   * Matching på orgnr/navn skjer på serveren (`kjopForLeverandor`); ingenting lagres.
   */
  const harOkonomi = modulErAktivert(aktivOrg?.enabledModules, "okonomi");
  type Kjop = Awaited<ReturnType<typeof okonomi.fiken.kjopForLeverandor>>;
  const [kjop, setKjop] = useState<Kjop | null>(null);
  useEffect(() => {
    if (fane !== "kjop" || kjop !== null) return;
    okonomi.fiken
      .kjopForLeverandor(orgId, id)
      .then(setKjop)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente kjøpene"));
  }, [fane, kjop, orgId, id]);
  useEffect(() => {
    if (fane !== "avtaler" || avtaler !== null) return;
    kontrakter
      .liste(orgId)
      .then((alle) => setAvtaler(alle.filter((k) => k.vendorId === id)))
      .catch(() => setAvtaler([]));
  }, [fane, orgId, id, avtaler]);

  /** `"ny"` åpner tomt skjema, et objekt åpner det forhåndsutfylt for endring. */
  const [kontaktSkjema, setKontaktSkjema] = useState<"ny" | Kontaktperson | null>(null);
  const [adgangSkjema, setAdgangSkjema] = useState<"ny" | Adgangsobjekt | null>(null);
  const [nyttNotat, setNyttNotat] = useState(false);

  // Inline-redigering av feltene — samme mønster og begrunnelse som i kontraktmodalen.
  const [redigerer, setRedigerer] = useState(false);
  const [lagrer, setLagrer] = useState(false);
  const [navn, setNavn] = useState("");
  const [relasjon, setRelasjon] = useState("avtale");
  const [fagfelt, setFagfelt] = useState("");
  const [orgNr, setOrgNr] = useState("");
  const [kundenr, setKundenr] = useState("");
  const [ehf, setEhf] = useState(false);
  const [aktiv, setAktiv] = useState(true);
  const [notat, setNotat] = useState("");

  const last = useCallback(async () => {
    try {
      setData(await leverandorer.hent(orgId, id));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente leverandøren");
    }
  }, [orgId, id]);

  useEffect(() => {
    setData(null);
    setFeil(null);
    setAvtaler(null);
    void last();
  }, [last]);

  async function oppdater() {
    await last();
    await onEndret();
  }

  function startRedigering() {
    if (!data) return;
    setNavn(data.name);
    setRelasjon(data.relationshipType);
    setFagfelt(data.category ?? "");
    setOrgNr(data.orgNumber ?? "");
    setKundenr(data.customerNumber ?? "");
    setEhf(data.ehf);
    setAktiv(data.active);
    setNotat(data.notes ?? "");
    setFane("om");
    setRedigerer(true);
  }

  async function lagreRedigering() {
    setLagrer(true);
    setFeil(null);
    try {
      await leverandorer.endre(orgId, id, {
        name: navn.trim(),
        relationshipType: relasjon,
        category: fagfelt.trim() || null,
        orgNumber: orgNr.replace(/\s/g, "") || null,
        customerNumber: kundenr.trim() || null,
        ehf,
        active: aktiv,
        notes: notat.trim() || null,
      });
      await oppdater();
      setRedigerer(false);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
    } finally {
      setLagrer(false);
    }
  }

  async function fjernKontakt(kontaktId: string) {
    try {
      await leverandorer.slettKontakt(orgId, id, kontaktId);
      await oppdater();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke fjerne kontakten");
    }
  }

  async function fjernAdgang(itemId: string) {
    try {
      await leverandorer.slettAdgang(orgId, id, itemId);
      await oppdater();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke fjerne adgangsobjektet");
    }
  }

  async function fjernNotat(notatId: string) {
    try {
      await leverandorer.slettNotat(orgId, id, notatId);
      await oppdater();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke fjerne notatet");
    }
  }

  const faner: ReadonlyArray<Fanevalg<Fane>> = [
    { nokkel: "om", etikett: "Om leverandøren", Ikon: Building2 },
    { nokkel: "avtaler", etikett: "Avtaler", Ikon: FileText },
    { nokkel: "kontakter", etikett: "Kontaktpersoner", Ikon: Users },
    { nokkel: "adgang", etikett: "Adgangskontroll", Ikon: KeyRound },
    { nokkel: "notater", etikett: "Notater", Ikon: NotebookPen },
    ...(harOkonomi ? [{ nokkel: "kjop" as const, etikett: "Kjøp fra regnskapet", Ikon: Receipt }] : []),
  ];

  // Samme Escape-gate som kontraktmodalen: undermodalens Escape skal ikke rive hovedmodalen,
  // og under redigering avbryter Escape/✕ redigeringen i stedet for å kaste feltene.
  const undermodal = kontaktSkjema !== null || adgangSkjema !== null || nyttNotat || apenKontrakt !== null;
  const lukkHoved = () => {
    if (undermodal) return;
    if (redigerer) setRedigerer(false);
    else onLukk();
  };

  return (
    <>
      <Fanemodal
        tittel={data?.name ?? "Leverandør"}
        onLukk={lukkHoved}
        faner={faner}
        valgt={fane}
        onVelg={setFane}
        fot={
          redigerer ? (
            <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
              <button className="btn btn-ghost" onClick={() => setRedigerer(false)}>
                Avbryt
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void lagreRedigering()}
                disabled={lagrer || !navn.trim()}
              >
                {lagrer ? "Lagrer …" : "Lagre"}
              </button>
            </div>
          ) : (
            <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
              <button className="btn btn-ghost" onClick={startRedigering} disabled={!data}>
                <Pencil size={15} strokeWidth={1.9} aria-hidden />
                Rediger
              </button>
              <button className="btn btn-ghost" onClick={onLukk}>
                Lukk
              </button>
            </div>
          )
        }
      >
        <Feil melding={feil} />

        {!data ? (
          !feil && <Tom tekst="Henter …" />
        ) : (
          <>
            {fane === "om" && redigerer && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void lagreRedigering();
                }}
                style={{ display: "flex", flexDirection: "column", gap: "15px" }}
              >
                <Tekstfelt etikett="Navn *" verdi={navn} onEndre={setNavn} />
                <Nedtrekk
                  etikett="Relasjon"
                  verdi={relasjon}
                  onEndre={setRelasjon}
                  valg={Object.entries(RELASJON).map(([verdi, etikett]) => ({ verdi, etikett }))}
                  notat="Faste leverandører har et løpende forhold, innkjøpssteder er butikker med kundenummer, «ved behov» er enkeltoppdrag."
                />
                <Tekstfelt etikett="Kategori" verdi={fagfelt} onEndre={setFagfelt} plassholder="Rørlegger, elektriker, renhold …" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <Tekstfelt etikett="Organisasjonsnummer" verdi={orgNr} onEndre={setOrgNr} />
                  <Tekstfelt etikett="Kundenummer" verdi={kundenr} onEndre={setKundenr} />
                </div>
                <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} />
                <Avkryssing
                  etikett="Aktiv"
                  verdi={aktiv}
                  onEndre={setAktiv}
                  notat="Inaktive leverandører beholder historikken, men foreslås ikke i nye avtaler."
                />
              </form>
            )}

            {fane === "om" && !redigerer && (
              <>
                <Rad tittel="Relasjon" hoyre={RELASJON[data.relationshipType] ?? data.relationshipType} />
                <Rad tittel="Kategori" hoyre={data.category ?? "—"} />
                <Rad tittel="Organisasjonsnummer" hoyre={data.orgNumber ?? "—"} />
                <Rad tittel="Kundenummer" hoyre={data.customerNumber ?? "—"} />
                {!data.active && (
                  <Rad tittel="Status" hoyre={<span className="badge muted">Inaktiv</span>} />
                )}
                {data.notes && <Rad tittel="Notat" meta={data.notes} />}
              </>
            )}

            {fane === "kjop" && (
              <>
                {kjop === null ? (
                  <Tom tekst="Henter …" />
                ) : !kjop.koblet ? (
                  <Tom tekst="Regnskapet er ikke koblet til Fiken. Koble til under Økonomi → Integrasjon, så vises bokførte kjøp her." />
                ) : kjop.kjop.length === 0 ? (
                  <Tom
                    tekst={
                      data?.orgNumber
                        ? "Ingen bokførte kjøp fra denne leverandøren i Fiken."
                        : "Ingen treff. Legg inn organisasjonsnummer på leverandøren, så matches kjøpene på det i stedet for på navn."
                    }
                  />
                ) : (
                  <>
                    <div className="field-note" style={{ marginBottom: "10px" }}>
                      Bokførte kjøp fra Fiken, matchet på {kjop.treffPaa === "orgnr" ? "organisasjonsnummer" : "navn"}. Siste kjøp{" "}
                      {dato(kjop.sisteKjop)}.
                    </div>
                    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "10px" }}>
                      {kjop.perAar.map((a) => (
                        <div key={a.aar}>
                          <div className="card-title">{a.aar}</div>
                          <div style={{ fontSize: "var(--fs-md)", fontWeight: 600 }}>{kroner(a.sum)}</div>
                          <div className="list-meta">{a.antall} kjøp</div>
                        </div>
                      ))}
                    </div>
                    {kjop.kjop.slice(0, 60).map((k) => (
                      <Rad
                        key={k.id}
                        tittel={k.linjer[0]?.description ?? k.identifier ?? "Kjøp"}
                        meta={[dato(k.date), k.identifier && `nr. ${k.identifier}`, [...new Set(k.linjer.map((l) => l.account).filter(Boolean))].join(", ")]
                          .filter(Boolean)
                          .join(" · ")}
                        hoyre={
                          <>
                            <span style={{ fontWeight: 600, fontSize: "var(--fs-sm)" }}>{kroner(k.gross)}</span>
                            {!k.settled && !k.paid && <span className="badge warn">Ubetalt</span>}
                          </>
                        }
                      />
                    ))}
                  </>
                )}
              </>
            )}

            {fane === "avtaler" && (
              <>
                {avtaler === null ? (
                  <Tom tekst="Henter …" />
                ) : avtaler.length === 0 ? (
                  <Tom tekst="Ingen avtaler med denne leverandøren. Nye avtaler opprettes under Kontrakter." />
                ) : (
                  // Arkiverte er med — fanen er leverandørens avtalehistorikk, og merket
                  // sier tydelig hva som er levende og hva som er ferdig.
                  avtaler.map((k) => {
                    const status = kontraktStatus(k);
                    return (
                      <Rad
                        key={k.id}
                        onClick={() => setApenKontrakt(k.id)}
                        tittel={k.title}
                        meta={[
                          kontraktKategoriEtikett(k.category),
                          !k.startDate && !k.endDate
                            ? null
                            : `${dato(k.startDate)} → ${k.endDate ? dato(k.endDate) : "løpende"}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        hoyre={
                          <>
                            <span style={{ fontWeight: 600, fontSize: "var(--fs-sm)" }}>
                              {k.annualSum ? kr(k.annualSum) : "—"}
                            </span>
                            <span className={`badge ${status.merke}`}>{status.etikett}</span>
                          </>
                        }
                      />
                    );
                  })
                )}
              </>
            )}

            {fane === "kontakter" && (
              <>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "4px" }}>
                  <button className="btn btn-ghost" onClick={() => setKontaktSkjema("ny")}>
                    <UserPlus size={14} strokeWidth={2} aria-hidden />
                    Ny kontakt
                  </button>
                </div>
                {data.kontakter.length === 0 ? (
                  <Tom tekst="Ingen kontaktpersoner registrert." />
                ) : (
                  // Primærkontakten sorteres først av API-et, og det finnes bare én.
                  data.kontakter.map((k) => (
                    <Rad
                      key={k.id}
                      tittel={k.name}
                      meta={[k.role, k.phone, k.email].filter(Boolean).join(" · ")}
                      hoyre={
                        <>
                          {k.isPrimary && <span className="badge info">Primær</span>}
                          <button className="btn btn-ghost" onClick={() => setKontaktSkjema(k)}>
                            Endre
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{ color: "var(--muted)" }}
                            onClick={() => void fjernKontakt(k.id)}
                          >
                            Fjern
                          </button>
                        </>
                      }
                    />
                  ))
                )}
              </>
            )}

            {fane === "adgang" && (
              <>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "4px" }}>
                  <button className="btn btn-ghost" onClick={() => setAdgangSkjema("ny")}>
                    <KeyRound size={14} strokeWidth={2} aria-hidden />
                    Ny nøkkel / kort
                  </button>
                </div>
                {data.adgang.length === 0 ? (
                  <Tom tekst="Ingen nøkler eller adgangskort utlevert." />
                ) : (
                  data.adgang.map((a) => {
                    const st = ADGANGSSTATUS[a.status] ?? { etikett: a.status, merke: "muted" };
                    return (
                      <Rad
                        key={a.id}
                        tittel={
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            <KeyRound size={14} strokeWidth={2} aria-hidden />
                            {a.title}
                          </span>
                        }
                        meta={[
                          a.issuedTo ? `utlevert til ${a.issuedTo}` : null,
                          a.issuedAt ? dato(a.issuedAt) : null,
                          a.areas,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        hoyre={
                          <>
                            <span className={`badge ${st.merke}`}>{st.etikett}</span>
                            <button className="btn btn-ghost" onClick={() => setAdgangSkjema(a)}>
                              Endre
                            </button>
                            <button
                              className="btn btn-ghost"
                              style={{ color: "var(--muted)" }}
                              onClick={() => void fjernAdgang(a.id)}
                            >
                              Fjern
                            </button>
                          </>
                        }
                      />
                    );
                  })
                )}
              </>
            )}

            {fane === "notater" && (
              <>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "4px" }}>
                  <button className="btn btn-ghost" onClick={() => setNyttNotat(true)}>
                    Nytt notat
                  </button>
                </div>
                {data.notater.length === 0 ? (
                  <Tom tekst="Ingen notater." />
                ) : (
                  data.notater.map((n) => (
                    <div key={n.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{n.text}</div>
                      <div
                        className="list-meta"
                        style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "10px" }}
                      >
                        <span style={{ flex: 1 }}>
                          {n.authorName} · {dato(n.createdAt)}
                        </span>
                        <button
                          className="btn btn-ghost"
                          style={{ color: "var(--muted)" }}
                          onClick={() => void fjernNotat(n.id)}
                        >
                          Fjern
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </>
            )}
          </>
        )}
      </Fanemodal>

      {kontaktSkjema !== null && (
        <KontaktSkjema
          orgId={orgId}
          id={id}
          utgangspunkt={kontaktSkjema === "ny" ? null : kontaktSkjema}
          onLukk={() => setKontaktSkjema(null)}
          onLagret={oppdater}
        />
      )}
      {adgangSkjema !== null && (
        <AdgangSkjema
          orgId={orgId}
          id={id}
          utgangspunkt={adgangSkjema === "ny" ? null : adgangSkjema}
          onLukk={() => setAdgangSkjema(null)}
          onLagret={oppdater}
        />
      )}
      {nyttNotat && <NyttNotat orgId={orgId} id={id} onLukk={() => setNyttNotat(false)} onLagret={oppdater} />}

      {/* Kontraktdetaljen STABLES over leverandørmodalen — man står fortsatt hos
          leverandøren når den lukkes. `onBytt` følger fornyelser og forgjengere. */}
      {apenKontrakt && (
        <KontraktDetaljModal
          orgId={orgId}
          id={apenKontrakt}
          kanRedigere={kanRedigere}
          onLukk={() => setApenKontrakt(null)}
          onEndret={async () => {
            setAvtaler(null);
            await oppdater();
          }}
          onBytt={setApenKontrakt}
        />
      )}
    </>
  );
}

/** Ett skjema for ny og endre — utgangspunktet avgjør hvilket API-kall som gjøres. */
function KontaktSkjema({
  orgId,
  id,
  utgangspunkt,
  onLukk,
  onLagret,
}: {
  orgId: string;
  id: string;
  utgangspunkt: Kontaktperson | null;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [navn, setNavn] = useState(utgangspunkt?.name ?? "");
  const [rolle, setRolle] = useState(utgangspunkt?.role ?? "");
  const [epost, setEpost] = useState(utgangspunkt?.email ?? "");
  const [telefon, setTelefon] = useState(utgangspunkt?.phone ?? "");
  const [primar, setPrimar] = useState(utgangspunkt?.isPrimary ?? false);
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel={utgangspunkt ? "Endre kontaktperson" : "Ny kontaktperson"} onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const felter = {
            name: navn,
            role: rolle || null,
            email: epost || null,
            phone: telefon || null,
            isPrimary: primar,
          };
          void send(() =>
            utgangspunkt
              ? leverandorer.endreKontakt(orgId, id, utgangspunkt.id, felter)
              : leverandorer.nyKontakt(orgId, id, felter),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} />
        <Tekstfelt etikett="Rolle" verdi={rolle} onEndre={setRolle} plassholder="Vaktmester, daglig leder …" />
        <div className="field-row">
          <Tekstfelt etikett="E-post" type="email" verdi={epost} onEndre={setEpost} />
          <Tekstfelt etikett="Telefon" verdi={telefon} onEndre={setTelefon} />
        </div>
        <Avkryssing
          etikett="Primærkontakt"
          verdi={primar}
          onEndre={setPrimar}
          notat="Bare én om gangen. Settes denne, mister den forrige merket — og rutiner med «ring leverandøren» viser denne."
        />
        <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={!navn.trim()} />
      </form>
    </Modal>
  );
}

/** Nøkkel eller adgangskort — ny og endre i samme skjema, som kontaktene. */
function AdgangSkjema({
  orgId,
  id,
  utgangspunkt,
  onLukk,
  onLagret,
}: {
  orgId: string;
  id: string;
  utgangspunkt: Adgangsobjekt | null;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [tittel, setTittel] = useState(utgangspunkt?.title ?? "");
  const [omrader, setOmrader] = useState(utgangspunkt?.areas ?? "");
  const [utlevertTil, setUtlevertTil] = useState(utgangspunkt?.issuedTo ?? "");
  const [utlevertDato, setUtlevertDato] = useState(utgangspunkt?.issuedAt ?? "");
  const [status, setStatus] = useState(utgangspunkt?.status ?? "utlevert");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel={utgangspunkt ? "Endre nøkkel / kort" : "Ny nøkkel / kort"} onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const felter = {
            title: tittel.trim(),
            areas: omrader.trim() || null,
            issuedTo: utlevertTil.trim() || null,
            issuedAt: utlevertDato || null,
            status,
          };
          void send(() =>
            utgangspunkt
              ? leverandorer.endreAdgang(orgId, id, utgangspunkt.id, felter)
              : leverandorer.nyAdgang(orgId, id, felter),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Tittel *" verdi={tittel} onEndre={setTittel} plassholder="F.eks. «Hovednøkkel kjeller»" />
        <Tekstfelt etikett="Områder" verdi={omrader} onEndre={setOmrader} plassholder="Kjeller, tekniske rom …" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Tekstfelt etikett="Utlevert til" verdi={utlevertTil} onEndre={setUtlevertTil} />
          <Tekstfelt etikett="Utlevert dato" type="date" verdi={utlevertDato} onEndre={setUtlevertDato} />
        </div>
        <Nedtrekk
          etikett="Status"
          verdi={status}
          onEndre={setStatus}
          valg={[
            { verdi: "utlevert", etikett: "Utlevert" },
            { verdi: "bør_sjekkes", etikett: "Bør sjekkes" },
            { verdi: "innlevert", etikett: "Innlevert" },
          ]}
          notat="«Bør sjekkes» er påminnelsen om å få bekreftet at nøkkelen fortsatt er der den skal."
        />
        <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={!tittel.trim()} />
      </form>
    </Modal>
  );
}

function NyttNotat({ orgId, id, onLukk, onLagret }: { orgId: string; id: string; onLukk: () => void; onLagret: () => Promise<void> }) {
  const [tekst, setTekst] = useState("");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Nytt notat" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => leverandorer.nyttNotat(orgId, id, { text: tekst }));
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstomrade
          etikett="Notat"
          verdi={tekst}
          onEndre={setTekst}
          notat="Navnet ditt lagres med notatet og endres ikke senere, selv om du bytter navn."
        />
        <Knapperad onAvbryt={onLukk} sendEtikett="Lagre notat" sender={sender} deaktivert={!tekst.trim()} />
      </form>
    </Modal>
  );
}
