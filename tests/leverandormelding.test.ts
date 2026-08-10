/**
 * Meldingen til leverandøren.
 *
 * Testene her handler om ÉN ting: at teksten kan sendes som den er. En generert e-post som må
 * etterredigeres hver gang er ikke bedre enn en mal, og de tre feilene som ødelegger den er
 * alle stille — en tom parentes etter et oppgavenavn, «denne oppgavene» i flertall, eller en
 * hilsen til «Hei ,» fordi kontaktpersonen manglet.
 */

import { describe, expect, it } from "vitest";
import { lagLeverandormelding } from "../src/lib/leverandormelding";

const grunn = {
  orgNavn: "Borettslaget Håsteinsgate 9",
  leverandorNavn: "Heis-Service Bergen",
  avsender: { navn: "Tore Olsen", epost: "tore@example.no" },
};

const oppgave = { tittel: "Heiskontroll", sted: "Heis A og B", frekvens: "quarterly" };

describe("lagLeverandormelding", () => {
  it("setter navn, lag og leverandør inn i teksten", () => {
    const { emne, tekst } = lagLeverandormelding({ ...grunn, oppgaver: [oppgave] });
    expect(emne).toContain("Borettslaget Håsteinsgate 9");
    expect(tekst).toContain("Heis-Service Bergen");
    expect(tekst).toContain("Tore Olsen");
    expect(tekst).toContain("tore@example.no");
    // Ingen igjenglemte plassholdere — hele poenget med å generere framfor å ha en mal.
    expect(tekst).not.toMatch(/\[|\{\{/);
  });

  it("skriver frekvensen med ETIKETT, ikke kodenavnet", () => {
    const { tekst } = lagLeverandormelding({ ...grunn, oppgaver: [oppgave] });
    expect(tekst).toContain("Kvartalsvis");
    expect(tekst).not.toContain("quarterly");
  });

  it("bøyer entall og flertall etter antall oppgaver", () => {
    const en = lagLeverandormelding({ ...grunn, oppgaver: [oppgave] });
    expect(en.tekst).toContain("denne oppgaven:");
    expect(en.emne).toContain("for oppgave");

    const to = lagLeverandormelding({
      ...grunn,
      oppgaver: [oppgave, { tittel: "Sprinklertest", sted: null, frekvens: "annual" }],
    });
    expect(to.tekst).toContain("disse oppgavene:");
    expect(to.emne).toContain("for oppgaver");
  });

  it("utelater parentesen når oppgaven mangler sted", () => {
    // «- Sprinklertest ( · Årlig)» er den typen slurv som gjør at teksten må skrives om.
    const { tekst } = lagLeverandormelding({
      ...grunn,
      oppgaver: [{ tittel: "Sprinklertest", sted: null, frekvens: "annual" }],
    });
    expect(tekst).toContain("- Sprinklertest (Årlig)");
  });

  it("hilser med fornavn når kontaktpersonen er kjent, ellers nøytralt", () => {
    const med = lagLeverandormelding({ ...grunn, kontaktFornavn: "Per", oppgaver: [oppgave] });
    expect(med.tekst.startsWith("Hei Per,")).toBe(true);

    const uten = lagLeverandormelding({ ...grunn, kontaktFornavn: null, oppgaver: [oppgave] });
    expect(uten.tekst.startsWith("Hei,")).toBe(true);
  });

  it("dropper kontaktparentesen når avsenderen ikke har e-post eller telefon", () => {
    const { tekst } = lagLeverandormelding({
      ...grunn,
      avsender: { navn: "Tore Olsen", epost: null },
      oppgaver: [oppgave],
    });
    expect(tekst).toContain("ta kontakt med Tore Olsen.");
    expect(tekst).not.toContain("Tore Olsen ()");
  });

  it("tar med telefon når den finnes", () => {
    const { tekst } = lagLeverandormelding({
      ...grunn,
      avsender: { navn: "Tore Olsen", epost: "tore@example.no", telefon: "99887766" },
      oppgaver: [oppgave],
    });
    expect(tekst).toContain("tore@example.no / 99887766");
  });

  it("står uten oppgaveliste når ingen er valgt", () => {
    // Hele meldingen skal fortsatt kunne sendes — bare uten en tom kulepunktliste.
    const { tekst } = lagLeverandormelding({ ...grunn, oppgaver: [] });
    expect(tekst).not.toContain("oppgavene:");
    expect(tekst).toContain("Slik gjør dere det:");
  });

  it("sier at det ikke kreves innlogging", () => {
    // Den vanligste innvendingen fra en leverandør, avklart før den blir stilt.
    const { tekst } = lagLeverandormelding({ ...grunn, oppgaver: [oppgave] });
    expect(tekst).toMatch(/ingen innlogging/i);
  });
});
