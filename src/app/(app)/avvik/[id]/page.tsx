"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import Layout from "@/components/Layout";
import { Feil, Kort, Tom, dato, initialer, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { avvik, brukere, enheter, leverandorer, type AvvikDetalj } from "@/lib/klient";
import { STATUS_VISNING, lesKategorier } from "@/lib/avvikkategorier";

const ALVORLIGHET = [
  { verdi: "", etikett: "Ikke vurdert" },
  { verdi: "lav", etikett: "Lav" },
  { verdi: "middels", etikett: "Middels" },
  { verdi: "akutt", etikett: "Akutt" },
];

const STEG = [
  { status: "ny", etikett: "Meldt" },
  { status: "under_behandling", etikett: "Under behandling" },
  { status: "lukket", etikett: "Løst og lukket" },
];

/**
 * Avviksdetalj — dokumentasjonskjeden.
 *
 * Beskrivelse → behandling → løsning er det som havner i internkontrollpermen (§ 5 pkt. 7),
 * og seksjonene er nummerert fordi rekkefølgen ER dokumentasjonen. Journalen er append-only:
 * innlegg kan verken endres eller slettes, ellers er kjeden ikke troverdig.
 *
 * Et lukket avvik kan ikke behandles videre, men KATEGORI og ALVORLIGHET kan fortsatt
 * rettes. Uten det ville statistikken arvet en hastig førstekategorisering for alltid.
 */
export default function Avviksdetalj({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => avvik.hent(o, id), [id]);
  const [lukker, setLukker] = useState(false);
  const [redigerer, setRedigerer] = useState(false);

  if (laster || !data) {
    return (
      <Layout tittel="Avvik">
        <div className="page-content">
          <Feil melding={feil} />
          {!feil && <Tom tekst="Henter …" />}
        </div>
      </Layout>
    );
  }

  const lukket = data.status === "lukket";

  return (
    <Layout
      tittel={`#${String(data.number ?? 0).padStart(3, "0")} ${data.title}`}
      handlinger={
        lukket ? (
          <span className="badge ok">Løst og lukket</span>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={() => setRedigerer(true)}>
              Rediger
            </button>
            <button className="btn btn-primary" onClick={() => setLukker(true)}>
              Lukk avvik
            </button>
          </>
        )
      }
      aside={
        <Detaljer
          avvik={data}
          orgId={orgId!}
          lukket={lukket}
          onEndret={last}
          onFeil={setFeil}
        />
      }
    >
      <div className="page-content">
        <Feil melding={feil} />

        <Link href="/avvik" className="tilbake-lenke">
          ← Alle avvik
        </Link>

        <Stegviser
          status={data.status}
          meldt={data.reportedAt}
          // Når behandlingen startet: datoen på FØRSTE innlegg. Status settes av nettopp
          // det å skrive et innlegg, så de to kan ikke komme ut av takt.
          behandletFra={data.behandlinger[0]?.createdAt ?? null}
          lukket={data.resolvedAt}
        />

        {/* ── 1 · HVA ER AVVIKET ── */}
        <Kort
          tittel="1 · Hva er avviket"
          handling={
            !lukket && <span className="field-note">Låses ikke, men endringer spores</span>
          }
        >
          <div style={{ padding: "14px 20px" }}>
            <div
              style={{
                fontSize: "var(--fs-sm)",
                lineHeight: 1.65,
                whiteSpace: "pre-wrap",
                color: data.description ? undefined : "var(--muted)",
              }}
            >
              {data.description || "Ingen beskrivelse."}
            </div>
          </div>

          {lukket && (
            <div className="lukket-blokk">
              <Meta etikett="Lukket av">{data.resolvedBy ?? "—"}</Meta>
              <Meta etikett="Lukket dato">{dato(data.resolvedAt)}</Meta>
              {data.resolutionNotes && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <Meta etikett="Løsning">{data.resolutionNotes}</Meta>
                </div>
              )}
            </div>
          )}
        </Kort>

        {/* ── 2 · BEHANDLING ── */}
        <Kort
          tittel="2 · Behandling — hva gjør vi med saken"
          handling={
            <span className="field-note">
              {data.behandlinger.length} {data.behandlinger.length === 1 ? "hendelse" : "hendelser"}
            </span>
          }
        >
          {data.behandlinger.map((b) => (
            <div key={b.id} className="behandling-rad">
              <span className="avatar liten">{initialer(b.createdBy)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="list-meta">
                  <strong style={{ color: "var(--text)" }}>{b.createdBy}</strong> · {dato(b.createdAt)}
                </div>
                <div
                  style={{
                    fontSize: "var(--fs-sm)",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    marginTop: "3px",
                  }}
                >
                  {b.text}
                </div>
              </div>
            </div>
          ))}

          {/* Skrivefeltet står DER samtalen er, ikke bak en knapp i toppen. Å registrere hva
              som er gjort er den vanligste handlingen på siden — den skal ikke koste en
              modal, og man skal se de forrige innleggene mens man skriver. */}
          {!lukket && (
            <SkrivBehandling orgId={orgId!} devId={id} onLagret={last} onFeil={setFeil} />
          )}
        </Kort>

        {/* ── HISTORIKK ── */}
        <Kort tittel="Historikk">
          {data.logg.length === 0 ? (
            <Tom tekst="Ingen hendelser." />
          ) : (
            data.logg.map((l) => (
              <div key={l.id} className="logg-rad">
                <div style={{ fontSize: "var(--fs-sm)" }}>{l.event}</div>
                <div className="list-meta">
                  {l.changedBy} · {dato(l.changedAt)}
                </div>
              </div>
            ))
          )}
        </Kort>
      </div>

      {lukker && (
        <LukkAvvik orgId={orgId!} devId={id} onLukk={() => setLukker(false)} onLagret={last} />
      )}
      {redigerer && (
        <RedigerAvvik
          orgId={orgId!}
          avvik={data}
          onLukk={() => setRedigerer(false)}
          onLagret={last}
        />
      )}
    </Layout>
  );
}

/**
 * Meldt → Under behandling → Løst og lukket.
 *
 * Viser hvor saken står i flyten. Status settes ALDRI direkte herfra: lukking krever en
 * løsningsbeskrivelse, og det kravet ville vært trivielt å omgå med en statusvelger.
 */
function Stegviser({
  status,
  meldt,
  behandletFra,
  lukket,
}: {
  status: string;
  meldt: string;
  behandletFra: string | null;
  lukket: string | null;
}) {
  const naa = STEG.findIndex((s) => s.status === status);
  // Datoen under hvert steg er poenget med visningen: «Under behandling» sier lite, «siden
  // 9. august» sier om saken står stille.
  const datoer = [meldt, behandletFra, lukket];

  return (
    <div className="stegviser">
      {STEG.map((s, i) => {
        const tilstand = i < naa ? " passert" : i === naa ? " aktiv" : "";
        const d = datoer[i];
        return (
          <div key={s.status} className={`steg${tilstand}`}>
            <span className="steg-prikk" aria-hidden />
            <span style={{ minWidth: 0 }}>
              <span className="steg-tekst">{s.etikett}</span>
              {d && (
                <span className="steg-dato">
                  {i === naa && i > 0 ? `siden ${dato(d)}` : dato(d)}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Meta({ etikett, children }: { etikett: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="field-label">{etikett}</div>
      <div style={{ fontSize: "var(--fs-sm)", marginTop: "2px" }}>{children}</div>
    </div>
  );
}

/**
 * Høyremenyen. Kategori og alvorlighet lagres UMIDDELBART ved endring, også på et lukket
 * avvik — de er merkelapper for statistikk, ikke del av den låste historikken.
 */
function Detaljer({
  avvik: a,
  orgId,
  lukket,
  onEndret,
  onFeil,
}: {
  avvik: AvvikDetalj;
  orgId: string;
  lukket: boolean;
  onEndret: () => Promise<void>;
  onFeil: (m: string) => void;
}) {
  const [kategorier, setKategorier] = useState(lesKategorier(null));
  useEffect(() => {
    avvik
      .liste(orgId, { side: 1 })
      .then((r) => setKategorier(lesKategorier(r.kategorier)))
      .catch(() => {});
  }, [orgId]);

  async function settFelt(felt: "category" | "severity", verdi: string) {
    try {
      await avvik.endre(orgId, a.id, { [felt]: verdi || null });
      await onEndret();
    } catch (e) {
      onFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
    }
  }

  const st = STATUS_VISNING[a.status] ?? STATUS_VISNING.ny!;

  return (
    <Kort tittel="Detaljer">
      <div className="detaljer-liste">
        <Meta etikett="Status">
          <span className={`badge ${st.merke}`}>{st.etikett}</span>
        </Meta>

        <div className="field">
          <label className="field-label" htmlFor="kategori">
            Kategori
          </label>
          <select
            id="kategori"
            className="input"
            value={a.category ?? ""}
            onChange={(e) => void settFelt("category", e.target.value)}
          >
            <option value="">Ingen kategori</option>
            {kategorier.map((k) => (
              <option key={k.verdi} value={k.verdi}>
                {k.etikett}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="alvorlighet">
            Alvorlighet
          </label>
          <select
            id="alvorlighet"
            className="input"
            value={a.severity ?? ""}
            onChange={(e) => void settFelt("severity", e.target.value)}
          >
            {ALVORLIGHET.map((v) => (
              <option key={v.verdi} value={v.verdi}>
                {v.etikett}
              </option>
            ))}
          </select>
          {lukket && (
            <div className="field-note">
              Kan endres også etter lukking — endringen føres i historikken. Ellers ville
              statistikken arvet en hastig førstekategorisering for alltid.
            </div>
          )}
        </div>

        <Meta etikett="Meldt av">{a.reportedBy}</Meta>
        <Meta etikett="Meldt dato">{dato(a.reportedAt)}</Meta>
        <Meta etikett="Ansvarlig">{a.assignedTo ?? "Ikke tildelt"}</Meta>
        <Meta etikett="Leverandør">{a.vendorNavn ?? "—"}</Meta>
        <Meta etikett="Sted">{a.unitNavn ?? "—"}</Meta>
        <Meta etikett="Frist">{a.dueDate ? dato(a.dueDate) : "—"}</Meta>
        {a.taskTittel && <Meta etikett="Knyttet oppgave">{a.taskTittel}</Meta>}
      </div>
    </Kort>
  );
}

/** Tittel, beskrivelse og koblingene. Kategori og alvorlighet ligger i høyremenyen. */
function RedigerAvvik({
  orgId,
  avvik: a,
  onLukk,
  onLagret,
}: {
  orgId: string;
  avvik: AvvikDetalj;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [tittel, setTittel] = useState(a.title);
  const [beskrivelse, setBeskrivelse] = useState(a.description ?? "");
  const [frist, setFrist] = useState(a.dueDate ?? "");
  const [ansvarlig, setAnsvarlig] = useState(a.responsibleUserId ?? "");
  const [vendorId, setVendorId] = useState(a.vendorId ?? "");
  const [unitId, setUnitId] = useState(a.unitId ?? "");
  const [folk, setFolk] = useState<Array<{ id: string; navn: string }>>([]);
  const [firmaer, setFirmaer] = useState<Array<{ id: string; navn: string }>>([]);
  const [steder, setSteder] = useState<Array<{ id: string; navn: string }>>([]);

  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  useEffect(() => {
    void brukere.liste(orgId).then((b) => setFolk(b.map((u) => ({ id: u.id, navn: u.name })))).catch(() => {});
    void leverandorer.liste(orgId).then((v) => setFirmaer(v.map((f) => ({ id: f.id, navn: f.name })))).catch(() => {});
    void enheter.liste(orgId).then((e) => setSteder(e.map((u) => ({ id: u.id, navn: u.navn ?? u.andelsnr ?? u.id })))).catch(() => {});
  }, [orgId]);

  return (
    <Modal tittel="Rediger avvik" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            avvik.endre(orgId, a.id, {
              title: tittel.trim(),
              description: beskrivelse.trim() || null,
              dueDate: frist || null,
              responsibleUserId: ansvarlig || null,
              vendorId: vendorId || null,
              unitId: unitId || null,
            }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Tittel" verdi={tittel} onEndre={setTittel} />
        <Tekstomrade etikett="Beskrivelse" verdi={beskrivelse} onEndre={setBeskrivelse} />
        <Tekstfelt etikett="Frist for tiltak" type="date" verdi={frist} onEndre={setFrist} />

        <div className="field">
          <label className="field-label" htmlFor="ansvarlig">Ansvarlig</label>
          <select id="ansvarlig" className="input" value={ansvarlig} onChange={(e) => setAnsvarlig(e.target.value)}>
            <option value="">Ikke tildelt</option>
            {folk.map((u) => <option key={u.id} value={u.id}>{u.navn}</option>)}
          </select>
          <div className="field-note">Den ansvarlige får varsel når saken endres.</div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="lev">Leverandør involvert</label>
          <select id="lev" className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Ingen leverandør</option>
            {firmaer.map((f) => <option key={f.id} value={f.id}>{f.navn}</option>)}
          </select>
        </div>

        {steder.length > 0 && (
          <div className="field">
            <label className="field-label" htmlFor="sted">Sted</label>
            <select id="sted" className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">Ingen bestemt enhet</option>
              {steder.map((u) => <option key={u.id} value={u.id}>{u.navn}</option>)}
            </select>
          </div>
        )}

        <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={!tittel.trim()} />
      </form>
    </Modal>
  );
}

/**
 * Skrivefeltet i behandlingsjournalen.
 *
 * Innlegget er append-only: det kan verken endres eller slettes etterpå. Derfor står
 * påminnelsen om det RETT under feltet — ikke i en hjelpetekst man leser etter at man har
 * sendt.
 */
function SkrivBehandling({
  orgId,
  devId,
  onLagret,
  onFeil,
}: {
  orgId: string;
  devId: string;
  onLagret: () => Promise<void>;
  onFeil: (m: string) => void;
}) {
  const [tekst, setTekst] = useState("");
  const [sender, setSender] = useState(false);

  async function registrer() {
    const rent = tekst.trim();
    if (!rent || sender) return;
    setSender(true);
    try {
      await avvik.behandle(orgId, devId, { text: rent });
      setTekst("");
      await onLagret();
    } catch (e) {
      onFeil(e instanceof Error ? e.message : "Kunne ikke lagre innlegget");
    } finally {
      setSender(false);
    }
  }

  return (
    <form
      className="behandling-skriv"
      onSubmit={(e) => {
        e.preventDefault();
        void registrer();
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <textarea
          className="input"
          rows={2}
          value={tekst}
          aria-label="Hva er gjort eller avtalt?"
          placeholder="Skriv hva som er gjort eller avtalt …"
          onChange={(e) => setTekst(e.target.value)}
          // Ctrl/Cmd+Enter sender, som i de fleste kommentarfelt. Enter alene gir linjeskift:
          // et behandlingsinnlegg er ofte flere setninger.
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void registrer();
            }
          }}
        />
        <div className="field-note" style={{ marginTop: "6px" }}>
          Innlegget kan ikke endres eller slettes etterpå — journalen er dokumentasjon, og den
          er bare troverdig hvis den står som den ble skrevet.
        </div>
      </div>
      <button className="btn btn-primary" disabled={sender || !tekst.trim()}>
        {sender ? "Lagrer …" : "Registrer"}
      </button>
    </form>
  );
}

function LukkAvvik({
  orgId,
  devId,
  onLukk,
  onLagret,
}: {
  orgId: string;
  devId: string;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [av, setAv] = useState("");
  const [losning, setLosning] = useState("");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Lukk avvik" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            avvik.lukk(orgId, devId, { resolvedBy: av.trim(), resolutionNotes: losning.trim() }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstomrade
          etikett="Løsning"
          verdi={losning}
          onEndre={setLosning}
          notat="Påkrevd. Et avvik uten løsningsbeskrivelse dokumenterer ingenting — det er hele grunnen til at lukking er en egen handling og ikke bare en statusendring."
        />
        <Tekstfelt etikett="Lukket av" verdi={av} onEndre={setAv} />
        <div className="field-note">
          Et lukket avvik kan ikke behandles videre. Kategori og alvorlighet kan fortsatt
          rettes.
        </div>
        <Knapperad
          onAvbryt={onLukk}
          sendEtikett="Lukk avvik"
          sender={sender}
          deaktivert={!av.trim() || !losning.trim()}
        />
      </form>
    </Modal>
  );
}
