"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Feil, Hurtigskjema, Kort, Nokkeltall, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { rutiner } from "@/lib/klient";

const MERKE: Record<string, string> = { utkast: "muted", aktiv: "ok", trenger_gjennomgang: "warn" };
const ETIKETT: Record<string, string> = {
  utkast: "Utkast",
  aktiv: "Aktiv",
  trenger_gjennomgang: "Trenger gjennomgang",
};

/**
 * Rutiner.
 *
 * `effektivStatus` kommer BEREGNET fra API-et og kan ikke settes manuelt — ellers kunne man
 * skrudd av 12-måneders-varselet ved å sette statusen til «aktiv».
 */
export default function Rutiner() {
  const router = useRouter();
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => rutiner.liste(o));
  const liste = data ?? [];
  const trengerGjennomgang = liste.filter((r) => r.effektivStatus === "trenger_gjennomgang");

  async function nyRutine(tittel: string) {
    if (!orgId) return;
    try {
      await rutiner.ny(orgId, { title: tittel });
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke opprette rutinen");
    }
  }

  async function markerGjennomgatt(id: string) {
    if (!orgId) return;
    try {
      await rutiner.markerGjennomgatt(orgId, id);
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke markere som gjennomgått");
    }
  }

  return (
    <Layout tittel="Rutiner">
      <div className="page-content">
        <Feil melding={feil} />

        <div className="auto-grid">
          <Nokkeltall etikett="Rutiner" verdi={liste.length} />
          <Nokkeltall etikett="Trenger gjennomgang" verdi={trengerGjennomgang.length} />
          <Nokkeltall etikett="Akuttrutiner" verdi={liste.filter((r) => r.isCritical).length} />
        </div>

        <Kort
          tittel="Alle rutiner"
          handling={<Hurtigskjema plassholder="Tittel på rutine" onSend={nyRutine} />}
        >
          {laster ? (
            <Tom tekst="Henter …" />
          ) : liste.length === 0 ? (
            <Tom tekst="Ingen rutiner opprettet ennå." />
          ) : (
            liste.map((r) => (
              <Rad
                key={r.id}
                onClick={() => router.push(`/rutiner/${r.id}`)}
                tittel={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    {r.isCritical && (
                      <AlertTriangle size={14} strokeWidth={2.2} color="var(--danger)" aria-label="Akuttrutine" />
                    )}
                    {r.title}
                  </span>
                }
                meta={[
                  r.responsible,
                  r.category,
                  `v${r.version}`,
                  r.lastReviewedAt ? `gjennomgått ${dato(r.lastReviewedAt)}` : "aldri gjennomgått",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                hoyre={
                  <>
                    {r.effektivStatus === "trenger_gjennomgang" && (
                      <button className="btn btn-ghost" onClick={() => markerGjennomgatt(r.id)}>
                        Marker gjennomgått
                      </button>
                    )}
                    <span className={`badge ${MERKE[r.effektivStatus]}`}>
                      {ETIKETT[r.effektivStatus]}
                    </span>
                  </>
                }
              />
            ))
          )}
        </Kort>
      </div>
    </Layout>
  );
}
