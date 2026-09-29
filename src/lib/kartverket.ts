/**
 * Adressesøk mot Kartverkets åpne adresse-API (Geonorge) — port av v1s `/adressesok`.
 *
 * Til autofyll av enhetsregisteret: hver vegadresse har en liste bruksenhetsnummer
 * (H0101 …) som blir leilighetsnummer. Areal og andelsnummer finnes IKKE i det åpne
 * API-et og må fortsatt inn manuelt.
 *
 * Proxyes gjennom vårt API i stedet for å la nettleseren kalle Geonorge direkte — samme
 * grunn som Brreg-styreoppslaget: kundens brukere skal ikke sende IP og søkestrenger til
 * tredjeparter fra appen.
 */

import { ApiFeil } from "./api";

export type Adressetreff = {
  adressetekst: string | null;
  nummer: number | null;
  bokstav: string;
  postnummer: string | null;
  poststed: string | null;
  kommunenavn: string | null;
  bruksenhetsnummer: string[];
};

type GeonorgeSvar = {
  adresser?: Array<{
    adressetekst?: string;
    nummer?: number;
    bokstav?: string;
    postnummer?: string;
    poststed?: string;
    kommunenavn?: string;
    bruksenhetsnummer?: string[];
  }>;
};

export async function sokAdresser(sok: string): Promise<Adressetreff[]> {
  // Komma gir null treff hos Geonorge — «Håsteins gate 9, Bergen» må bli «Håsteins gate 9
  // Bergen». Stedsnavn som egne ord matcher fint; det er tegnet som ødelegger.
  const rent = sok.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (rent.length < 3) return [];

  const url =
    "https://ws.geonorge.no/adresser/v1/sok?" +
    new URLSearchParams({
      sok: rent,
      treffPerSide: "20",
      // Kun vegadresser har bruksenhetsnummer; matrikkeladresser er støy her.
      objtype: "Vegadresse",
    }).toString();

  let data: GeonorgeSvar;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as GeonorgeSvar;
  } catch {
    // 503, ikke 502: Cloudflare bytter ut 502/504 med sin egen side (CLAUDE.md «Fallgruver»).
    throw new ApiFeil(503, "Fikk ikke kontakt med Kartverket. Prøv igjen om litt.");
  }

  return (data.adresser ?? []).map((a) => ({
    adressetekst: a.adressetekst ?? null,
    nummer: a.nummer ?? null,
    bokstav: a.bokstav ?? "",
    postnummer: a.postnummer ?? null,
    poststed: a.poststed ?? null,
    kommunenavn: a.kommunenavn ?? null,
    bruksenhetsnummer: a.bruksenhetsnummer ?? [],
  }));
}

export type Stedstreff = { tekst: string; lat: number; lon: number };

/**
 * Adressesøk med koordinater — til værmeldingen på oppslagstavla, som trenger et punkt og
 * ikke bruksenheter. Samme Geonorge-API og samme proxy-begrunnelse som over.
 */
export async function sokSted(sok: string): Promise<Stedstreff[]> {
  const rent = sok.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (rent.length < 3) return [];
  const url =
    "https://ws.geonorge.no/adresser/v1/sok?" +
    new URLSearchParams({ sok: rent, treffPerSide: "8", utkoordsys: "4258" }).toString();
  let data: {
    adresser?: Array<{ adressetekst?: string; poststed?: string; representasjonspunkt?: { lat?: number; lon?: number } }>;
  };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as typeof data;
  } catch {
    throw new ApiFeil(503, "Fikk ikke kontakt med Kartverket. Prøv igjen om litt.");
  }
  return (data.adresser ?? []).flatMap((a) =>
    typeof a.representasjonspunkt?.lat === "number" && typeof a.representasjonspunkt?.lon === "number"
      ? [
          {
            tekst: [a.adressetekst, a.poststed].filter(Boolean).join(", "),
            lat: a.representasjonspunkt.lat,
            lon: a.representasjonspunkt.lon,
          },
        ]
      : [],
  );
}
