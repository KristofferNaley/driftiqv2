"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { Feil, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { brukere, enheter, leverandorer as levKlient, oppgaver, type Oppgave } from "@/lib/klient";
import { FREQ_ETIKETTER } from "@/lib/oppgaveregler";
import EnhetVelger, { type VelgbarEnhet } from "@/components/EnhetVelger";

/**
 * Oppgaver.
 *
 * `forsinket` og `nesteFrist` kommer BEREGNET fra API-et — siden regner ikke selv. Regelen
 * bor i `lib/oppgaveregler.ts` og deles med e-postvarselet, så skjermen og varselet ikke kan
 * si ulike ting. Det var nettopp den feilen v1 hadde i sju kopier.
 */

type Status = "ok" | "forsinket" | "aldri";

/**
 * «Ikke utført» skiller «vi har ikke holdepunkt for når» fra «i rute».
 *
 * En gjentakende oppgave uten utkvittering, startdato OG frist har ingen neste frist å
 * regne fra — den skal ikke fremstilles som à jour bare fordi ingenting har forfalt. `Ved
 * behov` er unntaket: den har ingen kadens, og er derfor i rute per definisjon.
 */
function statusFor(t: Oppgave): Status {
  if (t.forsinket) return "forsinket";
  if (t.frequency === "on_demand") return "ok";
  return t.nesteFrist ? "ok" : "aldri";
}

const STATUSMERKE: Record<Status, { etikett: string; klasse: string }> = {
  ok: { etikett: "À jour", klasse: "ok" },
  forsinket: { etikett: "Forsinket", klasse: "warn" },
  aldri: { etikett: "Ikke utført", klasse: "info" },
};

