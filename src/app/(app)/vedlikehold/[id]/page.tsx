"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Upload } from "lucide-react";
import Layout from "@/components/Layout";
import { Feil, Kort, Rad, Tom, dato, kr, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { vedlikehold } from "@/lib/klient";

/** Slottene som teller mot komplett-prosenten, pluss samleposen. */
const FDV_TYPER = [
  { verdi: "bruksanvisning", etikett: "Bruksanvisning" },
  { verdi: "samsvar", etikett: "Samsvarserklæring" },
  { verdi: "tegninger", etikett: "Tegninger" },
  { verdi: "vedlikeholdsinstruks", etikett: "Vedlikeholdsinstruks" },
  { verdi: "garanti", etikett: "Garanti" },
  { verdi: "annet", etikett: "Annet" },
];

const GARANTIMERKE: Record<string, string> = { aktiv: "ok", utløpt: "muted", ukjent: "muted" };

export default function Bygningsdel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, feil, laster, last, orgId } = useOrgData((o) => vedlikehold.hent(o, id), [id]);
  const [laster0pp, setLasterOpp] = useState(false);
  const [nyService, setNyService] = useState(false);

  if (laster || !data) {
    return (
      <Layout tittel="Bygningsdel">
        <div className="page-content">
          <Feil melding={feil} />
          {!feil && <Tom tekst="Henter …" />}
        </div>
      </Layout>
    );
  }

  const manglende = FDV_TYPER.filter(
    (t) => t.verdi !== "annet" && !data.dokumenter.some((d) => d.fdvType === t.verdi),
  );

  return (
    <Layout
      tittel={`${data.icon} ${data.name}`}
      handlinger={
        <button className="btn btn-primary" onClick={() => setNyService(true)}>
          Registrer service
        </button>
      }
    >
      <div className="page-content">
        <Link href="/vedlikehold" className="list-meta" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Vedlikehold
        </Link>

        <Feil melding={feil} />

        <Kort tittel="Om bygningsdelen">
          <Rad tittel="Kategori" hoyre={data.category ?? "—"} />
          <Rad tittel="Tilstandsgrad" hoyre={data.conditionGrade ?? "Ikke vurdert"} />
          <Rad tittel="Montert" hoyre={data.installedYear ?? "—"} />
          <Rad tittel="Neste tiltak" hoyre={data.nextActionYear ?? "Ikke planlagt"} />
          <Rad tittel="Estimert kostnad" hoyre={kr(data.estimatedCost)} />
          <Rad tittel="Installatør" hoyre={data.vendorName ?? "—"} />
          <Rad
            tittel="Garanti"
            hoyre={
              <>
                {dato(data.warrantyExpires)}
                <span className={`badge ${GARANTIMERKE[data.garanti]}`}>{data.garanti}</span>
              </>
            }
          />
          <Rad
            tittel="Utført i enheter"
            hoyre={data.antallEnhetsarbeider}
          />
        </Kort>

        <Kort
          tittel={`FDV-dokumentasjon (${data.fdv.fylt}/${data.fdv.av})`}
          handling={
            <label className="btn btn-ghost" style={{ cursor: "pointer" }}>
              <Upload size={16} strokeWidth={2} aria-hidden />
              {laster0pp ? "Laster opp …" : "Last opp"}
              <input
                type="file"
                hidden
                onChange={async (e) => {
                  const fil = e.target.files?.[0];
                  if (!fil || !orgId) return;
                  const form = new FormData();
                  form.append("file", fil);
                  // Typen velges etterpå ved å laste opp i riktig slot; «annet» er trygg
                  // standard fordi den ikke teller mot komplett-prosenten.
                  form.append("fdvType", "annet");
                  setLasterOpp(true);
                  try {
                    await vedlikehold.lastOppFdv(orgId, id, form);
                    await last();
                  } finally {
                    setLasterOpp(false);
                    e.target.value = "";
                  }
                }}
              />
            </label>
          }
        >
          {data.dokumenter.length === 0 ? (
            <Tom tekst="Ingen FDV-dokumenter lastet opp." />
          ) : (
            data.dokumenter.map((d) => (
              <Rad
                key={d.id}
                tittel={d.title}
                hoyre={<span className="badge muted">{FDV_TYPER.find((t) => t.verdi === d.fdvType)?.etikett ?? d.fdvType}</span>}
              />
            ))
          )}
          {/* «annet» teller ikke mot prosenten — en samlepose sier ingenting om hva som
              faktisk mangler. Derfor listes de manglende slottene eksplisitt. */}
          {manglende.length > 0 && (
            <div style={{ padding: "14px 20px", fontSize: "var(--fs-label)", color: "var(--muted)" }}>
              Mangler: {manglende.map((t) => t.etikett).join(", ")}
            </div>
          )}
        </Kort>

        <Kort tittel="Servicehistorikk">
          {data.historikk.length === 0 ? (
            <Tom tekst="Ingen service registrert." />
          ) : (
            data.historikk.map((s) => (
              <Rad
                key={s.id}
                tittel={s.title}
                meta={[dato(s.serviceDate), s.performedBy].filter(Boolean).join(" · ")}
              />
            ))
          )}
        </Kort>
      </div>

      {nyService && (
        <RegistrerService orgId={orgId!} id={id} onLukk={() => setNyService(false)} onLagret={last} />
      )}
    </Layout>
  );
}

function RegistrerService({
  orgId,
  id,
  onLukk,
  onLagret,
}: {
  orgId: string;
  id: string;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [tittel, setTittel] = useState("");
  const [nar, setNar] = useState(new Date().toISOString().slice(0, 10));
  const [utfortAv, setUtfortAv] = useState("");
  const [notat, setNotat] = useState("");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Registrer service" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            vedlikehold.nyService(orgId, id, {
              title: tittel,
              serviceDate: nar,
              performedBy: utfortAv || null,
              notes: notat || null,
            }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Hva ble gjort?" verdi={tittel} onEndre={setTittel} />
        <div className="field-row">
          <Tekstfelt etikett="Dato" type="date" verdi={nar} onEndre={setNar} />
          <Tekstfelt etikett="Utført av" verdi={utfortAv} onEndre={setUtfortAv} />
        </div>
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} />
        <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={!tittel.trim()} />
      </form>
    </Modal>
  );
}
