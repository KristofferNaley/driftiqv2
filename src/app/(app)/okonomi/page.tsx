"use client";

import { use, useState } from "react";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { Faner } from "@/components/felles";
import Oversikt from "./Oversikt";
import Eiere from "./Eiere";
import Budsjett from "./Budsjett";
import Felleskostnader from "./Felleskostnader";
import Fakturaer from "./Fakturaer";
import Integrasjon from "./Integrasjon";

export type OkonomiFane = "oversikt" | "eiere" | "budsjett" | "felleskostnader" | "fakturaer" | "integrasjon";

/** Rekkefølgen følger arbeidsgangen: grunnlaget (eiere) → budsjett → satser → fakturaer. */
const FANER: ReadonlyArray<{ nokkel: OkonomiFane; etikett: string }> = [
  { nokkel: "oversikt", etikett: "Oversikt" },
  { nokkel: "eiere", etikett: "Seksjoner og eiere" },
  { nokkel: "budsjett", etikett: "Budsjett" },
  { nokkel: "felleskostnader", etikett: "Felleskostnader" },
  { nokkel: "fakturaer", etikett: "Fakturaer" },
  { nokkel: "integrasjon", etikett: "Integrasjon" },
];

const erFane = (v: unknown): v is OkonomiFane => FANER.some((f) => f.nokkel === v);

/**
 * Økonomi — «DriftIQ styrer, Fiken fører» (docs/fiken.md). Fanene deler ett grunnlag:
 * eierregisteret gir mottakerne og brøken, budsjettet gir satsene, halvårskjøringen gir
 * fakturagrunnlaget, og fakturagodkjenningen gir «faktisk» tilbake til budsjettet.
 * Integrasjonsfanen sier hva regnskapskoblingen skal gjøre når den kommer.
 *
 * `?fane=fakturaer&apen=<id>` åpner en faktura direkte — for lenker fra e-post og oversikt.
 */
export default function Okonomi({
  searchParams,
}: {
  searchParams: Promise<{ fane?: string; apen?: string }>;
}) {
  const { fane: faneStart, apen: apenStart } = use(searchParams);
  const { aktivOrg } = useOkt();
  const [fane, setFane] = useState<OkonomiFane>(erFane(faneStart) ? faneStart : "oversikt");
  const [apenFaktura, setApenFaktura] = useState<string | null>(apenStart ?? null);

  const nivaa = aktivOrg?.nivaa;
  const erAdmin = nivaa === "orgadmin";
  const kanRedigere = erAdmin || nivaa === "redigering";

  function gaaTil(ny: OkonomiFane, fakturaId?: string) {
    setApenFaktura(fakturaId ?? null);
    setFane(ny);
  }

  return (
    <Layout
      tittel="Økonomi"
      subnav={<Faner valgt={fane} onVelg={(f) => gaaTil(f)} faner={FANER} />}
    >
      <div className="page-content">
        {fane === "oversikt" && <Oversikt onGaaTil={gaaTil} />}
        {fane === "eiere" && <Eiere erAdmin={erAdmin} />}
        {fane === "budsjett" && <Budsjett erAdmin={erAdmin} />}
        {fane === "felleskostnader" && <Felleskostnader erAdmin={erAdmin} />}
        {fane === "fakturaer" && (
          <Fakturaer
            erAdmin={erAdmin}
            kanRedigere={kanRedigere}
            apenStart={apenFaktura}
            onApnet={() => setApenFaktura(null)}
          />
        )}
        {fane === "integrasjon" && <Integrasjon />}
      </div>
    </Layout>
  );
}
