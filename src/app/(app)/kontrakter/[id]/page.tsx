"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Archive, ArrowLeft, Upload } from "lucide-react";
import Layout from "@/components/Layout";
import { Feil, Kort, Rad, Tom, dato, kr, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { kontrakter } from "@/lib/klient";

export default function Kontraktdetalj({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => kontrakter.hent(o, id), [id]);
  const [nyPris, setNyPris] = useState(false);
  const [arkiverer, setArkiverer] = useState(false);

  async function lastOppFil(e: React.ChangeEvent<HTMLInputElement>) {
    const fil = e.target.files?.[0];
    if (!fil || !orgId) return;
    const form = new FormData();
    form.append("file", fil);
    try {
      await kontrakter.lastOppFil(orgId, id, form);
      await last();
    } catch (err) {
      // Kontrakter tillater bare PDF/PNG/JPG, men opptil 25 MB — API-et sier hvilken av
      // grensene som slo inn.
      setFeil(err instanceof Error ? err.message : "Opplasting feilet");
    } finally {
      e.target.value = "";
    }
  }

  if (laster || !data) {
    return (
      <Layout tittel="Avtale">
        <div className="page-content">
          <Feil melding={feil} />
          {!feil && <Tom tekst="Henter …" />}
        </div>
      </Layout>
    );
  }

  const arkivert = Boolean(data.archivedAt);

  return (
    <Layout
      tittel={data.title}
      handlinger={
        <>
          <label className="btn btn-ghost" style={{ cursor: "pointer" }}>
            <Upload size={16} strokeWidth={2} aria-hidden />
            {data.fileName ? "Bytt dokument" : "Last opp dokument"}
            <input type="file" hidden onChange={lastOppFil} />
          </label>
          {!arkivert && (
            <button className="btn btn-ghost" onClick={() => setArkiverer(true)}>
              <Archive size={16} strokeWidth={2} aria-hidden />
              Arkiver
            </button>
          )}
        </>
      }
    >
      <div className="page-content">
        <Link href="/kontrakter" className="list-meta" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Alle avtaler
        </Link>

        <Feil melding={feil} />

        {arkivert && (
          <div className="card">
            <div className="card-body" style={{ color: "var(--muted)", fontSize: "var(--fs-sm)" }}>
              Arkivert {dato(data.archivedAt)}
              {data.archiveNote ? ` — ${data.archiveNote}` : ""}. Avtalen er ikke slettet: utløpte
              avtaler har verdi som historikk ved regnskap, meglerpakke og tvist.
            </div>
          </div>
        )}

        <Kort tittel="Om avtalen">
          <Rad tittel="Leverandør" hoyre={data.vendorName ?? "—"} />
          <Rad tittel="Kategori" hoyre={data.category ?? "—"} />
          <Rad tittel="Årssum" hoyre={kr(data.annualSum)} />
          <Rad tittel="Periode" hoyre={`${dato(data.startDate)} – ${data.endDate ? dato(data.endDate) : "løpende"}`} />
          <Rad
            tittel="Dokument"
            hoyre={data.fileOriginalName ?? <span style={{ color: "var(--muted)" }}>Ingen fil</span>}
          />
          <Rad
            tittel="Delt med AI-rådgiveren"
            hoyre={
              data.aiReadable ? (
                <span className="badge info">Ja</span>
              ) : (
                <span className="badge muted">Nei</span>
              )
            }
          />
        </Kort>

        <Kort
          tittel="Prishistorikk"
          handling={
            <button className="btn btn-ghost" onClick={() => setNyPris(true)}>
              Ny pris
            </button>
          }
        >
          {data.prishistorikk.length === 0 ? (
            <Tom tekst="Ingen prisendringer registrert." />
          ) : (
            // Nyeste pris er avtalens gjeldende årssum — den settes automatisk.
            data.prishistorikk.map((p) => (
              <Rad
                key={p.id}
                tittel={kr(p.annualSum)}
                meta={[dato(p.effectiveDate), p.note].filter(Boolean).join(" · ")}
              />
            ))
          )}
        </Kort>
      </div>

      {nyPris && <NyPris orgId={orgId!} id={id} onLukk={() => setNyPris(false)} onLagret={last} />}
      {arkiverer && <Arkiver orgId={orgId!} id={id} onLukk={() => setArkiverer(false)} onLagret={last} />}
    </Layout>
  );
}

function NyPris({ orgId, id, onLukk, onLagret }: { orgId: string; id: string; onLukk: () => void; onLagret: () => Promise<void> }) {
  const [sum, setSum] = useState("");
  const [fra, setFra] = useState(new Date().toISOString().slice(0, 10));
  const [notat, setNotat] = useState("");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Ny pris" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            kontrakter.nyPris(orgId, id, { annualSum: Number(sum), effectiveDate: fra, note: notat || null }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Årssum (kr)" type="number" verdi={sum} onEndre={setSum} />
        <Tekstfelt etikett="Gjelder fra" type="date" verdi={fra} onEndre={setFra} />
        <Tekstomrade
          etikett="Notat"
          verdi={notat}
          onEndre={setNotat}
          notat="Nyeste pris blir avtalens gjeldende årssum."
        />
        <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={!sum} />
      </form>
    </Modal>
  );
}

function Arkiver({ orgId, id, onLukk, onLagret }: { orgId: string; id: string; onLukk: () => void; onLagret: () => Promise<void> }) {
  const [notat, setNotat] = useState("");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Arkiver avtale" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => kontrakter.arkiver(orgId, id, { archiveNote: notat || null }));
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstomrade
          etikett="Hvorfor arkiveres den?"
          verdi={notat}
          onEndre={setNotat}
          notat="Avtalen fjernes fra oversikten og KPI-ene, men slettes aldri."
        />
        <Knapperad onAvbryt={onLukk} sendEtikett="Arkiver" sender={sender} />
      </form>
    </Modal>
  );
}
