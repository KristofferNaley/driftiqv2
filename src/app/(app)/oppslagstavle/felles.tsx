"use client";

import { type ReactNode } from "react";
import { Knapperad, Modal } from "@/components/skjema";
import { dato } from "@/components/felles";
import type { BirStatus, Tavleblokk } from "@/lib/klient";
import { osloIDag } from "@/lib/oppslagstavleregler";
import { INNEBYGD_NAVN, INNEBYGDE_BLOKKER, type InnebygdBlokk } from "@/lib/tavlemaler";

/** Småting flere av filene i oppslagstavla deler. */

/** Bekreftelse i siden, i stedet for nettleserens `confirm()`. */
export function Bekreft({
  tittel,
  children,
  etikett,
  sender,
  onBekreft,
  onAvbryt,
}: {
  tittel: string;
  children: ReactNode;
  etikett: string;
  sender?: boolean;
  onBekreft: () => void;
  onAvbryt: () => void;
}) {
  return (
    <Modal tittel={tittel} onLukk={onAvbryt} bredde={440}>
      <div>{children}</div>
      <Knapperad onAvbryt={onAvbryt} onSend={onBekreft} sendEtikett={etikett} sender={sender} farlig />
    </Modal>
  );
}

/** «Sist sett 14:32», med dato foran når det er eldre enn i dag. */
export function sistSett(iso: string | null): string {
  if (!iso) return "Aldri sett";
  const d = new Date(iso);
  const kl = d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo" });
  return osloIDag(d) === osloIDag() ? `Sist sett ${kl}` : `Sist sett ${dato(iso)} kl. ${kl}`;
}

const erInnebygd = (n: string): n is InnebygdBlokk => (INNEBYGDE_BLOKKER as readonly string[]).includes(n);

/** Navnet på det som står i et felt, slik styret kjenner det. */
export function blokkNavn(nokkel: string, blokker: Tavleblokk[]): string {
  if (erInnebygd(nokkel)) return INNEBYGD_NAVN[nokkel];
  return blokker.find((b) => b.nokkel === nokkel)?.navn ?? "Fjernet innhold";
}

/** Hvorfor en blokk ikke vil vise noe på skjermen, eller `null` når den er klar. */
export function manglerOppsett(nokkel: string, blokker: Tavleblokk[], bir: BirStatus): string | null {
  if (nokkel === "tommedager") return bir ? null : "BIR er ikke koblet til";
  if (erInnebygd(nokkel)) return null;
  const b = blokker.find((x) => x.nokkel === nokkel);
  if (!b) return "Innholdet er fjernet";
  return b.konfig ? null : "Innstillingene er ugyldige";
}
