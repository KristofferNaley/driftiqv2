import { ImageResponse } from "next/og";

/**
 * OG-bildet for markedssidene, generert i stedet for tegnet.
 *
 * Samme begrunnelse som HTML-mocken på forsiden: en PNG i `public/` blir utdatert i det
 * budskapet endres. Denne bruker de samme fargene som appens mørke tema og bygges av
 * teksten den skal vise.
 *
 * Uten dette bildet blir en deling på LinkedIn en ren tekstlenke — det er hele grunnen til
 * at fila finnes.
 */

export const alt = "DriftIQ – driftsforvaltning for borettslag og sameier";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgBilde() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#0d1b2a",
          color: "#f2f5f9",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "#1459e0",
              color: "#fff",
              fontSize: 30,
              fontWeight: 800,
            }}
          >
            IQ
          </div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>
            Drift<span style={{ color: "#4d8dff" }}>IQ</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 62,
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: -1.5,
              maxWidth: 980,
            }}
          >
            Driften av bygget skal ikke ligge i hodet på styrelederen.
          </div>
          <div style={{ fontSize: 30, color: "#9fb0c3", maxWidth: 940 }}>
            Oppgaver, avvik, internkontroll og dokumentasjon for borettslag og sameier.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