export default function Oppgaver() {
  const router = useRouter();
  const { aktivOrg } = useOkt();
  const { data, feil, laster, last, orgId } = useOrgData((o) => oppgaver.liste(o));
  const [nyOppgave, setNyOppgave] = useState(false);
  const [filter, setFilter] = useState<"alle" | Status>("alle");
  const [leverandor, setLeverandor] = useState("");

  const liste = useMemo(() => data ?? [], [data]);
  const kanRedigere = aktivOrg?.nivaa === "orgadmin" || aktivOrg?.nivaa === "redigering";

  // Leverandørene som faktisk BRUKES, ikke hele registeret: et filter med valg som ikke
  // treffer noe er verre enn ingen filter.
  const leverandorer = useMemo(() => {
    const sett = new Map<string, string>();
    for (const t of liste) if (t.vendorId && t.vendorName) sett.set(t.vendorId, t.vendorName);
    return [...sett.entries()].sort((a, b) => a[1].localeCompare(b[1], "nb"));
  }, [liste]);

  const etterLeverandor = leverandor ? liste.filter((t) => t.vendorId === leverandor) : liste;
  const tell = (s: Status) => etterLeverandor.filter((t) => statusFor(t) === s).length;
  const vist = filter === "alle" ? etterLeverandor : etterLeverandor.filter((t) => statusFor(t) === filter);

  const faner: Array<{ nokkel: "alle" | Status; etikett: string; antall: number }> = [
    { nokkel: "alle", etikett: "Alle", antall: etterLeverandor.length },
    { nokkel: "forsinket", etikett: "Forsinket", antall: tell("forsinket") },
    { nokkel: "ok", etikett: "À jour", antall: tell("ok") },
    { nokkel: "aldri", etikett: "Ikke utført", antall: tell("aldri") },
  ];

  return (
    <Layout
      tittel="Oppgaver"
      handlinger={
        kanRedigere && (
          <button className="btn btn-primary" onClick={() => setNyOppgave(true)}>
            ＋ Ny oppgave
          </button>
        )
      }
    >
      <div className="page-content">
        <Feil melding={feil} />

        <div className="avvik-filter">
          {leverandorer.length > 1 && (
            <select
              className="input"
              aria-label="Filtrer på leverandør"
              value={leverandor}
              onChange={(e) => setLeverandor(e.target.value)}
            >
              <option value="">Alle leverandører</option>
              {leverandorer.map(([id, navn]) => (
                <option key={id} value={id}>
                  {navn}
                </option>
              ))}
            </select>
          )}
          <div className="pille-gruppe" style={{ marginLeft: 0 }}>
            {faner.map((f) => (
              <button
                key={f.nokkel}
                className={`pille${filter === f.nokkel ? " valgt" : ""}`}
                onClick={() => setFilter(f.nokkel)}
              >
                {f.etikett} ({f.antall})
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="avvik-tabell">
            <div className="oppgave-rad hode">
              <span>Oppgave</span>
              <span className="kol-vekk">Sted</span>
              <span className="kol-vekk">Ansvarlig i styret</span>
              <span>Status</span>
              <span className="kol-vekk">Frekvens</span>
              <span>Forfall</span>
            </div>

            {laster ? (
              <Tom tekst="Henter …" />
            ) : vist.length === 0 ? (
              <Tom tekst="Ingen oppgaver i denne kategorien." />
            ) : (
              vist.map((t) => {
                const st = STATUSMERKE[statusFor(t)];
                return (
                  <button
                    key={t.id}
                    className="oppgave-rad"
                    onClick={() => router.push(`/oppgaver/${t.id}`)}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span className="oppgave-navn">{t.title}</span>
                      <span className="oppgave-lev">{t.vendorName ?? "Ingen leverandør"}</span>
                    </span>
                    <span className="avvik-celle kol-vekk">
                      {t.unitNavn ?? t.location ?? "Ingen lokasjon"}
                    </span>
                    {/* Amber, ikke grått: en oppgave uten ansvarlig er noe styret bør fikse,
                        ikke bare et tomt felt. */}
                    <span className={`avvik-celle kol-vekk${t.ansvarligNavn ? "" : " mangler"}`}>
                      {t.ansvarligNavn ?? "Ingen ansvarlig"}
                    </span>
                    <span>
                      <span className={`badge ${st.klasse}`}>{st.etikett}</span>
                    </span>
                    <span className="avvik-celle kol-vekk">
                      {FREQ_ETIKETTER[t.frequency] ?? t.frequency}
                    </span>
                    <span className={`avvik-celle${statusFor(t) === "forsinket" ? " forfalt" : ""}`}>
                      {t.nesteFrist ? dato(t.nesteFrist) : "—"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {nyOppgave && orgId && (
        <NyOppgave orgId={orgId} onLukk={() => setNyOppgave(false)} onLagret={last} />
      )}
    </Layout>
  );
}

/**
 * Ny oppgave.
 *
 * Leverandør er PÅKREVD — en oppgave uten avtalepart har ingen som svarer for den, og
 * QR-skjemaet faller tilbake på leverandørnavnet når montøren ikke skriver sitt eget.
 */
function NyOppgave({
  orgId,
  onLukk,
  onLagret,
}: {
  orgId: string;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [tittel, setTittel] = useState("");
  const [beskrivelse, setBeskrivelse] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [frekvens, setFrekvens] = useState("annual");
  const [startDato, setStartDato] = useState("");
  const [frist, setFrist] = useState("");
  const [ansvarlig, setAnsvarlig] = useState("");
  const [unitId, setUnitId] = useState("");
  const [sted, setSted] = useState("");
  const [firmaer, setFirmaer] = useState<Array<{ id: string; navn: string }>>([]);
  const [folk, setFolk] = useState<Array<{ id: string; navn: string }>>([]);
  const [steder, setSteder] = useState<VelgbarEnhet[]>([]);

  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  useEffect(() => {
    void levKlient.liste(orgId).then((v) => setFirmaer(v.map((f) => ({ id: f.id, navn: f.name })))).catch(() => {});
    void brukere.liste(orgId).then((b) => setFolk(b.map((u) => ({ id: u.id, navn: u.name })))).catch(() => {});
    void enheter.liste(orgId).then(setSteder).catch(() => {});
  }, [orgId]);

  return (
    <Modal tittel="Ny oppgave" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            oppgaver.ny(orgId, {
              title: tittel.trim(),
              description: beskrivelse.trim() || null,
              vendorId,
              frequency: frekvens,
              startDate: startDato || null,
              dueDate: frist || null,
              responsibleUserId: ansvarlig || null,
              unitId: unitId || null,
              location: sted.trim() || null,
            }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Tittel *" verdi={tittel} onEndre={setTittel} />
        <Tekstomrade etikett="Beskrivelse" verdi={beskrivelse} onEndre={setBeskrivelse} />

        <Nedtrekk
          etikett="Leverandør *"
          verdi={vendorId}
          onEndre={setVendorId}
          valg={[{ verdi: "", etikett: "Velg leverandør …" }, ...firmaer.map((f) => ({ verdi: f.id, etikett: f.navn }))]}
        />
        <Nedtrekk
          etikett="Frekvens *"
          verdi={frekvens}
          onEndre={setFrekvens}
          valg={Object.entries(FREQ_ETIKETTER).map(([verdi, etikett]) => ({ verdi, etikett }))}
        />

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

        <Nedtrekk
          etikett="Ansvarlig i styret"
          verdi={ansvarlig}
          onEndre={setAnsvarlig}
          valg={[{ verdi: "", etikett: "Ingen ansvarlig" }, ...folk.map((u) => ({ verdi: u.id, etikett: u.navn }))]}
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
          </div>
        ) : (
          <Tekstfelt etikett="Sted" verdi={sted} onEndre={setSted} plassholder="F.eks. «Teknisk rom, loft»" />
        )}

        <Knapperad
          onAvbryt={onLukk}
          sendEtikett="Opprett oppgave"
          sender={sender}
          deaktivert={!tittel.trim() || !vendorId}
        />
      </form>
    </Modal>
  );
}
