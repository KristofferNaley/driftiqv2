"use client";

import Layout from "@/components/Layout";
import { Feil, Hurtigskjema, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { driftslogg } from "@/lib/klient";

/**
 * Driftslogg — de MANUELLE loggføringene.
 *
 * Resten av loggen (oppgaver, avvik, vedlikehold, vernerunde) hentes fra sine egne moduler
 * og slås sammen her når de sidene er portert. Bare det som ikke registreres noe annet sted
 * har en egen rad.
 */
export default function Driftslogg() {
  const { data, feil, setFeil, laster, last, orgId } = useOrgData((o) => driftslogg.liste(o));
  const liste = data ?? [];

  async function fore(tittel: string) {
    if (!orgId) return;
    try {
      await driftslogg.ny(orgId, { title: tittel, entryDate: new Date().toISOString().slice(0, 10) });
      await last();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke føre loggen");
    }
  }

  return (
    <Layout tittel="Driftslogg">
      <div className="page-content">
        <Feil melding={feil} />
        <Kort
          tittel="Loggførte hendelser"
          handling={<Hurtigskjema plassholder="Hva ble gjort?" knapp="Før i logg" onSend={fore} />}
        >
          {laster ? (
            <Tom tekst="Henter …" />
          ) : liste.length === 0 ? (
            <Tom tekst="Ingen loggføringer ennå." />
          ) : (
            liste.map((l) => (
              <Rad
                key={l.id}
                tittel={l.title}
                meta={[dato(l.entryDate), l.createdBy, l.vendorName].filter(Boolean).join(" · ")}
              />
            ))
          )}
        </Kort>
      </div>
    </Layout>
  );
}
