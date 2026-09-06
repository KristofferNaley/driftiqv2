"use client";

import { useState } from "react";
import { Feil, Kort, Tom, dato, datoTid, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { okonomi, type LadekjoringDetalj } from "@/lib/klient";
import { KJORING_STATUS_ETIKETT, type KjoringStatus, kroner } from "@/lib/okonomiregler";
import { LADING_INNTEKTSKONTO_STANDARD } from "@/lib/regnskap";

/**
 * Lading-fanen i Økonomi (docs/easee.md «Etappe 3»): ladekjøringene — fakturagrunnlaget
 * for strøm til lading, per periode sameiet velger. Grunnlaget lages fra
 * månedsrapportene i Parkering → Lading; herfra sendes det til regnskapssystemet orgen
 * er koblet til (navnet kommer fra koblingen, aldri hardkodet), eller lastes ned som CSV.
 */
export default function Ladekjoringer({ erAdmin }: { erAdmin: boolean }) {
  const kjoringer = useOrgData((o) => okonomi.ladekjoringer(o));
  const regnskap = useOrgData((o) => okonomi.regnskap(o));
  const [ny, setNy] = useState(false);
  const [vis, setVis] = useState<string | null>(null);
  const { orgId } = kjoringer;

  async function annuller(id: string) {
    if (!orgId || !window.confirm("Annullere grunnlaget? Perioden kan da kjøres på nytt.")) return;
    kjoringer.setFeil(null);
    try {
      await okonomi.annullerLadekjoring(orgId, id);
      await kjoringer.last();
    } catch (e) {
      kjoringer.setFeil(e instanceof Error ? e.message : "Kunne ikke annullere");
    }
  }

  const r = regnskap.data;

  return (
    <>
      <Feil melding={kjoringer.feil} />
      <Kort
        tittel="Ladekjøringer"
        handling={
          erAdmin && (
            <button className="btn btn-primary" onClick={() => setNy(true)}>Ny ladekjøring</button>
          )
        }
      >
        <div className="field-note" style={{ padding: "12px 18px 4px" }}>
          Én kjøring per periode — måned, kvartal, halvår eller år — med én linje per seksjon: summen av
          månedsrapportene i Parkering → Lading, priset etter prisplanen der. {r ? (r.system ? `Sendes til ${r.navn}${r.foretak ? ` (${r.foretak})` : ""}` : "Uten regnskapskobling lastes grunnlaget ned som CSV til forretningsfører") : ""}.
        </div>
        {kjoringer.laster && !kjoringer.data ? (
          <Tom tekst="Henter …" />
        ) : !kjoringer.data || kjoringer.data.length === 0 ? (
          <Tom tekst="Ingen ladekjøringer ennå. Lag den første fra perioden dere vil fakturere." />
        ) : (
          kjoringer.data.map((k) => {
            const st = KJORING_STATUS_ETIKETT[k.status as KjoringStatus] ?? { etikett: k.status, merke: "muted" };
            return (
              <div key={k.id} className="list-item">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="list-tittel">
                    {periodeTekst(k.periodStart, k.periodEnd)}
                    <span className={`badge ${st.merke}`} style={{ marginLeft: "8px" }}>{st.etikett}{k.status === "sendt" && k.sentTo ? ` · ${navnFor(k.sentTo)}` : ""}</span>
                  </div>
                  <div className="list-meta">
                    {k.lineCount - k.missingRecipients} linjer · {kroner(k.totalAmount)} · {k.totalKwh.toLocaleString("nb-NO", { maximumFractionDigits: 0 })} kWh · forfall {dato(k.dueDate)}
                    {k.missingRecipients > 0 ? <span style={{ color: "var(--warn)" }}> · {k.missingRecipients} uten mottaker</span> : null}
                  </div>
                  <div className="list-meta">laget av {k.createdBy} {dato(k.createdAt)}{k.sentAt ? ` · sendt ${datoTid(k.sentAt)}` : ""}</div>
                </div>
                <span style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                  <button className="btn btn-ghost" onClick={() => setVis(k.id)}>Åpne</button>
                  {erAdmin && k.status === "grunnlag" && (
                    <button className="btn btn-ghost" style={{ color: "var(--muted)" }} onClick={() => void annuller(k.id)}>Annuller</button>
                  )}
                </span>
              </div>
            );
          })
        )}
      </Kort>

      {ny && orgId && (
        <NyKjoringModal
          onLukk={() => setNy(false)}
          onLagre={async (d) => {
            const k = await okonomi.nyLadekjoring(orgId, d);
            await kjoringer.last();
            setVis(k.id);
          }}
        />
      )}
      {vis && orgId && (
        <KjoringDetaljModal
          orgId={orgId}
          id={vis}
          erAdmin={erAdmin}
          regnskap={r ?? null}
          onLukk={() => setVis(null)}
          onEndret={() => void kjoringer.last()}
        />
      )}
    </>
  );
}

const navnFor = (system: string) => ({ fiken: "Fiken", tripletex: "Tripletex" } as Record<string, string>)[system] ?? system;

function periodeTekst(start: string, slutt: string): string {
  const navn = (iso: string) => {
    const t = new Date(iso + "T00:00:00").toLocaleDateString("nb-NO", { month: "long", year: "numeric" });
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  return start.slice(0, 7) === slutt.slice(0, 7) ? navn(start) : `${navn(start)} – ${navn(slutt).toLowerCase()}`;
}

function NyKjoringModal({ onLukk, onLagre }: { onLukk: () => void; onLagre: (d: { periodStart: string; maaneder: 1 | 3 | 6 | 12; dueDate: string; incomeAccount: string; note: string | null }) => Promise<void> }) {
  const naa = new Date();
  // Forslag: forrige måned — den er ferdig målt.
  const forrige = new Date(naa.getFullYear(), naa.getMonth() - 1, 1);
  const [start, setStart] = useState(`${forrige.getFullYear()}-${String(forrige.getMonth() + 1).padStart(2, "0")}-01`);
  const [lengde, setLengde] = useState("1");
  const forfall = new Date(naa.getFullYear(), naa.getMonth(), naa.getDate() + 14);
  const [due, setDue] = useState(forfall.toISOString().slice(0, 10));
  const [konto, setKonto] = useState(LADING_INNTEKTSKONTO_STANDARD);
  const [notat, setNotat] = useState("");
  const { sender, feil, send } = useSending(onLukk);

  const maaneder: Array<{ verdi: string; etikett: string }> = [];
  for (let i = 0; i < 18; i++) {
    const d = new Date(naa.getFullYear(), naa.getMonth() - i, 1);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const t = d.toLocaleDateString("nb-NO", { month: "long", year: "numeric" });
    maaneder.push({ verdi: iso, etikett: t.charAt(0).toUpperCase() + t.slice(1) });
  }

  return (
    <Modal tittel="Ny ladekjøring" onLukk={onLukk}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => onLagre({ periodStart: start, maaneder: Number(lengde) as 1 | 3 | 6 | 12, dueDate: due, incomeAccount: konto.trim(), note: notat.trim() || null }));
        }}
      >
        <p className="ok-tekst">
          Lager én linje per seksjon med summen av ladeforbruket i perioden, priset etter prisplanen i Parkering → Lading.
          Plasser uten seksjon og seksjoner uten eier får linje uten mottaker og faktureres ikke — de telles opp, så du kan
          ordne koblingen og kjøre på nytt.
        </p>
        <div className="field-row">
          <Nedtrekk etikett="Fra og med" verdi={start} onEndre={setStart} valg={maaneder} />
          <Nedtrekk
            etikett="Lengde"
            verdi={lengde}
            onEndre={setLengde}
            valg={[{ verdi: "1", etikett: "Én måned" }, { verdi: "3", etikett: "Kvartal (3 måneder)" }, { verdi: "6", etikett: "Halvår (6 måneder)" }, { verdi: "12", etikett: "År (12 måneder)" }]}
          />
        </div>
        <div className="field-row">
          <Tekstfelt etikett="Forfall" verdi={due} onEndre={setDue} type="date" />
          <Tekstfelt etikett="Inntektskonto" verdi={konto} onEndre={setKonto} notat="3100 = salgsinntekt avgiftsfri (sameie uten mva). Mva-registrerte bruker 3000. Regnskapsføreren avgjør." />
        </div>
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} rader={2} />
        <Feil melding={feil} />
        <Knapperad onAvbryt={onLukk} sender={sender} sendEtikett="Lag grunnlag" />
      </form>
    </Modal>
  );
}

