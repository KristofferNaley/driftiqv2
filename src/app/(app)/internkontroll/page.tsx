"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Faner, Feil, Hurtigskjema, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { internkontroll } from "@/lib/klient";

const NIVAMERKE: Record<string, string> = { lav: "ok", middels: "warn", hoy: "danger" };
const OMRADE: Record<string, string> = {
  brannvern: "Brannvern",
  el_sikkerhet: "El-sikkerhet",
  utearealer: "Utearealer",
};

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

function Risiko() {
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => internkontroll.farer(o));
  const liste = data ?? [];

  async function nyFare(tittel: string) {
    if (!orgId) return;
    try {
      // Middels/middels som utgangspunkt — styret justerer etterpå.
      await internkontroll.nyFare(orgId, { title: tittel, probability: 3, consequence: 3 });
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke registrere faren");
    }
  }

  return (
    <>
      <Feil melding={feil} />
      <Kort
        tittel="Kartlagte farer"
        handling={<Hurtigskjema plassholder="Hva kan gå galt?" onSend={nyFare} />}
      >
        {laster ? (
          <Tom tekst="Henter …" />
        ) : liste.length === 0 ? (
          <Tom tekst="Ingen farer kartlagt ennå." />
        ) : (
          // Høyest risiko først — lista skal kunne leses ovenfra og ned.
          liste.map((f) => (
            <Rad
              key={f.id}
              tittel={f.title}
              meta={[
                `S${f.probability} × K${f.consequence}`,
                f.owner,
                f.tiltak.length ? `${f.tiltak.length} tiltak` : "ingen tiltak",
              ]
                .filter(Boolean)
                .join(" · ")}
              hoyre={<span className={`badge ${NIVAMERKE[f.niva]}`}>Risiko {f.risiko}</span>}
            />
          ))
        )}
      </Kort>
    </>
  );
}

function Vernerunder() {
  const router = useRouter();
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => internkontroll.runder(o));
  const liste = data ?? [];

  async function nyRunde(tittel: string) {
    if (!orgId) return;
    try {
      await internkontroll.nyRunde(orgId, { title: tittel });
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke opprette runden");
    }
  }

  return (
    <>
      <Feil melding={feil} />
      <Kort tittel="Vernerunder" handling={<Hurtigskjema plassholder="Navn på runde" onSend={nyRunde} />}>
        {laster ? (
          <Tom tekst="Henter …" />
        ) : liste.length === 0 ? (
          <Tom tekst="Ingen vernerunder ennå." />
        ) : (
          liste.map((r) => (
            <Rad
              key={r.id}
              onClick={() => router.push(`/internkontroll/vernerunde/${r.id}`)}
              tittel={r.title}
              meta={dato(r.roundDate)}
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
    </>
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
