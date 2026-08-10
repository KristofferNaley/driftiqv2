/**
 * Statusreglene for kontrakter. KPI-kortet «Utløper innen 180 dager», radmerkene og
 * filterpillene regner alle gjennom `kontraktStatus`/`erAktiv` — testene her låser den ene
 * implementasjonen fast, slik at kort og rader ikke kan si ulike ting om samme avtale.
 */

import { describe, expect, it } from "vitest";
import { SNART_UT_DAGER, erAktiv, kontraktStatus } from "../src/lib/kontraktregler";

const I_DAG = "2026-08-10";
const felter = (over: Partial<Parameters<typeof kontraktStatus>[0]> = {}) => ({
  archivedAt: null,
  startDate: null,
  endDate: null,
  ...over,
});

describe("kontraktStatus", () => {
  it("er løpende uten sluttdato", () => {
    expect(kontraktStatus(felter(), I_DAG).nokkel).toBe("lopende");
  });

  it("er kommende når startdatoen er fram i tid, med løpende som filternøkkel", () => {
    // Kommende deler nøkkel med Løpende: den er hverken på vei ut eller utløpt, og
    // fortjener ikke en egen filterpille for hvor sjelden den er.
    const s = kontraktStatus(felter({ startDate: "2026-09-01" }), I_DAG);
    expect(s.etikett).toBe("Kommende");
    expect(s.nokkel).toBe("lopende");
  });

  it("skifter til snart ut nøyaktig på grensen", () => {
    // 180 dager fra 2026-08-10 er 2027-02-06: dagen FØR er innenfor grensen, selve dagen er
    // utenfor (`dager < SNART_UT_DAGER`). Skifter grensen, skal denne testen si ifra.
    expect(SNART_UT_DAGER).toBe(180);
    expect(kontraktStatus(felter({ endDate: "2027-02-06" }), I_DAG).nokkel).toBe("lopende");
    expect(kontraktStatus(felter({ endDate: "2027-02-05" }), I_DAG).nokkel).toBe("snartut");
  });

  it("er utløpt dagen etter sluttdato, ikke på den", () => {
    expect(kontraktStatus(felter({ endDate: I_DAG }), I_DAG).nokkel).toBe("snartut");
    expect(kontraktStatus(felter({ endDate: "2026-08-09" }), I_DAG).nokkel).toBe("utlopt");
  });

  it("lar arkivert vinne over alt annet", () => {
    const s = kontraktStatus(felter({ archivedAt: "2026-01-01T00:00:00Z", endDate: "2020-01-01" }), I_DAG);
    expect(s.nokkel).toBe("arkiv");
  });
});

describe("erAktiv", () => {
  it("teller bare avtaler som løper akkurat nå", () => {
    expect(erAktiv(felter(), I_DAG)).toBe(true);
    expect(erAktiv(felter({ endDate: I_DAG }), I_DAG)).toBe(true);
    expect(erAktiv(felter({ endDate: "2026-08-09" }), I_DAG)).toBe(false);
    expect(erAktiv(felter({ startDate: "2026-09-01" }), I_DAG)).toBe(false);
    expect(erAktiv(felter({ archivedAt: "2026-01-01T00:00:00Z" }), I_DAG)).toBe(false);
  });
});
