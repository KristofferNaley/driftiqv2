"use client";

import { useEffect, useState } from "react";
import { FileText, Info, Paperclip, Users } from "lucide-react";
import { Feil } from "@/components/felles";
import { Avkryssing, Fanemodal, Nedtrekk, Tekstfelt, Tekstomrade, useSending, type Fanevalg } from "@/components/skjema";
import { kontrakter, leverandorer, type Kontrakt } from "@/lib/klient";
import { KONTRAKT_KATEGORIER, KONTRAKT_MAKS_MB, KONTRAKT_TYPER_TEKST, kontoForKategori } from "@/lib/kontraktregler";

/** Det skjemaet leverer fra seg — matcher `kontraktInn`/`kontraktEndring` i API-et. */
export type KontraktFelter = {
  vendorId: string;
  title: string;
  category: string | null;
  annualSum: number | null;
  account: number | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  aiReadable: boolean;
};

type Fane = "avtalen" | "kontakt" | "dokument";

/**
 * Ett skjema for ny, rediger og forny — kallstedet eier API-kallene gjennom `onLagre`,
 * fordi de tre variantene lagrer ULIKT: ny er ett kall, rediger et annet, og fornyelse er
 * to (opprett ny + arkiver forgjengeren). Skjemaet skal ikke vite om det.
 *
 * ## Faner, ikke steg
 *
 * Skjemaet vokste til tolv felt (konto og årssum kom med økonomimodulen), og én kolonne
 * scrollet. Vertikale faner framfor steg 1-2-3: steg passer når rekkefølgen er tvunget,
 * faner når styret hopper til det de har for hånden — kontaktpersonen kommer ofte etter
 * avtalen er lagt inn. Bare «Avtalen» har påkrevde felt; de andre to kan stå tomme.
 *
 * Dokumentet lastes opp ETTER at avtalen er opprettet (`onLagre` returnerer den nye
 * kontrakten), i samme trykk — ellers måtte man åpne avtalen igjen for å legge ved PDF-en.
 */
