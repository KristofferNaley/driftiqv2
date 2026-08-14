"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, Plus } from "lucide-react";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { Feil, Tom, dato, initialer, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { avvik as avvikKlient, brukere, internkontroll, type Rundepunkt } from "@/lib/klient";

/**
 * Vernerunde-gjennomføringen — bygget etter `mockups/vernerunde-mockup.html`: deltakerne
 * som chips øverst, klebrig fremdriftslinje, punktene som kort med tre store valgknapper,
 * avviksskjemaet INNE i kortet, og en bunnlinje som følger med. Runden gås med telefonen
 * i hånda; alt lagres fortløpende.
 *
 * ## Trestatus, ikke avkryssing
 *
 * Per punkt: OK / Avvik / Ikke aktuelt. En avkryssing kunne ikke skille «i orden» fra
 * «ikke sjekket» fra «finnes ikke hos oss» — og det er den forskjellen som er
 * dokumentasjonen. Ubesvart (ingen av de tre) er også et svar: det runden ikke rakk.
 *
 * ## Optimistisk avkryssing
 *
 * Et klikk endrer punktet i hånden umiddelbart (`setData`), API-kallet går i bakgrunnen —
 * å vise lasteskjerm for hvert kryss føltes som at hele siden lastet på nytt. Feiler
 * kallet, hentes sannheten på nytt.
 *
 * ## «Avvik» åpner et EKTE avviksskjema i kortet
 *
 * Avviket opprettes i avviksmodulen, koblet til punktet via roundId/roundItemId, og følges
 * opp der — runden er der det ble OPPDAGET, ikke der det behandles.
 *
 * ## En fullført runde er låst
 *
 * Den dokumenterer hva som ble observert den dagen. API-et nekter uansett; UI-et gjemmer
 * knappene fordi en knapp som alltid feiler er verre enn ingen knapp.
 */
