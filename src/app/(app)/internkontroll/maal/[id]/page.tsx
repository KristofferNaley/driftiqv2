"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, PenLine } from "lucide-react";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { Feil, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { api } from "@/lib/klient";

type Maal = {
  id: string;
  year: number;
  goalText: string;
  approved: boolean;
  approvedDate: string | null;
  approvedMeeting: string | null;
  delmal: Array<{ id: string; text: string; category: string | null; owner: string | null }>;
  signaturer: Array<{ id: string; userId: string; navn: string | null; signedAt: string }>;
};

/**
 * HMS-mål med signering (§ 5 pkt. 4).
 *
 * Signaturen er PERSONLIG: bruker-id-en kommer fra sesjonen på serversiden, aldri fra
 * kroppen. Derfor kan siden bare signere på egne vegne — det finnes ingen «signer for»-knapp,
 * og det er ikke en mangel.
 */
export default function Hmsmaal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { bruker } = useOkt();
  const { data, feil, setFeil, laster, last, orgId } = useOrgData(
    (o) => api.hent<Maal>(`/organizations/${o}/hms/goals/${id}`),
    [id],
  );
  const [sender, setSender] = useState(false);

  const harSignert = data?.signaturer.some((s) => s.userId === bruker?.id) ?? false;

  async function veksleSignatur() {
    if (!orgId) return;
    setSender(true);
    setFeil(null);
    try {
      const sti = `/organizations/${orgId}/hms/goals/${id}/sign`;
      if (harSignert) await api.slett(sti);
      else await api.send(sti, {});
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre signaturen");
    } finally {
      setSender(false);
    }
  }

  if (laster || !data) {
    return (
      <Layout tittel="HMS-mål">
        <div className="page-content">
          <Feil melding={feil} />
          {!feil && <Tom tekst="Henter …" />}
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      tittel={`HMS-mål ${data.year}`}
      handlinger={
        <button
          className={`btn ${harSignert ? "btn-ghost" : "btn-primary"}`}
          onClick={veksleSignatur}
          disabled={sender}
        >
          <PenLine size={16} strokeWidth={2} aria-hidden />
          {harSignert ? "Trekk tilbake signatur" : "Signer"}
        </button>
      }
    >
      <div className="page-content">
        <Link href="/internkontroll" className="list-meta" style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <ArrowLeft size={14} strokeWidth={2} aria-hidden /> Internkontroll
        </Link>

        <Feil melding={feil} />

        <Kort tittel="Målet">
          <div style={{ padding: "18px 20px", fontSize: "var(--fs-sm)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {data.goalText}
          </div>
        </Kort>

        <Kort tittel="Delmål">
          {data.delmal.length === 0 ? (
            <Tom tekst="Ingen delmål." />
          ) : (
            data.delmal.map((d) => (
              <Rad key={d.id} tittel={d.text} meta={[d.category, d.owner].filter(Boolean).join(" · ")} />
            ))
          )}
        </Kort>

        <Kort tittel={`Signaturer (${data.signaturer.length})`}>
          {data.signaturer.length === 0 ? (
            <Tom tekst="Ingen har signert ennå." />
          ) : (
            // Én signatur per styremedlem — databasen håndhever det, så to like navn her
            // ville betydd to faktiske personer.
            data.signaturer.map((s) => (
              <Rad
                key={s.id}
                tittel={s.navn ?? "Ukjent bruker"}
                meta={dato(s.signedAt)}
                hoyre={s.userId === bruker?.id ? <span className="badge info">Deg</span> : null}
              />
            ))
          )}
        </Kort>

        {data.approved && (
          <Kort tittel="Vedtak">
            <Rad tittel="Godkjent" hoyre={dato(data.approvedDate)} />
            <Rad tittel="Møte" hoyre={data.approvedMeeting ?? "—"} />
          </Kort>
        )}
      </div>
    </Layout>
  );
}
