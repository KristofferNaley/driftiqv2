"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Lock, MessageSquarePlus } from "lucide-react";
import Layout from "@/components/Layout";
import { Feil, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { avvik } from "@/lib/klient";

const MERKE: Record<string, string> = { ny: "warn", under_behandling: "info", lukket: "ok" };
const ETIKETT: Record<string, string> = {
  ny: "Ny",
  under_behandling: "Under behandling",
  lukket: "Lukket",
};

/**
 * Avviksdetalj — dokumentasjonskjeden.
 *
 * Beskrivelse → behandling → løsning er det som havner i internkontrollpermen (§ 5 pkt. 7).
 * Er avviket lukket, forsvinner BÅDE «Legg til behandling» og «Lukk avvik»: journalen er
 * append-only, og et lukket avvik kan ikke endres.
 */
export default function Avviksdetalj({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, feil, laster, last, orgId } = useOrgData((o) => avvik.hent(o, id), [id]);
  const [behandler, setBehandler] = useState(false);
  const [lukker, setLukker] = useState(false);

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
      tittel={`#${data.number ?? "?"} ${data.title}`}
      handlinger={
        lukket ? (
          <span className="badge ok">
            <Lock size={13} strokeWidth={2.2} aria-hidden /> Lukket
          </span>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={() => setBehandler(true)}>
              <MessageSquarePlus size={16} strokeWidth={2} aria-hidden />
              Legg til behandling
            </button>
            <button className="btn btn-primary" onClick={() => setLukker(true)}>
              Lukk avvik
            </button>
          </>
        )
      }
    >
      <div className="page-content">
        <Link href="/avvik" className="list-meta" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Alle avvik
        </Link>

        <Feil melding={feil} />

        <Kort tittel="Om avviket">
          <Rad tittel="Status" hoyre={<span className={`badge ${MERKE[data.status]}`}>{ETIKETT[data.status]}</span>} />
          <Rad tittel="Meldt av" hoyre={data.reportedBy} />
          <Rad tittel="Ansvarlig" hoyre={data.assignedTo ?? "Ikke tildelt"} />
          <Rad tittel="Sted" hoyre={data.unitNavn ?? "—"} />
          <Rad tittel="Frist" hoyre={dato(data.dueDate)} />
          {data.description && (
            <div style={{ padding: "14px 20px", fontSize: "var(--fs-sm)", lineHeight: 1.6, color: "var(--muted)" }}>
              {data.description}
            </div>
          )}
        </Kort>

        <Kort tittel={`Behandling (${data.behandlinger.length})`}>
          {data.behandlinger.length === 0 ? (
            <Tom tekst="Ingen behandlingsinnlegg ennå." />
          ) : (
            data.behandlinger.map((b) => (
              <div key={b.id} style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{b.text}</div>
                <div className="list-meta" style={{ marginTop: "6px" }}>
                  {b.createdBy} · {dato(b.createdAt)}
                </div>
              </div>
            ))
          )}
        </Kort>

        <Kort tittel="Endringslogg">
          {data.logg.map((l) => (
            <Rad key={l.id} tittel={l.event} meta={dato(l.changedAt)} />
          ))}
        </Kort>
      </div>

      {behandler && (
        <LeggTilBehandling orgId={orgId!} devId={id} onLukk={() => setBehandler(false)} onLagret={last} />
      )}
      {lukker && <LukkAvvik orgId={orgId!} devId={id} onLukk={() => setLukker(false)} onLagret={last} />}
    </Layout>
  );
}

function LeggTilBehandling({
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
  const [tekst, setTekst] = useState("");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Legg til behandling" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => avvik.behandle(orgId, devId, { text: tekst }));
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstomrade
          etikett="Hva gjør dere med saken?"
          verdi={tekst}
          onEndre={setTekst}
          notat="Innlegget kan ikke endres eller slettes senere — journalen er dokumentasjon, og er bare troverdig hvis den står som den ble skrevet."
        />
        <Knapperad onAvbryt={onLukk} sendEtikett="Legg til" sender={sender} deaktivert={!tekst.trim()} />
      </form>
    </Modal>
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
  const [navn, setNavn] = useState("");
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
          void send(() => avvik.lukk(orgId, devId, { resolvedBy: navn, resolutionNotes: losning }));
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Lukket av" verdi={navn} onEndre={setNavn} />
        <Tekstomrade
          etikett="Løsning"
          verdi={losning}
          onEndre={setLosning}
          notat="Påkrevd. Et avvik lukket uten begrunnelse dokumenterer ingenting — og etter lukking kan verken avviket eller behandlingen endres."
        />
        <Knapperad
          onAvbryt={onLukk}
          sendEtikett="Lukk avviket"
          sender={sender}
          deaktivert={!navn.trim() || !losning.trim()}
        />
      </form>
    </Modal>
  );
}
