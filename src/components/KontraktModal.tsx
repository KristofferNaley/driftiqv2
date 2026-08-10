"use client";

import { useEffect, useState } from "react";
import { Feil } from "@/components/felles";
import { Avkryssing, Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { leverandorer, type Kontrakt } from "@/lib/klient";
import { KONTRAKT_KATEGORIER } from "@/lib/kontraktregler";

/** Det skjemaet leverer fra seg — matcher `kontraktInn`/`kontraktEndring` i API-et. */
export type KontraktFelter = {
  vendorId: string;
  title: string;
  category: string | null;
  annualSum: number | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  aiReadable: boolean;
};

/**
 * Ett skjema for ny, rediger og forny — kallstedet eier API-kallene gjennom `onLagre`,
 * fordi de tre variantene lagrer ULIKT: ny er ett kall, rediger et annet, og fornyelse er
 * to (opprett ny + arkiver forgjengeren). Skjemaet skal ikke vite om det.
 */
export default function KontraktModal({
  tittel,
  orgId,
  utgangspunkt,
  sendEtikett = "Lagre",
  onLukk,
  onLagre,
  onSlett,
}: {
  tittel: string;
  orgId: string;
  /** Forhåndsutfylling — hele kontrakten ved redigering, kontrakten uten datoer ved fornyelse. */
  utgangspunkt?: Partial<Kontrakt>;
  sendEtikett?: string;
  onLukk: () => void;
  onLagre: (felter: KontraktFelter) => Promise<void>;
  /** Vis «Slett kontrakt» med bekreftelsessteg. Kun redigering sender denne. */
  onSlett?: () => Promise<void>;
}) {
  const [vendorId, setVendorId] = useState(utgangspunkt?.vendorId ?? "");
  const [navn, setNavn] = useState(utgangspunkt?.title ?? "");
  const [kategori, setKategori] = useState(utgangspunkt?.category ?? "");
  const [aarssum, setAarssum] = useState(utgangspunkt?.annualSum?.toString() ?? "");
  const [start, setStart] = useState(utgangspunkt?.startDate ?? "");
  const [slutt, setSlutt] = useState(utgangspunkt?.endDate ?? "");
  const [notat, setNotat] = useState(utgangspunkt?.notes ?? "");
  const [kontaktNavn, setKontaktNavn] = useState(utgangspunkt?.contactName ?? "");
  const [kontaktEpost, setKontaktEpost] = useState(utgangspunkt?.contactEmail ?? "");
  const [kontaktTelefon, setKontaktTelefon] = useState(utgangspunkt?.contactPhone ?? "");
  const [aiDeling, setAiDeling] = useState(utgangspunkt?.aiReadable ?? false);
  const [firmaer, setFirmaer] = useState<Array<{ id: string; navn: string }>>([]);
  const [bekreftSlett, setBekreftSlett] = useState(false);

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

  if (bekreftSlett && onSlett) {
    return (
      <Modal tittel="Slett kontrakt" onLukk={onLukk} bredde={420}>
        <Feil melding={feil} />
        <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, margin: 0 }}>
          Slett <strong>{navn || "avtalen"}</strong>? Prishistorikken og et eventuelt
          avtaledokument slettes også. En avsluttet avtale bør heller arkiveres — sletting er
          for feilregistreringer.
        </p>
        <Knapperad
          onAvbryt={() => setBekreftSlett(false)}
          avbrytEtikett="Tilbake"
          sendEtikett="Slett"
          farlig
          sender={sender}
          onSend={() => void send(onSlett)}
        />
      </Modal>
    );
  }

  return (
    <Modal tittel={tittel} onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            onLagre({
              vendorId,
              title: navn.trim(),
              category: kategori || null,
              annualSum: aarssum.trim() === "" ? null : Number(aarssum),
              startDate: start || null,
              endDate: slutt || null,
              notes: notat.trim() || null,
              contactName: kontaktNavn.trim() || null,
              contactEmail: kontaktEpost.trim() || null,
              contactPhone: kontaktTelefon.trim() || null,
              aiReadable: aiDeling,
            }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />

        <Nedtrekk
          etikett="Leverandør *"
          verdi={vendorId}
          onEndre={setVendorId}
          valg={[{ verdi: "", etikett: "Velg leverandør …" }, ...firmaer.map((f) => ({ verdi: f.id, etikett: f.navn }))]}
        />
        <Tekstfelt etikett="Tittel *" verdi={navn} onEndre={setNavn} plassholder="F.eks. «Heisservice og døgnberedskap»" />
        <Nedtrekk etikett="Kategori" verdi={kategori} onEndre={setKategori} valg={kategorier} />

        <Tekstfelt
          etikett="Årssum (kr)"
          type="number"
          verdi={aarssum}
          onEndre={setAarssum}
          notat="Grunnlaget for «Innkjøp per år». Senere prisendringer registreres på avtalen."
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Tekstfelt etikett="Startdato" type="date" verdi={start} onEndre={setStart} />
          <Tekstfelt etikett="Sluttdato" type="date" verdi={slutt} onEndre={setSlutt} notat="Tom = løpende avtale." />
        </div>

        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} />

        <Tekstfelt etikett="Kontaktperson" verdi={kontaktNavn} onEndre={setKontaktNavn} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <Tekstfelt etikett="E-post" type="email" verdi={kontaktEpost} onEndre={setKontaktEpost} />
          <Tekstfelt etikett="Telefon" verdi={kontaktTelefon} onEndre={setKontaktTelefon} />
        </div>

        <Avkryssing
          etikett="Del med AI-rådgiveren"
          verdi={aiDeling}
          onEndre={setAiDeling}
          notat="Lar AI-rådgiveren lese avtalen og dokumentet. Kan skrus av når som helst."
        />

        <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
          {onSlett && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: "var(--danger)" }}
              onClick={() => setBekreftSlett(true)}
            >
              Slett kontrakt …
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost" onClick={onLukk}>
            Avbryt
          </button>
          <button type="submit" className="btn btn-primary" disabled={sender || !navn.trim() || !vendorId}>
            {sender ? "Lagrer …" : sendEtikett}
          </button>
        </div>
      </form>
    </Modal>
  );
}