export default function KontraktModal({
  tittel,
  orgId,
  utgangspunkt,
  sendEtikett = "Lagre",
  onLukk,
  onLagre,
}: {
  tittel: string;
  orgId: string;
  /** Forhåndsutfylling — hele kontrakten ved redigering, kontrakten uten datoer ved fornyelse. */
  utgangspunkt?: Partial<Kontrakt>;
  sendEtikett?: string;
  onLukk: () => void;
  /** Returnerer den lagrede avtalen når den finnes — dokumentet lastes opp på den. */
  onLagre: (felter: KontraktFelter) => Promise<Kontrakt | void>;
}) {
  const [fane, setFane] = useState<Fane>("avtalen");
  const [vendorId, setVendorId] = useState(utgangspunkt?.vendorId ?? "");
  const [navn, setNavn] = useState(utgangspunkt?.title ?? "");
  const [kategori, setKategori] = useState(utgangspunkt?.category ?? "");
  const [aarssum, setAarssum] = useState(utgangspunkt?.annualSum?.toString() ?? "");
  const [konto, setKonto] = useState(utgangspunkt?.account?.toString() ?? "");
  const [start, setStart] = useState(utgangspunkt?.startDate ?? "");
  const [slutt, setSlutt] = useState(utgangspunkt?.endDate ?? "");
  const [notat, setNotat] = useState(utgangspunkt?.notes ?? "");
  const [kontaktNavn, setKontaktNavn] = useState(utgangspunkt?.contactName ?? "");
  const [kontaktEpost, setKontaktEpost] = useState(utgangspunkt?.contactEmail ?? "");
  const [kontaktTelefon, setKontaktTelefon] = useState(utgangspunkt?.contactPhone ?? "");
  const [aiDeling, setAiDeling] = useState(utgangspunkt?.aiReadable ?? false);
  const [fil, setFil] = useState<File | null>(null);
  const [firmaer, setFirmaer] = useState<Array<{ id: string; navn: string }>>([]);

  const { sender, feil, send } = useSending(onLukk);

  useEffect(() => {
    void leverandorer
      .liste(orgId)
      .then((v) => setFirmaer(v.map((f) => ({ id: f.id, navn: f.name }))))
      .catch(() => {});
  }, [orgId]);

  // Kategorifeltet er fri tekst i basen. En lagret verdi utenfor standardsettet vises som
  // sitt eget valg — ellers ville redigering stille byttet kategori på avtalen.
  const kategorier = [
    { verdi: "", etikett: "Uten kategori" },
    ...KONTRAKT_KATEGORIER,
    ...(kategori && !KONTRAKT_KATEGORIER.some((k) => k.verdi === kategori)
      ? [{ verdi: kategori, etikett: kategori }]
      : []),
  ];

  const faner: ReadonlyArray<Fanevalg<Fane>> = [
    { nokkel: "avtalen", etikett: "Avtalen", Ikon: Info },
    { nokkel: "kontakt", etikett: "Kontakt", Ikon: Users, endret: Boolean(kontaktNavn || kontaktEpost || kontaktTelefon) },
    { nokkel: "dokument", etikett: "Dokument og deling", Ikon: FileText, endret: Boolean(fil) || aiDeling },
  ];

  function lagre() {
    void send(async () => {
      if (!vendorId) {
        setFane("avtalen");
        throw new Error("Leverandør må velges");
      }
      if (!navn.trim()) {
        setFane("avtalen");
        throw new Error("Tittel må fylles ut");
      }
      const lagret = await onLagre({
        vendorId,
        title: navn.trim(),
        category: kategori || null,
        annualSum: aarssum.trim() === "" ? null : Number(aarssum),
        account: konto.trim() === "" ? null : Number(konto),
        startDate: start || null,
        endDate: slutt || null,
        notes: notat.trim() || null,
        contactName: kontaktNavn.trim() || null,
        contactEmail: kontaktEpost.trim() || null,
        contactPhone: kontaktTelefon.trim() || null,
        aiReadable: aiDeling,
      });
      if (fil && lagret?.id) {
        const form = new FormData();
        form.append("file", fil);
        await kontrakter.lastOppFil(orgId, lagret.id, form);
      }
    });
  }

  return (
    <Fanemodal
      tittel={tittel}
      onLukk={onLukk}
      bredde={780}
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
              {sender ? "Lagrer …" : sendEtikett}
            </button>
          </div>
        </div>
      }
    >
      {fane === "avtalen" && (
        <form
          style={{ display: "flex", flexDirection: "column", gap: "15px" }}
          onSubmit={(e) => {
            e.preventDefault();
            lagre();
          }}
        >
          <Nedtrekk
            etikett="Leverandør *"
            verdi={vendorId}
            onEndre={setVendorId}
            valg={[{ verdi: "", etikett: "Velg leverandør …" }, ...firmaer.map((f) => ({ verdi: f.id, etikett: f.navn }))]}
          />
          <Tekstfelt etikett="Tittel *" verdi={navn} onEndre={setNavn} plassholder="F.eks. «Heisservice og døgnberedskap»" />
          <Nedtrekk
            etikett="Kategori"
            verdi={kategori}
            onEndre={(v) => {
              // Kontoen følger kategorien til noen har satt den selv: tomt felt, eller feltet
              // står på forrige kategoris forslag, byttes; en egen verdi røres ikke.
              const forrige = kontoForKategori(kategori);
              if (konto === "" || (forrige !== null && konto === String(forrige))) {
                setKonto(kontoForKategori(v)?.toString() ?? "");
              }
              setKategori(v);
            }}
            valg={kategorier}
          />
          <div className="field-row">
            <Tekstfelt
              etikett="Årssum (kr)"
              type="number"
              verdi={aarssum}
              onEndre={setAarssum}
              notat="Grunnlaget for «Innkjøp per år» og for budsjettforslaget i Økonomi."
            />
            <Tekstfelt
              etikett="Konto (NS 4102)"
              type="number"
              verdi={konto}
              onEndre={setKonto}
              plassholder="6620"
              notat="Foreslås fra kategorien. Legger avtalen på riktig budsjettlinje."
            />
          </div>
          <div className="field-row">
            <Tekstfelt etikett="Startdato" type="date" verdi={start} onEndre={setStart} />
            <Tekstfelt etikett="Sluttdato" type="date" verdi={slutt} onEndre={setSlutt} notat="Tom = løpende avtale." />
          </div>
          <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} rader={3} />
          {/* Usynlig submit så Enter i et felt lagrer, som i de andre skjemaene. */}
          <button type="submit" hidden aria-hidden />
        </form>
      )}

      {fane === "kontakt" && (
        <form
          style={{ display: "flex", flexDirection: "column", gap: "15px" }}
          onSubmit={(e) => {
            e.preventDefault();
            lagre();
          }}
        >
          <div className="field-note">
            Kontaktpersonen hos leverandøren for denne avtalen. Leverandørens faste kontakter ligger på
            leverandørkortet — dette er den som svarer om akkurat denne avtalen.
          </div>
          <Tekstfelt etikett="Kontaktperson" verdi={kontaktNavn} onEndre={setKontaktNavn} />
          <div className="field-row">
            <Tekstfelt etikett="E-post" type="email" verdi={kontaktEpost} onEndre={setKontaktEpost} />
            <Tekstfelt etikett="Telefon" verdi={kontaktTelefon} onEndre={setKontaktTelefon} />
          </div>
          <button type="submit" hidden aria-hidden />
        </form>
      )}

      {fane === "dokument" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
          {utgangspunkt?.fileName && !fil ? (
            <div className="field-note">
              Avtalen har dokumentet «{utgangspunkt.fileOriginalName}». Nytt dokument byttes ut på avtalekortet under
              Dokument.
            </div>
          ) : (
            <div className="field">
              <label className="field-label">Avtaledokument</label>
              <label className="btn btn-ghost" style={{ alignSelf: "flex-start" }}>
                <Paperclip size={14} strokeWidth={2} aria-hidden /> {fil ? fil.name : "Velg PDF eller bilde"}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  style={{ display: "none" }}
                  onChange={(e) => setFil(e.target.files?.[0] ?? null)}
                />
              </label>
              <div className="field-note">
                {KONTRAKT_TYPER_TEKST}, inntil {KONTRAKT_MAKS_MB} MB. Lastes opp idet avtalen lagres.
                {fil && (
                  <>
                    {" "}
                    <button type="button" className="ok-lenkeknapp" onClick={() => setFil(null)}>
                      Fjern
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          <Avkryssing
            etikett="Del med AI-rådgiveren"
            verdi={aiDeling}
            onEndre={setAiDeling}
            notat="Lar AI-rådgiveren lese avtalen og dokumentet. Kan skrus av når som helst."
          />
        </div>
      )}
    </Fanemodal>
  );
}
