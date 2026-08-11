"use client";

import { Download } from "lucide-react";
import { Modal } from "@/components/skjema";

/**
 * Kan nettleseren vise denne typen? Gaten for å i det hele tatt tilby «Vis» — arkivet tar
 * imot Word-filer og iPhone-bilder (HEIC), og ingen av dem kan gjengis i iframe/img.
 * Motstykket til v1s `canPreview`, men på contentType i stedet for filnavn: originalnavnet
 * kan lyve («rapport.pdf.exe»), typen er validert ved opplasting.
 */
export function kanForhandsvises(contentType: string | null | undefined): boolean {
  if (contentType === "application/pdf") return true;
  if (!contentType?.startsWith("image/")) return false;
  return contentType !== "image/heic" && contentType !== "image/heif";
}

/**
 * Dokumentviser — PDF i `<iframe>`, bilde i `<img>`. Porten av v1s `FilePreviewModal`,
 * uten blob-omveien: v2 autentiserer med cookie, så viseren kan peke rett på filruta
 * med `?inline` i stedet for å hente en objekt-URL med token først.
 *
 * PDF kontra bilde avgjøres av `contentType` når kallstedet har den (dokumentarkivet),
 * ellers av det LAGREDE filnavnet (kontrakter) — endelsen der er satt av opplastingen
 * og kan stoles på, i motsetning til visningsnavnet.
 */
export default function Dokumentviser({
  filnavn,
  visningsnavn,
  contentType,
  url,
  onLukk,
}: {
  /** Lagret filnavn (uuid + endelse) — avgjør PDF kontra bilde når contentType mangler. */
  filnavn?: string;
  /** Navnet brukeren kjenner fila som. Står i tittelraden. */
  visningsnavn?: string | null;
  /** Lagret Content-Type — foretrukket signal for PDF kontra bilde. */
  contentType?: string | null;
  /** Filruta UTEN `?inline` — viseren legger den på selv, nedlastingen skal ikke ha den. */
  url: string;
  onLukk: () => void;
}) {
  const navn = visningsnavn ?? filnavn ?? "Dokument";
  const erPdf = contentType ? contentType === "application/pdf" : Boolean(filnavn?.toLowerCase().endsWith(".pdf"));

  return (
    <Modal tittel={navn} onLukk={onLukk} bredde={1100} utenPolstring>
      {/* Fast høyde, ikke innholdshøyde: en iframe uten høyde å fylle kollapser til null. */}
      <div style={{ height: "76dvh", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)" }}>
          {erPdf ? (
            <iframe
              src={`${url}?inline`}
              title={navn}
              style={{ width: "100%", height: "100%", border: "none", display: "block" }}
            />
          ) : (
            <img
              src={`${url}?inline`}
              alt={navn}
              style={{ maxWidth: "100%", maxHeight: "100%", display: "block", margin: "auto", padding: "16px" }}
            />
          )}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "10px 14px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <a className="btn btn-ghost" href={url} download={visningsnavn ?? undefined}>
            <Download size={14} strokeWidth={2} aria-hidden />
            Last ned
          </a>
        </div>
      </div>
    </Modal>
  );
}
