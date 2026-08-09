"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Hvilke domener som er hva, gitt fra serveren.
 *
 * Panelet må kunne lenke TIL kunde-appen, og på panelverten er `/dashboard` en 404 — lenken
 * må derfor være absolutt til appverten. Verdien kan ikke være en `NEXT_PUBLIC_`-variabel:
 * den bakes inn ved bygg, og et domenebytte ville krevd nytt image.
 *
 * Er verten ikke satt (enkeltvert, lokal utvikling), faller lenkene tilbake til vanlige
 * stier på samme domene.
 */
const Kontekst = createContext<{ appVert: string | null }>({ appVert: null });

export function VerterProvider({
  appVert,
  children,
}: {
  appVert: string | null;
  children: ReactNode;
}) {
  return <Kontekst.Provider value={{ appVert }}>{children}</Kontekst.Provider>;
}

/** Adressen til kunde-appen — absolutt når vertene er delt, ellers en vanlig sti. */
export function useAppLenke(sti = "/dashboard"): string {
  const { appVert } = useContext(Kontekst);
  return appVert ? `https://${appVert}${sti}` : sti;
}
