"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Modal og skjemafelter. Delt av alle detaljvisningene.
 *
 * Modalen lukkes med Escape og ved klikk utenfor. Begge deler er forventet oppførsel, og
 * begge glemmes lett når hver side lager sin egen — resultatet er at halvparten av dem
 * fanger brukeren i et skjema de ikke finner ut av.
 */

export function Modal({
  tittel,
  onLukk,
  children,
  bredde = 520,
}: {
  tittel: string;
  onLukk: () => void;
  children: ReactNode;
  bredde?: number;
}) {
  useEffect(() => {
    const påEsc = (e: KeyboardEvent) => e.key === "Escape" && onLukk();
    window.addEventListener("keydown", påEsc);
    return () => window.removeEventListener("keydown", påEsc);
  }, [onLukk]);

  return (
    <div
      onClick={onLukk}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        zIndex: 60,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tittel}
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "100%", maxWidth: `${bredde}px`, maxHeight: "88dvh", display: "flex", flexDirection: "column" }}
      >
        <div className="card-header">
          <div className="card-title">{tittel}</div>
          <button className="btn btn-ghost" onClick={onLukk} aria-label="Lukk">
            ✕
          </button>
        </div>
        <div style={{ padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "15px" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Felt({
  etikett,
  notat,
  children,
}: {
  etikett: string;
  notat?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label">{etikett}</label>
      {children}
      {notat && <div className="field-note">{notat}</div>}
    </div>
  );
}

export function Tekstfelt({
  etikett,
  verdi,
  onEndre,
  type = "text",
  notat,
  plassholder,
  laast,
}: {
  etikett: string;
  verdi: string;
  onEndre: (v: string) => void;
  type?: string;
  notat?: string;
  plassholder?: string;
  /** Vis verdien, men ikke la den endres — for felter som e-post, der verdien er nøkkelen. */
  laast?: boolean;
}) {
  return (
    <Felt etikett={etikett} notat={notat}>
      <input
        className="input"
        type={type}
        value={verdi}
        placeholder={plassholder}
        disabled={laast}
        onChange={(e) => onEndre(e.target.value)}
      />
    </Felt>
  );
}

export function Tekstomrade({
  etikett,
  verdi,
  onEndre,
  notat,
}: {
  etikett: string;
  verdi: string;
  onEndre: (v: string) => void;
  notat?: string;
}) {
  return (
    <Felt etikett={etikett} notat={notat}>
      <textarea className="textarea" value={verdi} onChange={(e) => onEndre(e.target.value)} />
    </Felt>
  );
}

export function Nedtrekk({
  etikett,
  verdi,
  valg,
  onEndre,
  notat,
}: {
  etikett: string;
  verdi: string;
  valg: ReadonlyArray<{ verdi: string; etikett: string }>;
  onEndre: (v: string) => void;
  notat?: string;
}) {
  return (
    <Felt etikett={etikett} notat={notat}>
      <select className="select" value={verdi} onChange={(e) => onEndre(e.target.value)}>
        {valg.map((v) => (
          <option key={v.verdi} value={v.verdi}>
            {v.etikett}
          </option>
        ))}
      </select>
    </Felt>
  );
}

export function Avkryssing({
  etikett,
  verdi,
  onEndre,
  notat,
}: {
  etikett: string;
  verdi: boolean;
  onEndre: (v: boolean) => void;
  notat?: string;
}) {
  return (
    <div className="field">
      <label style={{ display: "flex", alignItems: "center", gap: "9px", cursor: "pointer" }}>
        <input type="checkbox" checked={verdi} onChange={(e) => onEndre(e.target.checked)} />
        <span className="field-label" style={{ margin: 0 }}>
          {etikett}
        </span>
      </label>
      {notat && <div className="field-note">{notat}</div>}
    </div>
  );
}

/** Knapperad nederst i en modal. Primærhandlingen til høyre, som ellers i appen. */
export function Knapperad({
  onAvbryt,
  avbrytEtikett = "Avbryt",
  sendEtikett = "Lagre",
  sender,
  deaktivert,
  farlig,
  onSend,
}: {
  onAvbryt: () => void;
  /** «Tilbake» når raden står i et steg som har et steg foran seg. */
  avbrytEtikett?: string;
  sendEtikett?: string;
  sender?: boolean;
  deaktivert?: boolean;
  farlig?: boolean;
  /** Gjør knappen til en vanlig knapp i stedet for submit — for bekreftelsesdialoger. */
  onSend?: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
      <button type="button" className="btn btn-ghost" onClick={onAvbryt}>
        {avbrytEtikett}
      </button>
      <button
        type={onSend ? "button" : "submit"}
        onClick={onSend}
        className={`btn ${farlig ? "btn-danger" : "btn-primary"}`}
        disabled={sender || deaktivert}
      >
        {sender ? "Lagrer …" : sendEtikett}
      </button>
    </div>
  );
}

/** Håndterer send-tilstand og feil for et modalskjema, så hver side slipper å gjenta det. */
export function useSending(onFerdig: () => void) {
  const [sender, setSender] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);

  async function send(handling: () => Promise<unknown>) {
    setSender(true);
    setFeil(null);
    try {
      await handling();
      onFerdig();
    } catch (e) {
      // API-ets egne norske meldinger — duplikatnummer, kvote, låst runde — havner her.
      setFeil(e instanceof Error ? e.message : "Noe gikk galt");
    } finally {
      setSender(false);
    }
  }

  return { sender, feil, send };
}
