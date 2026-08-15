/**
 * Prismodellens versjonering — ny i v2 etter prismodell-v3-mockupen, ikke en v1-port.
 * Selve regnestykket (degressive trinn, gulvpris) er dekket i prisregler-testene; her
 * testes lagringslaget: at hver lagring blir en versjonsrad med løpenummer og et
 * autogenerert endringsnotat — historikk folk må huske å skrive, blir ikke skrevet.
 *
 * Singleton-raden deles med resten av testbasen, så modellen settes ALLTID tilbake i
 * `finally`, og versjonsradene ryddes på aktørnavnet.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { lukkPooler, withoutRls } from "../src/db/client";
import type { Aktor } from "../src/lib/aktor";
import { beskrivEndring, hentPrismodell, hentPrismodellPanel, settPrismodell } from "../src/lib/prismodell";

let eierPool: Pool;
const aktor: Aktor = { navn: "Prismodelltest", brukerId: null };

beforeAll(() => {
  eierPool = new Pool({ connectionString: process.env.DATABASE_URL! });
});

afterAll(async () => {
  await eierPool.query("DELETE FROM pricing_versions WHERE created_by = $1", [aktor.navn]);
  await eierPool.end();
  await lukkPooler();
});

describe("beskrivEndring", () => {
  const grunn = {
    gulvpris: 8000,
    trinn: [{ fra: 1, til: 100, sats: 200 }],
    modulpriser: { internkontroll: 12000 },
  };

  it("beskriver hevet gulvpris og endret modulpris", () => {
    const notat = beskrivEndring(grunn, {
      ...grunn,
      gulvpris: 9000,
      modulpriser: { internkontroll: 15000 },
    });
    expect(notat).toContain("Gulvpris hevet fra 8 000 kr til 9 000 kr");
    expect(notat).toContain("Internkontroll: 12 000 kr → 15 000 kr");
  });

  it("beskriver trinn lagt til, og sier fra når ingenting endret seg", () => {
    const medTrinn = beskrivEndring(grunn, {
      ...grunn,
      trinn: [...grunn.trinn, { fra: 101, til: 300, sats: 120 }],
    });
    expect(medTrinn).toContain("Trinn lagt til (1 → 2)");
    expect(beskrivEndring(grunn, grunn)).toBe("Ingen endring i satsene");
  });
});

describe("versjonert lagring", () => {
  it("hver lagring blir en versjonsrad med løpenummer, notat og gjelder-fra", async () => {
    const forrige = await withoutRls("plattformpanel", (db) => hentPrismodell(db));
    try {
      const panel = await withoutRls("plattformpanel", (db) =>
        settPrismodell(
          db,
          {
            gulvpris: forrige.gulvpris + 1000,
            trinn: forrige.trinn,
            modulpriser: forrige.modulpriser,
            gjelderFra: "2030-01-01",
          },
          aktor,
        ),
      );

      const [siste, ...eldre] = panel.versjoner;
      expect(siste!.createdBy).toBe(aktor.navn);
      expect(siste!.validFrom).toBe("2030-01-01");
      expect(siste!.note).toContain("Gulvpris hevet");
      if (eldre.length > 0) expect(siste!.version).toBe(eldre[0]!.version + 1);

      // Neste lagring skal få neste nummer.
      const panel2 = await withoutRls("plattformpanel", (db) =>
        settPrismodell(
          db,
          {
            gulvpris: forrige.gulvpris,
            trinn: forrige.trinn,
            modulpriser: forrige.modulpriser,
          },
          aktor,
        ),
      );
      expect(panel2.versjoner[0]!.version).toBe(siste!.version + 1);
      expect(panel2.versjoner[0]!.note).toContain("Gulvpris senket");
      // Uten gjelderFra faller datoen tilbake på i dag.
      expect(panel2.versjoner[0]!.validFrom).toBe(new Date().toISOString().slice(0, 10));
    } finally {
      await withoutRls("plattformpanel", (db) =>
        settPrismodell(
          db,
          { gulvpris: forrige.gulvpris, trinn: forrige.trinn, modulpriser: forrige.modulpriser },
          aktor,
        ),
      );
    }
  });

  it("panelet får kundene med kontraktdata og modultellinger", async () => {
    const panel = await withoutRls("plattformpanel", (db) => hentPrismodellPanel(db));
    expect(Array.isArray(panel.kunder)).toBe(true);
    // Alle tilleggsmoduler skal ha en telling — også de ingen har aktivert (0).
    expect(panel.modulKunder).toHaveProperty("internkontroll");
    expect(panel.modulKunder).toHaveProperty("parkering");
  });
});
