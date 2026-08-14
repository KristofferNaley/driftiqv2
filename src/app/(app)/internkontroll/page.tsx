"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Faner, Feil, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Skuff, Tekstfelt, useSending } from "@/components/skjema";
import { brukere, internkontroll, type HmsMal, type Sjekkliste } from "@/lib/klient";
import { Risiko } from "./risiko";

function Vernerunder() {
  const router = useRouter();
  const { data, feil, laster, last, orgId } = useOrgData((o) => internkontroll.runder(o));
  const sjekklister = useOrgData((o) => internkontroll.sjekklister(o));
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
          <Tom tekst="Ingen vernerunder ennå. Runden opprettes fra en av lagets sjekklister — med deltakere og dato — og gås så gjennom punkt for punkt." />
        ) : (
          liste.map((r) => (
            <Rad
              key={r.id}
              onClick={() => router.push(`/internkontroll/vernerunde/${r.id}`)}
              tittel={r.title}
              meta={[r.checklistName, r.roundDate && `befaring ${dato(r.roundDate)}`]
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

      <Sjekklister
        sjekklister={sjekklister.data ?? []}
        laster={sjekklister.laster}
        feil={sjekklister.feil}
        orgId={orgId}
        onEndret={sjekklister.last}
      />

      {nyRunde && orgId && (
        <NyRundeModal
          orgId={orgId}
          sjekklister={sjekklister.data ?? []}
          harRunder={liste.length > 0}
          onLukk={() => setNyRunde(false)}
          onOpprettet={async (id) => {
            await Promise.all([last(), sjekklister.last()]);
            router.push(`/internkontroll/vernerunde/${id}`);
          }}
        />
      )}
    </>
  );
}

/**
 * Ny vernerunde — befaringen planlegges FØR punktene gås gjennom: hvilken sjekkliste
 * (rundetype), hvem som går, og når. Velges en standardmal, kopieres den først inn som
 * lagets egen sjekkliste og runden opprettes fra den.
 */
function NyRundeModal({
  orgId,
  sjekklister,
  harRunder,
  onLukk,
  onOpprettet,
}: {
  orgId: string;
  sjekklister: Sjekkliste[];
  harRunder: boolean;
  onLukk: () => void;
  onOpprettet: (id: string) => Promise<void>;
}) {
  const halvaar = new Date().getMonth() < 6 ? "vår" : "høst";
  const aar = new Date().getFullYear();
  const [tittel, setTittel] = useState(`Vernerunde ${halvaar} ${aar}`);
  const [tittelRort, setTittelRort] = useState(false);
  const [rundeDato, setRundeDato] = useState(new Date().toISOString().slice(0, 10));
  const [maler, setMaler] = useState<HmsMal[] | null>(null);
  /** `liste:<id>` (lagets sjekkliste), `mal:<id>` (standard, kopieres inn) eller `forrige`. */
  const [valg, setValg] = useState(sjekklister[0] ? `liste:${sjekklister[0].id}` : "");
  const [deltakere, setDeltakere] = useState<Array<{ name: string; role: string | null }>>([]);
  const { sender, feil, send } = useSending(() => {});

  useEffect(() => {
    internkontroll
      .maler(orgId, "vernerunde")
      .then((m) => setMaler(m))
      .catch(() => setMaler([]));
  }, [orgId]);

  // Standardmaler laget alt har kopiert inn (samme navn) er støy i nedtrekket.
  const nyeMaler = (maler ?? []).filter(
    (m) => !sjekklister.some((s) => s.name.trim().toLowerCase() === m.name.trim().toLowerCase()),
  );
  const listevalg = [
    ...sjekklister.map((s) => ({ verdi: `liste:${s.id}`, etikett: `${s.name} (${s.antallPunkter} punkter)` })),
    ...nyeMaler.map((m) => ({ verdi: `mal:${m.id}`, etikett: `${m.name} — standard fra DriftIQ` })),
    ...(harRunder && sjekklister.length === 0
      ? [{ verdi: "forrige", etikett: "Samme punkter som forrige runde" }]
      : []),
  ];

  function velgListe(v: string) {
    setValg(v);
    if (tittelRort) return;
    const navn = v.startsWith("liste:")
      ? sjekklister.find((s) => s.id === v.slice(6))?.name
      : v.startsWith("mal:")
        ? (maler ?? []).find((m) => m.id === v.slice(4))?.name
        : null;
    setTittel(navn ? `${navn} — ${halvaar} ${aar}` : `Vernerunde ${halvaar} ${aar}`);
  }

  return (
    <Modal tittel="Ny vernerunde" onLukk={onLukk} bredde={520}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(async () => {
            let checklistId: string | null = null;
            if (valg.startsWith("liste:")) {
              checklistId = valg.slice(6);
            } else if (valg.startsWith("mal:")) {
              const mal = (maler ?? []).find((m) => m.id === valg.slice(4));
              const kopi = await internkontroll.nySjekkliste(orgId, {
                name: mal?.name ?? "Vernerunde",
                templateId: valg.slice(4),
              });
              checklistId = kopi.id;
            }
            const ny = await internkontroll.nyRunde(orgId, {
              title: tittel.trim(),
              roundDate: rundeDato || null,
              checklistId,
              deltakere,
            });
            await onOpprettet(ny.id);
          });
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />

        <Tekstfelt
          etikett="Navn på runden *"
          verdi={tittel}
          onEndre={(v) => {
            setTittel(v);
            setTittelRort(true);
          }}
        />

        {maler === null ? (
          <Tom tekst="Henter sjekklister …" />
        ) : listevalg.length === 0 ? (
          <div className="field-note">
            Ingen sjekklister ennå — runden starter uten punkter, og dere legger til egne
            underveis. Lag gjerne en sjekkliste først (under vernerundene).
          </div>
        ) : (
          <Nedtrekk
            etikett="Sjekkliste *"
            verdi={valg}
            onEndre={velgListe}
            valg={listevalg}
            notat="Én liste per rundetype — inne, ute, garasje … Standardmaler kopieres inn som lagets egen liste og kan tilpasses fritt etterpå."
          />
        )}

        {/* Én dato: runden opprettes når den GJENNOMFØRES. Varsling om lovpålagt frist
            kommer et annet sted senere — ikke som et skjemafelt her. */}
        <Tekstfelt etikett="Dato for befaringen" type="date" verdi={rundeDato} onEndre={setRundeDato} />

        <DeltakerVelger orgId={orgId} deltakere={deltakere} onEndre={setDeltakere} />

        <Knapperad
          onAvbryt={onLukk}
          sendEtikett="Opprett runde"
          sender={sender}
          deaktivert={!tittel.trim() || (listevalg.length > 0 && !valg)}
        />
      </form>
    </Modal>
  );
}

/** Deltakerne velges når runden planlegges — interne fra brukerlista, eksterne med navn. */
function DeltakerVelger({
  orgId,
  deltakere,
  onEndre,
}: {
  orgId: string;
  deltakere: Array<{ name: string; role: string | null }>;
  onEndre: (d: Array<{ name: string; role: string | null }>) => void;
}) {
  const [folk, setFolk] = useState<Array<{ id: string; name: string }> | null>(null);
  const [eksternNavn, setEksternNavn] = useState("");

  async function hentFolk() {
    if (folk !== null) return;
    try {
      setFolk(await brukere.liste(orgId));
    } catch {
      setFolk([]);
    }
  }

  function leggTil(name: string, role: string | null) {
    if (deltakere.some((d) => d.name === name)) return;
    onEndre([...deltakere, { name, role }]);
  }

  return (
    <div>
      <div className="field-label">Deltakere på befaringen</div>
      {/* Liste nedover, ikke små merker — hvem som går runden er et hovedfelt i skjemaet. */}
      {deltakere.length > 0 && (
        <div style={{ margin: "6px 0 4px" }}>
          {deltakere.map((d) => (
            <div key={d.name} className="list-item" style={{ padding: "7px 0" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="list-tittel">{d.name}</div>
                {d.role && <div className="list-meta">{d.role}</div>}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ color: "var(--muted)", padding: "2px 8px" }}
                aria-label={`Fjern ${d.name}`}
                onClick={() => onEndre(deltakere.filter((x) => x.name !== d.name))}
              >
                Fjern
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "6px" }}>
        <select
          className="select"
          aria-label="Legg til bruker i organisasjonen"
          value=""
          onFocus={() => void hentFolk()}
          onChange={(e) => {
            const b = folk?.find((f) => f.id === e.target.value);
            if (b) leggTil(b.name, null);
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
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Ekstern deltaker — navn"
            aria-label="Ekstern deltaker, navn"
            value={eksternNavn}
            onChange={(e) => setEksternNavn(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!eksternNavn.trim()}
            onClick={() => {
              leggTil(eksternNavn.trim(), null);
              setEksternNavn("");
            }}
          >
            ＋
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Lagets sjekklister — én per rundetype. Standarden fra DriftIQ er bare startpunktet:
 * laget eier lista og sletter punktene som ikke gjelder dem.
 */
function Sjekklister({
  sjekklister,
  laster,
  feil,
  orgId,
  onEndret,
}: {
  sjekklister: Sjekkliste[];
  laster: boolean;
  feil: string | null;
  orgId: string | undefined;
  onEndret: () => Promise<void>;
}) {
  const [nyListe, setNyListe] = useState(false);
  const [apen, setApen] = useState<string | null>(null);

  return (
    <>
      <Feil melding={feil} />
      <Kort
        tittel="Sjekklister"
        handling={
          <button className="btn btn-ghost" onClick={() => setNyListe(true)}>
            ＋ Ny sjekkliste
          </button>
        }
      >
        {laster ? (
          <Tom tekst="Henter …" />
        ) : sjekklister.length === 0 ? (
          <Tom tekst="Ingen sjekklister ennå. Én liste per rundetype — inne, ute, garasje … Start fra standardmalen vår, eller bygg deres egen." />
        ) : (
          sjekklister.map((s) => (
            <Rad
              key={s.id}
              onClick={() => setApen(s.id)}
              tittel={s.name}
              meta={s.description ?? undefined}
              hoyre={<span className="badge muted">{s.antallPunkter} punkter</span>}
            />
          ))
        )}
      </Kort>

      {nyListe && orgId && (
        <NySjekklisteModal
          orgId={orgId}
          onLukk={() => setNyListe(false)}
          onOpprettet={async (id) => {
            await onEndret();
            setNyListe(false);
            setApen(id);
          }}
        />
      )}

      {apen && orgId && (
        <SjekklisteSkuff
          orgId={orgId}
          checklistId={apen}
          onLukk={() => setApen(null)}
          onEndret={onEndret}
        />
      )}
    </>
  );
}

function NySjekklisteModal({
  orgId,
  onLukk,
  onOpprettet,
}: {
  orgId: string;
  onLukk: () => void;
  onOpprettet: (id: string) => Promise<void>;
}) {
  const [navn, setNavn] = useState("");
  const [maler, setMaler] = useState<HmsMal[] | null>(null);
  const [malId, setMalId] = useState("");
  const { sender, feil, send } = useSending(() => {});

  useEffect(() => {
    internkontroll
      .maler(orgId, "vernerunde")
      .then((m) => {
        setMaler(m);
        setMalId(m.find((x) => x.isDefault)?.id ?? m[0]?.id ?? "");
      })
      .catch(() => setMaler([]));
  }, [orgId]);

  return (
    <Modal tittel="Ny sjekkliste" onLukk={onLukk} bredde={460}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(async () => {
            const ny = await internkontroll.nySjekkliste(orgId, {
              name: navn.trim(),
              templateId: malId || null,
            });
            await onOpprettet(ny.id);
          });
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt
          etikett="Navn *"
          verdi={navn}
          onEndre={setNavn}
          notat="Rundetypen — for eksempel «Vernerunde inne» eller «Uteområde»."
        />
        {maler !== null && maler.length > 0 && (
          <Nedtrekk
            etikett="Start fra"
            verdi={malId}
            onEndre={setMalId}
            valg={[
              ...maler.map((m) => ({
                verdi: m.id,
                etikett: m.isDefault ? `${m.name} (standard)` : m.name,
              })),
              { verdi: "", etikett: "Tom liste" },
            ]}
            notat="Punktene kopieres inn og blir lagets egne — fjern det som ikke gjelder dere, og legg til eget."
          />
        )}
        <Knapperad onAvbryt={onLukk} sendEtikett="Opprett sjekkliste" sender={sender} deaktivert={!navn.trim()} />
      </form>
    </Modal>
  );
}

/** Redigering av én sjekkliste i skuff — lista bak står synlig. */
function SjekklisteSkuff({
  orgId,
  checklistId,
  onLukk,
  onEndret,
}: {
  orgId: string;
  checklistId: string;
  onLukk: () => void;
  onEndret: () => Promise<void>;
}) {
  const { data, feil, setFeil, last } = useOrgData(
    (o) => internkontroll.hentSjekkliste(o, checklistId),
    [checklistId],
  );
  const [nyTekst, setNyTekst] = useState("");
  const [nySeksjon, setNySeksjon] = useState("");
  const [redigerer, setRedigerer] = useState<{ id: string; tekst: string } | null>(null);
  const [bekreftSlett, setBekreftSlett] = useState(false);

  const seksjoner: Array<[string, NonNullable<typeof data>["punkter"]]> = [];
  for (const p of data?.punkter ?? []) {
    const navn = p.section ?? "Annet";
    const siste = seksjoner[seksjoner.length - 1];
    if (siste && siste[0] === navn) siste[1].push(p);
    else seksjoner.push([navn, [p]]);
  }

  async function leggTil() {
    if (!nyTekst.trim()) return;
    try {
      await internkontroll.nyttSjekklistepunkt(orgId, checklistId, {
        text: nyTekst.trim(),
        section: nySeksjon || null,
      });
      setNyTekst("");
      await Promise.all([last(), onEndret()]);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke legge til punktet");
    }
  }

  async function fjern(itemId: string) {
    try {
      await internkontroll.slettSjekklistepunkt(orgId, checklistId, itemId);
      await Promise.all([last(), onEndret()]);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke fjerne punktet");
    }
  }

  async function lagreEndring() {
    if (!redigerer?.tekst.trim()) return;
    try {
      await internkontroll.endreSjekklistepunkt(orgId, checklistId, redigerer.id, {
        text: redigerer.tekst.trim(),
      });
      setRedigerer(null);
      await Promise.all([last(), onEndret()]);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre punktet");
    }
  }

  async function slettListe() {
    try {
      await internkontroll.slettSjekkliste(orgId, checklistId);
      await onEndret();
      onLukk();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke slette sjekklista");
    }
  }

  return (
    <Skuff
      tittel={data?.name ?? "Sjekkliste"}
      onLukk={onLukk}
      fot={
        bekreftSlett ? (
          <div style={{ display: "flex", gap: "8px", alignItems: "center", width: "100%" }}>
            <span className="field-note" style={{ flex: 1 }}>
              Gjennomførte runder beholder punktene sine.
            </span>
            <button className="btn btn-ghost" onClick={() => setBekreftSlett(false)}>
              Avbryt
            </button>
            <button className="btn btn-danger" onClick={() => void slettListe()}>
              Slett sjekklista
            </button>
          </div>
        ) : (
          <button className="btn btn-ghost" style={{ color: "var(--muted)" }} onClick={() => setBekreftSlett(true)}>
            Slett sjekklista …
          </button>
        )
      }
    >
      <Feil melding={feil} />
      {!data ? (
        <Tom tekst="Henter …" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div className="field-note">
            Endringer her gjelder NESTE runde — punktene i en påbegynt eller fullført runde
            står som de var da runden ble opprettet.
          </div>

          {data.punkter.length === 0 ? (
            <Tom tekst="Ingen punkter ennå." />
          ) : (
            seksjoner.map(([navn, punkter]) => (
              <div key={navn}>
                <div className="field-label" style={{ marginBottom: "6px" }}>{navn}</div>
                {punkter.map((p) =>
                  redigerer?.id === p.id ? (
                    <form
                      key={p.id}
                      style={{ display: "flex", gap: "8px", padding: "7px 0" }}
                      onSubmit={(e) => {
                        e.preventDefault();
                        void lagreEndring();
                      }}
                    >
                      <input
                        className="input"
                        style={{ flex: 1 }}
                        autoFocus
                        aria-label={`Endre punktet ${p.text}`}
                        value={redigerer.tekst}
                        onChange={(e) => setRedigerer({ id: p.id, tekst: e.target.value })}
                      />
                      <button className="btn btn-ghost" disabled={!redigerer.tekst.trim()}>
                        Lagre
                      </button>
                      <button type="button" className="btn btn-ghost" style={{ color: "var(--muted)" }} onClick={() => setRedigerer(null)}>
                        Avbryt
                      </button>
                    </form>
                  ) : (
                    <div key={p.id} className="list-item" style={{ padding: "7px 0" }}>
                      {/* Teksten ER redigeringsknappen. <button> arver verken farge eller
                          font — begge settes eksplisitt (kjent felle). */}
                      <button
                        type="button"
                        onClick={() => setRedigerer({ id: p.id, tekst: p.text })}
                        title="Klikk for å endre punktet"
                        style={{
                          minWidth: 0, flex: 1, textAlign: "left", background: "none",
                          border: "none", padding: 0, cursor: "pointer",
                          color: "inherit", font: "inherit",
                        }}
                      >
                        <span className="list-tittel">{p.text}</span>
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ color: "var(--muted)", padding: "2px 8px" }}
                        aria-label={`Fjern punktet ${p.text}`}
                        onClick={() => void fjern(p.id)}
                      >
                        ✕
                      </button>
                    </div>
                  ),
                )}
              </div>
            ))
          )}

          <form
            style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            onSubmit={(e) => {
              e.preventDefault();
              void leggTil();
            }}
          >
            <div className="field-label">Nytt punkt</div>
            <input
              className="input"
              placeholder="Hva skal sjekkes?"
              aria-label="Nytt punkt"
              value={nyTekst}
              onChange={(e) => setNyTekst(e.target.value)}
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <select
                className="select"
                aria-label="Seksjon"
                style={{ flex: 1 }}
                value={nySeksjon}
                onChange={(e) => setNySeksjon(e.target.value)}
              >
                {seksjoner.map(([navn]) => (
                  <option key={navn} value={navn === "Annet" ? "" : navn}>
                    {navn}
                  </option>
                ))}
                {!seksjoner.some(([navn]) => navn === "Annet") && <option value="">Annet</option>}
              </select>
              <button className="btn btn-ghost" disabled={!nyTekst.trim()}>
                ＋ Legg til
              </button>
            </div>
          </form>
        </div>
      )}
    </Skuff>
  );
}

export default function Internkontroll() {
  // «Oversikt» (§ 5-status + HMS-mål) og «Ansvar» (§ 5 pkt. 5) er tatt ut i påvente av
  // redesign — fokus er risikovurdering og vernerunde. De kommer tilbake senere;
  // API-ene og lib-laget deres står urørt.
  const [fane, setFane] = useState<"risiko" | "runder">("risiko");
  return (
    <Layout
      tittel="Internkontroll"
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={[
            { nokkel: "risiko", etikett: "Risikovurdering" },
            { nokkel: "runder", etikett: "Vernerunder" },
          ]}
        />
      }
    >
      <div className="page-content">
        {fane === "risiko" && <Risiko />}
        {fane === "runder" && <Vernerunder />}
      </div>
    </Layout>
  );
}
