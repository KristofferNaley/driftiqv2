"use client";

import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Feil, Kort, Nokkeltall, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { oppgaver } from "@/lib/klient";
import { FREQ_ETIKETTER } from "@/lib/oppgaveregler";

/**
 * Oppgaver.
 *
 * `forsinket` og `nesteFrist` kommer BEREGNET fra API-et — siden regner ikke selv. Regelen
 * bor i `lib/oppgaveregler.ts` og deles med e-postvarselet, så skjermen og varselet ikke kan
 * si ulike ting. Det var nettopp den feilen v1 hadde i sju kopier.
 */
export default function Oppgaver() {
  const router = useRouter();
  const { data, feil, laster } = useOrgData((o) => oppgaver.liste(o));
  const liste = data ?? [];
  const forsinkede = liste.filter((t) => t.forsinket);

  return (
    <Layout tittel="Oppgaver">
      <div className="page-content">
        <Feil melding={feil} />

        <div className="auto-grid">
          <Nokkeltall etikett="Aktive oppgaver" verdi={liste.length} />
          <Nokkeltall etikett="Forsinket" verdi={forsinkede.length} />
          <Nokkeltall
            etikett="Neste frist"
            verdi={
              <span style={{ fontSize: "var(--fs-lg)" }}>
                {dato(liste.map((t) => t.nesteFrist).filter(Boolean).sort()[0])}
              </span>
            }
          />
        </div>

        {forsinkede.length > 0 && (
          <Kort tittel={`Forsinket (${forsinkede.length})`}>
            {forsinkede.map((t) => (
              <Rad
                key={t.id}
                onClick={() => router.push(`/oppgaver/${t.id}`)}
                tittel={t.title}
                meta={`${t.vendorName ?? "Ingen leverandør"} · frist ${dato(t.nesteFrist)}`}
                hoyre={<span className="badge danger">Forsinket</span>}
              />
            ))}
          </Kort>
        )}

        <Kort tittel="Alle oppgaver">
          {laster ? (
            <Tom tekst="Henter …" />
          ) : liste.length === 0 ? (
            <Tom tekst="Ingen oppgaver registrert ennå." />
          ) : (
            liste.map((t) => (
              <Rad
                key={t.id}
                onClick={() => router.push(`/oppgaver/${t.id}`)}
                tittel={t.title}
                meta={[
                  FREQ_ETIKETTER[t.frequency] ?? t.frequency,
                  t.vendorName,
                  t.unitNavn ?? t.location,
                  t.lastCompletedAt ? `sist ${dato(t.lastCompletedAt)}` : "aldri utført",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                hoyre={
                  <span className={`badge ${t.forsinket ? "danger" : "ok"}`}>
                    {t.forsinket ? "Forsinket" : "Å jour"}
                  </span>
                }
              />
            ))
          )}
        </Kort>
      </div>
    </Layout>
  );
}
