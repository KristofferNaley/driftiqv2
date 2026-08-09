"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Faner, Feil, Hurtigskjema, Kort, Nokkeltall, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { avvik } from "@/lib/klient";

const MERKE: Record<string, string> = { ny: "warn", under_behandling: "info", lukket: "ok" };
const ETIKETT: Record<string, string> = {
  ny: "Ny",
  under_behandling: "Under behandling",
  lukket: "Lukket",
};

export default function Avvik() {
  const router = useRouter();
  const [fane, setFane] = useState<"apne" | "lukkede">("apne");
  const { data, feil, setFeil, laster, last, orgId } = useOrgData(
    (o) => avvik.liste(o, fane === "lukkede"),
    [fane],
  );
  const liste = data ?? [];

  async function meld(tittel: string) {
    if (!orgId) return;
    try {
      await avvik.meld(orgId, { title: tittel });
      // Nye avvik er alltid åpne — bytt fane så brukeren ser det de nettopp meldte.
      setFane("apne");
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke melde avviket");
    }
  }

  return (
    <Layout
      tittel="Avvik"
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={[
            { nokkel: "apne", etikett: "Åpne" },
            { nokkel: "lukkede", etikett: "Lukkede" },
          ]}
        />
      }
    >
      <div className="page-content">
        <Feil melding={feil} />

        <div className="auto-grid">
          <Nokkeltall etikett={fane === "apne" ? "Åpne avvik" : "Lukkede avvik"} verdi={liste.length} />
          <Nokkeltall
            etikett="Med frist passert"
            verdi={liste.filter((a) => a.dueDate && a.dueDate < new Date().toISOString().slice(0, 10)).length}
          />
        </div>

        <Kort
          tittel={fane === "apne" ? "Åpne avvik" : "Lukkede avvik"}
          handling={<Hurtigskjema plassholder="Kort beskrivelse" knapp="Meld avvik" onSend={meld} />}
        >
          {laster ? (
            <Tom tekst="Henter …" />
          ) : liste.length === 0 ? (
            <Tom tekst={fane === "apne" ? "Ingen åpne avvik." : "Ingen lukkede avvik."} />
          ) : (
            liste.map((a) => (
              <Rad
                key={a.id}
                onClick={() => router.push(`/avvik/${a.id}`)}
                tittel={`#${a.number ?? "?"} ${a.title}`}
                meta={[a.assignedTo, a.unitNavn, a.dueDate ? `frist ${dato(a.dueDate)}` : null]
                  .filter(Boolean)
                  .join(" · ")}
                hoyre={
                  <>
                    {a.severity && <span className="badge muted">{a.severity}</span>}
                    <span className={`badge ${MERKE[a.status] ?? "muted"}`}>
                      {ETIKETT[a.status] ?? a.status}
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
