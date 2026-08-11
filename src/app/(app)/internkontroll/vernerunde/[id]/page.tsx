"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, Plus } from "lucide-react";
import Layout from "@/components/Layout";
import { Feil, Kort, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { avvik as avvikKlient, brukere, internkontroll, type Rundepunkt } from "@/lib/klient";

/**
 * Vernerunde — egenkontrollen av bygget, med sjekkliste. Port av v1s rundedetalj.
 *
 * ## Trestatus, ikke avkryssing
 *
 * Per punkt: OK / Avvik / Ikke aktuelt. En avkryssing kunne ikke skille «i orden» fra
 * «ikke sjekket» fra «finnes ikke hos oss» — og det er den forskjellen som er
 * dokumentasjonen. Ubesvart (ingen av de tre) er også et svar: det runden ikke rakk.
 *
 * ## «Registrer avvik» oppretter et EKTE avvik
 *
 * Koblet til punktet via roundId/roundItemId. Avviket lever videre i avviksmodulen med
 * hele behandlingskjeden sin — runden er der det ble OPPDAGET, ikke der det følges opp.
 *
 * ## En fullført runde er låst
 *
 * Den dokumenterer hva som ble observert den dagen. API-et nekter uansett; UI-et gjemmer
 * knappene fordi en knapp som alltid feiler er verre enn ingen knapp.
 */
export default function Vernerunde({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, feil, setFeil, laster, last, orgId } = useOrgData(
    (o) => internkontroll.hentRunde(o, id),
    [id],
  );
  const [lagrer, setLagrer] = useState<string | null>(null);
  const [avvikFor, setAvvikFor] = useState<Rundepunkt | null>(null);
  const [nyttPunkt, setNyttPunkt] = useState(false);
  const [bekreftFullfor, setBekreftFullfor] = useState(false);

  async function settStatus(punkt: Rundepunkt, status: string) {
    if (!orgId) return;
    setLagrer(punkt.id);
    try {
      // Samme knapp igjen = nullstill til ubesvart. Feilklikk skal kunne angres.
      await internkontroll.kryssAv(orgId, id, punkt.id, {
        status: punkt.status === status ? null : status,
      });
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
    } finally {
      setLagrer(null);
    }
  }

  async function lagreNotat(punktId: string, notat: string) {
    if (!orgId) return;
    try {
      await internkontroll.kryssAv(orgId, id, punktId, { notes: notat.trim() || null });
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre kommentaren");
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

  // Punktene gruppert på seksjon, i innsettingsrekkefølge — samme rekkefølge som malen.
  const seksjoner = useMemo(() => {
    const kart = new Map<string, Rundepunkt[]>();
    for (const p of data?.punkter ?? []) {
      const n = p.section ?? "Annet";
      if (!kart.has(n)) kart.set(n, []);
      kart.get(n)!.push(p);
    }
    return [...kart.entries()];
  }, [data]);

  if (laster || !data) {
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
  const ubesvarte = data.punkter.length - besvarte;
  const avvikPerPunkt = new Map(data.avvik.filter((a) => a.roundItemId).map((a) => [a.roundItemId!, a]));
  const dagerIgjen = data.dueDate
    ? Math.ceil((new Date(data.dueDate).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <Layout
      tittel={data.title}
      handlinger={
        laast ? (
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
        ) : (
          <button className="btn btn-primary" onClick={() => setBekreftFullfor(true)}>
            Fullfør runden
          </button>
        )
      }
    >
      <div className="page-content">
        <Link href="/internkontroll" className="list-meta" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Internkontroll
        </Link>

        <Feil melding={feil} />

        {laast ? (
          <div className="card">
            <div className="card-body" style={{ color: "var(--muted)", fontSize: "var(--fs-sm)" }}>
              Runden er fullført og låst. Den dokumenterer hva som ble observert den dagen —
              kunne den redigeres i ettertid, dokumenterte den ingenting.
            </div>
          </div>
        ) : (
          data.dueDate &&
          dagerIgjen !== null && (
            <div className={`runde-frist${dagerIgjen < 14 ? " snart" : ""}`}>
              <span style={{ minWidth: 0 }}>
                <b>Frist {dato(data.dueDate)}.</b> Bransjepraksis: vernerunde gjennomføres to
                ganger årlig — innen 1. juni og 1. desember.
              </span>
              <span className="runde-frist-dager">
                {dagerIgjen >= 0 ? (
                  <>
                    <b>{dagerIgjen}</b> dager igjen
                  </>
                ) : (
                  <b>{Math.abs(dagerIgjen)} dager over fristen</b>
                )}
              </span>
            </div>
          )
        )}

        {/* Fremdrift — brøken sier hvor langt befaringen faktisk er kommet. */}
        <div className="card">
          <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-sm)" }}>
              <b>Fremdrift</b>
              <span className="list-meta">
                {besvarte} / {data.punkter.length} punkter
                {data.avvik.length > 0 && ` · ${data.avvik.length} avvik funnet`}
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
        </div>

        {seksjoner.length === 0 ? (
          <Kort tittel="Sjekkpunkter">
            <Tom tekst="Ingen sjekkpunkter. Legg til egne under, eller opprett neste runde fra en HMS-mal." />
          </Kort>
        ) : (
          seksjoner.map(([navn, punkter]) => (
            <Kort
              key={navn}
              tittel={navn}
              handling={
                <span className="field-note">
                  {punkter.filter((p) => p.status).length}/{punkter.length}
                </span>
              }
            >
              {punkter.map((p) => (
                <Sjekkpunkt
                  key={p.id}
                  punkt={p}
                  laast={laast}
                  lagrer={lagrer === p.id}
                  avvik={avvikPerPunkt.get(p.id) ?? null}
                  onStatus={(s) => void settStatus(p, s)}
                  onNotat={(n) => void lagreNotat(p.id, n)}
                  onRegistrerAvvik={() => setAvvikFor(p)}
                  onFjern={() => void fjernPunkt(p.id)}
                />
              ))}
            </Kort>
          ))
        )}

        {!laast && (
          <button className="btn btn-ghost" onClick={() => setNyttPunkt(true)}>
            <Plus size={15} strokeWidth={2} aria-hidden /> Legg til sjekkpunkt
          </button>
        )}

        <Deltakere
          orgId={orgId!}
          rundeId={id}
          deltakere={data.deltakere}
          laast={laast}
          onEndret={last}
          onFeil={setFeil}
        />
      </div>

      {avvikFor && orgId && (
        <RegistrerAvvik
          orgId={orgId}
          rundeId={id}
          punkt={avvikFor}
          onLukk={() => setAvvikFor(null)}
          onLagret={last}
        />
      )}

      {nyttPunkt && orgId && (
        <NyttPunkt
          orgId={orgId}
          rundeId={id}
          seksjoner={seksjoner.map(([n]) => n)}
          onLukk={() => setNyttPunkt(false)}
          onLagret={last}
        />
      )}

      {bekreftFullfor && (
        <Modal tittel="Fullfør runden" onLukk={() => setBekreftFullfor(false)} bredde={440}>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, margin: 0 }}>
            {ubesvarte > 0 ? (
              <>
                <b>{ubesvarte}</b> {ubesvarte === 1 ? "punkt er ubesvart" : "punkter er ubesvarte"}.
                Runden låses ved fullføring og kan ikke gjenåpnes — de ubesvarte blir stående
                som «ikke sjekket» i dokumentasjonen.
              </>
            ) : (
              <>Alle punkter er besvart. Runden låses ved fullføring og kan ikke gjenåpnes.</>
            )}
          </p>
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

/** Ett sjekkpunkt: trestatus, kommentar, avvikskobling — og fjerning på ulåst runde. */
function Sjekkpunkt({
  punkt,
  laast,
  lagrer,
  avvik,
  onStatus,
  onNotat,
  onRegistrerAvvik,
  onFjern,
}: {
  punkt: Rundepunkt;
  laast: boolean;
  lagrer: boolean;
  avvik: { id: string; number: number | null; title: string; status: string } | null;
  onStatus: (status: string) => void;
  onNotat: (notat: string) => void;
  onRegistrerAvvik: () => void;
  onFjern: () => void;
}) {
  const [skriver, setSkriver] = useState(false);
  const [notat, setNotat] = useState(punkt.notes ?? "");

  const VALG = [
    { verdi: "ok", etikett: "OK", klasse: "ok" },
    { verdi: "avvik", etikett: "Avvik", klasse: "avvik" },
    { verdi: "ikke_aktuelt", etikett: "Ikke aktuelt", klasse: "ia" },
  ];

  return (
    <div className="sjekkpunkt">
      <div className="sjekkpunkt-hode">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="list-tittel">{punkt.text}</div>
          {punkt.notes && !skriver && <div className="list-meta">💬 {punkt.notes}</div>}
          {avvik && (
            <Link href={`/avvik/${avvik.id}`} className="sjekkpunkt-avvik">
              ⚠ Avvik #{String(avvik.number ?? 0).padStart(3, "0")} — {avvik.title}
            </Link>
          )}
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
          <div className="sjekkpunkt-valg">
            {VALG.map((v) => (
              <button
                key={v.verdi}
                className={`sp-knapp ${v.klasse}${punkt.status === v.verdi ? " valgt" : ""}`}
                disabled={lagrer}
                onClick={() => onStatus(v.verdi)}
              >
                {v.etikett}
              </button>
            ))}
            <button className="btn btn-ghost sp-fjern" onClick={onFjern} aria-label={`Fjern punktet ${punkt.text}`}>
              ✕
            </button>
          </div>
        )}
      </div>

      {!laast && (
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
                placeholder="Kommentar til punktet …"
                onChange={(e) => setNotat(e.target.value)}
              />
              <button className="btn btn-ghost" style={{ padding: "6px 12px" }}>
                Lagre
              </button>
            </form>
          ) : (
            <>
              <button className="sp-lenke" onClick={() => setSkriver(true)}>
                {punkt.notes ? "Endre kommentar" : "+ Legg til kommentar"}
              </button>
              {!avvik && (
                <button className="sp-lenke avvik" onClick={onRegistrerAvvik}>
                  + Registrer avvik
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Oppretter et EKTE avvik koblet til punktet. Tittelen er forhåndsutfylt fra punktteksten —
 * den som står i en kald kjeller med telefonen skal slippe å formulere seg fra null.
 */
function RegistrerAvvik({
  orgId,
  rundeId,
  punkt,
  onLukk,
  onLagret,
}: {
  orgId: string;
  rundeId: string;
  punkt: Rundepunkt;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [tittel, setTittel] = useState(punkt.text);
  const [beskrivelse, setBeskrivelse] = useState(punkt.notes ?? "");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Registrer avvik fra punktet" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(async () => {
            await avvikKlient.meld(orgId, {
              title: tittel.trim(),
              description: beskrivelse.trim() || null,
              category: "hms",
              roundId: rundeId,
              roundItemId: punkt.id,
            });
            // Punktet settes til «avvik» i samme slengen — det er jo det som ble funnet.
            await internkontroll.kryssAv(orgId, rundeId, punkt.id, { status: "avvik" });
          });
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Tittel *" verdi={tittel} onEndre={setTittel} />
        <Tekstomrade
          etikett="Hva ble observert?"
          verdi={beskrivelse}
          onEndre={setBeskrivelse}
          notat="Avviket opprettes i avviksmodulen, koblet til dette punktet, og følges opp der med hele behandlingskjeden."
        />
        <Knapperad onAvbryt={onLukk} sendEtikett="Registrer avvik" sender={sender} deaktivert={!tittel.trim()} />
      </form>
    </Modal>
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
          notat="Punktet blir med videre: neste runde kopierer denne rundens punktliste."
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

/** Deltakerne på befaringen — interne fra brukerlista, eksterne med navn og rolle. */
function Deltakere({
  orgId,
  rundeId,
  deltakere,
  laast,
  onEndret,
  onFeil,
}: {
  orgId: string;
  rundeId: string;
  deltakere: Array<{ id: string; name: string; role: string | null }>;
  laast: boolean;
  onEndret: () => Promise<void>;
  onFeil: (m: string) => void;
}) {
  const [folk, setFolk] = useState<Array<{ id: string; name: string }> | null>(null);
  const [eksternNavn, setEksternNavn] = useState("");
  const [eksternRolle, setEksternRolle] = useState("");

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
      onFeil(e instanceof Error ? e.message : "Kunne ikke legge til deltakeren");
    }
  }

  async function fjern(deltakerId: string) {
    try {
      await internkontroll.slettDeltaker(orgId, rundeId, deltakerId);
      await onEndret();
    } catch (e) {
      onFeil(e instanceof Error ? e.message : "Kunne ikke fjerne deltakeren");
    }
  }

  return (
    <Kort tittel="Deltakere på befaring">
      {deltakere.length === 0 ? (
        <Tom tekst="Ingen deltakere registrert." />
      ) : (
        deltakere.map((d) => (
          <div key={d.id} className="list-item">
            <div style={{ minWidth: 0 }}>
              <div className="list-tittel">{d.name}</div>
              {d.role && <div className="list-meta">{d.role}</div>}
            </div>
            {!laast && (
              <button className="btn btn-ghost" style={{ color: "var(--muted)" }} onClick={() => void fjern(d.id)}>
                Fjern
              </button>
            )}
          </div>
        ))
      )}

      {!laast && (
        <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
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
              style={{ width: "140px" }}
              placeholder="Rolle"
              aria-label="Ekstern deltaker, rolle"
              value={eksternRolle}
              onChange={(e) => setEksternRolle(e.target.value)}
            />
            <button className="btn btn-ghost" disabled={!eksternNavn.trim()}>
              ＋
            </button>
          </form>
        </div>
      )}
    </Kort>
  );
}
