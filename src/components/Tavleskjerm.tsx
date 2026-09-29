"use client";

import { useEffect, useState, type CSSProperties } from "react";
import {
  KATEGORI_ETIKETT,
  KONTAKT_SEKUNDER,
  STANDARD_SEKUNDER,
  skjermpalett,
  visKode,
  type Skjerminnhold,
} from "@/lib/oppslagstavleregler";

/**
 * Det beboeren ser på veggen. Brukes BÅDE av skjermen selv (`/skjerm`) og av
 * forhåndsvisningen i appen, så styret aldri ser en annen tavle enn den som henger i oppgangen.
 *
 * Alle mål er i `--u` (1 % av skjermens bredde, via container-enheter) i stedet for
 * `--fs-*`-tokenene: tavla skal se lik ut på en 55-tommer og i et 400 px vindu. Feltene
 * ligger i FASTE soner — plassen avhenger bare av hvilke felt som er på, aldri av hvor mye
 * tekst et oppslag har. Et langt oppslag klippes; det dytter aldri kalenderen ut av skjermen.
 */
export function Tavleskjerm({
  innhold,
  bildeUrl,
  kontaktbildeUrl,
  logoUrl,
  utenNett,
}: {
  innhold: Skjerminnhold;
  /** URL til bildet i et bildeoppslag — blob-URL på skjermen, API-sti i appen. */
  bildeUrl: (postId: string) => string | null;
  kontaktbildeUrl: (kontaktId: string) => string | null;
  logoUrl: string | null;
  /** Satt når skjermen ikke har fått svar på en stund: tidspunktet for siste vellykkede henting. */
  utenNett?: string | null;
}) {
  const naa = useKlokke();
  const [indeks, setIndeks] = useState(0);
  const [kontaktIndeks, setKontaktIndeks] = useState(0);
  // `kontakter` mangler i innhold en skjerm lagret før feltet fantes — da er lista tom.
  const { skjerm, org, utseende, oppslag, hendelser, kontakter = [] } = innhold;
  const liggende = skjerm.retning === "liggende";
  const aktivt = oppslag.length > 0 ? oppslag[indeks % oppslag.length]! : null;

  // Hvert oppslag står i SIN tid — derfor en timeout per oppslag, ikke et fast intervall.
  const sekunder = aktivt?.sekunder ?? STANDARD_SEKUNDER;
  useEffect(() => {
    if (oppslag.length < 2) return;
    const t = window.setTimeout(() => setIndeks((i) => i + 1), sekunder * 1000);
    return () => window.clearTimeout(t);
  }, [indeks, sekunder, oppslag.length]);

  useEffect(() => {
    if (kontakter.length < 2) return;
    const t = window.setInterval(() => setKontaktIndeks((i) => i + 1), KONTAKT_SEKUNDER * 1000);
    return () => window.clearInterval(t);
  }, [kontakter.length]);

  const palett = skjermpalett(utseende.background, utseende.accent) as CSSProperties;
  // `avfall` er null når borettslaget ikke er koblet til BIR — da er feltet borte, ikke tomt.
  const avfall = innhold.avfall ?? null;
  const felt = new Set(skjerm.felt.filter((f) => f !== "avfall" || avfall !== null));
  const kontakt = kontakter.length > 0 ? kontakter[kontaktIndeks % kontakter.length]! : null;
  const sistHentet = utenNett ? new Date(utenNett) : null;

  if (utenNett && utseende.offlineMode === "melding") {
    return (
      <div className={`ot-skjerm${liggende ? " liggende" : ""}`} style={palett}>
        <Topp innhold={innhold} naa={naa} logoUrl={logoUrl} />
        <div className="ot-midt">
          <h3>Skjermen har ikke kontakt med internett</h3>
          <p>Styret kan se det i DriftIQ.</p>
          <div className="ot-meta">
            {sistHentet && `Sist tilkoblet ${klokke(sistHentet)}`}
          </div>
        </div>
        <Fot tekst="Prøver igjen hvert minutt" />
      </div>
    );
  }

  const omraader = soner(felt, liggende);

  return (
    <div className={`ot-skjerm${liggende ? " liggende" : ""}`} style={palett}>
      <Topp innhold={innhold} naa={naa} logoUrl={logoUrl} />
      <div className="ot-kropp" style={omraader}>
        {felt.has("oppslag") &&
          (aktivt ? (
            <div
              key={aktivt.id}
              className={`ot-hero ot-fade ${aktivt.type === "bilde" ? "media" : (aktivt.kategori ?? "info")}`}
            >
              {aktivt.type === "bilde" ? (
                <>
                  {bildeUrl(aktivt.id) ? (
                    <img className="ot-bilde" src={bildeUrl(aktivt.id)!} alt="" />
                  ) : (
                    <div className="ot-bilde" />
                  )}
                  <h3 className="bildetekst">{aktivt.tittel}</h3>
                </>
              ) : (
                <>
                  <div className="ot-tag">{KATEGORI_ETIKETT[aktivt.kategori ?? "info"]}</div>
                  <h3>{aktivt.tittel}</h3>
                  {aktivt.tekst && <p>{aktivt.tekst}</p>}
                </>
              )}
              {oppslag.length > 1 && (
                <div className="ot-prikker">
                  {oppslag.map((p, i) => (
                    <i key={p.id} className={i === indeks % oppslag.length ? "pa" : ""} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="ot-hero info">
              <div className="ot-tag">Oppslag</div>
              <h3>Ingen oppslag nå</h3>
            </div>
          ))}

        {felt.has("kalender") && (
          <div className="ot-kort ot-sone-kalender">
            <div className="ot-h">Kommer</div>
            {hendelser.length === 0 && <div className="ot-tom">Ingen kommende hendelser</div>}
            {hendelser.slice(0, liggende ? 3 : 4).map((h) => {
              const d = new Date(`${h.dato}T12:00`);
              return (
                <div key={h.id} className="ot-hendelse">
                  <div className="ot-dato">
                    <b>{String(d.getDate()).padStart(2, "0")}</b>
                    <span>{d.toLocaleDateString("nb-NO", { month: "short" }).replace(".", "")}</span>
                  </div>
                  <div>
                    <div className="x">{h.tittel}</div>
                    <div className="y">
                      {[h.tid && `Kl. ${h.tid}`, h.sted].filter(Boolean).join(", ")}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {felt.has("avfall") && avfall && (
          <div className="ot-kort ot-sone-avfall">
            <div className="ot-h">Tømmedager</div>
            {avfall.length === 0 && <div className="ot-tom">Ingen kjente tømmedager</div>}
            {avfall.map((a) => (
              <div key={a.fraksjon} className={`ot-tomming${dagerTil(a.dato, naa) <= 1 ? " snart" : ""}`}>
                {a.etikett}
                <span>{naarTomming(a.dato, naa)}</span>
              </div>
            ))}
          </div>
        )}

        {felt.has("kontakt") && (
          <div className="ot-kort ot-sone-kontakt">
            <div className="ot-h">Kontakt styret</div>
            {kontakt ? (
              <div key={kontakt.id} className="ot-person ot-fade">
                {kontakt.harBilde && kontaktbildeUrl(kontakt.id) && (
                  <img className="ot-portrett" src={kontaktbildeUrl(kontakt.id)!} alt="" />
                )}
                <div style={{ minWidth: 0 }}>
                  <div className="ot-navn">
                    {kontakt.navn}
                    {kontakt.rolle && <span>, {kontakt.rolle.toLowerCase()}</span>}
                  </div>
                  {kontakt.telefon && <div className="ot-ph">{kontakt.telefon}</div>}
                  {kontakt.epost && <div className="ot-ph">{kontakt.epost}</div>}
                </div>
                {kontakter.length > 1 && (
                  <div className="ot-prikker ot-prikker-side">
                    {kontakter.map((k, i) => (
                      <i key={k.id} className={i === kontaktIndeks % kontakter.length ? "pa" : ""} />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {org.telefon && <div className="ot-ph">{org.telefon}</div>}
                {org.epost && <div className="ot-ph">{org.epost}</div>}
                {!org.telefon && !org.epost && <div className="ot-tom">Kontaktinfo er ikke lagt inn</div>}
              </>
            )}
          </div>
        )}
      </div>
      <Fot tekst={sistHentet ? "" : `Oppdatert ${klokke(new Date(innhold.hentet))}`} />
      {sistHentet && (
        <div className="ot-utennett">
          <i />
          Ingen internett. Viser innhold fra {klokke(sistHentet)}.
        </div>
      )}
    </div>
  );
}

/** Bildet før skjermen er koblet til et borettslag. */
export function Koblingsskjerm({ kode, gyldigTil }: { kode: string | null; gyldigTil: string | null }) {
  const naa = useKlokke();
  const igjen = gyldigTil ? Math.max(0, Math.floor((new Date(gyldigTil).getTime() - naa.getTime()) / 1000)) : null;
  return (
    <div className="ot-skjerm liggende" style={skjermpalett("#0b1f3a", "#4c9bff") as CSSProperties}>
      <div className="ot-midt">
        <div className="ot-logo">IQ</div>
        <div className="ot-lbl">DriftIQ Oppslagstavle</div>
        <p>Denne skjermen er ikke koblet til et borettslag ennå.</p>
        <div>
          <div className="ot-lbl">Koblingskode</div>
          <div className="ot-kode">{kode ? visKode(kode) : "…"}</div>
        </div>
        <p>
          Logg inn i DriftIQ, gå til Oppslagstavle og velg <b>Koble til skjerm</b>.
        </p>
      </div>
      <Fot
        tekst={igjen !== null ? `Koden fornyes om ${Math.floor(igjen / 60)}:${String(igjen % 60).padStart(2, "0")}` : ""}
      />
    </div>
  );
}

function Topp({ innhold, naa, logoUrl }: { innhold: Skjerminnhold; naa: Date; logoUrl: string | null }) {
  return (
    <div className="ot-topp">
      <div className="ot-id">
        <div className="ot-logo">
          {logoUrl ? <img src={logoUrl} alt="" /> : innhold.org.initialer}
        </div>
        <div className="ot-adr">
          {innhold.org.navn}
          <b>{innhold.skjerm.adresse || innhold.skjerm.navn}</b>
        </div>
      </div>
      <div className="ot-klokke">
        <div className="c">{klokke(naa)}</div>
        <div className="d">{naa.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" })}</div>
      </div>
    </div>
  );
}

function Fot({ tekst }: { tekst: string }) {
  return (
    <div className="ot-fot">
      <span>{tekst}</span>
      <span className="ot-merke">
        <i>IQ</i>Drevet av DriftIQ
      </span>
    </div>
  );
}

/** Sonene som grid-områder. Inline fordi de avhenger av data — bredden styres av `--u`, ikke av media queries. */
function soner(felt: Set<string>, liggende: boolean): CSSProperties {
  const o = felt.has("oppslag");
  const k = felt.has("kalender");
  // Tømmedagene er en stripe med høyde etter innholdet (`auto`), over hele bredden — datoen
  // er det viktigste i feltet og skal aldri kuttes av en smal kolonne.
  const avf = felt.has("avfall");
  if (liggende) {
    const venstre = o ? "hero " : "";
    const bredde = o ? "avf avf" : "avf";
    return {
      gridTemplateColumns: o ? "minmax(0,1.5fr) minmax(0,1fr)" : "minmax(0,1fr)",
      gridTemplateRows: [k && "minmax(0,1.2fr)", "minmax(0,1.2fr)", avf && "auto"].filter(Boolean).join(" "),
      gridTemplateAreas: [k && `'${venstre}kal'`, `'${venstre}kon'`, avf && `'${bredde}'`].filter(Boolean).join(" "),
    };
  }
  const rader = [o && "minmax(0,1.5fr)", k && "minmax(0,1fr)", avf && "auto", "minmax(0,0.62fr)"];
  const omr = [o && "'hero'", k && "'kal'", avf && "'avf'", "'kon'"];
  return {
    gridTemplateColumns: "minmax(0,1fr)",
    gridTemplateRows: rader.filter(Boolean).join(" "),
    gridTemplateAreas: omr.filter(Boolean).join(" "),
  };
}

/** Hele dager fra i dag (lokal dato på skjermen) til ÅÅÅÅ-MM-DD. */
function dagerTil(dato: string, naa: Date): number {
  const idag = new Date(naa.getFullYear(), naa.getMonth(), naa.getDate()).getTime();
  const [a, m, d] = dato.split("-").map(Number);
  return Math.round((new Date(a!, m! - 1, d!).getTime() - idag) / 86_400_000);
}

/** «i dag», «i morgen», ellers «man. 5. okt.» — det beboeren trenger i forbifarten. */
function naarTomming(dato: string, naa: Date): string {
  const n = dagerTil(dato, naa);
  if (n === 0) return "i dag";
  if (n === 1) return "i morgen";
  return new Date(`${dato}T12:00`).toLocaleDateString("nb-NO", { weekday: "short", day: "numeric", month: "short" });
}

function klokke(d: Date): string {
  return d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
}

function useKlokke(): Date {
  const [naa, setNaa] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNaa(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return naa;
}
