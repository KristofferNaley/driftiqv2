"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check } from "lucide-react";
import Layout from "@/components/Layout";
import { Feil, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Tekstomrade, Tekstfelt, useSending } from "@/components/skjema";
import { oppgaver } from "@/lib/klient";
import { FREQ_ETIKETTER } from "@/lib/oppgaveregler";

export default function Oppgavedetalj({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, feil, laster, last, orgId } = useOrgData((o) => oppgaver.hent(o, id), [id]);
  const [kvitterer, setKvitterer] = useState(false);
  const [redigererListe, setRedigererListe] = useState(false);

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
      handlinger={
        <>
          {/* Arket bærer QR-koden som henges opp på installasjonen. Uten denne inngangen
              er siden bare en URL man må huske. */}
          <Link className="btn btn-ghost" href={`/oppgaver/${id}/ark`}>
            🖨 Oppgaveark
          </Link>
          <button className="btn btn-primary" onClick={() => setKvitterer(true)}>
            <Check size={16} strokeWidth={2} aria-hidden />
            Kvitter ut
          </button>
        </>
      }
    >
      <div className="page-content">
        <Link href="/oppgaver" className="list-meta" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Alle oppgaver
        </Link>

        <Feil melding={feil} />

        <Kort tittel="Om oppgaven">
          <Rad tittel="Frekvens" hoyre={FREQ_ETIKETTER[data.frequency] ?? data.frequency} />
          <Rad tittel="Leverandør" hoyre={data.vendorName ?? "—"} />
          <Rad tittel="Sted" hoyre={data.unitNavn ?? data.location ?? "—"} />
          <Rad tittel="Sist utført" hoyre={dato(data.lastCompletedAt)} />
          <Rad
            tittel="Neste frist"
            hoyre={
              <>
                {dato(data.nesteFrist)}
                <span className={`badge ${data.forsinket ? "danger" : "ok"}`}>
                  {data.forsinket ? "Forsinket" : "Å jour"}
                </span>
              </>
            }
          />
          {data.description && (
            <div style={{ padding: "14px 20px", fontSize: "var(--fs-sm)", lineHeight: 1.6, color: "var(--muted)" }}>
              {data.description}
            </div>
          )}
        </Kort>

        <Kort
          tittel="Sjekkliste"
          handling={
            <button className="btn btn-ghost" onClick={() => setRedigererListe(true)}>
              Rediger
            </button>
          }
        >
          {data.sjekkliste.length === 0 ? (
            <Tom tekst="Ingen sjekkpunkter. De vises i QR-skjemaet hver gang oppgaven utføres." />
          ) : (
            data.sjekkliste.map((p) => <Rad key={p.id} tittel={p.text} />)
          )}
        </Kort>

        <Kort tittel="Utkvitteringer">
          {data.utkvitteringer.length === 0 ? (
            <Tom tekst="Aldri utført." />
          ) : (
            data.utkvitteringer.map((u) => (
              <Rad
                key={u.id}
                tittel={dato(u.completedAt)}
                meta={[u.completedBy, u.notes].filter(Boolean).join(" · ")}
                // Loggen viser kilden ærlig: manuelt registrert i appen, eller via QR-skjemaet.
                hoyre={<span className="badge muted">{u.manual ? "Manuelt" : "QR-skjema"}</span>}
              />
            ))
          )}
        </Kort>
      </div>

      {kvitterer && (
        <KvitterUt orgId={orgId!} taskId={id} onLukk={() => setKvitterer(false)} onLagret={last} />
      )}
      {redigererListe && (
        <RedigerSjekkliste
          orgId={orgId!}
          taskId={id}
          punkter={data.sjekkliste.map((p) => p.text)}
          onLukk={() => setRedigererListe(false)}
          onLagret={last}
        />
      )}
    </Layout>
  );
}

function KvitterUt({
  orgId,
  taskId,
  onLukk,
  onLagret,
}: {
  orgId: string;
  taskId: string;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [nar, setNar] = useState(new Date().toISOString().slice(0, 10));
  const [notat, setNotat] = useState("");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Registrer utført" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => oppgaver.kvitterUt(orgId, taskId, { completedAt: nar, notes: notat || null, hasDeviation: false }));
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        {/* API-et avviser datoer fram i tid — `max` gjør det tydelig før innsending. */}
        <Tekstfelt etikett="Utført dato" type="date" verdi={nar} onEndre={setNar} />
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

function RedigerSjekkliste({
  orgId,
  taskId,
  punkter,
  onLukk,
  onLagret,
}: {
  orgId: string;
  taskId: string;
  punkter: string[];
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [tekst, setTekst] = useState(punkter.join("\n"));
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Rediger sjekkliste" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const items = tekst
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => ({ text: t }));
          void send(() => oppgaver.settSjekkliste(orgId, taskId, { items }));
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstomrade
          etikett="Ett punkt per linje"
          verdi={tekst}
          onEndre={setTekst}
          notat="Malen kan endres fritt — allerede utført historikk berøres ikke, den har sin egen kopi av teksten."
        />
        <Knapperad onAvbryt={onLukk} sender={sender} />
      </form>
    </Modal>
  );
}
