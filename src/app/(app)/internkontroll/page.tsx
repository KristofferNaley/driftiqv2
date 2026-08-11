"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Faner, Feil, Hurtigskjema, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { internkontroll, type Fare, type HmsMal } from "@/lib/klient";
import { useOkt } from "@/components/OktProvider";

const NIVAMERKE: Record<string, string> = { lav: "ok", middels: "warn", hoy: "danger" };
const OMRADE: Record<string, string> = {
  brannvern: "Brannvern",
  el_sikkerhet: "El-sikkerhet",
  utearealer: "Utearealer",
};

/** Skalaene i risikomatrisen — tall med ord, så 1–5 betyr det samme for alle som fyller ut. */
const SANNSYNLIGHET = ["Svært lav", "Lav", "Middels", "Høy", "Svært høy"];
const KONSEKVENS = ["Ubetydelig", "Lav", "Middels", "Alvorlig", "Svært alvorlig"];
const FARESTATUS = [
  { verdi: "open", etikett: "Åpen" },
  { verdi: "mitigated", etikett: "Under kontroll" },
  { verdi: "closed", etikett: "Lukket" },
];
const TILTAKSSTATUS = [
  { verdi: "not_started", etikett: "Ikke startet" },
  { verdi: "in_progress", etikett: "Pågår" },
  { verdi: "done", etikett: "Utført" },
];

/** § 5-punktene og om de er dekket i år. Grunnlaget for oversikten. */
function Oversikt() {
  const router = useRouter();
  const { data, feil, laster } = useOrgData((o) => internkontroll.status(o));
  const maal = useOrgData((o) => internkontroll.maal(o));

  const punkter: Array<[string, boolean]> = data
    ? [
        [`HMS-mål satt for ${data.aar}`, data.maalSatt],
        ["Ansvar fordelt på alle områder", data.ansvarFordelt],
        ["Risiko kartlagt", data.risikoKartlagt],
        ["Vernerunde gjennomført", data.vernerundeGjennomfort],
        [`Årlig evaluering for ${data.aar}`, data.evaluert],
      ]
    : [];

  return (
    <>
      <Feil melding={feil} />
      <Kort tittel="Krav i internkontrollforskriften § 5">
        {laster ? (
          <Tom tekst="Henter …" />
        ) : (
          punkter.map(([tekst, oppfylt]) => (
            <Rad
              key={tekst}
              tittel={tekst}
              hoyre={
                oppfylt ? (
                  <span className="badge ok">
                    <Check size={13} strokeWidth={2.5} aria-hidden /> Dekket
                  </span>
                ) : (
                  <span className="badge warn">
                    <X size={13} strokeWidth={2.5} aria-hidden /> Mangler
                  </span>
                )
              }
            />
          ))
        )}
      </Kort>

      <Kort tittel="HMS-mål">
        {maal.laster ? (
          <Tom tekst="Henter …" />
        ) : (maal.data ?? []).length === 0 ? (
          <Tom tekst="Ingen HMS-mål satt. Ett mål per år." />
        ) : (
          (maal.data ?? []).map((m) => (
            <Rad
              key={m.id}
              onClick={() => router.push(`/internkontroll/maal/${m.id}`)}
              tittel={`${m.year} — ${m.goalText}`}
              hoyre={
                <span className={`badge ${m.approved ? "ok" : "muted"}`}>
                  {m.approved ? "Godkjent" : "Ikke godkjent"}
                </span>
              }
            />
          ))
        )}
      </Kort>
    </>
  );
}

/**
 * Risikovurderingen (§ 5 pkt. 6) — v1s matrise: sannsynlighet × konsekvens (1–5), tiltak
 * med ansvarlig og frist per fare. «Hent standard fareområder» kopierer plattformmalen
 * inn som LAGETS farer — malen er utgangspunktet, laget eier og redigerer kopien.
 */
