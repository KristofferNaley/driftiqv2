"use client";

import { useState } from "react";
import { Feil, Kort, Nokkeltall, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { okonomi, type KjoringDetalj, type Satsoversikt } from "@/lib/klient";
import {
  FORFALLSDAG_STANDARD,
  KJORING_STATUS_ETIKETT,
  brokTekst,
  halvaarsperioder,
  isoDato,
  kroner,
  manedTekst,
  tilKronerTekst,
  tilOre,
  type KjoringStatus,
} from "@/lib/okonomiregler";
import Belopfelt, { belopFeil } from "./Belopfelt";

/**
 * Felleskostnader: satsen per seksjon (regnet fra vedtatt budsjett, eller satt for hånd) og
 * halvårskjøringene som lager fakturagrunnlaget. Uten regnskapskobling er CSV-en
 * leveransen; med Fiken blir den samme kjøringen til fakturaer.
 */
export default function Felleskostnader({ erAdmin }: { erAdmin: boolean }) {
  const [datoValg, setDatoValg] = useState(isoDato(new Date()));
  const satser = useOrgData((o) => okonomi.satser(o, datoValg), [datoValg]);
  const kjoringer = useOrgData((o) => okonomi.kjoringer(o));
  const orgId = satser.orgId;

  const [endre, setEndre] = useState<Satsoversikt["rader"][number] | null>(null);
  const [nyKjoring, setNyKjoring] = useState(false);
  const [visKjoring, setVisKjoring] = useState<string | null>(null);

  async function annuller(id: string) {
    if (!orgId) return;
    if (!window.confirm("Annullere grunnlaget? Det blir stående som historikk, og perioden kan kjøres på nytt.")) return;
    try {
      await okonomi.annullerKjoring(orgId, id);
      await kjoringer.last();
    } catch (e) {
      kjoringer.setFeil(e instanceof Error ? e.message : "Kunne ikke annullere");
    }
  }

  const s = satser.data;

  return (
    <>
      <Feil melding={satser.feil ?? kjoringer.feil} />

      <div className="auto-grid">
        <Nokkeltall etikett="Per måned, alle seksjoner" verdi={s ? kroner(s.maanedligSum) : "—"} />
        <Nokkeltall etikett="Per år" verdi={s ? kroner(s.maanedligSum * 12) : "—"} />
        <Nokkeltall
          etikett="Uten sats"
          verdi={<span className={s && s.utenSats > 0 ? "ok-kpi-varsel" : undefined}>{s ? s.utenSats : "—"}</span>}
        />
      </div>

      <Kort tittel="Fra budsjett til felleskostnader">
        <div className="ok-steg">
          <div><span className="ok-steg-nr">1</span><b>Kostnader som dekkes</b><span className="list-meta">Sum av kostnadslinjene i vedtatt budsjett</span></div>
          <div><span className="ok-steg-nr">2</span><b>Trekk fra andre inntekter</b><span className="list-meta">Utleie, renter og annet — resten er felleskostnader («Balanser» i budsjettet)</span></div>
          <div><span className="ok-steg-nr">3</span><b>Fordel etter sameiebrøk</b><span className="list-meta">Felleskostnader × teller / nevner per seksjon (eierseksjonsloven § 29)</span></div>
          <div><span className="ok-steg-nr">4</span><b>Rund av per måned</b><span className="list-meta">Delt på 12 og rundet til hele kroner. Tillegg settes per seksjon</span></div>
        </div>
      </Kort>

      <Kort
        tittel="Satser per seksjon"
        handling={
          <div className="ok-handlinger">
            <label className="list-meta" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              Gjelder per
              <input
                className="input"
                type="date"
                value={datoValg}
                onChange={(e) => e.target.value && setDatoValg(e.target.value)}
                aria-label="Vis satsene som gjelder på dato"
              />
            </label>
          </div>
        }
      >
        {satser.laster || !s ? (
          <Tom tekst="Henter …" />
        ) : s.rader.length === 0 ? (
          <Tom tekst="Ingen seksjoner registrert. Leiligheter legges inn under Innstillinger." />
        ) : (
          <>
            <p className="ok-tekst">
              Satsene regnes fra vedtatt budsjett («Beregn satser» under Budsjett): felleskostnader × brøk / 12, rundet
              til hele kroner. Tillegg for garasje eller bod settes per seksjon og overlever en ny beregning.
            </p>
            <div className="ok-sats-hode" aria-hidden>
              <span>Seksjon</span>
              <span className="ok-sats-eier">Eier</span>
              <span className="ok-sats-brok">Brøk</span>
              <span className="ok-belop-celle">Sats / mnd</span>
              <span className="ok-sats-kilde">Kilde</span>
              <span />
            </div>
            {s.rader.map((r) => (
              <div key={r.unitId} className="ok-sats-rad">
                <div style={{ minWidth: 0 }}>
                  <div className="list-tittel">{r.navn}</div>
                  {(r.sats?.note || r.oppgang) && (
                    <div className="list-meta">{[r.oppgang && `oppg. ${r.oppgang}`, r.sats?.note].filter(Boolean).join(" · ")}</div>
                  )}
                </div>
                <span className="ok-sats-eier list-meta">{r.eierNavn ?? "—"}</span>
                <span className="ok-sats-brok list-meta">{brokTekst({ teller: r.brokTeller, nevner: r.brokNevner })}</span>
                <span className="ok-belop-celle">{r.sats ? kroner(r.sats.monthlyAmount) : <span className="badge warn">Mangler</span>}</span>
                <span className="ok-sats-kilde">
                  {r.sats && (
                    <span className={`badge ${r.sats.source === "overstyrt" ? "info" : "muted"}`} title={`Gyldig fra ${dato(r.sats.validFrom)}`}>
                      {r.sats.source === "overstyrt" ? "Satt manuelt" : "Beregnet"}
                    </span>
                  )}
                </span>
                <span className="ok-linje-handling">
                  {erAdmin && (
                    <button className="btn btn-ghost" onClick={() => setEndre(r)}>
                      {r.sats ? "Endre" : "Sett sats"}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </>
        )}
      </Kort>

      <Kort
        tittel="Fakturagrunnlag (halvårskjøringer)"
        handling={
          erAdmin && (
            <button className="btn btn-primary" onClick={() => setNyKjoring(true)}>
              ＋ Ny kjøring
            </button>
          )
        }
      >
        {kjoringer.laster ? (
          <Tom tekst="Henter …" />
        ) : !kjoringer.data || kjoringer.data.length === 0 ? (
          <Tom tekst="Ingen kjøringer ennå. En kjøring lager én linje per seksjon per måned for et halvår — grunnlaget forretningsfører eller regnskapssystemet fakturerer fra." />
        ) : (
          <>
            <div className="ok-kjoring-hode" aria-hidden>
              <span>Periode</span>
              <span className="ok-kjoring-linjer">Linjer</span>
              <span className="ok-belop-celle">Sum</span>
              <span>Status</span>
              <span />
            </div>
            {kjoringer.data.map((k) => {
              const st = KJORING_STATUS_ETIKETT[k.status as KjoringStatus] ?? { etikett: k.status, merke: "muted" };
              return (
                <div key={k.id} className="ok-kjoring-rad">
                  <div style={{ minWidth: 0 }}>
                    <div className="list-tittel">
                      {dato(k.periodStart)} – {dato(k.periodEnd)}
                    </div>
                    <div className="list-meta">
                      laget {dato(k.createdAt)} av {k.createdBy} · forfall den {k.dueDay}.
                      {k.missingOwners > 0 && ` · ${k.missingOwners} seksjoner uten eier`}
                    </div>
                  </div>
                  <span className="ok-kjoring-linjer list-meta">{k.lineCount}</span>
                  <span className="ok-belop-celle">{kroner(k.totalAmount)}</span>
                  <span>
                    <span className={`badge ${st.merke}`}>{st.etikett}</span>
                  </span>
                  <span className="ok-linje-handling">
                    <button className="btn btn-ghost" onClick={() => setVisKjoring(k.id)}>
                      Vis
                    </button>
                    {orgId && k.status !== "annullert" && (
                      <a className="btn btn-ghost" href={okonomi.eksportUrl(orgId, k.id)}>
                        CSV
                      </a>
                    )}
                    {erAdmin && k.status === "grunnlag" && (
                      <button className="btn btn-ghost" onClick={() => void annuller(k.id)}>
                        Annuller
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </Kort>

      {endre && orgId && (
        <SatsModal
          rad={endre}
          onLukk={() => setEndre(null)}
          onLagre={async (d) => {
            await okonomi.settSats(orgId, endre.unitId, d);
            await satser.last();
          }}
          onSlett={
            endre.sats
              ? async () => {
                  await okonomi.slettSats(orgId, endre.sats!.id);
                  await satser.last();
                }
              : undefined
          }
        />
      )}

      {nyKjoring && orgId && (
        <KjoringModal
          onLukk={() => setNyKjoring(false)}
          onLagre={async (d) => {
            const k = await okonomi.nyKjoring(orgId, d);
            await kjoringer.last();
            setVisKjoring(k.id);
          }}
        />
      )}

      {visKjoring && orgId && <KjoringDetaljModal orgId={orgId} id={visKjoring} onLukk={() => setVisKjoring(null)} />}
    </>
  );
}

function SatsModal({
  rad,
  onLukk,
  onLagre,
  onSlett,
}: {
  rad: Satsoversikt["rader"][number];
  onLukk: () => void;
  onLagre: (d: { monthlyAmount: number; validFrom: string; note: string | null }) => Promise<void>;
  onSlett?: () => Promise<void>;
}) {
  const [belop, setBelop] = useState(rad.sats ? tilKronerTekst(rad.sats.monthlyAmount) : "");
  const [fra, setFra] = useState(rad.sats?.validFrom ?? `${new Date().getFullYear()}-01-01`);
  const [notat, setNotat] = useState(rad.sats?.note ?? "");
  const { sender, feil, send } = useSending(onLukk);

  return (
    <Modal tittel={`Sats for ${rad.navn}`} onLukk={onLukk}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(async () => {
            const f = belopFeil(belop, "Satsen");
            if (f) throw new Error(f);
            await onLagre({ monthlyAmount: tilOre(belop)!, validFrom: fra, note: notat.trim() || null });
          });
        }}
      >
        <p className="ok-tekst">
          Brøk {brokTekst({ teller: rad.brokTeller, nevner: rad.brokNevner })}
          {rad.sats && ` · nå ${kroner(rad.sats.monthlyAmount)} (${rad.sats.source === "overstyrt" ? "satt manuelt" : "beregnet"})`}.
          En manuell sats overlever «Beregn satser» — bruk den for garasje, bod eller andre tillegg.
        </p>
        <Belopfelt etikett="Sats per måned" verdi={belop} onEndre={setBelop} />
        <Tekstfelt etikett="Gyldig fra" verdi={fra} onEndre={setFra} type="date" notat="Samme dato som en beregnet sats erstatter den; en senere dato legger til en ny periode." />
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} rader={2} plassholder="F.eks. inkl. garasjeplass 12" />
        {rad.alle.length > 1 && (
          <div>
            <div className="field-label">Historikk</div>
            {rad.alle.map((s) => (
              <div key={s.id} className="list-meta">
                fra {dato(s.validFrom)}: {kroner(s.monthlyAmount)} ({s.source === "overstyrt" ? "manuell" : "beregnet"})
              </div>
            ))}
          </div>
        )}
        <Feil melding={feil} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
          {onSlett ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => window.confirm("Slette denne satsen?") && void send(onSlett)}
            >
              Slett sats
            </button>
          ) : (
            <span />
          )}
          <Knapperad onAvbryt={onLukk} sender={sender} />
        </div>
      </form>
    </Modal>
  );
}

function KjoringModal({
  onLukk,
  onLagre,
}: {
  onLukk: () => void;
  onLagre: (d: { periodStart: string; dueDay: number; note: string | null }) => Promise<void>;
}) {
  const aar = new Date().getFullYear();
  const perioder = [...halvaarsperioder(aar), ...halvaarsperioder(aar + 1)];
  // Forslag: neste halvår som ikke har begynt.
  const iDag = isoDato(new Date());
  const [start, setStart] = useState(perioder.find((p) => p.start > iDag)?.start ?? perioder[0]!.start);
  const [dag, setDag] = useState(String(FORFALLSDAG_STANDARD));
  const [notat, setNotat] = useState("");
  const { sender, feil, send } = useSending(onLukk);

  return (
    <Modal tittel="Ny halvårskjøring" onLukk={onLukk}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => onLagre({ periodStart: start, dueDay: Number(dag), note: notat.trim() || null }));
        }}
      >
        <p className="ok-tekst">
          Lager én linje per seksjon per måned med satsen og eieren som gjelder den måneden. Alle seksjoner må ha sats;
          seksjoner uten eier får linje uten mottaker og telles opp.
        </p>
        <Nedtrekk etikett="Periode" verdi={start} onEndre={setStart} valg={perioder.map((p) => ({ verdi: p.start, etikett: p.etikett }))} />
        <Tekstfelt etikett="Forfallsdag i måneden" verdi={dag} onEndre={setDag} type="number" notat="1–28" />
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} rader={2} />
        <Feil melding={feil} />
        <Knapperad onAvbryt={onLukk} sender={sender} sendEtikett="Lag grunnlag" />
      </form>
    </Modal>
  );
}

function KjoringDetaljModal({ orgId, id, onLukk }: { orgId: string; id: string; onLukk: () => void }) {
  const [data, setData] = useState<KjoringDetalj | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  // Hentes én gang per åpning; `useOrgData` ville også lyttet på orgbytte, som lukker modalen uansett.
  useState(() => {
    okonomi.kjoring(orgId, id).then(setData).catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente"));
  });

  return (
    <Modal tittel={data ? `Fakturagrunnlag ${dato(data.periodStart)} – ${dato(data.periodEnd)}` : "Fakturagrunnlag"} onLukk={onLukk} bredde={820}>
      <Feil melding={feil} />
      {!data ? (
        <Tom tekst="Henter …" />
      ) : (
        <>
          <div className="ok-handlinger" style={{ justifyContent: "space-between" }}>
            <span className="list-meta">
              {data.lineCount} linjer · {kroner(data.totalAmount)} · laget av {data.createdBy} {dato(data.createdAt)}
            </span>
            {data.status !== "annullert" && (
              <a className="btn btn-ghost" href={okonomi.eksportUrl(orgId, data.id)}>
                Last ned CSV
              </a>
            )}
          </div>
          <div className="ok-grunnlag">
            <div className="ok-grunnlag-hode" aria-hidden>
              <span>Seksjon</span>
              <span>Eier</span>
              <span>Måned</span>
              <span>Forfall</span>
              <span className="ok-belop-celle">Beløp</span>
            </div>
            {data.linjer.map((l) => (
              <div key={l.id} className="ok-grunnlag-rad">
                <span className="list-tittel">{l.enhetNavn}</span>
                <span className={l.ownerName ? undefined : "ok-mangler"}>{l.ownerName ?? "Ingen eier"}</span>
                <span className="list-meta">{manedTekst(l.month)}</span>
                <span className="list-meta">{dato(l.dueDate)}</span>
                <span className="ok-belop-celle">{kroner(l.amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
