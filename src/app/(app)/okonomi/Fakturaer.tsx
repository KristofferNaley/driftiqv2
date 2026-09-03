"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Paperclip } from "lucide-react";
import { Feil, Kort, Tom, dato, datoTid, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import Dokumentviser from "@/components/Dokumentviser";
import { kontrakter, leverandorer, okonomi, type Budsjett, type Budsjettlinje, type Faktura } from "@/lib/klient";
import {
  FAKTURA_STATUSER,
  FAKTURA_STATUS_ETIKETT,
  isoDato,
  kroner,
  tilKronerTekst,
  tilOre,
  type FakturaStatus,
} from "@/lib/okonomiregler";
import Belopfelt, { belopFeil } from "./Belopfelt";

type Filter = "alle" | FakturaStatus;

/**
 * Fakturagodkjenning. Den som mottar fakturaen registrerer den (`redigering`); styret
 * (kontoadmin) godkjenner eller avviser; den som betaler merker betalt. Godkjente og
 * betalte fakturaer knyttet til en budsjettlinje er «faktisk» i budsjettet.
 */
export default function Fakturaer({
  erAdmin,
  kanRedigere,
  apenStart,
  onApnet,
}: {
  erAdmin: boolean;
  kanRedigere: boolean;
  apenStart: string | null;
  onApnet: () => void;
}) {
  const [aar, setAar] = useState<number | undefined>(undefined);
  const { data, feil, laster, last, orgId } = useOrgData((o) => okonomi.fakturaer(o, { aar }), [aar]);
  const [filter, setFilter] = useState<Filter>("alle");
  const [sok, setSok] = useState("");
  const [ny, setNy] = useState(false);
  const [apen, setApen] = useState<string | null>(apenStart);
  const [rediger, setRediger] = useState<Faktura | null>(null);

  useEffect(() => {
    if (apenStart) {
      setApen(apenStart);
      onApnet();
    }
  }, [apenStart, onApnet]);

  const liste = useMemo(() => data ?? [], [data]);
  const tell = (s: Filter) => (s === "alle" ? liste.length : liste.filter((f) => f.status === s).length);

  const vist = useMemo(() => {
    const q = sok.trim().toLowerCase();
    return liste.filter((f) => {
      if (filter !== "alle" && f.status !== filter) return false;
      if (!q) return true;
      return [f.leverandorNavn, f.invoiceNumber, f.description, f.budsjettlinjeNavn, f.kid]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [liste, filter, sok]);

  const aarValg = useMemo(() => {
    const s = new Set<number>([new Date().getFullYear()]);
    for (const f of liste) s.add(Number(f.invoiceDate.slice(0, 4)));
    return [...s].sort((a, b) => b - a);
  }, [liste]);

  const filtre: Array<{ nokkel: Filter; etikett: string }> = [
    { nokkel: "alle", etikett: "Alle" },
    ...FAKTURA_STATUSER.map((s) => ({ nokkel: s, etikett: FAKTURA_STATUS_ETIKETT[s].etikett })),
  ];

  return (
    <>
      <Feil melding={feil} />

      <div className="avvik-filter">
        <div className="pille-gruppe" style={{ marginLeft: 0 }}>
          {filtre.map((f) => (
            <button key={f.nokkel} className={`pille${filter === f.nokkel ? " valgt" : ""}`} onClick={() => setFilter(f.nokkel)}>
              {f.etikett} ({tell(f.nokkel)})
            </button>
          ))}
        </div>
        <select className="input" aria-label="År" value={aar ?? ""} onChange={(e) => setAar(e.target.value ? Number(e.target.value) : undefined)}>
          <option value="">Alle år</option>
          {aarValg.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input className="input sok-hoyre" placeholder="Søk faktura …" aria-label="Søk faktura" value={sok} onChange={(e) => setSok(e.target.value)} />
        {kanRedigere && (
          <button className="btn btn-primary" onClick={() => setNy(true)}>
            ＋ Registrer faktura
          </button>
        )}
      </div>

      <Kort tittel="Leverandørfakturaer">
        {laster ? (
          <Tom tekst="Henter …" />
        ) : vist.length === 0 ? (
          <Tom tekst={liste.length === 0 ? "Ingen fakturaer registrert. Registrer en når den kommer inn, så kan styret godkjenne den her." : "Ingen fakturaer matcher filteret."} />
        ) : (
          <>
            <div className="ok-fakt-hode" aria-hidden>
              <span>Leverandør</span>
              <span className="ok-fakt-dato">Dato</span>
              <span className="ok-fakt-forfall">Forfall</span>
              <span className="ok-belop-celle">Beløp</span>
              <span className="ok-fakt-linje">Budsjettlinje</span>
              <span>Status</span>
            </div>
            {vist.map((f) => {
              const st = FAKTURA_STATUS_ETIKETT[f.status as FakturaStatus] ?? { etikett: f.status, merke: "muted" };
              return (
                <div key={f.id} className="ok-fakt-rad" onClick={() => setApen(f.id)}>
                  <div style={{ minWidth: 0 }}>
                    <div className="list-tittel ok-fakt-tittel">
                      {f.leverandorNavn}
                      {f.fileName && <Paperclip size={13} strokeWidth={2} aria-label="Har vedlegg" />}
                    </div>
                    <div className="list-meta">{[f.invoiceNumber && `nr. ${f.invoiceNumber}`, f.description].filter(Boolean).join(" · ") || "—"}</div>
                  </div>
                  <span className="ok-fakt-dato list-meta">{dato(f.invoiceDate)}</span>
                  <span className={`ok-fakt-forfall list-meta${f.forfalt ? " ok-mangler" : ""}`}>{f.dueDate ? dato(f.dueDate) : "—"}</span>
                  <span className="ok-belop-celle">{kroner(f.amount)}</span>
                  <span className="ok-fakt-linje list-meta">{f.budsjettlinjeNavn ? `${f.budsjettlinjeNavn}${f.budsjettAar ? ` (${f.budsjettAar})` : ""}` : "—"}</span>
                  <span>
                    <span className={`badge ${f.forfalt ? "danger" : st.merke}`}>{f.forfalt ? "Forfalt" : st.etikett}</span>
                  </span>
                </div>
              );
            })}
          </>
        )}
      </Kort>

      {ny && orgId && (
        <FakturaSkjema
          orgId={orgId}
          faktura={null}
          onLukk={() => setNy(false)}
          onLagre={async (d) => {
            const f = await okonomi.nyFaktura(orgId, d);
            await last();
            setApen(f.id);
          }}
        />
      )}

      {rediger && orgId && (
        <FakturaSkjema
          orgId={orgId}
          faktura={rediger}
          onLukk={() => setRediger(null)}
          onLagre={async (d) => {
            await okonomi.endreFaktura(orgId, rediger.id, d);
            await last();
          }}
        />
      )}

      {apen && orgId && (
        <FakturaDetalj
          orgId={orgId}
          id={apen}
          erAdmin={erAdmin}
          kanRedigere={kanRedigere}
          onLukk={() => setApen(null)}
          onRediger={(f) => {
            setApen(null);
            setRediger(f);
          }}
          onEndret={last}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------
// Skjema — registrering og retting
// ---------------------------------------------------------------------------------------

type SkjemaData = {
  vendorId: string | null; supplierName: string | null; contractId: string | null; budgetLineId: string | null;
  invoiceNumber: string | null; invoiceDate: string; dueDate: string | null; amount: number;
  kid: string | null; description: string | null; note: string | null;
};

function FakturaSkjema({
  orgId,
  faktura,
  onLukk,
  onLagre,
}: {
  orgId: string;
  faktura: Faktura | null;
  onLukk: () => void;
  onLagre: (d: SkjemaData) => Promise<void>;
}) {
  const [vendorId, setVendorId] = useState(faktura?.vendorId ?? "");
  const [supplierName, setSupplierName] = useState(faktura?.supplierName ?? "");
  const [contractId, setContractId] = useState(faktura?.contractId ?? "");
  const [budgetLineId, setBudgetLineId] = useState(faktura?.budgetLineId ?? "");
  const [nr, setNr] = useState(faktura?.invoiceNumber ?? "");
  const [datoVerdi, setDatoVerdi] = useState(faktura?.invoiceDate ?? isoDato(new Date()));
  const [forfall, setForfall] = useState(faktura?.dueDate ?? "");
  const [belop, setBelop] = useState(faktura ? tilKronerTekst(faktura.amount) : "");
  const [kid, setKid] = useState(faktura?.kid ?? "");
  const [beskrivelse, setBeskrivelse] = useState(faktura?.description ?? "");
  const [notat, setNotat] = useState(faktura?.note ?? "");
  const { sender, feil, send } = useSending(onLukk);

  const [levValg, setLevValg] = useState<Array<{ verdi: string; etikett: string }>>([]);
  const [kontraktValg, setKontraktValg] = useState<Array<{ verdi: string; etikett: string; vendorId: string }>>([]);
  const [budsjetter, setBudsjetter] = useState<Budsjett[]>([]);
  const [linjer, setLinjer] = useState<Budsjettlinje[]>([]);

  useEffect(() => {
    leverandorer.liste(orgId).then((l) => setLevValg(l.filter((v) => v.active || v.id === faktura?.vendorId).map((v) => ({ verdi: v.id, etikett: v.name })))).catch(() => {});
    kontrakter.liste(orgId, false).then((k) => setKontraktValg(k.map((c) => ({ verdi: c.id, etikett: c.title, vendorId: c.vendorId })))).catch(() => {});
    okonomi.budsjetter(orgId).then(setBudsjetter).catch(() => {});
  }, [orgId, faktura?.vendorId]);

  // Budsjettlinjene følger fakturadatoens år — det er det budsjettet fakturaen belaster.
  const aar = Number(datoVerdi.slice(0, 4));
  const budsjettForAar = budsjetter.find((b) => b.year === aar) ?? null;
  useEffect(() => {
    if (!budsjettForAar) {
      setLinjer([]);
      return;
    }
    okonomi.budsjett(orgId, budsjettForAar.id).then((b) => setLinjer(b.linjer.filter((l) => l.kind === "kostnad"))).catch(() => setLinjer([]));
  }, [orgId, budsjettForAar]);

  const kontrakterForLev = kontraktValg.filter((k) => !vendorId || k.vendorId === vendorId);

  return (
    <Modal tittel={faktura ? "Rett faktura" : "Registrer faktura"} onLukk={onLukk} bredde={600}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(async () => {
            const f = belopFeil(belop);
            if (f) throw new Error(f);
            await onLagre({
              vendorId: vendorId || null,
              supplierName: vendorId ? null : supplierName.trim() || null,
              contractId: contractId || null,
              budgetLineId: budgetLineId || null,
              invoiceNumber: nr.trim() || null,
              invoiceDate: datoVerdi,
              dueDate: forfall || null,
              amount: tilOre(belop)!,
              kid: kid.trim() || null,
              description: beskrivelse.trim() || null,
              note: notat.trim() || null,
            });
          });
        }}
      >
        <Nedtrekk
          etikett="Leverandør"
          verdi={vendorId}
          onEndre={(v) => {
            setVendorId(v);
            if (v && contractId && !kontraktValg.some((k) => k.verdi === contractId && k.vendorId === v)) setContractId("");
          }}
          valg={[{ verdi: "", etikett: "— Ikke i registeret (skriv navn under) —" }, ...levValg]}
        />
        {!vendorId && <Tekstfelt etikett="Leverandørens navn" verdi={supplierName} onEndre={setSupplierName} plassholder="F.eks. Demo Rør AS" />}
        {kontrakterForLev.length > 0 && (
          <Nedtrekk etikett="Avtale" verdi={contractId} onEndre={setContractId} valg={[{ verdi: "", etikett: "— Ingen —" }, ...kontrakterForLev]} />
        )}
        <div className="field-row">
          <Tekstfelt etikett="Fakturanummer" verdi={nr} onEndre={setNr} />
          <Belopfelt etikett="Beløp (brutto)" verdi={belop} onEndre={setBelop} notat="Det sameiet betaler, inkl. mva" />
        </div>
        <div className="field-row">
          <Tekstfelt etikett="Fakturadato" verdi={datoVerdi} onEndre={setDatoVerdi} type="date" />
          <Tekstfelt etikett="Forfall" verdi={forfall} onEndre={setForfall} type="date" />
        </div>
        <Nedtrekk
          etikett={`Budsjettlinje${budsjettForAar ? ` (${budsjettForAar.year})` : ""}`}
          verdi={budgetLineId}
          onEndre={setBudgetLineId}
          valg={[{ verdi: "", etikett: budsjettForAar ? "— Ikke knyttet —" : `— Ingen budsjett for ${aar} —` }, ...linjer.map((l) => ({ verdi: l.id, etikett: l.name }))]}
          notat="Godkjente fakturaer på linja teller som «faktisk» i budsjettet."
        />
        <Tekstfelt etikett="Hva gjelder fakturaen" verdi={beskrivelse} onEndre={setBeskrivelse} plassholder="F.eks. Heisservice 2. kvartal" />
        <Tekstfelt etikett="KID" verdi={kid} onEndre={setKid} />
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} rader={2} />
        <Feil melding={feil} />
        <Knapperad onAvbryt={onLukk} sender={sender} sendEtikett={faktura ? "Lagre" : "Registrer"} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------
// Detalj — beslutningen
// ---------------------------------------------------------------------------------------

function FakturaDetalj({
  orgId,
  id,
  erAdmin,
  kanRedigere,
  onLukk,
  onRediger,
  onEndret,
}: {
  orgId: string;
  id: string;
  erAdmin: boolean;
  kanRedigere: boolean;
  onLukk: () => void;
  onRediger: (f: Faktura) => void;
  onEndret: () => Promise<void>;
}) {
  const [f, setF] = useState<Faktura | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [beslutning, setBeslutning] = useState<"godkjenn" | "avvis" | "betalt" | null>(null);
  const [visFil, setVisFil] = useState(false);
  const [laster, setLaster] = useState(false);

  const hent = useCallback(async () => {
    try {
      setF(await okonomi.faktura(orgId, id));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente fakturaen");
    }
  }, [orgId, id]);
  useEffect(() => {
    void hent();
  }, [hent]);

  async function utfor(fn: () => Promise<unknown>) {
    setFeil(null);
    setLaster(true);
    try {
      await fn();
      await hent();
      await onEndret();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Noe gikk galt");
    } finally {
      setLaster(false);
    }
  }

  async function lastOpp(e: React.ChangeEvent<HTMLInputElement>) {
    const fil = e.target.files?.[0];
    e.target.value = "";
    if (!fil) return;
    const form = new FormData();
    form.append("file", fil);
    await utfor(() => okonomi.lastOppFakturafil(orgId, id, form));
  }

  const st = f ? (FAKTURA_STATUS_ETIKETT[f.status as FakturaStatus] ?? { etikett: f.status, merke: "muted" }) : null;

  return (
    <Modal tittel={f ? f.leverandorNavn : "Faktura"} onLukk={onLukk} bredde={640}>
      <Feil melding={feil} />
      {!f || !st ? (
        <Tom tekst="Henter …" />
      ) : (
        <>
          <div className="ok-detalj-topp">
            <span className="ok-detalj-belop">{kroner(f.amount)}</span>
            <span className={`badge ${f.forfalt ? "danger" : st.merke}`}>{f.forfalt ? `Forfalt ${dato(f.dueDate)}` : st.etikett}</span>
          </div>

          <dl className="ok-detaljer">
            <Detalj etikett="Fakturanummer" verdi={f.invoiceNumber} />
            <Detalj etikett="Fakturadato" verdi={dato(f.invoiceDate)} />
            <Detalj etikett="Forfall" verdi={f.dueDate ? dato(f.dueDate) : null} />
            <Detalj etikett="KID" verdi={f.kid} />
            <Detalj etikett="Gjelder" verdi={f.description} />
            <Detalj etikett="Avtale" verdi={f.kontraktTittel} />
            <Detalj etikett="Budsjettlinje" verdi={f.budsjettlinjeNavn ? `${f.budsjettlinjeNavn}${f.budsjettAar ? ` (${f.budsjettAar})` : ""}` : null} />
            <Detalj etikett="Registrert av" verdi={`${f.registeredBy} · ${datoTid(f.createdAt)}`} />
            {f.decidedBy && (
              <Detalj
                etikett={f.status === "avvist" ? "Avvist av" : "Godkjent av"}
                verdi={`${f.decidedBy} · ${datoTid(f.decidedAt)}${f.decisionNote ? ` — ${f.decisionNote}` : ""}`}
              />
            )}
            {f.paidDate && <Detalj etikett="Betalt" verdi={dato(f.paidDate)} />}
            {f.note && <Detalj etikett="Notat" verdi={f.note} />}
          </dl>

          <div className="ok-vedlegg">
            <span className="field-label">Vedlegg</span>
            {f.fileName ? (
              <div className="ok-handlinger">
                <button className="btn btn-ghost" onClick={() => setVisFil(true)}>
                  <Paperclip size={13} strokeWidth={2} aria-hidden /> {f.fileOriginalName}
                </button>
                <a className="btn btn-ghost" href={`/api/organizations/${orgId}/okonomi/fakturaer/${f.id}/fil`}>
                  Last ned
                </a>
                {kanRedigere && (
                  <button className="btn btn-ghost" disabled={laster} onClick={() => window.confirm("Fjerne vedlegget?") && void utfor(() => okonomi.slettFakturafil(orgId, id))}>
                    Fjern
                  </button>
                )}
              </div>
            ) : kanRedigere ? (
              <label className="btn btn-ghost" style={{ alignSelf: "flex-start" }}>
                Last opp PDF eller bilde
                <input type="file" accept="application/pdf,image/png,image/jpeg" style={{ display: "none" }} onChange={(e) => void lastOpp(e)} />
              </label>
            ) : (
              <span className="list-meta">Ingen fil.</span>
            )}
          </div>

          <div className="ok-beslutning">
            {erAdmin && f.status === "mottatt" && (
              <>
                <button className="btn btn-primary" disabled={laster} onClick={() => setBeslutning("godkjenn")}>
                  Godkjenn
                </button>
                <button className="btn btn-danger" disabled={laster} onClick={() => setBeslutning("avvis")}>
                  Avvis
                </button>
              </>
            )}
            {kanRedigere && f.status === "godkjent" && (
              <button className="btn btn-primary" disabled={laster} onClick={() => setBeslutning("betalt")}>
                Marker betalt
              </button>
            )}
            {erAdmin && (f.status === "godkjent" || f.status === "avvist") && (
              <button className="btn btn-ghost" disabled={laster} onClick={() => void utfor(() => okonomi.gjenapneFaktura(orgId, id))}>
                Gjenåpne
              </button>
            )}
            {kanRedigere && f.status === "mottatt" && (
              <button className="btn btn-ghost" disabled={laster} onClick={() => onRediger(f)}>
                Rett
              </button>
            )}
            {kanRedigere && (f.status === "mottatt" || f.status === "avvist") && (
              <button
                className="btn btn-ghost"
                disabled={laster}
                onClick={() =>
                  window.confirm("Slette fakturaen? Bare for feilregistreringer.") &&
                  void utfor(async () => {
                    await okonomi.slettFaktura(orgId, id);
                    onLukk();
                  })
                }
              >
                Slett
              </button>
            )}
          </div>
        </>
      )}

      {beslutning && f && (
        <BeslutningModal
          type={beslutning}
          faktura={f}
          onLukk={() => setBeslutning(null)}
          onLagre={async (verdi) => {
            if (beslutning === "godkjenn") await okonomi.godkjenn(orgId, id, { note: verdi || null });
            else if (beslutning === "avvis") await okonomi.avvis(orgId, id, { note: verdi });
            else await okonomi.betalt(orgId, id, { paidDate: verdi });
            await hent();
            await onEndret();
          }}
        />
      )}

      {visFil && f?.fileName && (
        <Dokumentviser
          filnavn={f.fileName}
          visningsnavn={f.fileOriginalName}
          url={`/api/organizations/${orgId}/okonomi/fakturaer/${f.id}/fil`}
          onLukk={() => setVisFil(false)}
        />
      )}
    </Modal>
  );
}

function Detalj({ etikett, verdi }: { etikett: string; verdi: string | null | undefined }) {
  if (!verdi) return null;
  return (
    <div className="ok-detalj">
      <dt className="list-meta">{etikett}</dt>
      <dd>{verdi}</dd>
    </div>
  );
}

function BeslutningModal({
  type,
  faktura,
  onLukk,
  onLagre,
}: {
  type: "godkjenn" | "avvis" | "betalt";
  faktura: Faktura;
  onLukk: () => void;
  onLagre: (verdi: string) => Promise<void>;
}) {
  const [verdi, setVerdi] = useState(type === "betalt" ? isoDato(new Date()) : "");
  const { sender, feil, send } = useSending(onLukk);
  const tittel = type === "godkjenn" ? "Godkjenn faktura" : type === "avvis" ? "Avvis faktura" : "Marker som betalt";

  return (
    <Modal tittel={tittel} onLukk={onLukk}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => onLagre(verdi.trim()));
        }}
      >
        <p className="ok-tekst">
          {faktura.leverandorNavn}
          {faktura.invoiceNumber && ` · nr. ${faktura.invoiceNumber}`} · <strong>{kroner(faktura.amount)}</strong>
          {type === "godkjenn" && ". Godkjenningen logges i hendelsesloggen med navnet ditt."}
          {type === "avvis" && ". Leverandøren får ikke beskjed herfra — avvisningen er styrets interne beslutning."}
        </p>
        {type === "betalt" ? (
          <Tekstfelt etikett="Betalt dato" verdi={verdi} onEndre={setVerdi} type="date" />
        ) : (
          <Tekstomrade
            etikett={type === "avvis" ? "Begrunnelse" : "Kommentar (valgfri)"}
            verdi={verdi}
            onEndre={setVerdi}
            rader={3}
            plassholder={type === "avvis" ? "F.eks. feil beløp i forhold til avtalen" : ""}
          />
        )}
        <Feil melding={feil} />
        <Knapperad onAvbryt={onLukk} sender={sender} sendEtikett={type === "godkjenn" ? "Godkjenn" : type === "avvis" ? "Avvis" : "Registrer betalt"} farlig={type === "avvis"} />
      </form>
    </Modal>
  );
}
