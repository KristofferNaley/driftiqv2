"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import * as ikoner from "lucide-react";
import { Modal } from "./skjema";
import { Tom } from "./felles";
import { sok, type SokTreff } from "@/lib/klient";
import { MENY, type ModulNokkel } from "@/lib/moduler";

/**
 * Globalt søk — modal over siden, åpnet fra sidemenyen eller Cmd+K.
 *
 * Resultatene grupperes per modul i MENY-rekkefølgen, med modulens egen etikett og ikon —
 * treffet skal se ut som stedet det lenker til. Ingen `useSearchParams()` her (BAILOUT-
 * fella): tilstanden er lokal, lenkene er vanlige `href`.
 */

/**
 * Hvor et treff lenker. Modulene med `[id]`-side får detaljsiden direkte — for kontrakter
 * og leverandører ER `[id]`-siden en redirect til `?apen=<id>`-mønsteret, så samme form
 * virker for alle. De tre uten detaljvisning lenker til listesiden; ikke bygg en ny nå.
 */
function lenkeFor(t: SokTreff): string {
  const sti = MENY[t.modul as ModulNokkel]?.sti ?? "/dashboard";
  const harDetalj = !["driftslogg", "arshjul", "internkontroll"].includes(t.modul);
  return harDetalj ? `${sti}/${t.id}` : sti;
}

export default function SokModal({ orgId, onLukk }: { orgId: string | null; onLukk: () => void }) {
  const [q, setQ] = useState("");
  const [treff, setTreff] = useState<SokTreff[] | null>(null);
  const [laster, setLaster] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const felt = useRef<HTMLInputElement>(null);

  useEffect(() => felt.current?.focus(), []);

  // 300 ms debounce — samme mønster som avvikssøket. To tegn er minstekravet i API-et,
  // så under det spør vi ikke i det hele tatt.
  useEffect(() => {
    if (!orgId || q.trim().length < 2) {
      setTreff(null);
      setFeil(null);
      return;
    }
    const sporring = q.trim();
    setLaster(true);
    const t = setTimeout(() => {
      sok
        .hent(orgId, sporring)
        .then((r) => {
          setTreff(r);
          setFeil(null);
        })
        .catch((e) => setFeil(e instanceof Error ? e.message : "Søket feilet"))
        .finally(() => setLaster(false));
    }, 300);
    return () => clearTimeout(t);
  }, [orgId, q]);

  // Grupper i MENY-rekkefølgen — det er rekkefølgen brukeren kjenner fra sidemenyen.
  const grupper = useMemo(() => {
    if (!treff) return [];
    const rekkefolge = Object.keys(MENY) as ModulNokkel[];
    return rekkefolge
      .map((modul) => ({ modul, punkt: MENY[modul]!, treff: treff.filter((t) => t.modul === modul) }))
      .filter((g) => g.treff.length > 0);
  }, [treff]);

  return (
    <Modal tittel="Søk" onLukk={onLukk} bredde={620} utenPolstring>
      <div className="sok-felt">
        <ikoner.Search size={17} strokeWidth={2} aria-hidden />
        <input
          ref={felt}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Søk i avvik, oppgaver, kontrakter, dokumenter …"
          aria-label="Søk i hele systemet"
        />
        {laster && <span className="sok-status">Søker …</span>}
      </div>

      <div className="sok-resultater">
        {feil && <div className="feilmelding">{feil}</div>}
        {!feil && q.trim().length < 2 && (
          <Tom tekst="Skriv minst to tegn. Søket dekker titler, beskrivelser og notater i alle modulene deres." />
        )}
        {!feil && treff && treff.length === 0 && !laster && (
          <Tom tekst={`Ingenting traff «${q.trim()}».`} />
        )}
        {grupper.map((g) => {
          const Ikon =
            (ikoner as unknown as Record<string, ikoner.LucideIcon>)[g.punkt.ikon] ?? ikoner.Circle;
          return (
            <div key={g.modul} className="sok-gruppe">
              <div className="sok-gruppe-navn">
                <Ikon size={13} strokeWidth={2} aria-hidden />
                {g.punkt.etikett}
              </div>
              {g.treff.map((t) => (
                <Link key={t.id} href={lenkeFor(t)} className="sok-treff" onClick={onLukk}>
                  <span className="sok-treff-tittel">
                    {t.nummer !== null && <b>#{String(t.nummer).padStart(3, "0")}</b>} {t.tittel}
                  </span>
                  {(t.undertekst || t.dato) && (
                    <span className="sok-treff-meta">
                      {[t.undertekst, t.dato].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
