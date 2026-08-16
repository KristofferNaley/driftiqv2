"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, Mail, Printer, Send, X } from "lucide-react";
import Layout from "@/components/Layout";
import { Faner, Feil, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstomrade, Tekstfelt, useSending } from "@/components/skjema";
import EnhetVelger, { type VelgbarEnhet } from "@/components/EnhetVelger";
import { useOkt } from "@/components/OktProvider";
import { brukere, enheter, leverandorer as levKlient, oppgaver, type Oppgave, type OppgaveMedHistorikk, type Sjekkpunkt, type Utkvitteringsbilde } from "@/lib/klient";
import Dokumentviser from "@/components/Dokumentviser";
import { lagLeverandormelding } from "@/lib/leverandormelding";
import { FREQ_ETIKETTER } from "@/lib/oppgaveregler";
import { byggSerier, type Serie } from "@/lib/maleserier";

export default function Oppgavedetalj({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { aktivOrg } = useOkt();
  const { data, feil, laster, last, orgId } = useOrgData((o) => oppgaver.hent(o, id), [id]);
  const [fane, setFane] = useState<Fane>("oppgaven");
  const [kvitterer, setKvitterer] = useState(false);
  const [informerer, setInformerer] = useState(false);
  /** Bildet som vises i stor visning. Samme viser som dokumentarkivet og avviksvedlegg. */
  const [viser, setViser] = useState<(Utkvitteringsbilde & { completionId: string }) | null>(null);

  const bildeUrl = (completionId: string, bildeId: string) =>
    `/api/organizations/${orgId}/tasks/${id}/completions/${completionId}/bilder/${bildeId}/fil`;

  /**
   * Samme skille som på lista: `visning` kan se alt og kvittere ut, men ikke endre oppsettet.
   * En visningsbruker får derfor kortet, ikke skjemaet — et skjema med låste felter later som
   * det er redigerbart, og det er verre enn å vise verdiene rett fram.
   */
  const kanRedigere = aktivOrg?.nivaa === "orgadmin" || aktivOrg?.nivaa === "redigering";

  if (laster || !data) {
    return (
      <Layout tittel="Oppgave">
        <div className="page-content">
          <Feil melding={feil} />
          {!feil && <Tom tekst="Henter …" />}
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      tittel={data.title}
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={[
            { nokkel: "oppgaven", etikett: "Oppgaven" },
            { nokkel: "sjekkliste", etikett: `Sjekkliste (${data.sjekkliste.length})` },
            // «Logg», ikke «Utkvitteringer»: fanen svarer på «hva har skjedd med denne
            // oppgaven», og det er samme ord som i v1.
            { nokkel: "logg", etikett: `Logg (${data.utkvitteringer.length})` },
            // Bare når oppgaven faktisk måler noe. En fane som kun kan si «ingen målinger»
            // er verre enn ingen fane — samme regel som varselfanen i profilmodalen.
            ...(data.sjekkliste.some((p) => p.type === "tall")
              ? [{ nokkel: "statistikk" as const, etikett: "Statistikk" }]
              : []),
          ]}
        />
      }
      handlinger={
        <>
          {/* Arket bærer QR-koden som henges opp på installasjonen. Uten denne inngangen
              er siden bare en URL man må huske. */}
          <Link className="btn btn-ghost" href={`/oppgaver/${id}/ark`}>
            <Printer size={16} strokeWidth={1.9} aria-hidden />
            Oppgaveark
          </Link>
          {/* Arket er verdiløst til noen skanner det, og det leddet er en e-post til
              leverandøren. Knappen står NED VED arket med vilje: det er samme jobb — henge
              opp koden og få den tatt i bruk — og to steg i én tanke. */}
          <button className="btn btn-ghost" onClick={() => setInformerer(true)}>
            <Mail size={16} strokeWidth={1.9} aria-hidden />
            Info til leverandør
          </button>
        </>
      }
    >
      <div className="page-content">
        <Link href="/oppgaver" className="list-meta" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Alle oppgaver
        </Link>

        <Feil melding={feil} />

        {/* Statuslinja står OVER fanene: «er denne à jour» er spørsmålet man kommer med, og
            svaret skal ikke ligge bak et fanevalg. */}
        <div className="oppg-status">
          <span>
            <b>{FREQ_ETIKETTER[data.frequency] ?? data.frequency}</b> · {data.vendorName ?? "ingen leverandør"}
            {(data.unitNavn ?? data.location) && ` · ${data.unitNavn ?? data.location}`}
          </span>
          <span className="oppg-status-frist">
            {data.lastCompletedAt ? `Sist utført ${dato(data.lastCompletedAt)}` : "Aldri utført"} ·
            neste frist {dato(data.nesteFrist)}
            <span className={`badge ${data.forsinket ? "danger" : "ok"}`}>
              {data.forsinket ? "Forsinket" : "Å jour"}
            </span>
          </span>
        </div>

        {fane === "oppgaven" &&
          (kanRedigere ? (
            <Oppgaveskjema orgId={orgId!} oppgave={data} onLagret={last} />
          ) : (
            <Kort tittel="Om oppgaven">
              <Rad tittel="Frekvens" hoyre={FREQ_ETIKETTER[data.frequency] ?? data.frequency} />
              <Rad tittel="Leverandør" hoyre={data.vendorName ?? "—"} />
              <Rad tittel="Ansvarlig i styret" hoyre={data.ansvarligNavn ?? "—"} />
              <Rad tittel="Sted" hoyre={data.unitNavn ?? data.location ?? "—"} />
              {data.description && (
                <div style={{ padding: "14px 20px", fontSize: "var(--fs-sm)", lineHeight: 1.6, color: "var(--muted)" }}>
                  {data.description}
                </div>
              )}
            </Kort>
          ))}

        {fane === "sjekkliste" && (
          <Sjekklistepanel
            orgId={orgId!}
            taskId={id}
            punkter={data.sjekkliste}
            kanRedigere={kanRedigere}
            onLagret={last}
          />
        )}

        {fane === "statistikk" && (
          <Statistikkpanel utkvitteringer={data.utkvitteringer} sjekkliste={data.sjekkliste} />
        )}

        {fane === "logg" && (
          <Kort
            tittel="Utkvitteringer"
            handling={
              // Handlingen hører til fanen den gjelder, ikke til toppraden: å registrere utført
              // er noe man gjør TIL loggen, og knappen står nå der resultatet vises.
              // `redigering` er kravet i API-et — en visningsbruker skal ikke se en knapp som
              // svarer 403.
              kanRedigere && (
                <button className="btn btn-primary" onClick={() => setKvitterer(true)}>
                  <Check size={16} strokeWidth={2} aria-hidden />
                  Kvitter ut
                </button>
              )
            }
          >
            {data.utkvitteringer.length === 0 ? (
              <Tom tekst="Aldri utført. Egner oppgaven seg ikke for QR-ark, kan styret kvittere den ut her." />
            ) : (
              data.utkvitteringer.map((u) => {
                const huket = u.punkter.filter((p) => p.checked).length;
                return (
                  <div key={u.id} className="utkv-rad">
                    <div className="utkv-hode">
                      <div style={{ minWidth: 0 }}>
                        <div className="list-tittel">{u.completedBy}</div>
                        <div className="list-meta">
                          {dato(u.completedAt)}
                          {u.notes && ` · ${u.notes}`}
                        </div>
                      </div>
                      {/* Loggen viser kilden ærlig: registrert av styret i appen, eller skannet
                          på oppslaget i bygget. */}
                      <span className={`badge ${u.manual ? "info" : "muted"}`}>
                        {u.manual ? "Registrert av styret" : "QR-skjema"}
                      </span>
                    </div>

                    {/* Bildene fra stedet. De har blitt lagret siden QR-flyten kom, men aldri
                        vist noe sted — styret kunne ikke se beviset for arbeidet de betalte
                        for. De hører hjemme HER, i raden for den utførelsen de dokumenterer. */}
                    {u.bilder.length > 0 && (
                      <div className="utkv-bilder">
                        {u.bilder.map((b) => (
                          <button
                            key={b.id}
                            type="button"
                            className="utkv-bilde"
                            onClick={() => setViser({ ...b, completionId: u.id })}
                            title={b.originalName}
                          >
                            <img
                              src={`${bildeUrl(u.id, b.id)}?inline`}
                              alt={b.originalName}
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Sjekkpunktene SOM DE STO den dagen — kopien i utkvitteringen, ikke dagens
                        mal. Uhukede punkter vises også: «ikke utført» og «ikke spurt om» er
                        ulike ting i en internkontrollperm. */}
                    {u.punkter.length > 0 && (
                      <div className="utkv-punkter">
                        <div className={`utkv-antall${huket === u.punkter.length ? " alle" : ""}`}>
                          {huket} av {u.punkter.length} punkter huket av
                        </div>
                        {u.punkter.map((p) => (
                          <div key={p.id} className={`utkv-punkt${p.checked ? " ja" : ""}`}>
                            {p.checked ? "✓" : "○"} {p.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </Kort>
        )}
      </div>

      {kvitterer && (
        <KvitterUt
          orgId={orgId!}
          taskId={id}
          punkter={data.sjekkliste}
          onLukk={() => setKvitterer(false)}
          onLagret={last}
        />
      )}
      {informerer && (
        <InfoTilLeverandor
          orgId={orgId!}
          vendorId={data.vendorId}
          vendorNavn={data.vendorName}
          onLukk={() => setInformerer(false)}
        />
      )}
      {viser && (
        <Dokumentviser
          visningsnavn={viser.originalName}
          contentType={viser.contentType}
          url={bildeUrl(viser.completionId, viser.id)}
          onLukk={() => setViser(null)}
        />
      )}
    </Layout>
  );
}

type Fane = "oppgaven" | "sjekkliste" | "logg" | "statistikk";

/**
 * Måleseriene som graf.
 *
 * SVG for hånd, ikke et diagrambibliotek: designsystemet er én CSS-fil uten Tailwind, og et
 * bibliotek ville dratt inn sin egen tema- og fontverden for en enkelt linje med punkter.
 */
function Statistikkpanel({
  utkvitteringer,
  sjekkliste,
}: {
  utkvitteringer: OppgaveMedHistorikk["utkvitteringer"];
  sjekkliste: Sjekkpunkt[];
}) {
  const serier = byggSerier(
    utkvitteringer,
    sjekkliste.filter((p) => p.type === "tall").map((p) => p.id),
  );

  if (serier.length === 0) {
    return (
      <Kort tittel="Målinger">
        <Tom tekst="Ingen avlesninger ennå. Verdiene dukker opp her etter hvert som oppgaven kvitteres ut." />
      </Kort>
    );
  }

  return (
    <>
      {serier.map((s) => (
        <Kort
          key={s.nokkel}
          tittel={`${s.navn}${s.enhet ? ` (${s.enhet})` : ""}`}
          handling={!s.aktiv && <span className="badge muted">Utgått punkt</span>}
        >
          <Graf serie={s} />
        </Kort>
      ))}
      <div className="field-note">
        Hver serie er ett sjekkpunkt i én enhet. Endres enheten på malen, starter en ny serie —
        gamle avlesninger beholder enheten de ble målt i, og tall i ulike enheter skal ikke
        tegnes i samme kurve.
      </div>
    </>
  );
}

function Graf({ serie }: { serie: Serie }) {
  const { malinger, enhet } = serie;
  const verdier = malinger.map((m) => m.verdi);
  const siste = malinger[malinger.length - 1]!;
  const maks = Math.max(...verdier);
  const min = Math.min(...verdier);
  const snitt = verdier.reduce((a, b) => a + b, 0) / verdier.length;

  // Litt luft over og under, og et gulv på 1 så en flat serie ikke deler på null.
  const spenn = Math.max(maks - min, 1);
  const tak = maks + spenn * 0.15;
  const gulv = min - spenn * 0.15;

  const B = 600;
  const H = 170;
  const x = (i: number) => (malinger.length === 1 ? B / 2 : (i / (malinger.length - 1)) * B);
  const y = (v: number) => H - ((v - gulv) / (tak - gulv)) * H;
  const linje = malinger.map((m, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(m.verdi).toFixed(1)}`).join(" ");
  const tall = (v: number) => v.toLocaleString("nb-NO", { maximumFractionDigits: 2 });

  return (
    <div className="graf">
      <div className="graf-tall">
        <span>
          <b>{tall(siste.verdi)}{enhet && ` ${enhet}`}</b>
          <em>Siste, {dato(siste.nar)}</em>
        </span>
        <span><b>{tall(min)}</b><em>Laveste</em></span>
        <span><b>{tall(maks)}</b><em>Høyeste</em></span>
        <span><b>{tall(snitt)}</b><em>Snitt av {malinger.length}</em></span>
      </div>

      {/* `preserveAspectRatio="none"`: kurven skal fylle bredden den får, og y-aksen har sin
          egen skala uansett. Tallene ved siden av står i HTML og strekkes derfor ikke. */}
      <div className="graf-flate">
        <svg viewBox={`0 0 ${B} ${H}`} preserveAspectRatio="none" role="img"
             aria-label={`Utvikling for ${serie.navn}, ${malinger.length} avlesninger`}>
          <path className="graf-linje" d={linje} />
          {malinger.map((m, i) => (
            <circle key={`${m.nar}-${i}`} className="graf-punkt" cx={x(i)} cy={y(m.verdi)} r={4}>
              <title>{`${dato(m.nar)}: ${tall(m.verdi)}${enhet ? ` ${enhet}` : ""}`}</title>
            </circle>
          ))}
        </svg>
        <span className="graf-akse">
          <em>{tall(tak)}</em>
          <em>{tall(gulv)}</em>
        </span>
      </div>

      <div className="graf-datoer">
        <span>{dato(malinger[0]!.nar)}</span>
        <span>{dato(siste.nar)}</span>
      </div>
    </div>
  );
}

/**
 * Detaljsvaret, utledet av klientmetoden i stedet for skrevet på nytt. Endres formen på
 * `oppgaver.hent`, følger denne etter av seg selv — en håndskrevet kopi ville ikke gjort det.
 */
type OppgaveDetalj = Awaited<ReturnType<typeof oppgaver.hent>>;

/**
 * Oppgaven som REDIGERBART skjema — det v1 hadde, og som v2 manglet.
 *
 * `PUT /tasks/{id}` og `oppgaver.endre` har eksistert hele tiden, men ingen kalte dem: en
 * oppgave kunne opprettes og kvitteres ut, aldri rettes. Skrev noen «Heiskontrol» i tittelen,
 * eller byttet laget rørlegger, måtte oppgaven deaktiveres og lages på nytt — og da mistet den
 * QR-tokenet sitt, som er trykt på et ark som henger i kjelleren.
 *
 * Feltene er de SAMME som i «Ny oppgave» på lista, i samme rekkefølge. To skjemaer for samme
 * ting som ser ulike ut er to steder å lære, og det ene blir liggende etter.
 */
function Oppgaveskjema({
  orgId,
  oppgave,
  onLagret,
}: {
  orgId: string;
  oppgave: OppgaveDetalj;
  onLagret: () => Promise<void>;
}) {
  const [tittel, setTittel] = useState(oppgave.title);
  const [beskrivelse, setBeskrivelse] = useState(oppgave.description ?? "");
  const [vendorId, setVendorId] = useState(oppgave.vendorId);
  const [frekvens, setFrekvens] = useState(oppgave.frequency);
  const [startDato, setStartDato] = useState(oppgave.startDate ?? "");
  const [frist, setFrist] = useState(oppgave.dueDate ?? "");
  const [ansvarlig, setAnsvarlig] = useState(oppgave.responsibleUserId ?? "");
  const [unitId, setUnitId] = useState(oppgave.unitId ?? "");
  const [sted, setSted] = useState(oppgave.location ?? "");
  const [firmaer, setFirmaer] = useState<Array<{ id: string; navn: string }>>([]);
  const [folk, setFolk] = useState<Array<{ id: string; navn: string }>>([]);
  const [steder, setSteder] = useState<VelgbarEnhet[]>([]);
  const [lagret, setLagret] = useState(false);
  const [bekrefterAv, setBekrefterAv] = useState(false);

  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    setLagret(true);
    setTimeout(() => setLagret(false), 2000);
  });

  useEffect(() => {
    void levKlient.liste(orgId).then((v) => setFirmaer(v.map((f) => ({ id: f.id, navn: f.name })))).catch(() => {});
    void brukere.liste(orgId).then((b) => setFolk(b.map((u) => ({ id: u.id, navn: u.name })))).catch(() => {});
    void enheter.liste(orgId).then(setSteder).catch(() => {});
  }, [orgId]);

  return (
    <>
      <Kort tittel="Oppgaven">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(() =>
              oppgaver.endre(orgId, oppgave.id, {
                title: tittel.trim(),
                description: beskrivelse.trim() || null,
                vendorId,
                frequency: frekvens,
                startDate: startDato || null,
                dueDate: frist || null,
                responsibleUserId: ansvarlig || null,
                unitId: unitId || null,
                // Fritekststedet nullstilles når en enhet velges: to steder som sier hvor
                // jobben gjøres er ett for mange, og enheten er den strukturerte sannheten.
                location: unitId ? null : sted.trim() || null,
              }),
            );
          }}
          style={{ display: "flex", flexDirection: "column", gap: "15px", padding: "18px 20px" }}
        >
          <Feil melding={feil} />

          <Tekstfelt etikett="Tittel *" verdi={tittel} onEndre={setTittel} />
          <Tekstomrade etikett="Beskrivelse" verdi={beskrivelse} onEndre={setBeskrivelse} />

          <div className="field-row">
            <Nedtrekk
              etikett="Leverandør *"
              verdi={vendorId}
              onEndre={setVendorId}
              valg={[
                { verdi: "", etikett: "Velg leverandør …" },
                ...firmaer.map((f) => ({ verdi: f.id, etikett: f.navn })),
              ]}
            />
            <Nedtrekk
              etikett="Frekvens *"
              verdi={frekvens}
              onEndre={setFrekvens}
              valg={Object.entries(FREQ_ETIKETTER).map(([verdi, etikett]) => ({ verdi, etikett }))}
            />
          </div>

          <div className="field-row">
            <Tekstfelt
              etikett="Første / neste utføring"
              type="date"
              verdi={startDato}
              onEndre={setStartDato}
              notat="Når skal oppgaven utføres første gang?"
            />
            <Tekstfelt
              etikett="Frist"
              type="date"
              verdi={frist}
              onEndre={setFrist}
              notat="Valgfritt. Merkes forsinket når fristen er passert og oppgaven aldri er utført."
            />
          </div>

          <Nedtrekk
            etikett="Ansvarlig i styret"
            verdi={ansvarlig}
            onEndre={setAnsvarlig}
            valg={[
              { verdi: "", etikett: "Ingen ansvarlig" },
              ...folk.map((u) => ({ verdi: u.id, etikett: u.navn })),
            ]}
            notat="Kontaktperson for oppfølging. Vises på oppgavearket som henges opp."
          />

          {steder.length > 0 ? (
            <div className="field">
              <label className="field-label">Sted</label>
              <EnhetVelger
                verdi={unitId}
                onEndre={setUnitId}
                enheter={steder}
                tomEtikett="Ingen bestemt enhet"
                ariaEtikett="Sted"
              />
              {/* Arven fra v1: eldre oppgaver har stedet som fritekst. Den vises her slik at
                  man ser HVA man erstatter når man velger en enhet. */}
              {!unitId && sted.trim() && (
                <div className="field-note">
                  Sted i fritekst i dag: «{sted}» — velg en enhet for å erstatte det.
                </div>
              )}
            </div>
          ) : (
            <Tekstfelt etikett="Sted" verdi={sted} onEndre={setSted} plassholder="F.eks. «Teknisk rom, loft»" />
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
            {lagret && (
              <span style={{ fontSize: "var(--fs-label)", color: "var(--accent2)" }}>Lagret.</span>
            )}
            <button
              className="btn btn-primary"
              style={{ marginLeft: "auto" }}
              disabled={sender || !tittel.trim() || !vendorId}
            >
              {sender ? "Lagrer …" : "Lagre endringer"}
            </button>
          </div>
        </form>
      </Kort>

      <Kort tittel="Avslutt oppgaven">
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="field-note" style={{ lineHeight: 1.6 }}>
            Deaktivering tar oppgaven ut av lista og av årshjulet, men beholder historikken og
            QR-koden. Er oppgaven bare utført for siste gang, er dette riktig valg — å slette
            den ville fjernet dokumentasjonen på jobbene som ER gjort.
          </div>
          <button
            type="button"
            className="btn btn-ghost profil-handling fjern-knapp"
            onClick={() => setBekrefterAv(true)}
          >
            Deaktiver oppgaven
          </button>
        </div>
      </Kort>

      {bekrefterAv && (
        <Modal tittel="Deaktiver oppgaven" onLukk={() => setBekrefterAv(false)} bredde={400}>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
            Deaktiver <strong>{oppgave.title}</strong>? Den forsvinner fra oppgavelista og
            årshjulet. Utkvitteringene står igjen, og QR-koden på arket fortsetter å peke hit.
          </p>
          <Knapperad
            onAvbryt={() => setBekrefterAv(false)}
            sendEtikett="Deaktiver"
            farlig
            onSend={() =>
              void send(async () => {
                await oppgaver.deaktiver(orgId, oppgave.id);
                setBekrefterAv(false);
              })
            }
            sender={sender}
          />
        </Modal>
      )}
    </>
  );
}

/**
 * «Info til leverandør» — den ferdige e-posten som får QR-koden tatt i bruk.
 *
 * ## Hvorfor dette er en funksjon i produktet og ikke en hjelpeartikkel
 *
 * Oppslaget med QR-koden gjør ingenting av seg selv. Noen må si til rørleggeren at koden
 * finnes og hva de skal gjøre med den, og det er en e-post et styremedlem skal skrive på
 * kvelden. Blir den ikke skrevet, henger koden ubrukt og loggen fylles av etterregistreringer
 * — og da har laget dokumentasjon på at styret husket, ikke på at jobben ble gjort.
 *
 * ## ALLE oppgavene leverandøren har, ikke bare denne
 *
 * Rørleggeren gjør sjelden én jobb for laget. Én e-post per oppgave er fire e-poster ingen
 * sender, så meldingen lister alle aktive oppgaver med QR-kode som er tildelt DENNE
 * leverandøren. Den kan hakes av og på — sender du meldingen fordi det kom en ny oppgave, vil
 * du kanskje bare nevne den.
 *
 * ## Redigerbar, og den sender ingenting selv
 *
 * Teksten står i et tekstfelt, ikke som ferdig formatert HTML: styret kjenner leverandøren og
 * skal kunne stryke en setning. «Åpne i e-post» fyller ut deres EGET e-postprogram via
 * `mailto:` — DriftIQ sender ikke noe på deres vegne, og adressaten er noen de ser før de
 * trykker send.
 */
function InfoTilLeverandor({
  orgId,
  vendorId,
  vendorNavn,
  onLukk,
}: {
  orgId: string;
  vendorId: string;
  vendorNavn: string | null;
  onLukk: () => void;
}) {
  const { aktivOrg, bruker } = useOkt();
  const [alle, setAlle] = useState<Oppgave[] | null>(null);
  const [epost, setEpost] = useState<string | null>(null);
  const [kontaktFornavn, setKontaktFornavn] = useState<string | null>(null);
  const [valgte, setValgte] = useState<Set<string>>(new Set());
  const [tekst, setTekst] = useState("");
  const [emne, setEmne] = useState("");
  const [kopiert, setKopiert] = useState(false);
  const [sender, setSender] = useState(false);
  const [sendtTil, setSendtTil] = useState<string | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  // Oppgavelista og leverandøren hentes hver for seg: kontaktpersonen ligger bare på
  // leverandørdetaljen, og oppgavene bare i lista. Ingen av dem har begge.
  useEffect(() => {
    oppgaver
      .liste(orgId)
      .then((liste) => {
        const mine = liste.filter((o) => o.vendorId === vendorId && o.active && o.qrToken);
        setAlle(mine);
        setValgte(new Set(mine.map((o) => o.id)));
      })
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente oppgavene"));

    levKlient
      .hent(orgId, vendorId)
      .then((v) => {
        // Primærkontakten hvis den finnes, ellers den første med e-post. En leverandør uten
        // registrert kontakt gir ingen adressat — da står teksten der, klar til å limes inn.
        const k = v.kontakter.find((k) => k.isPrimary && k.email) ?? v.kontakter.find((k) => k.email);
        setEpost(k?.email ?? null);
        setKontaktFornavn(k?.name?.trim().split(/\s+/)[0] ?? null);
      })
      .catch(() => {
        // Feiler oppslaget, mister vi bare hilsenen og adressaten. Teksten er hovedsaken.
      });
  }, [orgId, vendorId]);

  // Teksten regnes om når avkryssingen endres — men bare til brukeren har begynt å redigere
  // den. Å overskrive en tekst noen har endret på er den verste av de to feilene.
  const [rort, setRort] = useState(false);
  useEffect(() => {
    if (alle === null || rort) return;
    const melding = lagLeverandormelding({
      orgNavn: aktivOrg?.name ?? "Borettslaget",
      leverandorNavn: vendorNavn ?? "dere",
      kontaktFornavn,
      oppgaver: alle
        .filter((o) => valgte.has(o.id))
        .map((o) => ({ tittel: o.title, sted: o.unitNavn ?? o.location, frekvens: o.frequency })),
      avsender: { navn: bruker?.name ?? "styret", epost: bruker?.email ?? null, telefon: bruker?.phone ?? null },
    });
    setEmne(melding.emne);
    setTekst(melding.tekst);
  }, [alle, valgte, rort, aktivOrg, vendorNavn, kontaktFornavn, bruker]);

  const mailto = `mailto:${epost ?? ""}?subject=${encodeURIComponent(emne)}&body=${encodeURIComponent(tekst)}`;

  return (
    <Modal tittel="Info til leverandør" onLukk={onLukk} bredde={680}>
      <Feil melding={feil} />

      <div className="tips-stripe">
        <span style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
          <b>Ferdig tekst du kan sende.</b>{" "}
          <span style={{ color: "var(--muted)" }}>
            Den forklarer hva QR-koden er, hvilke oppgaver det gjelder, og hva leverandøren skal
            gjøre — uten at de trenger konto, app eller passord.
          </span>
        </span>
      </div>

      {alle === null ? (
        <div className="field-note">Henter oppgavene …</div>
      ) : alle.length === 0 ? (
        <div className="field-note" style={{ lineHeight: 1.6 }}>
          {vendorNavn ?? "Leverandøren"} har ingen aktive oppgaver med QR-kode i dette laget.
          Teksten under nevner derfor ingen oppgaver — men den kan fortsatt sendes.
        </div>
      ) : (
        <div className="field">
          <span className="field-label">Oppgaver meldingen nevner</span>
          <div className="field-note" style={{ marginBottom: "6px" }}>
            Alle aktive oppgaver {vendorNavn ?? "leverandøren"} har i {aktivOrg?.name}. Ta bort
            det som ikke er relevant.
          </div>
          {alle.map((o) => (
            <label key={o.id} className="varsel-valg">
              <input
                type="checkbox"
                checked={valgte.has(o.id)}
                onChange={(e) => {
                  const neste = new Set(valgte);
                  if (e.target.checked) neste.add(o.id);
                  else neste.delete(o.id);
                  setValgte(neste);
                  // Endrer man utvalget, skal teksten følge etter igjen.
                  setRort(false);
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span className="varsel-navn">{o.title}</span>
                <span className="varsel-desc">
                  {[o.unitNavn ?? o.location, FREQ_ETIKETTER[o.frequency] ?? o.frequency]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="field">
        <label className="field-label" htmlFor="melding-emne">
          Emne
        </label>
        <input
          id="melding-emne"
          className="input"
          value={emne}
          onChange={(e) => setEmne(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="melding-tekst">
          Meldingen
        </label>
        <textarea
          id="melding-tekst"
          className="textarea melding-tekst"
          value={tekst}
          onChange={(e) => {
            setTekst(e.target.value);
            setRort(true);
          }}
        />
        <div className="field-note">
          {epost
            ? `Sendes til ${epost}. E-posten går fra DriftIQ, men svar kommer til deg — og sendingen loggføres som notat på leverandøren.`
            : "Leverandøren har ingen registrert kontaktperson med e-post. Legg den inn under Leverandører, eller kopier teksten og send den selv."}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        {sendtTil && (
          <span style={{ fontSize: "var(--fs-label)", color: "var(--accent2)" }}>
            Sendt til {sendtTil}.
          </span>
        )}
        {kopiert && !sendtTil && (
          <span style={{ fontSize: "var(--fs-label)", color: "var(--accent2)" }}>Kopiert.</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={onLukk}>
            Lukk
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              void navigator.clipboard
                .writeText(tekst)
                .then(() => setKopiert(true))
                .catch(() => setFeil("Nettleseren tillot ikke kopiering. Merk teksten og kopier den manuelt."));
            }}
          >
            <Copy size={15} strokeWidth={1.9} aria-hidden />
            Kopier teksten
          </button>
          {/* Lenke, ikke knapp med `window.open`: da virker høyreklikk, og nettleseren får
              selv velge hvilket e-postprogram som skal åpnes. Sekundær nå — men den er den
              eneste veien når leverandøren ikke har en registrert adresse, og den eneste som
              legger meldingen i styremedlemmets egen «sendt»-mappe. */}
          <a className="btn btn-ghost" href={mailto}>
            Åpne i e-post
          </a>
          {/* Ett trykk, og den er sendt. Krever en registrert adresse: serveren nekter å sende
              til noe annet enn leverandørens egne kontaktpersoner. */}
          {epost && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={sender || !!sendtTil || !tekst.trim()}
              onClick={() => {
                setSender(true);
                setFeil(null);
                levKlient
                  .sendQrInfo(orgId, vendorId, { emne, tekst, til: epost })
                  .then((r) => setSendtTil(r.til))
                  .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke sende"))
                  .finally(() => setSender(false));
              }}
            >
              <Send size={15} strokeWidth={1.9} aria-hidden />
              {sender ? "Sender …" : sendtTil ? "Sendt" : "Send til leverandøren"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function KvitterUt({
  orgId,
  taskId,
  punkter,
  onLukk,
  onLagret,
}: {
  orgId: string;
  taskId: string;
  punkter: Sjekkpunkt[];
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [nar, setNar] = useState(new Date().toISOString().slice(0, 10));
  const [notat, setNotat] = useState("");
  const [avhuket, setAvhuket] = useState<Set<string>>(new Set());
  /** Som i QR-skjemaet: tekst mens den skrives, tall ved innsending. Se kommentaren der. */
  const [verdier, setVerdier] = useState<Record<string, string>>({});
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Registrer utført" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(async () => {
            // Samme sperre som i QR-skjemaet, og av samme grunn: serveren avviser uansett,
            // men den som fyller ut skal få vite hvilket punkt det gjelder med en gang.
            const mangler = punkter.filter(
              (p) =>
                p.required &&
                (p.type === "tall" ? !(verdier[p.id] ?? "").trim() : !avhuket.has(p.id)),
            );
            if (mangler.length > 0) {
              throw new Error(
                mangler.length === 1
                  ? `«${mangler[0]!.text}» må fylles ut før oppgaven kan kvitteres ut.`
                  : `Disse må fylles ut: ${mangler.map((p) => p.text).join(", ")}.`,
              );
            }
            return oppgaver.kvitterUt(orgId, taskId, {
              completedAt: nar,
              notes: notat || null,
              hasDeviation: false,
              checkedItemIds: [...avhuket],
              verdier: Object.entries(verdier)
                .filter(([, v]) => v.trim() !== "")
                .map(([itemId, v]) => ({ itemId, value: Number(v) }))
                .filter((v) => Number.isFinite(v.value)),
            });
          });
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        {/* API-et avviser datoer fram i tid — `max` gjør det tydelig før innsending. */}
        <Tekstfelt etikett="Utført dato" type="date" verdi={nar} onEndre={setNar} />

        {/* Sjekklisten hører HJEMME her. Uten den ble hvert punkt ført som ikke utført ved en
            manuell registrering — loggen sa «utført» og «0 av 3 punkter huket av» om en jobb
            som var gjort i sin helhet. */}
        {punkter.length > 0 && (
          <div className="kvitt-liste">
            <span className="field-note">Sjekkliste</span>
            {punkter.map((p) =>
              p.type === "tall" ? (
                <label key={p.id} className="kvitt-maling">
                  <span>
                    {p.text}
                    {p.unit && <em> ({p.unit})</em>}
                    {p.required && <b> må fylles ut</b>}
                  </span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={verdier[p.id] ?? ""}
                    placeholder={p.unit ? `Verdi i ${p.unit}` : "Verdi"}
                    onChange={(e) =>
                      setVerdier({ ...verdier, [p.id]: e.target.value.replace(",", ".") })
                    }
                  />
                </label>
              ) : (
                <label key={p.id} className="kvitt-punkt">
                  <input
                    type="checkbox"
                    checked={avhuket.has(p.id)}
                    onChange={(e) => {
                      const neste = new Set(avhuket);
                      if (e.target.checked) neste.add(p.id);
                      else neste.delete(p.id);
                      setAvhuket(neste);
                    }}
                  />
                  <span>
                    {p.text}
                    {p.required && <b> må hukes av</b>}
                  </span>
                </label>
              ),
            )}
            <span className="field-note">
              Punkter du ikke huker av føres som ikke utført — det er et gyldig svar.
            </span>
          </div>
        )}

        <Tekstomrade
          etikett="Notat"
          verdi={notat}
          onEndre={setNotat}
          notat="Registreres som manuell utkvittering, ikke som om den kom fra QR-skjemaet."
        />
        <Knapperad onAvbryt={onLukk} sendEtikett="Registrer" sender={sender} />
      </form>
    </Modal>
  );
}

/**
 * Sjekklisten som RADEDITOR, rett i fanen — slik v1 gjorde det.
 *
 * Første utkast var et tekstfelt i en modal, én linje per punkt. Det så enkelt ut og var
 * verre på alle måtene som teller: rekkefølge måtte klippes og limes, hvert punkt mistet
 * identiteten sin ved lagring, og redigering av ETT punkt krevde at man fant det igjen i en
 * tekstblokk. Radene her gjør hver handling til sin egen: endre tekst i feltet, flytt med
 * pilene, fjern med ✕, legg til nederst.
 *
 * ## Hver handling lagrer med en gang
 *
 * Ingen «Lagre»-knapp. Flytting og fjerning skrives idet de gjøres; tekst lagres når feltet
 * forlates. En editor med utsatt lagring må svare på «hva skjer hvis jeg bytter fane nå?» —
 * denne trenger ikke spørsmålet.
 *
 * Serveren gjenkjenner punktene på uendret tekst og lar dem beholde id-en sin — det er den
 * koblingen statistikken per punkt henger i (se `erstattSjekkliste`). Derfor sier notatet
 * nederst det viktigste rett ut: endre tekst = nytt punkt.
 */
function Sjekklistepanel({
  orgId,
  taskId,
  punkter,
  kanRedigere,
  onLagret,
}: {
  orgId: string;
  taskId: string;
  punkter: Sjekkpunkt[];
  kanRedigere: boolean;
  onLagret: () => Promise<void>;
}) {
  /**
   * Lokal kopi av HELE raden, ikke bare teksten: et punkt har nå også type, enhet og om det
   * er påkrevd. Synkes fra props etter hver lagring — `punkter` er sannheten mellom
   * redigeringene.
   */
  type Rad = Pick<Sjekkpunkt, "text" | "type" | "unit" | "required">;
  const fraProps = (): Rad[] =>
    punkter.map((p) => ({ text: p.text, type: p.type, unit: p.unit, required: p.required }));

  const [rader, setRader] = useState<Rad[]>(fraProps);
  const [nytt, setNytt] = useState("");
  const [feil, setFeil] = useState<string | null>(null);
  const [jobber, setJobber] = useState(false);
  useEffect(() => setRader(fraProps()), [punkter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function lagre(neste: Rad[]) {
    setJobber(true);
    setFeil(null);
    try {
      await oppgaver.settSjekkliste(orgId, taskId, {
        items: neste
          .map((r) => ({ ...r, text: r.text.trim() }))
          .filter((r) => r.text)
          .map((r) => ({
            text: r.text,
            type: r.type,
            // Enheten sendes bare for tallpunkter — serveren rydder den uansett, men det er
            // billigere å ikke sende den enn å stole på at noen husker det neste gang.
            unit: r.type === "tall" ? (r.unit ?? null) : null,
            required: r.required,
          })),
      });
      await onLagret();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre sjekklisten");
      // Tilbake til det som faktisk står lagret — en rad som SER flyttet ut men ikke er det,
      // er verre enn at flyttingen synlig ikke skjedde.
      setRader(fraProps());
    } finally {
      setJobber(false);
    }
  }

  /** Endrer ett felt på én rad og lagrer. Brukes av alt unntatt tekstfeltet, som venter på blur. */
  function endre(i: number, felt: Partial<Rad>) {
    const neste = rader.map((r, j) => (j === i ? { ...r, ...felt } : r));
    setRader(neste);
    void lagre(neste);
  }

  const flytt = (i: number, retning: -1 | 1) => {
    const til = i + retning;
    if (til < 0 || til >= rader.length) return;
    const neste = [...rader];
    [neste[i], neste[til]] = [neste[til]!, neste[i]!];
    setRader(neste);
    void lagre(neste);
  };

  if (!kanRedigere) {
    return (
      <Kort tittel="Sjekkliste">
        {punkter.length === 0 ? (
          <Tom tekst="Ingen sjekkpunkter. De vises i QR-skjemaet hver gang oppgaven utføres." />
        ) : (
          punkter.map((p, i) => (
            <Rad
              key={p.id}
              tittel={`${i + 1}. ${p.text}`}
              hoyre={
                p.type === "tall"
                  ? `Måling${p.unit ? ` i ${p.unit}` : ""}${p.required ? " · påkrevd" : ""}`
                  : p.required
                    ? "Påkrevd"
                    : undefined
              }
            />
          ))
        )}
      </Kort>
    );
  }

  return (
    <div className="page-content" style={{ padding: 0, gap: "10px", display: "flex", flexDirection: "column" }}>
      <div className="field-note">Punktene vises i QR-skjemaet hver gang oppgaven utføres.</div>
      <Feil melding={feil} />

      {rader.map((rad, i) => (
        <div key={punkter[i]?.id ?? `ny-${i}`} className="sjekk-blokk">
        <div className="sjekk-rad">
          <span className="sjekk-nr">{i + 1}.</span>
          <input
            className="input"
            value={rad.text}
            aria-label={`Sjekkpunkt ${i + 1}`}
            disabled={jobber}
            onChange={(e) =>
              setRader(rader.map((r, j) => (j === i ? { ...r, text: e.target.value } : r)))
            }
            // Lagres når feltet forlates — per tastetrykk ville hvert tegn gitt et nytt
            // punkt hos serveren, siden gjenkjenningen går på uendret tekst.
            onBlur={() => {
              if (rad.text.trim() !== (punkter[i]?.text ?? "")) void lagre(rader);
            }}
          />
          <button
            type="button"
            className="btn btn-ghost sjekk-knapp"
            aria-label={`Flytt sjekkpunkt ${i + 1} opp`}
            disabled={jobber || i === 0}
            onClick={() => flytt(i, -1)}
          >
            <ArrowUp size={15} strokeWidth={1.9} aria-hidden />
          </button>
          <button
            type="button"
            className="btn btn-ghost sjekk-knapp"
            aria-label={`Flytt sjekkpunkt ${i + 1} ned`}
            disabled={jobber || i === rader.length - 1}
            onClick={() => flytt(i, 1)}
          >
            <ArrowDown size={15} strokeWidth={1.9} aria-hidden />
          </button>
          <button
            type="button"
            className="btn btn-ghost sjekk-knapp farlig"
            aria-label={`Fjern sjekkpunkt ${i + 1}`}
            disabled={jobber}
            onClick={() => {
              const neste = rader.filter((_, j) => j !== i);
              setRader(neste);
              void lagre(neste);
            }}
          >
            <X size={15} strokeWidth={1.9} aria-hidden />
          </button>
        </div>

        {/* Egenskapene på egen linje under teksten. Presset inn på samme rad ble feltene så
            smale at ingen av dem kunne leses på mobil — og det er nettopp på mobil den som
            setter opp en sprinklerkontroll står. */}
        <div className="sjekk-valg">
          <label>
            <span className="field-note">Svar</span>
            <select
              className="input"
              value={rad.type}
              disabled={jobber}
              aria-label={`Type på sjekkpunkt ${i + 1}`}
              onChange={(e) => endre(i, { type: e.target.value as Sjekkpunkt["type"] })}
            >
              <option value="avkryssing">Avkryssing</option>
              <option value="tall">Tall som fylles ut</option>
            </select>
          </label>

          {/* Enheten finnes bare for tallpunkter. Den kopieres inn i hver avlesning, så en
              endring her gjelder framover — gamle målinger beholder enheten de ble målt i. */}
          {rad.type === "tall" && (
            <label>
              <span className="field-note">Enhet</span>
              <input
                className="input"
                value={rad.unit ?? ""}
                placeholder="bar, °C, ppm …"
                maxLength={12}
                disabled={jobber}
                aria-label={`Enhet på sjekkpunkt ${i + 1}`}
                onChange={(e) =>
                  setRader(rader.map((r, j) => (j === i ? { ...r, unit: e.target.value } : r)))
                }
                onBlur={() => {
                  if ((rad.unit ?? "") !== (punkter[i]?.unit ?? "")) void lagre(rader);
                }}
              />
            </label>
          )}

          <label className="sjekk-pakrevd">
            <input
              type="checkbox"
              checked={rad.required}
              disabled={jobber}
              onChange={(e) => endre(i, { required: e.target.checked })}
            />
            <span>Må fylles ut</span>
          </label>
        </div>
        </div>
      ))}

      <form
        style={{ display: "flex", gap: "8px" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!nytt.trim()) return;
          // Nye punkter starter som avkryssing. Trenger de en måling, settes typen på raden
          // etterpå — å spørre om type før punktet finnes ville gjort det vanligste tilfellet
          // to klikk dyrere.
          const neste: Rad[] = [
            ...rader,
            { text: nytt.trim(), type: "avkryssing", unit: null, required: false },
          ];
          setRader(neste);
          setNytt("");
          void lagre(neste);
        }}
      >
        <input
          className="input"
          placeholder="Skriv nytt sjekkpunkt og trykk Enter …"
          aria-label="Nytt sjekkpunkt"
          value={nytt}
          disabled={jobber}
          onChange={(e) => setNytt(e.target.value)}
        />
        <button className="btn btn-primary" disabled={jobber}>
          Legg til
        </button>
      </form>

      <div className="field-note">
        Utført historikk berøres ikke av endringer her. Endrer du teksten på et punkt, regnes
        det som et nytt — statistikken per punkt følger ikke med. Legg heller til nye punkter
        enn å omdøpe gamle.
      </div>
    </div>
  );
}