function KjoringDetaljModal({ orgId, id, erAdmin, regnskap, onLukk, onEndret }: {
  orgId: string; id: string; erAdmin: boolean;
  regnskap: { system: string | null; navn: string; foretak: string | null; kanFakturere: boolean; grunn: string | null } | null;
  onLukk: () => void; onEndret: () => void;
}) {
  const [data, setData] = useState<LadekjoringDetalj | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [sender, setSender] = useState(false);
  const [rediger, setRediger] = useState<{ dueDate: string; incomeAccount: string } | null>(null);
  useState(() => {
    okonomi.ladekjoring(orgId, id).then(setData).catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente"));
  });

  async function lagreEndring() {
    if (!rediger) return;
    setSender(true);
    setFeil(null);
    try {
      setData(await okonomi.endreLadekjoring(orgId, id, rediger));
      setRediger(null);
      onEndret();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
    } finally {
      setSender(false);
    }
  }

  async function send() {
    if (!data || !regnskap?.system) return;
    const antall = data.linjer.filter((l) => l.unitId && l.ownerId && l.amount > 0).length;
    const sporsmal = data.status === "sendt"
      ? "Sende fakturaene som ikke er levert på e-post til mottakerne?"
      : `Opprette ${antall} faktura${antall === 1 ? "" : "er"} i ${regnskap.navn}${regnskap.foretak ? ` (${regnskap.foretak})` : ""} og sende dem på e-post til eierne som har adresse?`;
    if (!window.confirm(sporsmal)) return;
    setSender(true);
    setFeil(null);
    try {
      setData(await okonomi.sendLadekjoring(orgId, id));
      onEndret();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Sendingen feilet");
    } finally {
      setSender(false);
    }
  }

  const st = data ? KJORING_STATUS_ETIKETT[data.status as KjoringStatus] ?? { etikett: data.status, merke: "muted" } : null;

  return (
    <Modal tittel={data ? `Lading ${data.etikett}` : "Ladekjøring"} onLukk={onLukk} bredde={960}>
      <Feil melding={feil} />
      {!data ? (
        <Tom tekst="Henter …" />
      ) : (
        <>
          <div className="ok-handlinger" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <span className="list-meta">
              {st && <span className={`badge ${st.merke}`} style={{ marginRight: "8px" }}>{st.etikett}{data.sentTo ? ` · ${navnFor(data.sentTo)}` : ""}</span>}
              {data.lineCount - data.missingRecipients} linjer · {kroner(data.totalAmount)} · forfall {dato(data.dueDate)} · konto {data.incomeAccount} · laget av {data.createdBy} {dato(data.createdAt)}
            </span>
            <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {erAdmin && data.status === "grunnlag" && !rediger && (
                <button className="btn btn-ghost" onClick={() => setRediger({ dueDate: data.dueDate, incomeAccount: data.incomeAccount })}>Endre forfall/konto</button>
              )}
              {data.status !== "annullert" && <a className="btn btn-ghost" href={okonomi.ladekjoringEksportUrl(orgId, data.id)}>Last ned CSV</a>}
              {erAdmin && data.status === "grunnlag" && (
                <button
                  className="btn btn-primary"
                  disabled={sender || !regnskap?.kanFakturere}
                  title={regnskap?.kanFakturere ? undefined : regnskap?.grunn ?? "Ingen regnskapskobling"}
                  onClick={() => void send()}
                >
                  {sender ? "Sender …" : `Send til ${regnskap?.navn ?? "regnskapet"}`}
                </button>
              )}
              {erAdmin && data.status === "sendt" && regnskap?.kanFakturere && data.linjer.some((l) => l.externalRef && l.ownerEmail && !l.sentToRecipient) && (
                <button className="btn btn-primary" disabled={sender} onClick={() => void send()} title="Fakturaene finnes i regnskapet, men er ikke sendt til mottakeren">
                  {sender ? "Sender …" : "Send ubesendte på e-post"}
                </button>
              )}
            </span>
          </div>
          {rediger && (
            <div className="field-row" style={{ marginTop: "12px", alignItems: "flex-end" }}>
              <Tekstfelt etikett="Forfall" verdi={rediger.dueDate} onEndre={(v) => setRediger({ ...rediger, dueDate: v })} type="date" />
              <Tekstfelt etikett="Inntektskonto" verdi={rediger.incomeAccount} onEndre={(v) => setRediger({ ...rediger, incomeAccount: v })} notat="3100 avgiftsfri salg · 3000 avgiftspliktig (krever mva-kode)" />
              <div style={{ display: "flex", gap: "6px", paddingBottom: "18px" }}>
                <button className="btn btn-ghost" onClick={() => setRediger(null)} disabled={sender}>Avbryt</button>
                <button className="btn btn-primary" onClick={() => void lagreEndring()} disabled={sender}>Lagre</button>
              </div>
            </div>
          )}
          {data.missingRecipients > 0 && data.status === "grunnlag" && (
            <div className="ea-advarsel" style={{ margin: "10px 0 0" }}>
              {data.missingRecipients} linje{data.missingRecipients === 1 ? "" : "r"} mangler mottaker og faktureres ikke. Koble plassen til seksjon (Parkering) eller registrer eier (Økonomi → Seksjoner), annuller denne kjøringen og lag den på nytt.
            </div>
          )}
          <div className="prk-scroll" style={{ marginTop: "12px" }}>
            <table className="ea-tabell" style={{ minWidth: "820px" }}>
              <thead>
                <tr><th>Seksjon</th><th>Eier</th><th>Gjelder</th><th className="r">kWh</th><th className="r">Kraft</th><th className="r">Nett</th><th className="r">Fastledd</th><th className="r">Beløp</th><th>Faktura</th></tr>
              </thead>
              <tbody>
                {data.linjer.map((l) => (
                  <tr key={l.id}>
                    <td><b>{l.unitLabel ?? "—"}</b></td>
                    <td>
                      {l.ownerName ?? <span style={{ color: "var(--warn)" }}>{l.issue ?? "Ingen mottaker"}</span>}
                      {l.ownerEmail && <span className="ea-under">{l.ownerEmail}</span>}
                    </td>
                    <td className="mut" style={{ maxWidth: "260px" }}>{l.description.replace(/^Lading [^·]+· /, "")}</td>
                    <td className="r">{l.kwh.toLocaleString("nb-NO", { maximumFractionDigits: 1 })}</td>
                    <td className="r">{kroner(l.energyAmount)}</td>
                    <td className="r">{kroner(l.gridAmount)}</td>
                    <td className="r">{kroner(l.fixedAmount)}</td>
                    <td className="r"><b>{kroner(l.amount)}</b></td>
                    <td>
                      {l.externalNumber ? <>#{l.externalNumber}{l.sentToRecipient ? <span className="ea-under">sendt {datoTid(l.sentToRecipient)}</span> : <span className="ea-under">opprettet, ikke sendt</span>}</> : l.externalRef ? `id ${l.externalRef}` : l.issue ? <span className="ea-chip w">Hoppes over</span> : <span className="mut">—</span>}
                    </td>
                  </tr>
                ))}
                <tr className="ea-sumrad">
                  <td colSpan={3}>Sum med mottaker</td>
                  <td className="r">{data.linjer.filter((l) => l.unitId && l.ownerId).reduce((n, l) => n + l.kwh, 0).toLocaleString("nb-NO", { maximumFractionDigits: 1 })}</td>
                  <td className="r">{kroner(data.linjer.filter((l) => l.unitId && l.ownerId).reduce((n, l) => n + l.energyAmount, 0))}</td>
                  <td className="r">{kroner(data.linjer.filter((l) => l.unitId && l.ownerId).reduce((n, l) => n + l.gridAmount, 0))}</td>
                  <td className="r">{kroner(data.linjer.filter((l) => l.unitId && l.ownerId).reduce((n, l) => n + l.fixedAmount, 0))}</td>
                  <td className="r">{kroner(data.totalAmount)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <div className="field-note" style={{ marginTop: "10px" }}>
            Ordrereferansen («Lading juli 2026») og kunden identifiserer fakturaen i regnskapssystemet, så en kjøring som feiler halvveis kan sendes på nytt uten dobbeltfakturering.
          </div>
        </>
      )}
    </Modal>
  );
}
