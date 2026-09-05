"use client";

import { useEffect, useState } from "react";
import { Info, ShieldCheck, Wrench } from "lucide-react";
import { Feil } from "@/components/felles";
import { Fanemodal, Nedtrekk, Tekstfelt, Tekstomrade, useSending, type Fanevalg } from "@/components/skjema";
import { leverandorer, type BygningsdelDetalj } from "@/lib/klient";
import { ANLEGG_KATEGORIER } from "@/lib/anleggkategorier";

/** Det skjemaet leverer fra seg — matcher `elementInn`/`elementEndring` i API-et. */
export type AnleggFelter = {
  name: string;
  icon: string;
  category: string | null;
  installedYear: number | null;
  expectedLifetimeYears: number | null;
  notes: string | null;
  conditionGrade: string | null;
  nextActionYear: number | null;
  estimatedCost: number | null;
  vendorId: string | null;
  warrantyYears: number | null;
  warrantyExpires: string | null;
};

type Fane = "om" | "tilstand" | "leverandor";

/** Tilstandsgradene fra NS 3424 — samme sett som `TILSTANDSGRADER` i lib/vedlikehold.ts. */
const TILSTAND = [
  { verdi: "", etikett: "Ikke vurdert" },
  { verdi: "TG0", etikett: "TG0 — som ny" },
  { verdi: "TG1", etikett: "TG1 — mindre slitasje" },
  { verdi: "TG2", etikett: "TG2 — vesentlig slitasje" },
  { verdi: "TG3", etikett: "TG3 — utskifting nødvendig" },
];

/**
 * Redigering av et anlegg (teknisk installasjon eller bygningsdel). Hurtigskjemaet i lista oppretter delen med bare et navn, og
 * denne modalen er der resten fylles inn — den åpnes derfor også rett etter opprettelsen.
 *
 * Tre faner etter hva styret har for hånden: det som står på typeskiltet, det som kommer
 * fra en tilstandsvurdering, og det som står i kontrakten med installatøren. Bare navnet
 * er påkrevd; alt annet kan stå tomt til man vet det.
 */
