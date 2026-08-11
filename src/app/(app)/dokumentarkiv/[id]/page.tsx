"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Eye, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Feil, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { Avkryssing, Knapperad, Modal, Nedtrekk, Tekstfelt, useSending } from "@/components/skjema";
import Dokumentviser, { kanForhandsvises } from "@/components/Dokumentviser";
import { dokumenter } from "@/lib/klient";

const MAPPER = [
  { verdi: "vedtekter", etikett: "Vedtekter" },
  { verdi: "generalforsamling", etikett: "Generalforsamling" },
  { verdi: "styrereferater", etikett: "Styrereferater" },
  { verdi: "bygningsdok", etikett: "Bygningsdokumentasjon" },
  { verdi: "forsikring", etikett: "Forsikring" },
  { verdi: "annet", etikett: "Annet" },
];

const kb = (n: number | null) => (n ? `${Math.round(n / 1024)} kB` : "—");

export default function Dokumentdetalj({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  // Detaljvisningen har ikke sitt eget listeendepunkt — dokumentet hentes fra lista og
  // filtreres her. Ett endepunkt mindre å vedlikeholde for en visning som uansett trenger
  // resten av mappen for å kunne flytte dokumentet.
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => dokumenter.liste(o), [id]);
  const dok = data?.find((d) => d.id === id) ?? null;
  const [redigerer, setRedigerer] = useState(false);
  const [viser, setViser] = useState(false);

  async function slett() {
    if (!orgId) return;
    try {
      await dokumenter.slett(orgId, id);
      router.push("/dokumentarkiv");
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke slette dokumentet");
    }
  }

  if (laster) {
    return (
      <Layout tittel="Dokument">
        <div className="page-content">
          <Feil melding={feil} />
          <Tom tekst="Henter …" />
        </div>
      </Layout>
    );
  }

  if (!dok) {
    return (
      <Layout tittel="Dokument">
        <div className="page-content">
          <Feil melding={feil ?? "Dokumentet finnes ikke."} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      tittel={dok.title}
      handlinger={
        <>
          {/* Fila serveres gjennom API-et og ikke som en statisk lenke — tilgangen må
              gjennom de samme gatene som resten av modulen. */}
          {kanForhandsvises(dok.contentType) && (
            <button className="btn btn-ghost" onClick={() => setViser(true)}>
              <Eye size={16} strokeWidth={2} aria-hidden />
              Vis
            </button>
          )}
          <a className="btn btn-ghost" href={`/api/organizations/${orgId}/documents/${id}/file`}>
            <Download size={16} strokeWidth={2} aria-hidden />
            Last ned
          </a>
          <button className="btn btn-ghost" onClick={() => setRedigerer(true)}>
            Rediger
          </button>
          <button className="btn btn-danger" onClick={slett}>
            <Trash2 size={16} strokeWidth={2} aria-hidden />
            Slett
          </button>
        </>
      }
    >
      <div className="page-content">
        <Link href="/dokumentarkiv" className="list-meta" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Dokumentarkiv
        </Link>

        <Feil melding={feil} />

        <Kort tittel="Om dokumentet">
          <Rad tittel="Mappe" hoyre={MAPPER.find((m) => m.verdi === dok.folder)?.etikett ?? dok.folder} />
          <Rad
            tittel="Dokumentdato"
            hoyre={dato(dok.documentDate)}
          />
          <Rad tittel="Filnavn" hoyre={dok.originalName} />
          <Rad tittel="Størrelse" hoyre={kb(dok.fileSize)} />
          <Rad
            tittel="Delt med AI-rådgiveren"
            hoyre={dok.aiReadable ? <span className="badge info">Ja</span> : <span className="badge muted">Nei</span>}
          />
        </Kort>
      </div>

      {viser && (
        <Dokumentviser
          visningsnavn={dok.originalName}
          contentType={dok.contentType}
          url={`/api/organizations/${orgId}/documents/${id}/file`}
          onLukk={() => setViser(false)}
        />
      )}

      {redigerer && (
        <Rediger dok={dok} orgId={orgId!} onLukk={() => setRedigerer(false)} onLagret={last} />
      )}
    </Layout>
  );
}

function Rediger({
  dok,
  orgId,
  onLukk,
  onLagret,
}: {
  dok: { id: string; title: string; folder: string; documentDate: string | null; aiReadable: boolean };
  orgId: string;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [tittel, setTittel] = useState(dok.title);
  const [mappe, setMappe] = useState(dok.folder);
  const [dokdato, setDokdato] = useState(dok.documentDate ?? "");
  const [delt, setDelt] = useState(dok.aiReadable);
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel="Rediger dokument" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            dokumenter.endre(orgId, dok.id, {
              title: tittel,
              folder: mappe,
              documentDate: dokdato || null,
              aiReadable: delt,
            }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Tittel" verdi={tittel} onEndre={setTittel} />
        <Nedtrekk etikett="Mappe" verdi={mappe} valg={MAPPER} onEndre={setMappe} />
        <Tekstfelt
          etikett="Dokumentdato"
          type="date"
          verdi={dokdato}
          onEndre={setDokdato}
          notat="Dokumentets egen dato, ikke når det ble lastet opp — et gammelt referat kan lastes opp i dag."
        />
        <Avkryssing
          etikett="Del med AI-rådgiveren"
          verdi={delt}
          onEndre={setDelt}
          notat="Innholdet sendes da til Anthropics API når rådgiveren trenger det. Protokoller med persondata bør styret tenke seg om på."
        />
        <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={!tittel.trim()} />
      </form>
    </Modal>
  );
}
