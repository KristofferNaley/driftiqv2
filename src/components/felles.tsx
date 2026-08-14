"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useOkt } from "./OktProvider";

/**
 * Delte byggeklosser for modulsidene.
 *
 * Alle tretten sidene har samme skjelett: hent data for aktiv org, vis «Henter …», vis en
 * feilmelding hvis noe ryker, og last på nytt etter en skriving. Uten en felles hook blir
 * det tretten litt ulike varianter — og da er det tilfeldig hvilke av dem som håndterer
 * orgbytte riktig.
 */

/**
 * Henter data for den aktive organisasjonen.
 *
 * Nøkkelen er at `hent` kjøres på nytt når org-en byttes: `orgId` er med i avhengighetene.
 * Glemmer man det, viser siden forrige kundes data til noe annet tvinger en ny henting —
 * og det er en lekkasje brukeren ser, selv om API-et aldri sendte den.
 */
export function useOrgData<T>(
  hent: (orgId: string) => Promise<T>,
  avhengigheter: unknown[] = [],
) {
  const { aktivOrg, laster: lasterOkt } = useOkt();
  const orgId = aktivOrg?.id;
  const [data, setData] = useState<T | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [laster, setLaster] = useState(true);

  const last = useCallback(async () => {
    if (!orgId) return;
    setLaster(true);
    setFeil(null);
    try {
      setData(await hent(orgId));
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente data");
    } finally {
      setLaster(false);
    }
    // `hent` er en ny funksjon ved hver render, så den kan ikke stå her — kallstedet
    // oppgir i stedet hva som faktisk skal utløse en ny henting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, ...avhengigheter]);

  useEffect(() => {
    void last();
  }, [last]);

  // `setData` er med for optimistiske oppdateringer: en avkryssing skal endre punktet i
  // hånden UMIDDELBART, ikke via lasteskjerm — `last()` etterpå er bare avstemming.
  return { data, setData, feil, setFeil, laster: laster || lasterOkt, last, orgId };
}

export function Kort({
  tittel,
  handling,
  children,
}: {
  tittel: string;
  handling?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">{tittel}</div>
        {handling}
      </div>
      {children}
    </div>
  );
}

export function Rad({
  tittel,
  meta,
  hoyre,
  onClick,
}: {
  tittel: ReactNode;
  meta?: ReactNode;
  hoyre?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className="list-item"
      onClick={onClick}
      style={onClick ? { cursor: "pointer" } : undefined}
    >
      <div style={{ minWidth: 0 }}>
        <div className="list-tittel">{tittel}</div>
        {meta && <div className="list-meta">{meta}</div>}
      </div>
      {hoyre && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          {hoyre}
        </div>
      )}
    </div>
  );
}

export function Tom({ tekst }: { tekst: string }) {
  return <div className="tom-melding">{tekst}</div>;
}

export function Feil({ melding }: { melding: string | null }) {
  return melding ? <div className="feilmelding">{melding}</div> : null;
}

export function Nokkeltall({ etikett, verdi }: { etikett: string; verdi: ReactNode }) {
  return (
    <div className="card">
      <div className="card-body">
        <div className="card-title">{etikett}</div>
        <div style={{ fontSize: "var(--fs-hero)", fontWeight: 700, marginTop: "4px" }}>{verdi}</div>
      </div>
    </div>
  );
}

/** Enkelt inline-skjema for «legg til»-rader i et kortthode. */
export function Hurtigskjema({
  plassholder,
  knapp = "Legg til",
  onSend,
}: {
  plassholder: string;
  knapp?: string;
  onSend: (verdi: string) => Promise<void>;
}) {
  const [verdi, setVerdi] = useState("");
  const [sender, setSender] = useState(false);
  const felt = useRef<HTMLInputElement>(null);

  return (
    <form
      style={{ display: "flex", gap: "8px" }}
      onSubmit={async (e) => {
        e.preventDefault();
        // Tomt felt: sett fokus der i stedet for å gjøre ingenting. Knappen er IKKE
        // deaktivert på tom verdi — en permanent grå knapp leses som «ødelagt», ikke som
        // «skriv i feltet først», og det var nøyaktig slik den ble meldt inn som feil.
        if (!verdi.trim()) {
          felt.current?.focus();
          return;
        }
        if (sender) return;
        setSender(true);
        try {
          await onSend(verdi.trim());
          setVerdi("");
        } finally {
          setSender(false);
        }
      }}
    >
      <input
        ref={felt}
        className="input"
        style={{ minWidth: "180px" }}
        placeholder={plassholder}
        aria-label={plassholder}
        value={verdi}
        onChange={(e) => setVerdi(e.target.value)}
      />
      <button className="btn btn-primary" disabled={sender}>
        {knapp}
      </button>
    </form>
  );
}

/** Fanerad for moduler med flere visninger (Internkontroll, Vedlikehold). */
export function Faner<T extends string>({
  valgt,
  faner,
  onVelg,
}: {
  valgt: T;
  faner: ReadonlyArray<{ nokkel: T; etikett: string }>;
  onVelg: (n: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "4px" }}>
      {faner.map((f) => (
        <button
          key={f.nokkel}
          onClick={() => onVelg(f.nokkel)}
          className="nav-lenke"
          style={{
            border: "none",
            background: valgt === f.nokkel ? "rgba(var(--accent-rgb),0.12)" : "transparent",
            color: valgt === f.nokkel ? "var(--accent)" : "var(--text)",
            fontWeight: valgt === f.nokkel ? 600 : 400,
            borderRadius: 0,
            borderBottom: valgt === f.nokkel ? "2px solid var(--accent)" : "2px solid transparent",
            padding: "14px 16px",
          }}
        >
          {f.etikett}
        </button>
      ))}
    </div>
  );
}

