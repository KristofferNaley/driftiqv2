"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Lys/mørk-veksler for kunde-appen. Samme plassering som i v1: nederst i sidemenyen.
 *
 * Knappen EIER ikke temaet. Det settes på `<html data-theme>` av et lite skript i
 * rot-layouten før første maling, slik at appen ikke blinker hvitt før React har startet.
 * Her flippes bare det samme attributtet, og valget huskes.
 *
 * Ikonet tegnes først etter montering: serveren vet ikke hva som står i `localStorage`, så
 * en sol rendret på serveren ville blitt en måne i det React overtok — og React klager på at
 * HTML-en ikke stemmer.
 */
export default function Temaknapp({ kompakt = false }: { kompakt?: boolean } = {}) {
  const [tema, setTema] = useState<"dark" | "light" | null>(null);

  useEffect(() => {
    setTema(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function veksle() {
    const nytt = tema === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = nytt;
    try {
      localStorage.setItem("theme", nytt);
    } catch {
      // Privat modus o.l. Valget gjelder da bare for denne økten, og det er greit.
    }
    setTema(nytt);
  }

  const tilLys = tema !== "light";

  return (
    <button
      className={kompakt ? "tema-knapp kompakt" : "tema-knapp"}
      onClick={veksle}
      aria-label={tilLys ? "Bytt til lys modus" : "Bytt til mørk modus"}
      title={tilLys ? "Lys modus" : "Mørk modus"}
    >
      {tema === null ? (
        // Ingen ikon før vi vet hva som gjelder — en gjetning ville blinket.
        <span style={{ width: 15, height: 15 }} aria-hidden />
      ) : tilLys ? (
        <Sun size={15} strokeWidth={1.9} aria-hidden />
      ) : (
        <Moon size={15} strokeWidth={1.9} aria-hidden />
      )}
      {/* I plattformpanelet står knappen ved siden av «Tilbake»-lenka og har bare ikonet —
          teksten ville sprengt raden. */}
      {!kompakt && <span className="nav-tekst">{tilLys ? "Lys modus" : "Mørk modus"}</span>}
    </button>
  );
}
