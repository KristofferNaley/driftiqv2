"use client";

import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Feil, Hurtigskjema, Kort, Rad, Tom, useOrgData } from "@/components/felles";
import { leverandorer } from "@/lib/klient";

const RELASJON: Record<string, string> = {
  avtale: "Avtale",
  handelskonto: "Handelskonto",
  adhoc: "Ved behov",
};

export default function Leverandorer() {
  const router = useRouter();
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => leverandorer.liste(o));
  const liste = data ?? [];

  async function nyLeverandor(navn: string) {
    if (!orgId) return;
    try {
      await leverandorer.ny(orgId, { name: navn });
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke legge til leverandøren");
    }
  }

  // Gruppert på relasjonstype: den styrer hvilke felter som er relevante, og dermed
  // hvordan lista leses.
  const grupper = Object.keys(RELASJON).map((type) => ({
    type,
    rader: liste.filter((l) => l.relationshipType === type),
  }));

  return (
    <Layout tittel="Leverandører">
      <div className="page-content">
        <Feil melding={feil} />
        <Kort
          tittel="Leverandører"
          handling={<Hurtigskjema plassholder="Firmanavn" onSend={nyLeverandor} />}
        >
          {laster ? (
            <Tom tekst="Henter …" />
          ) : liste.length === 0 ? (
            <Tom tekst="Ingen leverandører registrert ennå." />
          ) : (
            grupper
              .filter((g) => g.rader.length > 0)
              .map((g) => (
                <div key={g.type}>
                  <div className="nav-gruppe">{RELASJON[g.type]}</div>
                  {g.rader.map((l) => (
                    <Rad
                      key={l.id}
                      onClick={() => router.push(`/leverandorer/${l.id}`)}
                      tittel={l.name}
                      meta={[l.category, l.orgNumber, l.customerNumber && `kundenr ${l.customerNumber}`]
                        .filter(Boolean)
                        .join(" · ")}
                      hoyre={
                        <>
                          {l.ehf && <span className="badge muted">EHF</span>}
                          {!l.active && <span className="badge muted">Inaktiv</span>}
                        </>
                      }
                    />
                  ))}
                </div>
              ))
          )}
        </Kort>
      </div>
    </Layout>
  );
}