export default function AnleggModal({
  orgId,
  utgangspunkt,
  onLukk,
  onLagre,
}: {
  orgId: string;
  utgangspunkt: Partial<BygningsdelDetalj>;
  onLukk: () => void;
  onLagre: (felter: AnleggFelter) => Promise<void>;
}) {
  const tall = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  const [fane, setFane] = useState<Fane>("om");
  const [navn, setNavn] = useState(utgangspunkt.name ?? "");
  const [ikon, setIkon] = useState(utgangspunkt.icon ?? "🏗");
  const [kategori, setKategori] = useState(utgangspunkt.category ?? "");
  const [montert, setMontert] = useState(tall(utgangspunkt.installedYear));
  const [levetid, setLevetid] = useState(tall(utgangspunkt.expectedLifetimeYears));
  const [notat, setNotat] = useState(utgangspunkt.notes ?? "");
  const [tilstand, setTilstand] = useState(utgangspunkt.conditionGrade ?? "");
  const [nesteTiltak, setNesteTiltak] = useState(tall(utgangspunkt.nextActionYear));
  const [kostnad, setKostnad] = useState(tall(utgangspunkt.estimatedCost));
  const [vendorId, setVendorId] = useState(utgangspunkt.vendorId ?? "");
  const [garantiAar, setGarantiAar] = useState(tall(utgangspunkt.warrantyYears));
  const [garantiTil, setGarantiTil] = useState(utgangspunkt.warrantyExpires ?? "");
  const [firmaer, setFirmaer] = useState<Array<{ id: string; navn: string }>>([]);

  const { sender, feil, send } = useSending(onLukk);

  useEffect(() => {
    void leverandorer
      .liste(orgId)
      .then((v) => setFirmaer(v.map((f) => ({ id: f.id, navn: f.name }))))
      .catch(() => {});
  }, [orgId]);

  // Kategorifeltet er fri tekst i basen. En lagret verdi utenfor NS 3451-lista vises som sitt
  // eget valg — ellers ville redigering stille byttet kategori på anlegget.
  const kategorier = [
    { verdi: "", etikett: "Uten kategori" },
    ...ANLEGG_KATEGORIER.map((k) => ({ verdi: k.verdi, etikett: `${k.etikett} — ${k.hint}` })),
    ...(kategori && !ANLEGG_KATEGORIER.some((k) => k.verdi === kategori) ? [{ verdi: kategori, etikett: kategori }] : []),
  ];

  const faner: ReadonlyArray<Fanevalg<Fane>> = [
    { nokkel: "om", etikett: "Om delen", Ikon: Info },
    { nokkel: "tilstand", etikett: "Tilstand og plan", Ikon: Wrench, endret: Boolean(tilstand || nesteTiltak || kostnad) },
    { nokkel: "leverandor", etikett: "Leverandør og garanti", Ikon: ShieldCheck, endret: Boolean(vendorId || garantiAar || garantiTil) },
  ];

  const helt = (s: string) => (s.trim() === "" ? null : Number(s));

  function lagre() {
    void send(async () => {
      if (!navn.trim()) {
        setFane("om");
        throw new Error("Navn må fylles ut");
      }
      await onLagre({
        name: navn.trim(),
        icon: ikon.trim() || "🏗",
        category: kategori.trim() || null,
        installedYear: helt(montert),
        expectedLifetimeYears: helt(levetid),
        notes: notat.trim() || null,
        conditionGrade: tilstand || null,
        nextActionYear: helt(nesteTiltak),
        estimatedCost: helt(kostnad),
        vendorId: vendorId || null,
        warrantyYears: helt(garantiAar),
        warrantyExpires: garantiTil || null,
      });
    });
  }

  const skjema = (barn: React.ReactNode) => (
    <form
      style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      onSubmit={(e) => {
        e.preventDefault();
        lagre();
      }}
    >
      {barn}
      {/* Usynlig submit så Enter i et felt lagrer, som i de andre skjemaene. */}
      <button type="submit" hidden aria-hidden />
    </form>
  );

  return (
    <Fanemodal
      tittel={utgangspunkt.id ? "Rediger anlegg" : "Nytt anlegg"}
      onLukk={onLukk}
      faner={faner}
      valgt={fane}
      onVelg={setFane}
      fot={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", width: "100%" }}>
          <Feil melding={feil} />
          <div style={{ display: "flex", gap: "10px", marginLeft: "auto" }}>
            <button type="button" className="btn btn-ghost" onClick={onLukk}>
              Avbryt
            </button>
            <button type="button" className="btn btn-primary" disabled={sender} onClick={lagre}>
              {sender ? "Lagrer …" : "Lagre"}
            </button>
          </div>
        </div>
      }
    >
      {fane === "om" &&
        skjema(
          <>
            <div className="field-row">
              <Tekstfelt etikett="Navn *" verdi={navn} onEndre={setNavn} plassholder="F.eks. «Heis oppgang A»" />
              <Tekstfelt etikett="Ikon" verdi={ikon} onEndre={setIkon} notat="Ett tegn eller emoji, vises i lista." />
            </div>
            <Nedtrekk etikett="Kategori (NS 3451)" verdi={kategori} onEndre={setKategori} valg={kategorier} notat="Hovedgruppene i bygningsdelstabellen — samme inndeling takstmenn og forretningsførere bruker." />
            <div className="field-row">
              <Tekstfelt etikett="Montert (år)" type="number" verdi={montert} onEndre={setMontert} plassholder="2009" />
              <Tekstfelt
                etikett="Forventet levetid (år)"
                type="number"
                verdi={levetid}
                onEndre={setLevetid}
                notat="Fra leverandørens FDV eller SINTEFs levetidstabeller."
              />
            </div>
            <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} rader={3} />
          </>,
        )}

      {fane === "tilstand" &&
        skjema(
          <>
            <Nedtrekk
              etikett="Tilstandsgrad"
              verdi={tilstand}
              onEndre={setTilstand}
              valg={TILSTAND}
              notat="Etter NS 3424. Settes etter en tilstandsvurdering, ikke på magefølelse."
            />
            <div className="field-row">
              <Tekstfelt etikett="Neste tiltak (år)" type="number" verdi={nesteTiltak} onEndre={setNesteTiltak} />
              <Tekstfelt
                etikett="Estimert kostnad (kr)"
                type="number"
                verdi={kostnad}
                onEndre={setKostnad}
                notat="Grunnlaget for vedlikeholdsplanen og budsjettforslaget i Økonomi."
              />
            </div>
          </>,
        )}

      {fane === "leverandor" &&
        skjema(
          <>
            <Nedtrekk
              etikett="Installatør"
              verdi={vendorId}
              onEndre={setVendorId}
              valg={[{ verdi: "", etikett: "Ingen / ukjent" }, ...firmaer.map((f) => ({ verdi: f.id, etikett: f.navn }))]}
              notat="Fra leverandørregisteret. Servicepartneren registreres på kontrakten."
            />
            <div className="field-row">
              <Tekstfelt etikett="Garanti (år)" type="number" verdi={garantiAar} onEndre={setGarantiAar} />
              <Tekstfelt etikett="Garanti utløper" type="date" verdi={garantiTil} onEndre={setGarantiTil} />
            </div>
          </>,
        )}
    </Fanemodal>
  );
}
