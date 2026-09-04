"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Download,
  Eye,
  FileText,
  Info,
  Pencil,
  RefreshCw,
  Trash2,
  TrendingUp,
  Upload,
  Users,
} from "lucide-react";
import { Feil, Rad, Tom, dato, kr } from "@/components/felles";
import {
  Avkryssing,
  Fanemodal,
  Knapperad,
  Modal,
  Nedtrekk,
  Tekstfelt,
  Tekstomrade,
  useSending,
  type Fanevalg,
} from "@/components/skjema";
import Dokumentviser from "@/components/Dokumentviser";
import KontraktModal from "@/components/KontraktModal";
import { kontrakter, leverandorer, type Kontrakt } from "@/lib/klient";
import { KONTRAKT_KATEGORIER, kontoForKategori, kontraktKategoriEtikett, kontraktStatus } from "@/lib/kontraktregler";

type Fane = "om" | "kontakter" | "priser" | "dokument";

type Detalj = Kontrakt & {
  prishistorikk: Array<{ id: string; effectiveDate: string; annualSum: number; note: string | null }>;
};

type VendorKontakt = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
};

/**
 * Kontraktdetaljen — en fanemodal over lista, ikke en egen side.
 *
 * Samme begrunnelse som «Min profil»: detaljene er noe man SLÅR OPP mens man står i lista,
 * og en sidenavigasjon river en ut av sammenhengen for så å måtte navigere tilbake. De
 * vertikale fanene deler innholdet i det man leser (Om avtalen), det man vedlikeholder
 * (Prisjusteringer) og fila (Dokument) — og tar imot nye seksjoner uten å endre resten.
 *
 * `onBytt` bytter hvilken avtale modalen viser: fornyelsen hopper til den nye avtalen, og
 * «Se avtalen den erstattet» til forgjengeren — uten å lukke og lete i lista.
 */
