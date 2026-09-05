"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Trash2, Upload } from "lucide-react";
import Layout from "@/components/Layout";
import AnleggModal from "@/components/AnleggModal";
import { Feil, Kort, Rad, Tom, dato, kr, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { vedlikehold, type Service } from "@/lib/klient";
import { anleggKategoriEtikett } from "@/lib/anleggkategorier";

/**
 * Slottene som teller mot komplett-prosenten, pluss samleposen. Én boks per slott på siden:
 * det som mangler skal synes som et tomt felt, ikke som en setning nederst i et kort.
 */
const FDV_TYPER = [
  { verdi: "bruksanvisning", etikett: "Bruksanvisning", krav: true },
  { verdi: "samsvar", etikett: "Samsvarserklæring", krav: true },
  { verdi: "tegninger", etikett: "Tegninger", krav: true },
  { verdi: "vedlikeholdsinstruks", etikett: "Vedlikeholdsinstruks", krav: true },
  { verdi: "garanti", etikett: "Garanti", krav: true },
  { verdi: "annet", etikett: "Annet", krav: false },
];

const GARANTIMERKE: Record<string, string> = { aktiv: "ok", utløpt: "muted", ukjent: "muted" };

export default function Bygningsdel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => vedlikehold.hent(o, id), [id]);
  /** FDV-typen det lastes opp til akkurat nå — knappen i den boksen viser «Laster opp …». */
  const [lasterOpp, setLasterOpp] = useState<string | null>(null);
  const [rediger, setRediger] = useState(false);
  const [bekreftSlett, setBekreftSlett] = useState(false);
  const [nyService, setNyService] = useState(false);
  const [redigerService, setRedigerService] = useState<Service | null>(null);
  const [slettService, setSlettService] = useState<Service | null>(null);

  // Hurtigskjemaet i lista oppretter delen med bare et navn og sender hit med `?rediger=1`,
  // så resten fylles inn med en gang. Leses fra window, ikke useSearchParams — den tvinger
  // hele treet til klientrendring (se CLAUDE.md).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("rediger")) {
      setRediger(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (laster || !data) {
    return (
      <Layout tittel="Anlegg">
        <div className="page-content">
          <Feil melding={feil} />
          {!feil && <Tom tekst="Henter …" />}
        </div>
      </Layout>
    );
  }

  async function lastOpp(fdvType: string, fil: File) {
    if (!orgId) return;
    const form = new FormData();
    form.append("file", fil);
    form.append("fdvType", fdvType);
    setLasterOpp(fdvType);
    try {
      await vedlikehold.lastOppFdv(orgId, id, form);
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke laste opp dokumentet");
    } finally {
      setLasterOpp(null);
    }
  }

  async function slettDokument(docId: string) {
    if (!orgId) return;
    try {
      await vedlikehold.slettFdv(orgId, id, docId);
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke slette dokumentet");
    }
  }

  return (
    <Layout
      tittel={`${data.icon} ${data.name}`}
      handlinger={
        <>
          <button className="btn btn-ghost" onClick={() => setRediger(true)}>
            <Pencil size={15} strokeWidth={2} aria-hidden /> Rediger
          </button>
          <button className="btn btn-primary" onClick={() => setNyService(true)}>
            Registrer service
          </button>
        </>
      }
    >
      <div className="page-content">
        <Link href="/vedlikehold" className="list-meta" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Vedlikehold
        </Link>

        <Feil melding={feil} />

        <Kort tittel="Om anlegget">
          <Rad tittel="Kategori" hoyre={anleggKategoriEtikett(data.category) ?? "—"} />
          <Rad tittel="Tilstandsgrad" hoyre={data.conditionGrade ?? "Ikke vurdert"} />
          <Rad tittel="Montert" hoyre={data.installedYear ?? "—"} />
          <Rad tittel="Forventet levetid" hoyre={data.expectedLifetimeYears ? `${data.expectedLifetimeYears} år` : "—"} />
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
          <Rad tittel="Utført i enheter" hoyre={data.antallEnhetsarbeider} />
          {data.notes && <Rad tittel="Notat" meta={data.notes} />}
        </Kort>

        <Kort tittel={`FDV-dokumentasjon (${data.fdv.fylt}/${data.fdv.av})`}>
          <div className="fdv-grid">
            {FDV_TYPER.map((t) => {
              const filer = data.dokumenter.filter((d) => d.fdvType === t.verdi);
              const mangler = t.krav && filer.length === 0;
              return (
                <div key={t.verdi} className={`fdv-boks${mangler ? " mangler" : ""}`}>
                  <div className="fdv-boks-hode">
                    <span className="fdv-boks-tittel">{t.etikett}</span>
                    {t.krav ? (
                      <span className={`badge ${mangler ? "warn" : "ok"}`}>{mangler ? "Mangler" : "OK"}</span>
                    ) : (
                      <span className="badge muted">Valgfritt</span>
                    )}
                  </div>
                  {filer.map((d) => (
                    <div key={d.id} className="fdv-fil">
                      <span title={d.title}>{d.title}</span>
                      <button
                        type="button"
                        className="fdv-slett"
                        aria-label={`Slett ${d.title}`}
                        title="Slett"
                        onClick={() => void slettDokument(d.id)}
                      >
                        <Trash2 size={14} strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                  ))}
                  <label className="btn btn-ghost fdv-last" style={{ cursor: "pointer" }}>
                    <Upload size={14} strokeWidth={2} aria-hidden />
                    {lasterOpp === t.verdi ? "Laster opp …" : filer.length ? "Legg til" : "Last opp"}
                    <input
                      type="file"
                      hidden
                      disabled={lasterOpp !== null}
                      onChange={(e) => {
                        const fil = e.target.files?.[0];
                        e.target.value = "";
                        if (fil) void lastOpp(t.verdi, fil);
                      }}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        </Kort>

        <Kort tittel="Servicehistorikk">
          {data.historikk.length === 0 ? (
            <Tom tekst="Ingen service registrert." />
          ) : (
            data.historikk.map((s) => (
              <Rad
                key={s.id}
                tittel={s.title}
                meta={[dato(s.serviceDate), s.performedBy, s.notes].filter(Boolean).join(" · ")}
                hoyre={
                  <span style={{ display: "inline-flex", gap: "4px" }}>
                    <button type="button" className="fdv-slett" aria-label="Endre service" title="Endre" onClick={() => setRedigerService(s)}>
                      <Pencil size={14} strokeWidth={2} aria-hidden />
                    </button>
                    <button type="button" className="fdv-slett" aria-label="Slett service" title="Slett" onClick={() => setSlettService(s)}>
                      <Trash2 size={14} strokeWidth={2} aria-hidden />
                    </button>
                  </span>
                }
              />
            ))
          )}
        </Kort>

        <Kort tittel="Fjern anlegget">
          <div className="field-note" style={{ padding: "14px 20px" }}>
            Sletter anlegget med FDV-dokumenter og servicehistorikk. Enhetsarbeid som peker på den beholdes.{" "}
            <button type="button" className="ok-lenkeknapp" onClick={() => setBekreftSlett(true)}>
              Slett anlegg
            </button>
          </div>
        </Kort>
      </div>

      {rediger && orgId && (
        <AnleggModal
          orgId={orgId}
          utgangspunkt={data}
          onLukk={() => setRediger(false)}
          onLagre={async (felter) => {
            await vedlikehold.endreElement(orgId, id, felter);
            await last();
          }}
        />
      )}

      {(nyService || redigerService) && orgId && (
        <ServiceModal
          orgId={orgId}
          id={id}
          utgangspunkt={redigerService}
          onLukk={() => {
            setNyService(false);
            setRedigerService(null);
          }}
          onLagret={last}
        />
      )}

      {slettService && orgId && (
        <Modal tittel="Slett service" onLukk={() => setSlettService(null)} bredde={420}>
          <p style={{ margin: 0 }}>
            Slette «{slettService.title}» ({dato(slettService.serviceDate)}) fra historikken?
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "18px" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setSlettService(null)}>
              Avbryt
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                try {
                  await vedlikehold.slettService(orgId, id, slettService.id);
                  setSlettService(null);
                  await last();
                } catch (e) {
                  setFeil(e instanceof Error ? e.message : "Kunne ikke slette servicen");
                  setSlettService(null);
                }
              }}
            >
              Slett
            </button>
          </div>
        </Modal>
      )}

      {bekreftSlett && orgId && (
        <Modal tittel="Slett anlegg" onLukk={() => setBekreftSlett(false)} bredde={420}>
          <p style={{ margin: 0 }}>
            Slette «{data.name}» med {data.dokumenter.length} FDV-dokument{data.dokumenter.length === 1 ? "" : "er"} og{" "}
            {data.historikk.length} service{data.historikk.length === 1 ? "" : "r"}? Dette kan ikke angres.
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "18px" }}>
            <button type="button" className="btn btn-ghost" onClick={() => setBekreftSlett(false)}>
              Avbryt
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                try {
                  await vedlikehold.slettElement(orgId, id);
                  router.push("/vedlikehold");
                } catch (e) {
                  setFeil(e instanceof Error ? e.message : "Kunne ikke slette anlegget");
                  setBekreftSlett(false);
                }
              }}
            >
              Slett
            </button>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

/** Ny eller endret service — samme skjema, `utgangspunkt` avgjør hvilket kall som gjøres. */
function ServiceModal({
  orgId,
  id,
  utgangspunkt,
  onLukk,
  onLagret,
}: {
  orgId: string;
  id: string;
  utgangspunkt: Service | null;
  onLukk: () => void;
  onLagret: () => Promise<void>;
}) {
  const [tittel, setTittel] = useState(utgangspunkt?.title ?? "");
  const [nar, setNar] = useState(utgangspunkt?.serviceDate ?? new Date().toISOString().slice(0, 10));
  const [utfortAv, setUtfortAv] = useState(utgangspunkt?.performedBy ?? "");
  const [notat, setNotat] = useState(utgangspunkt?.notes ?? "");
  const { sender, feil, send } = useSending(async () => {
    await onLagret();
    onLukk();
  });

  return (
    <Modal tittel={utgangspunkt ? "Endre service" : "Registrer service"} onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = { title: tittel, serviceDate: nar, performedBy: utfortAv || null, notes: notat || null };
          void send(() =>
            utgangspunkt ? vedlikehold.endreService(orgId, id, utgangspunkt.id, data) : vedlikehold.nyService(orgId, id, data),
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