export default function Vernerunde({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { aktivOrg } = useOkt();
  const { data, setData, feil, setFeil, last, orgId } = useOrgData(
    (o) => internkontroll.hentRunde(o, id),
    [id],
  );
  const [apentSkjema, setApentSkjema] = useState<string | null>(null);
  const [nyttPunkt, setNyttPunkt] = useState(false);
  const [nyDeltaker, setNyDeltaker] = useState(false);
  const [bekreftFullfor, setBekreftFullfor] = useState(false);

  async function settStatus(punkt: Rundepunkt, status: string) {
    if (!orgId) return;
    // Samme knapp igjen = nullstill til ubesvart. Feilklikk skal kunne angres.
    const ny = punkt.status === status ? null : status;
    setData((d) =>
      d ? { ...d, punkter: d.punkter.map((p) => (p.id === punkt.id ? { ...p, status: ny } : p)) } : d,
    );
    setApentSkjema(ny === "avvik" ? punkt.id : null);
    try {
      await internkontroll.kryssAv(orgId, id, punkt.id, { status: ny });
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
      await last();
    }
  }

  async function lagreNotat(punktId: string, notat: string) {
    if (!orgId) return;
    const verdi = notat.trim() || null;
    setData((d) =>
      d ? { ...d, punkter: d.punkter.map((p) => (p.id === punktId ? { ...p, notes: verdi } : p)) } : d,
    );
    try {
      await internkontroll.kryssAv(orgId, id, punktId, { notes: verdi });
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre merknaden");
      await last();
    }
  }

  async function fjernPunkt(punktId: string) {
    if (!orgId) return;
    try {
      await internkontroll.slettPunkt(orgId, id, punktId);
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke fjerne punktet");
    }
  }

  async function fullfor() {
    if (!orgId) return;
    try {
      await internkontroll.fullfor(orgId, id);
      setBekreftFullfor(false);
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke fullføre runden");
    }
  }

  // Punktene gruppert på seksjon, i innsettingsrekkefølge — samme rekkefølge som sjekklista.
  const seksjoner = useMemo(() => {
    const kart = new Map<string, Rundepunkt[]>();
    for (const p of data?.punkter ?? []) {
      const n = p.section ?? "Annet";
      if (!kart.has(n)) kart.set(n, []);
      kart.get(n)!.push(p);
    }
    return [...kart.entries()];
  }, [data]);

  if (!data) {
    return (
      <Layout tittel="Vernerunde">
        <div className="page-content">
          <Feil melding={feil} />
          {!feil && <Tom tekst="Henter …" />}
        </div>
      </Layout>
    );
  }

  const laast = data.status === "completed";
  const besvarte = data.punkter.filter((p) => p.status).length;
  const antallOk = data.punkter.filter((p) => p.status === "ok").length;
  const antallAvvik = data.punkter.filter((p) => p.status === "avvik").length;
  const ubesvarte = data.punkter.length - besvarte;
  const avvikPerPunkt = new Map(data.avvik.filter((a) => a.roundItemId).map((a) => [a.roundItemId!, a]));
  const avvikUtenMelding = data.punkter.filter(
    (p) => p.status === "avvik" && !avvikPerPunkt.has(p.id),
  ).length;

  return (
    <Layout
      tittel={data.title}
      handlinger={
        laast && (
          <>
            {/* Rapporten er utskriften: siden er ren dokumentasjon når runden er låst,
                og print-CSS-en fjerner alt som hører til skjermen. */}
            <button className="btn btn-ghost" onClick={() => window.print()}>
              Skriv ut rapport
            </button>
            <span className="badge ok">
              <Lock size={13} strokeWidth={2.2} aria-hidden /> Fullført og låst
            </span>
          </>
        )
      }
    >
      <div className="page-content">
        <Link href="/internkontroll" className="list-meta print-skjul" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Internkontroll
        </Link>

        <Feil melding={feil} />

        {/* Rapporthodet — finnes KUN på papiret. Skjermen har tittelen i toppbaren og
            deltakerne som chips; utskriften trenger dem samlet øverst som en rapport. */}
        <div className="vr-print-hode">
          <div className="vr-print-tittel">{data.title}</div>
          <div className="vr-print-meta">
            {aktivOrg?.name}
            {data.roundDate && <> · befaring {dato(data.roundDate)}</>}
            {data.deltakere.length > 0 && (
              <> · {data.deltakere.map((d) => (d.role ? `${d.name} (${d.role})` : d.name)).join(", ")}</>
            )}
          </div>
          <div className="vr-print-meta">
            {besvarte} av {data.punkter.length} punkter vurdert · {antallOk} i orden ·{" "}
            {antallAvvik} avvik{laast && " · Fullført og låst"}
          </div>
        </div>

        {/* Deltakerne øverst — befaringen er planlagt med folk og dato før punktene gås gjennom. */}
        <div className="vr-folk print-skjul">
          {data.deltakere.map((d) => (
            <span key={d.id} className="vr-person">
              <span className="vr-avatar" aria-hidden>{initialer(d.name)}</span>
              {d.name}
              {d.role && <span style={{ color: "var(--muted)" }}>· {d.role}</span>}
              {!laast && (
                <button
                  aria-label={`Fjern ${d.name}`}
                  onClick={() => {
                    if (!orgId) return;
                    void internkontroll
                      .slettDeltaker(orgId, id, d.id)
                      .then(last)
                      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke fjerne deltakeren"));
                  }}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          {!laast && (
            <button className="vr-leggtil" onClick={() => setNyDeltaker(true)}>
              + Deltaker
            </button>
          )}
          {data.deltakere.length === 0 && laast && (
            <span className="list-meta">Ingen deltakere registrert.</span>
          )}
        </div>

        {laast && (
          <div className="card print-skjul">
            <div className="card-body" style={{ color: "var(--muted)", fontSize: "var(--fs-sm)" }}>
              Runden er fullført og låst. Den dokumenterer hva som ble observert den dagen —
              kunne den redigeres i ettertid, dokumenterte den ingenting.
            </div>
          </div>
        )}

        {/* Klebrig fremdrift — brøken følger med nedover lista. */}
        <div className="vr-fremdrift print-skjul">
          <div className="vr-fremdrift-rad">
            <span>
              <b>{besvarte}</b> av <b>{data.punkter.length}</b> punkter vurdert
            </span>
            <span className="vr-tellinger">
              <span className="vr-telling ok"><i aria-hidden /> {antallOk} i orden</span>
              <span className="vr-telling avvik"><i aria-hidden /> {antallAvvik} avvik</span>
            </span>
          </div>
          <div className="tg-spor">
            <div
              className="tg-fyll"
              style={{
                width: `${data.punkter.length ? Math.round((100 * besvarte) / data.punkter.length) : 0}%`,
                ["--tg-farge" as string]: "var(--accent2)",
              }}
            />
          </div>
        </div>

        {seksjoner.length === 0 && (
          <Tom tekst="Ingen sjekkpunkter. Legg til egne under, eller opprett neste runde fra en sjekkliste." />
        )}

        {seksjoner.map(([navn, punkter]) => (
          <section key={navn}>
            <div className="vr-seksjon-hode">
              <h2>{navn}</h2>
              <span className="vr-n">
                {punkter.filter((p) => p.status).length}/{punkter.length}
              </span>
              <span className="vr-linje" aria-hidden />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
              {punkter.map((p) => (
                <Punktkort
                  key={p.id}
                  punkt={p}
                  laast={laast}
                  orgId={orgId!}
                  rundeId={id}
                  avvik={avvikPerPunkt.get(p.id) ?? null}
                  skjemaApent={apentSkjema === p.id}
                  onStatus={(s) => void settStatus(p, s)}
                  onNotat={(n) => void lagreNotat(p.id, n)}
                  onApneSkjema={() => setApentSkjema(p.id)}
                  onLukkSkjema={() => setApentSkjema(null)}
                  onOpprettet={last}
                  onFjern={() => void fjernPunkt(p.id)}
                />
              ))}
            </div>
          </section>
        ))}

        {!laast && (
          <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => setNyttPunkt(true)}>
            <Plus size={15} strokeWidth={2} aria-hidden /> Legg til sjekkpunkt
          </button>
        )}

        {/* Bunnlinja følger med — fullføringen skal være ett trykk unna hele veien. */}
        {!laast && (
          <div className="vr-bunn">
            <span className="vr-bunn-status">
              {besvarte === 0 ? (
                "Ingen punkter vurdert ennå"
              ) : (
                <>
                  <b>{besvarte}</b> av {data.punkter.length} vurdert · <b>{data.avvik.length}</b> avvik opprettet
                </>
              )}
            </span>
            <div className="vr-bunn-knapper">
              <Link href="/internkontroll" className="btn btn-ghost">
                Lagre og fortsett senere
              </Link>
              <button className="btn btn-primary" onClick={() => setBekreftFullfor(true)}>
                Fullfør vernerunde
              </button>
            </div>
          </div>
        )}
      </div>

      {nyttPunkt && orgId && (
        <NyttPunkt
          orgId={orgId}
          rundeId={id}
          seksjoner={seksjoner.map(([n]) => n)}
          onLukk={() => setNyttPunkt(false)}
          onLagret={last}
        />
      )}

      {nyDeltaker && orgId && (
        <NyDeltakerModal
          orgId={orgId}
          rundeId={id}
          deltakere={data.deltakere}
          onLukk={() => setNyDeltaker(false)}
          onEndret={last}
        />
      )}

      {bekreftFullfor && (
        <Modal tittel="Fullfør vernerunden" onLukk={() => setBekreftFullfor(false)} bredde={440}>
          <p className="list-meta" style={{ margin: "0 0 10px" }}>
            Rapporten arkiveres i internkontrollen, og avvikene følges opp videre i Avvik.
          </p>
          <div className="vr-sum">
            <div><span>Punkter i orden</span><span>{antallOk}</span></div>
            <div><span>Punkter med avvik</span><span>{antallAvvik}</span></div>
            <div><span>Ikke aktuelt</span><span>{data.punkter.filter((p) => p.status === "ikke_aktuelt").length}</span></div>
            <div><span>Avvik opprettet</span><span>{data.avvik.length}</span></div>
          </div>
          {ubesvarte > 0 && (
            <div className="field-note" style={{ marginTop: "10px" }}>
              {ubesvarte} {ubesvarte === 1 ? "punkt er ikke vurdert" : "punkter er ikke vurdert"} —
              {" "}de blir stående som «ikke sjekket» i dokumentasjonen. Runden låses og kan
              ikke gjenåpnes.
            </div>
          )}
          {avvikUtenMelding > 0 && (
            <div className="field-note" style={{ marginTop: "8px", color: "var(--warn)" }}>
              {avvikUtenMelding} {avvikUtenMelding === 1 ? "punkt" : "punkter"} er merket som
              avvik uten at avvik er opprettet — da blir det ikke fulgt opp i systemet.
            </div>
          )}
          <Knapperad
            onAvbryt={() => setBekreftFullfor(false)}
            sendEtikett="Fullfør og lås"
            onSend={() => void fullfor()}
          />
        </Modal>
      )}
    </Layout>
  );
}

const VALG = [
  { verdi: "ok", etikett: "I orden", klasse: "ok" },
  { verdi: "avvik", etikett: "Avvik", klasse: "avvik" },
  { verdi: "ikke_aktuelt", etikett: "Ikke aktuelt", klasse: "ia" },
];

/** Ett punktkort: trestatus, merknad, avviksskjema i kortet — og fjerning på ulåst runde. */
function Punktkort({
  punkt,
  laast,
  orgId,
  rundeId,
  avvik,
  skjemaApent,
  onStatus,
  onNotat,
  onApneSkjema,
  onLukkSkjema,
  onOpprettet,
  onFjern,
}: {
  punkt: Rundepunkt;
  laast: boolean;
  orgId: string;
  rundeId: string;
  avvik: { id: string; number: number | null; title: string; status: string } | null;
  skjemaApent: boolean;
  onStatus: (status: string) => void;
  onNotat: (notat: string) => void;
  onApneSkjema: () => void;
  onLukkSkjema: () => void;
  onOpprettet: () => Promise<void>;
  onFjern: () => void;
}) {
  const [skriver, setSkriver] = useState(false);
  const [notat, setNotat] = useState(punkt.notes ?? "");

  const tilstand =
    punkt.status === "ok" ? " gjort-ok" : punkt.status === "avvik" ? " gjort-avvik" : punkt.status === "ikke_aktuelt" ? " gjort-na" : "";

  return (
    <div className={`vr-punkt${tilstand}`}>
      <div className="vr-punkt-hode">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="list-tittel">{punkt.text}</div>
          {punkt.notes && !skriver && <div className="list-meta">💬 {punkt.notes}</div>}
        </div>
        {laast ? (
          <span
            className={`badge ${
              punkt.status === "ok" ? "ok" : punkt.status === "avvik" ? "danger" : punkt.status === "ikke_aktuelt" ? "muted" : "warn"
            }`}
          >
            {VALG.find((v) => v.verdi === punkt.status)?.etikett ?? "Ikke sjekket"}
          </span>
        ) : (
          <button className="btn btn-ghost sp-fjern" onClick={onFjern} aria-label={`Fjern punktet ${punkt.text}`}>
            ✕
          </button>
        )}
      </div>

      {avvik && (
        <div className="vr-avvikkort">
          <b>⚠ Avvik #{String(avvik.number ?? 0).padStart(3, "0")}</b>
          <span style={{ flex: 1, minWidth: "120px" }}>{avvik.title}</span>
          <Link href={`/avvik/${avvik.id}`}>Åpne i Avvik</Link>
        </div>
      )}

      {!laast && (
        <>
          <div className="vr-valg">
            {VALG.map((v) => (
              <button
                key={v.verdi}
                className={`sp-knapp ${v.klasse}${punkt.status === v.verdi ? " valgt" : ""}`}
                aria-pressed={punkt.status === v.verdi}
                onClick={() => onStatus(v.verdi)}
              >
                {v.etikett}
              </button>
            ))}
          </div>

          {punkt.status === "avvik" && !avvik && skjemaApent && (
            <Avviksskjema
              orgId={orgId}
              rundeId={rundeId}
              punkt={punkt}
              onAvbryt={() => {
                // Avbrutt skjema = punktet er ikke et avvik likevel — tilbake til ubesvart.
                onLukkSkjema();
                onStatus("avvik");
              }}
              onOpprettet={async () => {
                onLukkSkjema();
                await onOpprettet();
              }}
            />
          )}

          <div className="sjekkpunkt-handlinger">
            {skriver ? (
              <form
                style={{ display: "flex", gap: "8px", flex: 1 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  onNotat(notat);
                  setSkriver(false);
                }}
              >
                <input
                  className="input"
                  style={{ flex: 1, padding: "6px 10px", fontSize: "var(--fs-sm)" }}
                  value={notat}
                  autoFocus
                  placeholder="Merknad til punktet …"
                  onChange={(e) => setNotat(e.target.value)}
                />
                <button className="btn btn-ghost" style={{ padding: "6px 12px" }}>
                  Lagre
                </button>
              </form>
            ) : (
              <>
                <button className="sp-lenke" onClick={() => setSkriver(true)}>
                  {punkt.notes ? "Endre merknad" : "+ Legg til merknad"}
                </button>
                {punkt.status === "avvik" && !avvik && !skjemaApent && (
                  <button className="sp-lenke avvik" onClick={onApneSkjema}>
                    + Registrer avvik
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const ALVOR = [
  { verdi: "lav", etikett: "Lav" },
  { verdi: "middels", etikett: "Middels" },
  { verdi: "akutt", etikett: "Akutt" },
];

/**
 * Avviksskjemaet i punktkortet — oppretter et EKTE avvik koblet til punktet. Tittelen er
 * punktteksten: den som står i en kald kjeller med telefonen skal slippe å formulere seg
 * fra null. Behandlingen skjer videre i avviksmodulen.
 */
function Avviksskjema({
  orgId,
  rundeId,
  punkt,
  onAvbryt,
  onOpprettet,
}: {
  orgId: string;
  rundeId: string;
  punkt: Rundepunkt;
  onAvbryt: () => void;
  onOpprettet: () => Promise<void>;
}) {
  const [beskrivelse, setBeskrivelse] = useState("");
  const [alvor, setAlvor] = useState("middels");
  const { sender, feil, send } = useSending(async () => {
    await onOpprettet();
  });

  return (
    <form
      className="vr-avviksskjema"
      onSubmit={(e) => {
        e.preventDefault();
        void send(() =>
          avvikKlient.meld(orgId, {
            title: punkt.text,
            description: beskrivelse.trim() || null,
            category: "hms",
            severity: alvor,
            roundId: rundeId,
            roundItemId: punkt.id,
          }),
        );
      }}
    >
      <Feil melding={feil} />
      <Tekstomrade
        etikett="Hva ble observert?"
        verdi={beskrivelse}
        onEndre={setBeskrivelse}
        plassholder="Beskriv det du ser, og hvor det er"
      />
      <div>
        <div className="field-label">Alvorlighet</div>
        <div className="vr-seg" style={{ marginTop: "6px" }}>
          {ALVOR.map((a) => (
            <button
              key={a.verdi}
              type="button"
              className={alvor === a.verdi ? "valgt" : ""}
              aria-pressed={alvor === a.verdi}
              onClick={() => setAlvor(a.verdi)}
            >
              {a.etikett}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-ghost" onClick={onAvbryt} disabled={sender}>
          Avbryt
        </button>
        <button className="btn btn-primary" disabled={sender}>
          {sender ? "Oppretter …" : "Opprett avvik"}
        </button>
      </div>
    </form>
  );
}

function NyttPunkt({
  orgId,
  rundeId,
  seksjoner,
  onLukk,
  onLagret,
}: {
  orgId: string;
  rundeId: string;
  seksjoner: string[];
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [tekst, setTekst] = useState("");
  const [seksjon, setSeksjon] = useState(seksjoner[0] ?? "");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Nytt sjekkpunkt" onLukk={onLukk} bredde={460}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            internkontroll.nyttPunkt(orgId, rundeId, { text: tekst.trim(), section: seksjon || null }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt
          etikett="Hva skal sjekkes? *"
          verdi={tekst}
          onEndre={setTekst}
          notat="Punktet gjelder bare denne runden. Skal det med i alle senere runder, legg det også inn i sjekklista under Vernerunder."
        />
        {seksjoner.length > 0 && (
          <Nedtrekk
            etikett="Seksjon"
            verdi={seksjon}
            onEndre={setSeksjon}
            valg={[...seksjoner.map((s) => ({ verdi: s, etikett: s })), { verdi: "", etikett: "Annet" }]}
          />
        )}
        <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={!tekst.trim()} />
      </form>
    </Modal>
  );
}

/** Legger til deltakere underveis — interne fra brukerlista, eksterne med navn og rolle. */
function NyDeltakerModal({
  orgId,
  rundeId,
  deltakere,
  onLukk,
  onEndret,
}: {
  orgId: string;
  rundeId: string;
  deltakere: Array<{ id: string; name: string; role: string | null }>;
  onLukk: () => void;
  onEndret: () => Promise<void>;
}) {
  const [folk, setFolk] = useState<Array<{ id: string; name: string }> | null>(null);
  const [eksternNavn, setEksternNavn] = useState("");
  const [eksternRolle, setEksternRolle] = useState("");
  const [feil, setFeil] = useState<string | null>(null);

  async function hentFolk() {
    if (folk !== null) return;
    try {
      setFolk(await brukere.liste(orgId));
    } catch {
      setFolk([]);
    }
  }

  async function leggTil(navn: string, rolle: string | null) {
    try {
      await internkontroll.nyDeltaker(orgId, rundeId, { name: navn, role: rolle });
      await onEndret();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke legge til deltakeren");
    }
  }

  return (
    <Modal tittel="Legg til deltaker" onLukk={onLukk} bredde={440}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <Feil melding={feil} />
        <select
          className="select"
          aria-label="Legg til bruker i organisasjonen"
          value=""
          onFocus={() => void hentFolk()}
          onChange={(e) => {
            const b = folk?.find((f) => f.id === e.target.value);
            if (b) void leggTil(b.name, null);
          }}
        >
          <option value="">Velg bruker i organisasjonen …</option>
          {(folk ?? [])
            .filter((f) => !deltakere.some((d) => d.name === f.name))
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </select>
        <form
          style={{ display: "flex", gap: "8px" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!eksternNavn.trim()) return;
            void leggTil(eksternNavn.trim(), eksternRolle.trim() || null);
            setEksternNavn("");
            setEksternRolle("");
          }}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Ekstern deltaker — navn"
            aria-label="Ekstern deltaker, navn"
            value={eksternNavn}
            onChange={(e) => setEksternNavn(e.target.value)}
          />
          <input
            className="input"
            style={{ width: "120px" }}
            placeholder="Rolle"
            aria-label="Ekstern deltaker, rolle"
            value={eksternRolle}
            onChange={(e) => setEksternRolle(e.target.value)}
          />
          <button className="btn btn-ghost" disabled={!eksternNavn.trim()}>
            ＋
          </button>
        </form>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="btn btn-primary" onClick={onLukk}>
            Ferdig
          </button>
        </div>
      </div>
    </Modal>
  );
}