export default function KontraktDetaljModal({
  orgId,
  id,
  kanRedigere,
  onLukk,
  onEndret,
  onBytt,
}: {
  orgId: string;
  id: string;
  kanRedigere: boolean;
  onLukk: () => void;
  /** Lista bak modalen — kalles etter hver skriving, så radene ikke lyver når modalen lukkes. */
  onEndret: () => Promise<void>;
  onBytt: (id: string) => void;
}) {
  const [fane, setFane] = useState<Fane>("om");
  const [data, setData] = useState<Detalj | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  const [nyPris, setNyPris] = useState(false);
  const [arkiverer, setArkiverer] = useState(false);
  const [fornyer, setFornyer] = useState(false);
  const [sletter, setSletter] = useState(false);
  const [viserDokument, setViserDokument] = useState(false);

  /**
   * Redigering skjer I fanene, ikke i en modal oppå modalen: «Rediger» bytter feltene i
   * «Om avtalen» til skjemafelter og bunnraden til Avbryt/Lagre. Feltverdiene settes idet
   * redigeringen STARTER — de skal utgå fra det som vises, ikke fra en senere refetch.
   */
  const [redigerer, setRedigerer] = useState(false);
  const [lagrer, setLagrer] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [tittel, setTittel] = useState("");
  const [kategori, setKategori] = useState("");
  const [aarssum, setAarssum] = useState("");
  const [konto, setKonto] = useState("");
  const [start, setStart] = useState("");
  const [slutt, setSlutt] = useState("");
  const [notat, setNotat] = useState("");
  const [kontaktNavn, setKontaktNavn] = useState("");
  const [kontaktEpost, setKontaktEpost] = useState("");
  const [kontaktTelefon, setKontaktTelefon] = useState("");
  const [aiDeling, setAiDeling] = useState(false);
  const [firmaer, setFirmaer] = useState<Array<{ id: string; navn: string }>>([]);

  const last = useCallback(async () => {
    try {
      setData(await kontrakter.hent(orgId, id));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente avtalen");
    }
  }, [orgId, id]);

  useEffect(() => {
    setData(null);
    setFeil(null);
    void last();
  }, [last]);

  /**
   * Leverandørens kontaktpersoner — hentes først når fanen faktisk åpnes. `null` betyr
   * «ikke hentet ennå»; feiler kallet vises avtalens egen kontakt uansett.
   */
  const [vendorKontakter, setVendorKontakter] = useState<VendorKontakt[] | null>(null);
  const gjeldendeLeverandor = data?.vendorId;
  useEffect(() => {
    setVendorKontakter(null);
  }, [gjeldendeLeverandor]);
  useEffect(() => {
    if (fane !== "kontakter" || !gjeldendeLeverandor || vendorKontakter !== null) return;
    leverandorer
      .hent(orgId, gjeldendeLeverandor)
      .then((v) => setVendorKontakter(v.kontakter))
      .catch(() => setVendorKontakter([]));
  }, [fane, orgId, gjeldendeLeverandor, vendorKontakter]);

  /** Skrivinger inne i modalen skal synes BÅDE her og i lista bak. */
  async function oppdater() {
    await last();
    await onEndret();
  }

  function startRedigering() {
    if (!data) return;
    setVendorId(data.vendorId);
    setTittel(data.title);
    setKategori(data.category ?? "");
    setAarssum(data.annualSum?.toString() ?? "");
    setKonto(data.account?.toString() ?? "");
    setStart(data.startDate ?? "");
    setSlutt(data.endDate ?? "");
    setNotat(data.notes ?? "");
    setKontaktNavn(data.contactName ?? "");
    setKontaktEpost(data.contactEmail ?? "");
    setKontaktTelefon(data.contactPhone ?? "");
    setAiDeling(data.aiReadable);
    setFane("om");
    setRedigerer(true);
    if (firmaer.length === 0) {
      void leverandorer
        .liste(orgId)
        .then((v) => setFirmaer(v.map((f) => ({ id: f.id, navn: f.name }))))
        .catch(() => {});
    }
  }

  async function lagreRedigering() {
    setLagrer(true);
    setFeil(null);
    try {
      await kontrakter.endre(orgId, id, {
        vendorId,
        title: tittel.trim(),
        category: kategori || null,
        annualSum: aarssum.trim() === "" ? null : Number(aarssum),
        account: konto.trim() === "" ? null : Number(konto),
        startDate: start || null,
        endDate: slutt || null,
        notes: notat.trim() || null,
        contactName: kontaktNavn.trim() || null,
        contactEmail: kontaktEpost.trim() || null,
        contactPhone: kontaktTelefon.trim() || null,
        aiReadable: aiDeling,
      });
      await oppdater();
      setRedigerer(false);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
    } finally {
      setLagrer(false);
    }
  }

  // Kategorifeltet er fri tekst i basen. En lagret verdi utenfor standardsettet vises som
  // sitt eget valg — ellers ville redigering stille byttet kategori på avtalen.
  const kategorivalg = [
    { verdi: "", etikett: "Uten kategori" },
    ...KONTRAKT_KATEGORIER,
    ...(kategori && !KONTRAKT_KATEGORIER.some((k) => k.verdi === kategori)
      ? [{ verdi: kategori, etikett: kategori }]
      : []),
  ];

  async function lastOppFil(e: React.ChangeEvent<HTMLInputElement>) {
    const fil = e.target.files?.[0];
    if (!fil) return;
    const form = new FormData();
    form.append("file", fil);
    try {
      await kontrakter.lastOppFil(orgId, id, form);
      await oppdater();
    } catch (err) {
      // Kontrakter tillater bare PDF/PNG/JPG, men opptil 25 MB — API-et sier hvilken av
      // grensene som slo inn.
      setFeil(err instanceof Error ? err.message : "Opplasting feilet");
    } finally {
      e.target.value = "";
    }
  }

  async function fjernFil() {
    try {
      await kontrakter.slettFil(orgId, id);
      await oppdater();
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Sletting feilet");
    }
  }

  async function gjenopprett() {
    try {
      await kontrakter.gjenopprett(orgId, id);
      await oppdater();
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Gjenoppretting feilet");
    }
  }

  async function fjernPris(prisId: string) {
    try {
      await kontrakter.slettPris(orgId, id, prisId);
      await oppdater();
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Sletting feilet");
    }
  }

  const faner: ReadonlyArray<Fanevalg<Fane>> = [
    { nokkel: "om", etikett: "Om avtalen", Ikon: Info },
    { nokkel: "kontakter", etikett: "Kontaktpersoner", Ikon: Users },
    { nokkel: "priser", etikett: "Prisjusteringer", Ikon: TrendingUp },
    { nokkel: "dokument", etikett: "Dokument", Ikon: FileText },
  ];

  const status = data ? kontraktStatus(data) : null;
  const arkivert = Boolean(data?.archivedAt);
  const kontakt = data
    ? [data.contactName, data.contactEmail, data.contactPhone].filter(Boolean).join(" · ")
    : "";
  const filUrl = `/api/organizations/${orgId}/contracts/${id}/file`;

  // Escape lukker ALLE modaler som lytter — uten gaten ville et Escape i «Ny pris» også
  // revet ned fanemodalen bak den. Undermodalens eget Escape står urørt. Under redigering
  // avbryter Escape/✕ redigeringen i stedet for å kaste hele modalen med ulagrede felter.
  const undermodal = nyPris || arkiverer || fornyer || sletter || viserDokument;
  const lukkHoved = () => {
    if (undermodal) return;
    if (redigerer) setRedigerer(false);
    else onLukk();
  };

  return (
    <>
      <Fanemodal
        tittel={data?.title ?? "Avtale"}
        onLukk={lukkHoved}
        faner={faner}
        valgt={fane}
        onVelg={setFane}
        fot={
          redigerer ? (
            // Redigeringsmodus eier hele bunnraden: å la Slett/Arkiver stå ved siden av
            // Lagre er å be om feilklikk med ulagrede felter i panelet.
            <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
              <button className="btn btn-ghost" onClick={() => setRedigerer(false)}>
                Avbryt
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void lagreRedigering()}
                disabled={lagrer || !tittel.trim() || !vendorId}
              >
                {lagrer ? "Lagrer …" : "Lagre"}
              </button>
            </div>
          ) : kanRedigere ? (
            <>
              <button className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={() => setSletter(true)}>
                <Trash2 size={15} strokeWidth={1.9} aria-hidden />
                Slett
              </button>
              <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
                {arkivert ? (
                  <button className="btn btn-ghost" onClick={() => void gjenopprett()}>
                    <ArchiveRestore size={15} strokeWidth={1.9} aria-hidden />
                    Hent ut av arkiv
                  </button>
                ) : (
                  <button className="btn btn-ghost" onClick={() => setArkiverer(true)}>
                    <Archive size={15} strokeWidth={1.9} aria-hidden />
                    Arkiver
                  </button>
                )}
                <button className="btn btn-ghost" onClick={startRedigering} disabled={!data}>
                  <Pencil size={15} strokeWidth={1.9} aria-hidden />
                  Rediger
                </button>
                <button className="btn btn-ghost" onClick={onLukk}>
                  Lukk
                </button>
                {/* Fornyelsen er hovedhandlingen på en utløpt avtale — den arkiverer
                    forgjengeren selv, så ingen må huske et eget arkiveringssteg etterpå. */}
                {status?.nokkel === "utlopt" && (
                  <button className="btn btn-primary" onClick={() => setFornyer(true)}>
                    <RefreshCw size={15} strokeWidth={1.9} aria-hidden />
                    Forny avtale
                  </button>
                )}
              </div>
            </>
          ) : (
            <button className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={onLukk}>
              Lukk
            </button>
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
                <Nedtrekk
                  etikett="Leverandør *"
                  verdi={vendorId}
                  onEndre={setVendorId}
                  valg={[
                    // Gjeldende leverandør vises med en gang — lista fra API-et fyller på når
                    // den kommer, og skal ikke la feltet stå tomt i mellomtiden.
                    ...(firmaer.some((f) => f.id === vendorId) || !data.vendorName
                      ? []
                      : [{ verdi: data.vendorId, etikett: data.vendorName }]),
                    ...firmaer.map((f) => ({ verdi: f.id, etikett: f.navn })),
                  ]}
                />
                <Tekstfelt etikett="Tittel *" verdi={tittel} onEndre={setTittel} />
                <Nedtrekk
                  etikett="Kategori"
                  verdi={kategori}
                  onEndre={(v) => {
                    const forrige = kontoForKategori(kategori);
                    if (konto === "" || (forrige !== null && konto === String(forrige))) {
                      setKonto(kontoForKategori(v)?.toString() ?? "");
                    }
                    setKategori(v);
                  }}
                  valg={kategorivalg}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <Tekstfelt
                    etikett="Årssum (kr)"
                    type="number"
                    verdi={aarssum}
                    onEndre={setAarssum}
                    notat="Grunnlaget for «Innkjøp per år». Prisendringer registreres under Prisjusteringer."
                  />
                  <Tekstfelt
                    etikett="Konto (NS 4102)"
                    type="number"
                    verdi={konto}
                    onEndre={setKonto}
                    plassholder="6620"
                    notat="Foreslås fra kategorien. Brukes av budsjettforslaget i Økonomi."
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <Tekstfelt etikett="Startdato" type="date" verdi={start} onEndre={setStart} />
                  <Tekstfelt etikett="Sluttdato" type="date" verdi={slutt} onEndre={setSlutt} notat="Tom = løpende avtale." />
                </div>
                <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} />
                <Avkryssing
                  etikett="Del med AI-rådgiveren"
                  verdi={aiDeling}
                  onEndre={setAiDeling}
                  notat="Lar AI-rådgiveren lese avtalen og dokumentet. Kan skrus av når som helst."
                />
              </form>
            )}

            {fane === "om" && !redigerer && (
              <>
                {arkivert && (
                  <div className="field-note" style={{ marginBottom: "8px" }}>
                    Arkivert {dato(data.archivedAt)}
                    {data.archiveNote ? ` — ${data.archiveNote}` : ""}. Avtalen er ikke slettet:
                    utløpte avtaler har verdi som historikk ved regnskap, meglerpakke og tvist.
                  </div>
                )}
                {status && (
                  <Rad tittel="Status" hoyre={<span className={`badge ${status.merke}`}>{status.etikett}</span>} />
                )}
                <Rad tittel="Leverandør" hoyre={data.vendorName ?? "—"} />
                <Rad tittel="Kategori" hoyre={kontraktKategoriEtikett(data.category) ?? "—"} />
                <Rad tittel="Årssum" hoyre={kr(data.annualSum)} />
                <Rad tittel="Konto" hoyre={data.account ?? "—"} />
                <Rad
                  tittel="Periode"
                  hoyre={`${dato(data.startDate)} – ${data.endDate ? dato(data.endDate) : "løpende"}`}
                />
                {data.notes && <Rad tittel="Notat" meta={data.notes} />}
                {data.predecessorId && (
                  <Rad
                    tittel="Fornyelse"
                    hoyre={
                      <button className="btn btn-ghost" onClick={() => onBytt(data.predecessorId!)}>
                        Se avtalen den erstattet
                      </button>
                    }
                  />
                )}
                <Rad
                  tittel="Delt med AI-rådgiveren"
                  hoyre={
                    data.aiReadable ? <span className="badge info">Ja</span> : <span className="badge muted">Nei</span>
                  }
                />
              </>
            )}

            {fane === "kontakter" && redigerer && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void lagreRedigering();
                }}
                style={{ display: "flex", flexDirection: "column", gap: "15px" }}
              >
                <div className="field-note">
                  Avtalens kontaktperson — den man ringer om akkurat denne avtalen. Lagres
                  sammen med resten av redigeringen.
                </div>
                <Tekstfelt etikett="Kontaktperson" verdi={kontaktNavn} onEndre={setKontaktNavn} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <Tekstfelt etikett="E-post" type="email" verdi={kontaktEpost} onEndre={setKontaktEpost} />
                  <Tekstfelt etikett="Telefon" verdi={kontaktTelefon} onEndre={setKontaktTelefon} />
                </div>
              </form>
            )}

            {fane === "kontakter" && !redigerer && (
              <>
                {/* Avtalens egen kontakt først — det er den som gjelder DENNE avtalen. */}
                {kontakt ? (
                  <Rad tittel={data.contactName ?? "Kontaktperson"} meta="Avtalens kontaktperson" hoyre={
                    [data.contactEmail, data.contactPhone].filter(Boolean).join(" · ") || undefined
                  } />
                ) : (
                  <Tom tekst="Ingen kontaktperson på avtalen — trykk Rediger for å legge til." />
                )}

                <div className="field-note" style={{ marginTop: "14px" }}>
                  Hos {data.vendorName ?? "leverandøren"} — fra leverandørkortet, felles for
                  alle avtaler med dem.
                </div>
                {vendorKontakter === null ? (
                  <Tom tekst="Henter …" />
                ) : vendorKontakter.length === 0 ? (
                  <Tom tekst="Ingen kontaktpersoner registrert på leverandøren." />
                ) : (
                  vendorKontakter.map((p) => (
                    <Rad
                      key={p.id}
                      tittel={
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "7px" }}>
                          {p.name}
                          {p.isPrimary && <span className="badge info">Primær</span>}
                        </span>
                      }
                      meta={p.role ?? undefined}
                      hoyre={[p.email, p.phone].filter(Boolean).join(" · ") || undefined}
                    />
                  ))
                )}
              </>
            )}

            {fane === "priser" && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                  <span className="field-note" style={{ flex: 1 }}>
                    Nyeste pris er avtalens gjeldende årssum.
                  </span>
                  {kanRedigere && (
                    <button className="btn btn-ghost" onClick={() => setNyPris(true)}>
                      Ny pris
                    </button>
                  )}
                </div>
                {data.prishistorikk.length === 0 ? (
                  <Tom tekst="Ingen prisendringer registrert." />
                ) : (
                  data.prishistorikk.map((p) => (
                    <Rad
                      key={p.id}
                      tittel={kr(p.annualSum)}
                      meta={[dato(p.effectiveDate), p.note].filter(Boolean).join(" · ")}
                      hoyre={
                        kanRedigere && (
                          <button
                            className="btn btn-ghost"
                            style={{ color: "var(--muted)" }}
                            onClick={() => void fjernPris(p.id)}
                          >
                            Fjern
                          </button>
                        )
                      }
                    />
                  ))
                )}
              </>
            )}

            {fane === "dokument" && (
              <>
                {data.fileName ? (
                  <Rad
                    tittel={data.fileOriginalName ?? "Dokument"}
                    hoyre={
                      <>
                        {/* Kontrakter tillater bare PDF/PNG/JPG — alt som ligger her KAN vises. */}
                        <button className="btn btn-ghost" onClick={() => setViserDokument(true)}>
                          <Eye size={14} strokeWidth={2} aria-hidden />
                          Vis
                        </button>
                        <a className="btn btn-ghost" href={filUrl} download={data.fileOriginalName ?? undefined}>
                          <Download size={14} strokeWidth={2} aria-hidden />
                          Last ned
                        </a>
                        {kanRedigere && (
                          <button className="btn btn-ghost" style={{ color: "var(--muted)" }} onClick={() => void fjernFil()}>
                            Fjern
                          </button>
                        )}
                      </>
                    }
                  />
                ) : (
                  <Tom tekst="Ingen fil lastet opp." />
                )}
                {kanRedigere && (
                  <div style={{ marginTop: "10px" }}>
                    <label className="btn btn-ghost" style={{ cursor: "pointer" }}>
                      <Upload size={14} strokeWidth={2} aria-hidden />
                      {data.fileName ? "Bytt dokument" : "Last opp dokument"}
                      <input type="file" hidden onChange={(e) => void lastOppFil(e)} />
                    </label>
                    <div className="field-note" style={{ marginTop: "6px" }}>
                      PDF, PNG eller JPG, opptil 25 MB. En signert avtale er et dokument eller en
                      skann — ikke et regneark.
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Fanemodal>

      {viserDokument && data?.fileName && (
        <Dokumentviser
          filnavn={data.fileName}
          visningsnavn={data.fileOriginalName}
          url={filUrl}
          onLukk={() => setViserDokument(false)}
        />
      )}

      {nyPris && <NyPris orgId={orgId} id={id} onLukk={() => setNyPris(false)} onLagret={oppdater} />}

      {arkiverer && <Arkiver orgId={orgId} id={id} onLukk={() => setArkiverer(false)} onLagret={oppdater} />}

      {sletter && data && (
        <SlettKontrakt
          navn={data.title}
          onLukk={() => setSletter(false)}
          onSlett={async () => {
            await kontrakter.slett(orgId, id);
            await onEndret();
            onLukk();
          }}
        />
      )}

      {fornyer && data && (
        <KontraktModal
          tittel="Forny avtale"
          orgId={orgId}
          // Vilkårene arves, datoene gjør det ikke — den nye avtalen har sin egen periode.
          utgangspunkt={{ ...data, startDate: null, endDate: null }}
          sendEtikett="Opprett ny avtale"
          onLukk={() => setFornyer(false)}
          onLagre={async (felter) => {
            const ny = await kontrakter.ny(orgId, { ...felter, predecessorId: id });
            // Forgjengeren arkiveres automatisk: poenget med «Forny» er nettopp at den gamle
            // er ferdigbehandlet, og et manuelt steg ville etterlatt den i «Utløpte» til noen
            // husket på det.
            await kontrakter.arkiver(orgId, id, { archiveNote: "Fornyet — erstattet av ny avtale" });
            await onEndret();
            onBytt(ny.id);
            return ny;
          }}
        />
      )}
    </>
  );
}

function NyPris({
  orgId,
  id,
  onLukk,
  onLagret,
}: {
  orgId: string;
  id: string;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [sum, setSum] = useState("");
  const [fra, setFra] = useState(new Date().toISOString().slice(0, 10));
  const [notat, setNotat] = useState("");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Ny pris" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            kontrakter.nyPris(orgId, id, { annualSum: Number(sum), effectiveDate: fra, note: notat || null }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Årssum (kr)" type="number" verdi={sum} onEndre={setSum} />
        <Tekstfelt etikett="Gjelder fra" type="date" verdi={fra} onEndre={setFra} />
        <Tekstomrade
          etikett="Notat"
          verdi={notat}
          onEndre={setNotat}
          notat="Nyeste pris blir avtalens gjeldende årssum."
        />
        <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={!sum} />
      </form>
    </Modal>
  );
}

function Arkiver({
  orgId,
  id,
  onLukk,
  onLagret,
}: {
  orgId: string;
  id: string;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [notat, setNotat] = useState("");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Arkiver avtale" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => kontrakter.arkiver(orgId, id, { archiveNote: notat || null }));
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstomrade
          etikett="Hvorfor arkiveres den?"
          verdi={notat}
          onEndre={setNotat}
          notat="Avtalen fjernes fra oversikten og KPI-ene, men slettes aldri."
        />
        <Knapperad onAvbryt={onLukk} sendEtikett="Arkiver" sender={sender} />
      </form>
    </Modal>
  );
}

function SlettKontrakt({
  navn,
  onLukk,
  onSlett,
}: {
  navn: string;
  onLukk: () => void;
  onSlett: () => Promise<void>;
}) {
  const { sender, feil, send } = useSending(onLukk);

  return (
    <Modal tittel="Slett kontrakt" onLukk={onLukk} bredde={420}>
      <Feil melding={feil} />
      <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, margin: 0 }}>
        Slett <strong>{navn}</strong>? Prishistorikken og et eventuelt avtaledokument slettes
        også. En avsluttet avtale bør heller arkiveres — sletting er for feilregistreringer.
      </p>
      <Knapperad onAvbryt={onLukk} sendEtikett="Slett" farlig sender={sender} onSend={() => void send(onSlett)} />
    </Modal>
  );
}
