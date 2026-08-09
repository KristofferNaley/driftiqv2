"use client";

import Layout from "@/components/Layout";
import { Feil, Hurtigskjema, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { arshjul } from "@/lib/klient";

const MERKE: Record<string, string> = { dugnad: "info", budsjett: "muted", frist: "warn", annet: "muted" };

/** Grupperer på måned. `eventDate` er ALLTID slutten av perioden — se skjemakommentaren. */
function perManed(hendelser: Array<{ eventDate: string }>) {
  const grupper = new Map<string, number[]>();
  hendelser.forEach((h, n) => {
    const nokkel = h.eventDate.slice(0, 7);
    grupper.set(nokkel, [...(grupper.get(nokkel) ?? []), n]);
  });
  return [...grupper.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function Arshjul() {
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => arshjul.liste(o));
  const liste = data ?? [];

  async function leggTil(tittel: string) {
    if (!orgId) return;
    try {
      await arshjul.ny(orgId, { title: tittel, eventDate: new Date().toISOString().slice(0, 10) });
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke legge til hendelsen");
    }
  }

  return (
    <Layout tittel="Årshjul">
      <div className="page-content">
        <Feil melding={feil} />
        <Kort
          tittel="Hendelser"
          handling={<Hurtigskjema plassholder="Hva skjer?" onSend={leggTil} />}
        >
          {laster ? (
            <Tom tekst="Henter …" />
          ) : liste.length === 0 ? (
            <Tom tekst="Ingen hendelser lagt inn. Oppgaver og frister hentes automatisk fra sine moduler." />
          ) : (
            perManed(liste).map(([maned, indekser]) => (
              <div key={maned}>
                <div className="nav-gruppe">
                  {new Date(`${maned}-01`).toLocaleDateString("nb-NO", { month: "long", year: "numeric" })}
                </div>
                {indekser.map((n) => {
                  const h = liste[n]!;
                  return (
                    <Rad
                      key={h.id}
                      tittel={h.title}
                      meta={[
                        h.startDate ? `${dato(h.startDate)} – ${dato(h.eventDate)}` : dato(h.eventDate),
                        h.isRecurring ? "gjentas årlig" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      hoyre={<span className={`badge ${MERKE[h.category] ?? "muted"}`}>{h.category}</span>}
                    />
                  );
                })}
              </div>
            ))
          )}
        </Kort>
      </div>
    </Layout>
  );
}
