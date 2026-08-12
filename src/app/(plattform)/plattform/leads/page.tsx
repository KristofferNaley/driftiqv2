"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { datoTid } from "@/components/felles";
import { Knapperad, Modal } from "@/components/skjema";
import { api } from "@/lib/klient";
import { Ramme } from "../ramme";

type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string | null;
  status: string;
  createdAt: string;
  convertedOrgId: string | null;
  orgNr: string | null;
  orgForm: string | null;
  kommune: string | null;
  adresse: string | null;
  postnummer: string | null;
  poststed: string | null;
  brregEpost: string | null;
  brregTelefon: string | null;
  nettsted: string | null;
};

const STATUS: Record<string, { etikett: string; merke: string }> = {
  ny: { etikett: "Ny", merke: "danger" },
  kontaktet: { etikett: "Kontaktet", merke: "warn" },
  kvalifisert: { etikett: "Kvalifisert", merke: "ok" },
  avslatt: { etikett: "Avslått", merke: "muted" },
  // Settes av «Lag kunde» — aldri manuelt, derfor utenfor pillene på raden.
  konvertert: { etikett: "Kunde", merke: "info" },
};
const VELGBARE = ["ny", "kontaktet", "kvalifisert", "avslatt"] as const;
const FILTRE = ["alle", "ny", "kontaktet", "kvalifisert", "avslatt", "konvertert"] as const;

