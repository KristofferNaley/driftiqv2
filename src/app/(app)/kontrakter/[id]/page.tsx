"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ArrowLeft, Download, Pencil, RefreshCw, Upload } from "lucide-react";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { Feil, Kort, Rad, Tom, dato, kr, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import KontraktModal from "@/components/KontraktModal";
import { kontrakter } from "@/lib/klient";
import { kontraktKategoriEtikett, kontraktStatus } from "@/lib/kontraktregler";

export default function Kontraktdetalj({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { aktivOrg } = useOkt();
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => kontrakter.hent(o, id), [id]);
  const [nyPris, setNyPris] = useState(false);
  const [arkiverer, setArkiverer] = useState(false);
  const [redigerer, setRedigerer] = useState(false);
  const [fornyer, setFornyer] = useState(false);

  const kanRedigere = aktivOrg?.nivaa === "orgadmin" || aktivOrg?.nivaa === "redigering";

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

  async function fjernFil() {
    if (!orgId) return;
    try {
      await kontrakter.slettFil(orgId, id);
      await last();
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Sletting feilet");
    }
  }

  async function gjenopprett() {
    if (!orgId) return;
    try {
      await kontrakter.gjenopprett(orgId, id);
      await last();
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Gjenoppretting feilet");
    }
  }

  async function fjernPris(prisId: string) {
    if (!orgId) return;
    try {
      await kontrakter.slettPris(orgId, id, prisId);
      await last();
    } catch (err) {
      setFeil(err instanceof Error ? err.message : "Sletting feilet");
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
  const status = kontraktStatus(data);
  const kontakt = [data.contactName, data.contactEmail, data.contactPhone].filter(Boolean).join(" · ");

  return (
    <Layout
      tittel={data.title}
      handlinger={
        kanRedigere && (
          <>
            {/* Fornyelsen er hovedhandlingen på en utløpt avtale — den arkiverer forgjengeren
                selv, så ingen må huske et eget arkiveringssteg etterpå. */}
            {status.nokkel === "utlopt" && (
              <button className="btn btn-primary" onClick={() => setFornyer(true)}>
                <RefreshCw size={16} strokeWidth={2} aria-hidden />
                Forny avtale
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => setRedigerer(true)}>
              <Pencil size={16} strokeWidth={2} aria-hidden />
              Rediger
            </button>
            <label className="btn btn-ghost" style={{ cursor: "pointer" }}>
              <Upload size={16} strokeWidth={2} aria-hidden />
              {data.fileName ? "Bytt dokument" : "Last opp dokument"}
              <input type="file" hidden onChange={lastOppFil} />
            </label>
            {arkivert ? (
              <button className="btn btn-ghost" onClick={() => void gjenopprett()}>
                <ArchiveRestore size={16} strokeWidth={2} aria-hidden />
                Hent ut av arkiv
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={() => setArkiverer(true)}>
                <Archive size={16} strokeWidth={2} aria-hidden />
                Arkiver
              </button>
            )}
          </>
        )
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
          <Rad tittel="Status" hoyre={<span className={`badge ${status.merke}`}>{status.etikett}</span>} />
          <Rad tittel="Leverandør" hoyre={data.vendorName ?? "—"} />
          <Rad tittel="Kategori" hoyre={kontraktKategoriEtikett(data.category) ?? "—"} />
          <Rad tittel="Årssum" hoyre={kr(data.annualSum)} />
          <Rad tittel="Periode" hoyre={`${dato(data.startDate)} – ${data.endDate ? dato(data.endDate) : "løpende"}`} />
          {kontakt && <Rad tittel="Kontaktperson" hoyre={kontakt} />}
          {data.notes && <Rad tittel="Notat" meta={data.notes} />}
          {data.predecessorId && (
            <Rad
              tittel="Fornyelse"
              hoyre={
                <Link href={`/kontrakter/${data.predecessorId}`} className="list-meta">
                  Se avtalen den erstattet
                </Link>
              }
            />
          )}
          <Rad
            tittel="Dokument"
            hoyre={
              data.fileName ? (
                <>
                  <a
                    className="btn btn-ghost"
                    href={`/api/organizations/${orgId}/contracts/${id}/file`}
                    download={data.fileOriginalName ?? undefined}
                  >
                    <Download size={14} strokeWidth={2} aria-hidden />
                    {data.fileOriginalName ?? "Last ned"}
                  </a>
                  {kanRedigere && (
                    <button className="btn btn-ghost" style={{ color: "var(--muted)" }} onClick={() => void fjernFil()}>
                      Fjern
                    </button>
                  )}
                </>
              ) : (
                <span style={{ color: "var(--muted)" }}>Ingen fil</span>
              )
            }
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
            kanRedigere && (
              <button className="btn btn-ghost" onClick={() => setNyPris(true)}>
                Ny pris
              </button>
            )
          }
        >
          {data.prishistorikk.length === 0 ? (
            <Tom tekst="Ingen prisendringer registrert." />
          ) : (
            // Nyeste pris er avtalens gjeldende årssum — den settes automatisk, også når en
            // oppføring fjernes.
            data.prishistorikk.map((p) => (
              <Rad
                key={p.id}
                tittel={kr(p.annualSum)}
                meta={[dato(p.effectiveDate), p.note].filter(Boolean).join(" · ")}
                hoyre={
                  kanRedigere && (
                    <button className="btn btn-ghost" style={{ color: "var(--muted)" }} onClick={() => void fjernPris(p.id)}>
                      Fjern
                    </button>
                  )
                }
              />
            ))
          )}
        </Kort>
      </div>

      {nyPris && <NyPris orgId={orgId!} id={id} onLukk={() => setNyPris(false)} onLagret={last} />}
      {arkiverer && <Arkiver orgId={orgId!} id={id} onLukk={() => setArkiverer(false)} onLagret={last} />}

      {redigerer && orgId && (
        <KontraktModal
          tittel="Rediger kontrakt"
          orgId={orgId}
          utgangspunkt={data}
          onLukk={() => setRedigerer(false)}
          onLagre={async (felter) => {
            await kontrakter.endre(orgId, id, felter);
            await last();
          }}
          onSlett={async () => {
            await kontrakter.slett(orgId, id);
            router.push("/kontrakter");
          }}
        />
      )}

      {fornyer && orgId && (
        <KontraktModal
          tittel="Forny avtale"
          orgId={orgId}
          // Vilkårene arves, datoene gjør det ikke — den nye avtalen har sin egen periode.
          utgangspunkt={{ ...data, startDate: null, endDate: null }}
          sendEtikett="Opprett ny avtale"
          onLukk={() => setFornyer(false)}
          onLagre={async (felter) => {
            const ny = await kontrakter.ny(orgId, { ...felter, predecessorId: id });
            // Forgjengeren arkiveres automatisk: poenget med «Forny» er nettopp at den gamle
            // er ferdigbehandlet, og et manuelt steg ville etterlatt den i «Utløpte» til noen
            // husket på det.
            await kontrakter.arkiver(orgId, id, { archiveNote: "Fornyet — erstattet av ny avtale" });
            router.push(`/kontrakter/${ny.id}`);
          }}
        />
      )}
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
