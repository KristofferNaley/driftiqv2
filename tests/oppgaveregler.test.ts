/**
 * Forsinket-regelen. Denne fila er viktigere enn den ser ut.
 *
 * I v1 lå regelen i sju kopier som hadde drevet fra hverandre — leverandørportalen og
 * QR-skjemaet regnet halvårlig som 182 dager, resten som 183, så e-postvarselet sa noe annet
 * enn skjermen. Testene under låser den ene implementasjonen fast, dagtall for dagtall.
 */

import { describe, expect, it } from "vitest";
import { FREQ_DAGER, erForsinket, nesteFrist } from "../src/lib/oppgaveregler";
import { FREKVENSER } from "../src/lib/oppgaver";

/** `YYYY-MM-DD` n dager fra i dag. Negativ = i fortiden. */
function dager(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe("frekvenstabellen", () => {
  it("har et dagtall for hver frekvens unntatt on_demand", () => {
    // Mangler dagtallet, blir oppgaven STILLE aldri forsinket (`if (!dager) return false`).
    // Denne testen er det som fanger en ny frekvens som bare ble lagt i enumen.
    for (const f of FREKVENSER) {
      if (f === "on_demand") {
        expect(FREQ_DAGER[f], "on_demand skal ikke ha dagtall").toBeUndefined();
      } else {
        expect(FREQ_DAGER[f], `${f} mangler dagtall`).toBeGreaterThan(0);
      }
    }
  });

  it("holder halvårlig på 183 dager", () => {
    // Nøyaktig dette tallet var uenigheten i v1. 182 et sted, 183 et annet.
    expect(FREQ_DAGER.semiannual).toBe(183);
  });

  it("har flerårige intervaller som stemmer med skuddår", () => {
    expect(FREQ_DAGER.every_3_years).toBe(1095);
    expect(FREQ_DAGER.every_5_years).toBe(1826);
    expect(FREQ_DAGER.every_8_years).toBe(2922);
  });
});

describe("erForsinket", () => {
  const grunn = { active: true, frequency: "monthly" as const };

  it("er aldri forsinket når oppgaven er deaktivert", () => {
    expect(erForsinket({ ...grunn, active: false, dueDate: dager(-100) })).toBe(false);
  });

  it("er forsinket når fristen er passert og oppgaven aldri er utført", () => {
    expect(erForsinket({ ...grunn, dueDate: dager(-1) })).toBe(true);
  });

  it("er ikke forsinket når fristen ligger fram i tid", () => {
    expect(erForsinket({ ...grunn, dueDate: dager(1) })).toBe(false);
  });

  it("lar en on_demand-oppgave MED frist bli forsinket", () => {
    // Uten fristen har den ingen syklus og kunne aldri bli forsinket. Det er hele grunnen
    // til at dueDate sjekkes FØR frekvensen.
    expect(erForsinket({ active: true, frequency: "on_demand", dueDate: dager(-1) })).toBe(true);
  });

  it("lar en on_demand-oppgave UTEN frist aldri bli forsinket", () => {
    expect(erForsinket({ active: true, frequency: "on_demand", startDate: dager(-9999) })).toBe(false);
  });

  it("slutter å bruke fristen etter første utkvittering", () => {
    // Fristen gjelder bare første gang. Etterpå styrer frekvensen.
    expect(
      erForsinket({ ...grunn, dueDate: dager(-500), lastCompletedAt: dager(-1) }),
    ).toBe(false);
  });

  it("bruker frekvensen fra siste utkvittering", () => {
    expect(erForsinket({ ...grunn, lastCompletedAt: dager(-31) })).toBe(true);
    expect(erForsinket({ ...grunn, lastCompletedAt: dager(-29) })).toBe(false);
  });

  it("faller tilbake på startdato når oppgaven aldri er utført", () => {
    expect(erForsinket({ ...grunn, startDate: dager(-1) })).toBe(true);
    expect(erForsinket({ ...grunn, startDate: dager(1) })).toBe(false);
  });

  it("er forsinket uten både utkvittering og startdato", () => {
    // En oppgave med reell frekvens som aldri er kommet i gang, skulle vært i gang.
    expect(erForsinket({ ...grunn })).toBe(true);
  });

  it("regner halvårlig nøyaktig på 183 dager", () => {
    const halvaarlig = { active: true, frequency: "semiannual" as const };
    expect(erForsinket({ ...halvaarlig, lastCompletedAt: dager(-184) })).toBe(true);
    expect(erForsinket({ ...halvaarlig, lastCompletedAt: dager(-183) })).toBe(false);
    // Med 182-regelen fra leverandørportalen ville denne vært forsinket. Det er avviket
    // som gjorde at e-posten sa noe annet enn skjermen.
    expect(erForsinket({ ...halvaarlig, lastCompletedAt: dager(-182) })).toBe(false);
  });
});

describe("nesteFrist", () => {
  it("legger frekvensen til siste utkvittering", () => {
    expect(nesteFrist({ active: true, frequency: "weekly", lastCompletedAt: "2026-08-01" })).toBe(
      "2026-08-08",
    );
  });

  it("bruker fristen før oppgaven er utført", () => {
    expect(nesteFrist({ active: true, frequency: "annual", dueDate: "2026-12-01" })).toBe("2026-12-01");
  });

  it("lar fristen vinne over startdatoen", () => {
    // En frist er strengere enn en planlagt start.
    expect(
      nesteFrist({ active: true, frequency: "annual", startDate: "2026-01-01", dueDate: "2026-03-01" }),
    ).toBe("2026-03-01");
  });

  it("gir null for on_demand uten frist", () => {
    expect(nesteFrist({ active: true, frequency: "on_demand" })).toBeNull();
  });
});