/** Henvendelser fra landingssiden. Uten denne siden ville skjemaet vært en svart boks. */
export default function Leads() {
  const router = useRouter();
  const [liste, setListe] = useState<Lead[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTRE)[number]>("alle");
  const [sok, setSok] = useState("");
  const [jobber, setJobber] = useState<string | null>(null);
  const [bekreftSlett, setBekreftSlett] = useState<Lead | null>(null);

  const last = useCallback(async () => {
    try {
      setListe(await api.hent<Lead[]>("/plattform/leads"));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente henvendelsene");
    }
  }, []);

  useEffect(() => {
    void last();
  }, [last]);

  async function endre(id: string, fn: () => Promise<unknown>) {
    setJobber(id);
    setFeil(null);
    try {
      await fn();
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
    } finally {
      setJobber(null);
    }
  }

  async function slett(lead: Lead) {
    await endre(lead.id, () => api.slett(`/plattform/leads/${lead.id}`));
    setBekreftSlett(null);
  }

  // «Lag kunde»: backend oppretter organisasjonen fra leadens felter + ferskt
  // Brreg-oppslag, og vi lander rett på kundekortet.
  async function konverter(lead: Lead) {
    setJobber(lead.id);
    setFeil(null);
    try {
      const org = await api.send<{ id: string }>(`/plattform/leads/${lead.id}/konverter`, {});
      router.push(`/plattform/kunder/${org.id}`);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke opprette kunden");
      setJobber(null);
    }
  }

  const alle = liste ?? [];
  const antall = (status: string) => alle.filter((l) => l.status === status).length;

  const q = sok.trim().toLowerCase();
  const filtrert = alle.filter((l) => {
    if (filter !== "alle" && l.status !== filter) return false;
    if (
      q &&
      !(
        l.name.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        (l.company ?? "").toLowerCase().includes(q)
      )
    )
      return false;
    return true;
  });

  return (
    <Ramme tittel="Leads">
      {feil && <div className="feilmelding">{feil}</div>}

      <p className="pf-dempet">
        Interessenter som har meldt seg via landingssiden — ikke kunder ennå. Hvem som varsles
        på e-post styres under <Link className="pf-lenke-inline" href="/plattform/prismodell">Prismodell</Link>.
      </p>

      <div className="pf-kpi-grid">
        <div className="pf-kpi">
          <div className="pf-kpi-etikett">Totalt</div>
          <div className="pf-kpi-verdi">{alle.length}</div>
        </div>
        <div className="pf-kpi">
          <div className="pf-kpi-etikett">Nye</div>
          <div className="pf-kpi-verdi">{antall("ny")}</div>
        </div>
        <div className="pf-kpi">
          <div className="pf-kpi-etikett">Kvalifisert</div>
          <div className="pf-kpi-verdi">{antall("kvalifisert")}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
          {FILTRE.map((f) => (
            <button
              key={f}
              className={`pille${filter === f ? " valgt" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "alle" ? "Alle" : STATUS[f]!.etikett} (
              {f === "alle" ? alle.length : antall(f)})
            </button>
          ))}
        </div>
        <input
          className="input"
          style={{ marginLeft: "auto", width: "240px", flexShrink: 1 }}
          placeholder="Søk navn, e-post eller selskap …"
          aria-label="Søk i leads"
          value={sok}
          onChange={(e) => setSok(e.target.value)}
        />
      </div>

      {!liste ? (
        <p className="pf-dempet">Henter …</p>
      ) : filtrert.length === 0 ? (
        <p className="pf-dempet">
          {alle.length === 0 ? "Ingen henvendelser ennå." : "Ingen leads matcher filteret."}
        </p>
      ) : (
        <div className="pf-kort">
          {filtrert.map((l) => (
            <div key={l.id} className="pf-lead">
              <div style={{ minWidth: 0, flex: 1 }}>
                <span className="pf-navn">{l.name}</span>
                <span className="pf-under">
                  <a className="pf-lenke-inline" href={`mailto:${l.email}`}>{l.email}</a>
                  {l.phone && ` · ${l.phone}`}
                  {l.company && ` · ${l.company}`}
                </span>
                {l.message && <p className="pf-lead-melding">{l.message}</p>}

                {/* Fra Enhetsregisteret. Holdes atskilt fra besøkendes egne opplysninger —
                    registerets e-post er lagets offisielle, ikke personens. */}
                {l.orgNr && (
                  <div className="pf-lead-brreg">
                    <span className="pf-under">Fra Enhetsregisteret</span>
                    <div>
                      {[
                        `Org.nr. ${l.orgNr}`,
                        l.orgForm,
                        [l.adresse, [l.postnummer, l.poststed].filter(Boolean).join(" ")]
                          .filter(Boolean)
                          .join(", "),
                        l.kommune,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {(l.brregEpost || l.brregTelefon || l.nettsted) && (
                      <div>
                        {[l.brregEpost, l.brregTelefon, l.nettsted].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: "8px",
                    flexWrap: "wrap",
                    alignItems: "center",
                    marginTop: "12px",
                  }}
                >
                  {l.status !== "konvertert" &&
                    VELGBARE.map((st) => (
                      <button
                        key={st}
                        className={`pille${l.status === st ? " valgt" : ""}`}
                        disabled={jobber === l.id}
                        onClick={() =>
                          void endre(l.id, () =>
                            api.endre(`/plattform/leads/${l.id}`, { status: st }),
                          )
                        }
                      >
                        {STATUS[st]!.etikett}
                      </button>
                    ))}
                  {l.convertedOrgId ? (
                    <Link href={`/plattform/kunder/${l.convertedOrgId}`} className="btn btn-ghost">
                      Åpne kundekortet →
                    </Link>
                  ) : (
                    <button
                      className="btn btn-primary"
                      disabled={jobber === l.id}
                      onClick={() => void konverter(l)}
                    >
                      {jobber === l.id ? "Oppretter …" : "Lag kunde"}
                    </button>
                  )}
                  <button
                    className="btn btn-ghost"
                    style={{ color: "var(--danger)", marginLeft: "auto" }}
                    disabled={jobber === l.id}
                    onClick={() => setBekreftSlett(l)}
                  >
                    Slett
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: "6px",
                  flexShrink: 0,
                }}
              >
                <span className="pf-celle">{datoTid(l.createdAt)}</span>
                <span className={`badge ${STATUS[l.status]?.merke ?? "muted"}`}>
                  {STATUS[l.status]?.etikett ?? l.status}
                </span>
              </div>
            </div>
          ))}
          <div className="pf-under" style={{ padding: "11px 18px", borderTop: "1px solid var(--border)" }}>
            Viser {filtrert.length} av {alle.length} leads
          </div>
        </div>
      )}

      {bekreftSlett && (
        <Modal tittel="Slett lead" onLukk={() => setBekreftSlett(null)} bredde={420}>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
            Slette interessenten <strong>{bekreftSlett.name}</strong> permanent? Dette kan
            ikke angres.
          </p>
          <Knapperad
            onAvbryt={() => setBekreftSlett(null)}
            sendEtikett="Slett"
            farlig
            sender={jobber === bekreftSlett.id}
            onSend={() => void slett(bekreftSlett)}
          />
        </Modal>
      )}
    </Ramme>
  );
}
