"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as ikoner from "lucide-react";
import { Plus, type LucideIcon } from "lucide-react";
import Layout from "@/components/Layout";
import { Feil, Tom, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { useOkt } from "@/components/OktProvider";
import { driftslogg, leverandorer } from "@/lib/klient";
// Ren fil uten server-importer — leses av både denne siden og aggregeringen på serveren.
import { KILDE_ETIKETT, LOGGKILDER, type Loggkilde, type Loggpost } from "@/lib/driftsloggslag";

/**
 * Driftsloggen — lagets kronologiske dagbok, samlet fra fem kilder.
 *
 * Fram til nå viste siden BARE de manuelle notatene, mens skjemakommentaren lovet at resten
 * skulle flettes inn ved lesing. Nå gjør serveren det (`hentDriftsloggSamlet`), og siden er
 * tidslinja fra v1: kildefilter med antall, dagsoverskrifter, og hver rad lenker inn i
 * modulen hendelsen kom fra. Notatene er unntaket — de ER her, og har ingen annen side.
 *
 * Filteret og sorteringen er KLIENT-tilstand, ikke API-parametre: hele loggen er allerede
 * hentet, og et filterklikk som utløser en ny rundtur ville gjort chipsene trege uten å
 * spare noe.
 */
export default function Driftslogg() {
  const router = useRouter();
  const { aktivOrg } = useOkt();
  const { data, feil, laster, last, orgId } = useOrgData((o) => driftslogg.liste(o));
  const [filter, setFilter] = useState<Loggkilde | "alle">("alle");
  const [fra, setFra] = useState("");
  const [til, setTil] = useState("");
  const [eldsteForst, setEldsteForst] = useState(false);
  const [forer, setForer] = useState(false);

  const kanRedigere = aktivOrg?.nivaa === "orgadmin" || aktivOrg?.nivaa === "redigering";

  // Perioden først, kilden etterpå: kildetallene på chipsene regnes av PERIODEN, slik at
  // «Avvik 12» svarer på tidsrommet styret ser på — f.eks. «hva skjedde i fjor vinter»,
  // som er spørsmålet en generalforsamling faktisk stiller.
  const iPerioden = useMemo(
    () =>
      (data?.poster ?? []).filter((p) => {
        const dag = p.tidspunkt.slice(0, 10);
        return (!fra || dag >= fra) && (!til || dag <= til);
      }),
    [data, fra, til],
  );

  const antall = useMemo(() => {
    const a = Object.fromEntries(LOGGKILDER.map((k) => [k, 0])) as Record<Loggkilde, number>;
    for (const p of iPerioden) a[p.kilde]++;
    return a;
  }, [iPerioden]);

  const poster = useMemo(() => {
    const valgte = iPerioden.filter((p) => filter === "alle" || p.kilde === filter);
    return eldsteForst ? [...valgte].reverse() : valgte;
  }, [iPerioden, filter, eldsteForst]);

  // Grupperes på DATO, med «I dag»/«I går» som overskrift — tidslinja leses dag for dag,
  // og 49 rader uten skillelinjer er en vegg.
  const dager = useMemo(() => {
    const grupper: Array<{ dag: string; poster: Loggpost[] }> = [];
    for (const p of poster) {
      const dag = p.tidspunkt.slice(0, 10);
      const siste = grupper[grupper.length - 1];
      if (siste && siste.dag === dag) siste.poster.push(p);
      else grupper.push({ dag, poster: [p] });
    }
    return grupper;
  }, [poster]);

  const totalt = iPerioden.length;

  return (
    <Layout
      tittel="Driftslogg"
      handlinger={
        kanRedigere && (
          <button className="btn btn-primary" onClick={() => setForer(true)}>
            <Plus size={16} strokeWidth={2} aria-hidden />
            Ny loggføring
          </button>
        )
      }
    >
      <div className="page-content">
        <Feil melding={feil} />

        <div className="field-note">
          Kronologisk oversikt — samler automatisk fra Oppgaver, Avvik, Vedlikehold og
          Internkontroll, pluss egne notater.
        </div>

        <div className="dl-filterrad">
          <button
            className={`dl-chip${filter === "alle" ? " valgt" : ""}`}
            onClick={() => setFilter("alle")}
          >
            Alle {totalt}
          </button>
          {LOGGKILDER.map((k) => {
            const Ikon = (ikoner as unknown as Record<string, LucideIcon>)[KILDE_ETIKETT[k].ikon] ?? ikoner.Dot;
            return (
              <button
                key={k}
                className={`dl-chip${filter === k ? " valgt" : ""}`}
                onClick={() => setFilter(k)}
              >
                <Ikon size={13} strokeWidth={1.9} aria-hidden />
                {KILDE_ETIKETT[k].filter} {antall[k]}
              </button>
            );
          })}
          <button
            className="dl-chip dl-sorter"
            onClick={() => setEldsteForst((v) => !v)}
            title="Snu sorteringen"
          >
            {eldsteForst ? "↑ Eldste først" : "↓ Nyeste først"}
          </button>
        </div>

        {/* Fra/til gjelder DAGEN hendelsen skjedde. Tomme felter = ingen grense den veien,
            så «alt før jul» og «alt etter overtakelsen» er ett felt hver. */}
        <div className="dl-periode">
          <label className="dl-periode-felt">
            <span>Fra</span>
            <input type="date" className="input" value={fra} max={til || undefined} onChange={(e) => setFra(e.target.value)} />
          </label>
          <label className="dl-periode-felt">
            <span>Til</span>
            <input type="date" className="input" value={til} min={fra || undefined} onChange={(e) => setTil(e.target.value)} />
          </label>
          {(fra || til) && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setFra("");
                setTil("");
              }}
            >
              Nullstill
            </button>
          )}
        </div>

        {laster && !data ? (
          <Tom tekst="Henter …" />
        ) : poster.length === 0 ? (
          <Tom
            tekst={
              fra || til
                ? "Ingen hendelser i denne perioden."
                : filter === "alle"
                  ? "Ingen hendelser ennå. Loggen fylles av seg selv etter hvert som oppgaver kvitteres ut og avvik meldes."
                  : `Ingen hendelser fra ${KILDE_ETIKETT[filter as Loggkilde].filter.toLowerCase()} ennå.`
            }
          />
        ) : (
          dager.map(({ dag, poster: dagens }) => (
            <div key={dag}>
              <div className="dl-dag">{dagtittel(dag)}</div>
              {dagens.map((p) => {
                const Ikon =
                  (ikoner as unknown as Record<string, LucideIcon>)[KILDE_ETIKETT[p.kilde].ikon] ?? ikoner.Dot;
                const innhold = (
                  <>
                    <span className={`dl-ikon ${p.kilde}`} aria-hidden>
                      <Ikon size={16} strokeWidth={1.9} />
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="dl-tittel">{p.tittel}</span>
                      {p.tekst && <span className="dl-tekst">{p.tekst}</span>}
                      <span className="dl-meta">
                        <span className={`dl-badge ${p.kilde}`}>{KILDE_ETIKETT[p.kilde].badge}</span>
                        {p.vendorName && <span>{p.vendorName}</span>}
                        {p.aktor && <span>{p.aktor}</span>}
                      </span>
                    </span>
                    {p.visKlokke && (
                      <span className="dl-tid">
                        {new Date(p.tidspunkt).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </>
                );
                // Rader med en kilde å gå til er knapper; notatene er endestasjonen sin.
                return p.sti ? (
                  <button key={p.id} className="dl-rad lenke" onClick={() => router.push(p.sti!)}>
                    {innhold}
                  </button>
                ) : (
                  <div key={p.id} className="dl-rad">
                    {innhold}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {forer && (
        <NyLoggforing
          orgId={orgId!}
          onLukk={() => setForer(false)}
          onLagret={async () => {
            await last();
            setForer(false);
          }}
        />
      )}
    </Layout>
  );
}

/** «I dag, 10. august» / «I går, 9. august» / «8. august» — med årstall når det ikke er i år. */
function dagtittel(dag: string): string {
  const iDag = new Date().toISOString().slice(0, 10);
  const iGaar = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const d = new Date(`${dag}T12:00:00`);
  const tekst = d.toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "long",
    ...(dag.slice(0, 4) !== iDag.slice(0, 4) ? { year: "numeric" } : {}),
  });
  if (dag === iDag) return `I dag, ${tekst}`;
  if (dag === iGaar) return `I går, ${tekst}`;
  return tekst;
}

/**
 * Notatmodalen — for det som ikke registreres noe annet sted.
 *
 * Hurtigskjemaet med ett felt er byttet ut: v1s modal har dato (etterregistrering er
 * normalen — «i forrige uke byttet vi …»), beskrivelse og leverandør, og API-et har tatt
 * imot alle fire feltene hele tiden. Det var bare UI-et som sendte ett av dem.
 */
function NyLoggforing({
  orgId,
  onLukk,
  onLagret,
}: {
  orgId: string;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [tittel, setTittel] = useState("");
  const [dato, setDato] = useState(new Date().toISOString().slice(0, 10));
  const [tekst, setTekst] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [firmaer, setFirmaer] = useState<Array<{ id: string; navn: string }>>([]);
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
  });

  useEffect(() => {
    void leverandorer
      .liste(orgId)
      .then((v) => setFirmaer(v.map((f) => ({ id: f.id, navn: f.name }))))
      .catch(() => {});
  }, [orgId]);

  return (
    <Modal tittel="Ny loggføring" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            driftslogg.ny(orgId, {
              title: tittel.trim(),
              entryDate: dato,
              description: tekst.trim() || null,
              vendorId: vendorId || null,
            }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Hva ble gjort? *" verdi={tittel} onEndre={setTittel} plassholder="F.eks. «Byttet lyspære i oppgang B»" />
        <Tekstfelt
          etikett="Dato"
          type="date"
          verdi={dato}
          onEndre={setDato}
          notat="Datoen det skjedde — ikke nødvendigvis i dag."
        />
        <Tekstomrade etikett="Beskrivelse (valgfritt)" verdi={tekst} onEndre={setTekst} />
        <Nedtrekk
          etikett="Leverandør"
          verdi={vendorId}
          onEndre={setVendorId}
          valg={[{ verdi: "", etikett: "Ingen leverandør" }, ...firmaer.map((f) => ({ verdi: f.id, etikett: f.navn }))]}
          notat="Hvem som utførte jobben, hvis det var et firma."
        />
        <Knapperad onAvbryt={onLukk} sendEtikett="Før i loggen" sender={sender} deaktivert={!tittel.trim()} />
      </form>
    </Modal>
  );
}
