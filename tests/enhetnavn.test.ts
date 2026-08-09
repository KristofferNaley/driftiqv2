import { describe, expect, it } from "vitest";
import { enhetNavn, enhetTreffer } from "../src/lib/enhetnavn";

/**
 * Navngivning og søk i enhetsvelgeren. Ren logikk portet fra v1s `utils/leilighet.js`.
 *
 * Verdt egne tester fordi feilen den erstatter var stum: v2 falt tilbake til `u.id` når
 * både navn og andelsnummer manglet, og stedsfilteret i Avvik viste da en liste med rå
 * UUID-er. Ingenting krasjet — det så bare uforståelig ut.
 */
describe("enhetNavn", () => {
  it("setter H-nummeret først", () => {
    expect(enhetNavn({ leilighetsnr: "H0305", andelsnr: "26" })).toBe("H0305");
  });

  it("tar med oppgangen når den finnes", () => {
    expect(enhetNavn({ leilighetsnr: "H0305", oppgang: "9" })).toBe("H0305 · oppg. 9");
  });

  it("kjenner fellesarealet på navnet, ikke på nummer", () => {
    expect(enhetNavn({ type: "fellesareal", navn: "Bossrom oppgang B", andelsnr: "4" })).toBe(
      "Bossrom oppgang B",
    );
  });

  it("faller tilbake til andelsnummeret når H-nummeret mangler", () => {
    expect(enhetNavn({ andelsnr: "26" })).toBe("Andel 26");
  });

  it("viser ALDRI en id — en enhet uten nummer sier at den er uten nummer", () => {
    expect(enhetNavn({})).toBe("Enhet uten nummer");
    expect(enhetNavn(null)).toBe("—");
  });
});

describe("enhetTreffer", () => {
  const h0305 = { leilighetsnr: "H0305", andelsnr: "26", oppgang: "9" };

  it("treffer på delstreng, ikke bare prefiks", () => {
    // Man husker sjelden at H-nummeret starter med etasjen.
    expect(enhetTreffer(h0305, "305")).toBe(true);
  });

  it("ser bort fra format og store bokstaver", () => {
    expect(enhetTreffer(h0305, "h 03 05")).toBe(true);
    expect(enhetTreffer(h0305, "H0305")).toBe(true);
  });

  it("finner enheten på andelsnummeret selv om det ikke vises", () => {
    expect(enhetTreffer(h0305, "26")).toBe(true);
  });

  it("finner fellesarealet på navnet", () => {
    expect(enhetTreffer({ type: "fellesareal", navn: "Bossrom oppgang B" }, "bossrom")).toBe(true);
  });

  it("slipper alt gjennom på tomt søk", () => {
    expect(enhetTreffer(h0305, "   ")).toBe(true);
  });

  it("sier nei når ingenting passer", () => {
    expect(enhetTreffer(h0305, "takterrasse")).toBe(false);
  });
});