export const kr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${n.toLocaleString("nb-NO")} kr`;

/**
 * «i dag», «i går», «for 5 dager siden» — og full dato når det er lenger enn en måned.
 * For «sist innlogget» o.l., der det nære er interessant relativt og det fjerne som dato.
 *
 * Reserven er «aldri», ikke «—»: mangler verdien, ER det svaret, ikke ukjent.
 */
export function siden(verdi: string | null | undefined, reserve = "aldri"): string {
  const dager = dagerSiden(verdi);
  if (dager === null) return reserve;
  if (dager <= 0) return "i dag";
  if (dager === 1) return "i går";
  if (dager <= 31) return `for ${dager} dager siden`;
  return dato(verdi);
}

/**
 * Antall hele dager siden et tidspunkt, eller `null` hvis verdien mangler.
 *
 * Skilt ut fra `siden()` fordi kallstedet ofte trenger TALLET og ikke teksten — «sist
 * innlogget» dempes når det er over 90 dager siden, og den terskelen kan ikke leses ut av
 * strengen «for 200 dager siden».
 */
export function dagerSiden(verdi: string | null | undefined): number | null {
  if (!verdi) return null;
  return Math.floor((Date.now() - new Date(verdi).getTime()) / 86_400_000);
}

/** Initialer til avatarsirkelen. To bokstaver, aldri mer. */
export function initialer(navn: string): string {
  const deler = navn.trim().split(/\s+/).filter(Boolean);
  if (deler.length === 0) return "?";
  if (deler.length === 1) return deler[0]!.slice(0, 1).toUpperCase();
  return (deler[0]![0]! + deler[deler.length - 1]![0]!).toUpperCase();
}

/**
 * Dato MED klokkeslett.
 *
 * Brukes der rekkefølgen innad i en dag betyr noe: behandlingsjournalen og historikken er
 * dokumentasjon, og «09. aug.» på fire innlegg sier ingenting om hva som skjedde først.
 * Lister og frister bruker `dato()` — der er klokkeslettet bare støy.
 */
export const datoTid = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleString("nb-NO", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export const dato = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" }) : "—";
