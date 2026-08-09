"use client";

import { useEffect, useState } from "react";

/**
 * Lys/mørk-veksler for landingssiden.
 *
 * Temaet settes på `<html data-theme>` av et lite skript i rot-layouten FØR første maling,
 * slik at siden ikke blinker i feil farge. Denne knappen bare flipper det samme attributtet
 * og husker valget — den eier ikke temaet.
 *
 * Ikonet rendres først etter montering. Serveren vet ikke hva som står i `localStorage`, så
 * en sol tegnet på serveren ville blitt til en måne i det React overtok — og React klager på
 * at HTML-en ikke stemmer.
 */
export function Temaveksler() {
  const [tema, setTema] = useState<"dark" | "light" | null>(null);

  useEffect(() => {
    const naa = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setTema(naa);
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

  return (
    <button
      className="mk-tema"
      onClick={veksle}
      aria-label={tema === "light" ? "Bytt til mørk modus" : "Bytt til lys modus"}
      title={tema === "light" ? "Mørk modus" : "Lys modus"}
    >
      {tema === null ? "" : tema === "light" ? "🌙" : "☀"}
    </button>
  );
}