function Risiko() {
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => internkontroll.farer(o));
  const [apen, setApen] = useState<Fare | null>(null);
  const [seeder, setSeeder] = useState(false);
  const liste = data ?? [];

  async function nyFare(tittel: string) {
    if (!orgId) return;
    try {
      // Middels/middels som utgangspunkt — styret justerer i faremodalen etterpå.
      const ny = await internkontroll.nyFare(orgId, { title: tittel, probability: 3, consequence: 3 });
      await last();
      setApen(ny);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke registrere faren");
    }
  }

  return (
    <>
      <Feil melding={feil} />
      <Kort
        tittel="Kartlagte farer"
        handling={
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={() => setSeeder(true)}>
              Hent standard fareområder
            </button>
            <Hurtigskjema plassholder="Hva kan gå galt?" onSend={nyFare} />
          </div>
        }
      >
        {laster ? (
          <Tom tekst="Henter …" />
        ) : liste.length === 0 ? (
          <Tom tekst="Ingen farer kartlagt ennå. Start med standard fareområder — de lovpålagte er med der." />
        ) : (
          // Høyest risiko først — lista skal kunne leses ovenfra og ned.
          liste.map((f) => (
            <Rad
              key={f.id}
              onClick={() => setApen(f)}
              tittel={f.title}
              meta={[
                f.category,
                `${SANNSYNLIGHET[f.probability - 1] ?? f.probability} sannsynlighet · ${String(KONSEKVENS[f.consequence - 1] ?? f.consequence).toLowerCase()} konsekvens`,
                f.tiltak.length ? `${f.tiltak.length} tiltak` : f.niva !== "lav" ? "ingen tiltak" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              hoyre={
                <>
                  {f.status !== "open" && (
                    <span className="badge muted">
                      {FARESTATUS.find((s) => s.verdi === f.status)?.etikett ?? f.status}
                    </span>
                  )}
                  <span className={`badge ${NIVAMERKE[f.niva]}`}>Risiko {f.risiko}</span>
                </>
              }
            />
          ))
        )}
      </Kort>

      {apen && orgId && (
        <FareModal
          orgId={orgId}
          fare={apen}
          onLukk={() => setApen(null)}
          onEndret={async () => {
            await last();
          }}
        />
      )}

      {seeder && orgId && (
        <SeedModal orgId={orgId} onLukk={() => setSeeder(false)} onLagret={last} />
      )}
    </>
  );
}

/** Redigerer én fare: matriseverdiene, eier, status — og tiltakene med frist og ansvarlig. */
function FareModal({
  orgId,
  fare,
  onLukk,
  onEndret,
}: {
  orgId: string;
  fare: Fare;
  onLukk: () => void;
  onEndret: () => Promise<void>;
}) {
  const [tittel, setTittel] = useState(fare.title);
  const [kategori, setKategori] = useState(fare.category ?? "");
  const [beskrivelse, setBeskrivelse] = useState(fare.description ?? "");
  const [s, setS] = useState(String(fare.probability));
  const [k, setK] = useState(String(fare.consequence));
  const [eier, setEier] = useState(fare.owner ?? "");
  const [status, setStatus] = useState(fare.status);
  const [bekreftSlett, setBekreftSlett] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [lagrer, setLagrer] = useState(false);

  // Tiltakene lagres UMIDDELBART — de er egne rader, ikke del av fare-skjemaet.
  const [tiltak, setTiltak] = useState(fare.tiltak);
  const [nyttTiltak, setNyttTiltak] = useState("");

  const risikotall = Number(s) * Number(k);
  const niva = risikotall >= 15 ? "danger" : risikotall >= 8 ? "warn" : "ok";

  async function lagre() {
    setLagrer(true);
    setFeil(null);
    try {
      await internkontroll.endreFare(orgId, fare.id, {
        title: tittel.trim(),
        category: kategori.trim() || null,
        description: beskrivelse.trim() || null,
        probability: Number(s),
        consequence: Number(k),
        owner: eier.trim() || null,
        status,
      });
      await onEndret();
      onLukk();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
    } finally {
      setLagrer(false);
    }
  }

  async function leggTilTiltak() {
    const t = nyttTiltak.trim();
    if (!t) return;
    try {
      await internkontroll.nyttTiltak(orgId, { hazardId: fare.id, title: t });
      setNyttTiltak("");
      await oppfriskTiltak();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke legge til tiltaket");
    }
  }

  async function settTiltak(id: string, felt: "status" | "dueDate" | "owner", verdi: string) {
    try {
      await internkontroll.endreTiltak(orgId, id, { [felt]: verdi || null });
      await oppfriskTiltak();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre tiltaket");
    }
  }

  async function fjernTiltak(id: string) {
    try {
      await internkontroll.slettTiltak(orgId, id);
      await oppfriskTiltak();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke fjerne tiltaket");
    }
  }

  async function oppfriskTiltak() {
    await onEndret();
    const farer = await internkontroll.farer(orgId);
    setTiltak(farer.find((f) => f.id === fare.id)?.tiltak ?? []);
  }

  if (bekreftSlett) {
    return (
      <Modal tittel="Slett fare" onLukk={onLukk} bredde={420}>
        <Feil melding={feil} />
        <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, margin: 0 }}>
          Slett <strong>{fare.title}</strong>? Tiltakene slettes også. En fare som er
          håndtert bør heller settes til «Under kontroll» — historikken viser da at den ER
          vurdert.
        </p>
        <Knapperad
          onAvbryt={() => setBekreftSlett(false)}
          avbrytEtikett="Tilbake"
          sendEtikett="Slett"
          farlig
          onSend={() => {
            void (async () => {
              try {
                await internkontroll.slettFare(orgId, fare.id);
                await onEndret();
                onLukk();
              } catch (e) {
                setFeil(e instanceof Error ? e.message : "Kunne ikke slette");
              }
            })();
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal tittel="Fare og tiltak" onLukk={onLukk} bredde={620}>
      <Feil melding={feil} />

      <Tekstfelt etikett="Hva kan gå galt? *" verdi={tittel} onEndre={setTittel} />
      <div className="field-row">
        <Tekstfelt etikett="Område" verdi={kategori} onEndre={setKategori} plassholder="Brannvern, el-sikkerhet …" />
        <Tekstfelt etikett="Ansvarlig" verdi={eier} onEndre={setEier} plassholder="Navn" />
      </div>
      <Tekstomrade etikett="Beskrivelse" verdi={beskrivelse} onEndre={setBeskrivelse} />

      <div className="field-row">
        <Nedtrekk
          etikett="Sannsynlighet"
          verdi={s}
          onEndre={setS}
          valg={SANNSYNLIGHET.map((e, i) => ({ verdi: String(i + 1), etikett: `${i + 1} — ${e}` }))}
        />
        <Nedtrekk
          etikett="Konsekvens"
          verdi={k}
          onEndre={setK}
          valg={KONSEKVENS.map((e, i) => ({ verdi: String(i + 1), etikett: `${i + 1} — ${e}` }))}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span className={`badge ${niva}`}>Risiko {risikotall}</span>
        <span className="field-note" style={{ margin: 0 }}>
          Sannsynlighet × konsekvens. Rødt (15+) krever tiltak; gult (8–14) bør ha en plan.
        </span>
      </div>

      <Nedtrekk etikett="Status" verdi={status} onEndre={setStatus} valg={FARESTATUS} />

      {/* ── Tiltakene ── */}
      <div className="field">
        <span className="field-label">Tiltak</span>
        {tiltak.length === 0 && (
          <div className="field-note">Ingen tiltak registrert{risikotall >= 8 ? " — denne bør ha minst ett." : "."}</div>
        )}
        {tiltak.map((t) => (
          <div key={t.id} className="tiltak-rad">
            <span className="list-tittel" style={{ flex: 1, minWidth: 0 }}>{t.title}</span>
            <select
              className="select tiltak-felt"
              aria-label={`Status for ${t.title}`}
              value={t.status}
              onChange={(e) => void settTiltak(t.id, "status", e.target.value)}
            >
              {TILTAKSSTATUS.map((v) => (
                <option key={v.verdi} value={v.verdi}>{v.etikett}</option>
              ))}
            </select>
            <input
              className="input tiltak-felt"
              type="date"
              aria-label={`Frist for ${t.title}`}
              value={t.dueDate ?? ""}
              onChange={(e) => void settTiltak(t.id, "dueDate", e.target.value)}
            />
            <button className="btn btn-ghost" style={{ color: "var(--muted)", padding: "5px 9px" }} onClick={() => void fjernTiltak(t.id)}>
              ✕
            </button>
          </div>
        ))}
        <form
          style={{ display: "flex", gap: "8px", marginTop: "8px" }}
          onSubmit={(e) => {
            e.preventDefault();
            void leggTilTiltak();
          }}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Nytt tiltak — hva skal gjøres?"
            aria-label="Nytt tiltak"
            value={nyttTiltak}
            onChange={(e) => setNyttTiltak(e.target.value)}
          />
          <button className="btn btn-ghost" disabled={!nyttTiltak.trim()}>
            ＋
          </button>
        </form>
      </div>

      <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
        <button className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={() => setBekreftSlett(true)}>
          Slett fare …
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={onLukk}>
          Avbryt
        </button>
        <button className="btn btn-primary" onClick={() => void lagre()} disabled={lagrer || !tittel.trim()}>
          {lagrer ? "Lagrer …" : "Lagre"}
        </button>
      </div>
    </Modal>
  );
}

/** Henter risikovurderingsmalen inn som lagets farer. */
function SeedModal({
  orgId,
  onLukk,
  onLagret,
}: {
  orgId: string;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [maler, setMaler] = useState<HmsMal[] | null>(null);
  const [valgt, setValgt] = useState("");
  const [resultat, setResultat] = useState<{ opprettet: number; hoppetOver: number } | null>(null);
  const { sender, feil, send } = useSending(() => {});

  useEffect(() => {
    internkontroll
      .maler(orgId, "risikovurdering")
      .then((m) => {
        setMaler(m);
        setValgt(m.find((x) => x.isDefault)?.id ?? m[0]?.id ?? "");
      })
      .catch(() => setMaler([]));
  }, [orgId]);

  return (
    <Modal tittel="Hent standard fareområder" onLukk={onLukk} bredde={460}>
      {resultat ? (
        <>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, margin: 0 }}>
            Hentet <b>{resultat.opprettet}</b> fareområde{resultat.opprettet === 1 ? "" : "r"}
            {resultat.hoppetOver > 0 && <> — {resultat.hoppetOver} fantes fra før</>}. Alle er
            satt til middels sannsynlighet og konsekvens: gå gjennom og juster, det er selve
            vurderingen.
          </p>
          <Knapperad onAvbryt={onLukk} avbrytEtikett="Lukk" sendEtikett="Ferdig" onSend={onLukk} />
        </>
      ) : (
        <>
          <Feil melding={feil} />
          {maler === null ? (
            <Tom tekst="Henter maler …" />
          ) : maler.length === 0 ? (
            <Tom tekst="Ingen risikovurderingsmal er lagt inn i plattformpanelet ennå." />
          ) : (
            <>
              <Nedtrekk
                etikett="Mal"
                verdi={valgt}
                onEndre={setValgt}
                valg={maler.map((m) => ({ verdi: m.id, etikett: m.isDefault ? `${m.name} (standard)` : m.name }))}
                notat="Malens fareområder kopieres inn som lagets egne — dere redigerer dem fritt etterpå. Farer dere alt har, hoppes over."
              />
              <Knapperad
                onAvbryt={onLukk}
                sendEtikett="Hent fareområder"
                sender={sender}
                deaktivert={!valgt}
                onSend={() =>
                  void send(async () => {
                    setResultat(await internkontroll.seedFarer(orgId, valgt));
                    await onLagret();
                  })
                }
              />
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function Vernerunder() {
  const router = useRouter();
  const { data, feil, laster, last, orgId } = useOrgData((o) => internkontroll.runder(o));
  const [nyRunde, setNyRunde] = useState(false);
  const liste = data ?? [];

  return (
    <>
      <Feil melding={feil} />
      <Kort
        tittel="Vernerunder"
        handling={
          <button className="btn btn-ghost" onClick={() => setNyRunde(true)}>
            ＋ Ny vernerunde
          </button>
        }
      >
        {laster ? (
          <Tom tekst="Henter …" />
        ) : liste.length === 0 ? (
          <Tom tekst="Ingen vernerunder ennå. Den første opprettes fra en HMS-mal — deretter kopierer hver runde lagets egen punktliste." />
        ) : (
          liste.map((r) => (
            <Rad
              key={r.id}
              onClick={() => router.push(`/internkontroll/vernerunde/${r.id}`)}
              tittel={r.title}
              meta={[
                r.roundDate && `startet ${dato(r.roundDate)}`,
                r.dueDate && r.status !== "completed" && `frist ${dato(r.dueDate)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              hoyre={
                // En fullført runde er låst — den dokumenterer hva som ble observert den dagen.
                <span className={`badge ${r.status === "completed" ? "ok" : "muted"}`}>
                  {r.status === "completed" ? "Fullført og låst" : "Planlagt"}
                </span>
              }
            />
          ))
        )}
      </Kort>

      {nyRunde && orgId && (
        <NyRundeModal
          orgId={orgId}
          forsteRunde={liste.length === 0}
          onLukk={() => setNyRunde(false)}
          onOpprettet={async (id) => {
            await last();
            router.push(`/internkontroll/vernerunde/${id}`);
          }}
        />
      )}
    </>
  );
}

/**
 * Ny vernerunde. Første gang velges HMS-malen som gir sjekklista; senere runder kopierer
 * lagets forrige punktliste — tilpasningene deres blir med videre av seg selv.
 */
function NyRundeModal({
  orgId,
  forsteRunde,
  onLukk,
  onOpprettet,
}: {
  orgId: string;
  forsteRunde: boolean;
  onLukk: () => void;
  onOpprettet: (id: string) => Promise<void>;
}) {
  const { aktivOrg } = useOkt();
  const halvaar = new Date().getMonth() < 6 ? "vår" : "høst";
  const [tittel, setTittel] = useState(`Vernerunde ${halvaar} ${new Date().getFullYear()}`);
  const [rundeDato, setRundeDato] = useState(new Date().toISOString().slice(0, 10));
  // Bransjepraksis: innen 1. juni og 1. desember.
  const [frist, setFrist] = useState(
    `${new Date().getFullYear()}-${new Date().getMonth() < 6 ? "06-01" : "12-01"}`,
  );
  const [maler, setMaler] = useState<HmsMal[] | null>(null);
  const [malId, setMalId] = useState("");
  const { sender, feil, send } = useSending(() => {});

  useEffect(() => {
    if (!forsteRunde) return;
    internkontroll
      .maler(orgId, "vernerunde")
      .then((m) => {
        setMaler(m);
        setMalId(m.find((x) => x.isDefault)?.id ?? m[0]?.id ?? "");
      })
      .catch(() => setMaler([]));
  }, [orgId, forsteRunde]);

  return (
    <Modal tittel="Ny vernerunde" onLukk={onLukk} bredde={480}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(async () => {
            const ny = await internkontroll.nyRunde(orgId, {
              title: tittel.trim(),
              roundDate: rundeDato || null,
              dueDate: frist || null,
              templateId: forsteRunde ? malId || null : null,
            });
            await onOpprettet(ny.id);
          });
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Navn *" verdi={tittel} onEndre={setTittel} />
        <div className="field-row">
          <Tekstfelt etikett="Startdato" type="date" verdi={rundeDato} onEndre={setRundeDato} />
          <Tekstfelt
            etikett="Frist"
            type="date"
            verdi={frist}
            onEndre={setFrist}
            notat="Bransjepraksis: innen 1. juni og 1. desember."
          />
        </div>

        {forsteRunde ? (
          maler === null ? (
            <Tom tekst="Henter maler …" />
          ) : maler.length === 0 ? (
            <div className="field-note">
              Ingen vernerundemal er lagt inn i plattformpanelet — runden starter uten
              punkter, og dere legger til egne.
            </div>
          ) : (
            <Nedtrekk
              etikett="Sjekkliste fra mal"
              verdi={malId}
              onEndre={setMalId}
              valg={maler.map((m) => ({ verdi: m.id, etikett: m.isDefault ? `${m.name} (standard)` : m.name }))}
              notat="Punktene kopieres inn og blir lagets egne — legg til og fjern fritt. Senere runder kopierer lagets liste."
            />
          )
        ) : (
          <div className="field-note">
            Sjekklista kopieres fra forrige runde — tilpasningene deres er med videre.
            {aktivOrg ? ` Runden gjelder ${aktivOrg.name}.` : ""}
          </div>
        )}

        <Knapperad onAvbryt={onLukk} sendEtikett="Opprett runde" sender={sender} deaktivert={!tittel.trim()} />
      </form>
    </Modal>
  );
}

function Ansvar() {
  const { data, feil, laster } = useOrgData((o) => internkontroll.ansvar(o));
  const liste = data ?? [];

  return (
    <>
      <Feil melding={feil} />
      <Kort tittel="Ansvarsfordeling (§ 5 pkt. 5)">
        {laster ? (
          <Tom tekst="Henter …" />
        ) : (
          // Alle områdene vises, også de tomme — et manglende område er nettopp det
          // kunden skal se at mangler.
          liste.map((a) => (
            <Rad
              key={a.area}
              tittel={OMRADE[a.area] ?? a.area}
              meta={a.note ?? undefined}
              hoyre={
                a.personName ? (
                  <span className="badge ok">{a.personName}</span>
                ) : (
                  <span className="badge warn">Ikke fordelt</span>
                )
              }
            />
          ))
        )}
      </Kort>
    </>
  );
}

export default function Internkontroll() {
  const [fane, setFane] = useState<"oversikt" | "risiko" | "runder" | "ansvar">("oversikt");
  return (
    <Layout
      tittel="Internkontroll"
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={[
            { nokkel: "oversikt", etikett: "Oversikt" },
            { nokkel: "risiko", etikett: "Risikovurdering" },
            { nokkel: "runder", etikett: "Vernerunder" },
            { nokkel: "ansvar", etikett: "Ansvar" },
          ]}
        />
      }
    >
      <div className="page-content">
        {fane === "oversikt" && <Oversikt />}
        {fane === "risiko" && <Risiko />}
        {fane === "runder" && <Vernerunder />}
        {fane === "ansvar" && <Ansvar />}
      </div>
    </Layout>
  );
}
