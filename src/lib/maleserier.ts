/**
 * Måleserier — avlesningene fra sjekkpunkter av typen `tall`, gruppert til kurver.
 *
 * IMPORTFRI, som `oppgaveregler.ts`: både grafen i kunde-appen og en eventuell rapport senere
 * skal bruke NØYAKTIG denne grupperingen. v1 hadde sju kopier av forsinkelsesregelen som
 * drev fra hverandre; her finnes regelen ett sted, og den er testet.
 *
 * ## De to reglene som betyr noe
 *
 * **Enheten er en del av nøkkelen.** En avlesning bærer enheten den ble målt i, ikke malens
 * nåværende (se `completion_checklist_results.unit`). Endres malen fra bar til kPa, får
 * punktet to serier i stedet for én kurve — tallene er ikke sammenlignbare, og en kurve som
 * blander dem ser helt riktig ut og er feil.
 *
 * **Serien brytes ved omdøping.** Et omdøpt sjekkpunkt er et NYTT punkt i dette systemet (se
 * `erstattSjekkliste`), så grupperingen går på `itemId` og aldri på teksten. «Vask 3» skal
 * ikke arve «Vask 1» sine tall. Avlesninger fra et slettet malpunkt har `itemId = null` og
 * grupperes på teksten sin — de er fortsatt gyldig historikk, bare avsluttet.
 */

/** Én avlesning. */
export type Maling = { nar: string; verdi: number };

export type Serie = {
  nokkel: string;
  navn: string;
  enhet: string | null;
  /** Punktet finnes fortsatt i malen. Er det borte, er serien historikk. */
  aktiv: boolean;
  malinger: Maling[];
};

/**
 * Formene funksjonen trenger — definert her, ikke importert, så fila forblir importfri.
 * `value` er STRENG fordi `numeric` kommer slik fra node-postgres.
 */
export type Avlest = {
  itemId: string | null;
  text: string;
  value: string | null;
  unit: string | null;
};

export type Utfort = { completedAt: string; punkter: Avlest[] };

export function byggSerier(utkvitteringer: Utfort[], aktiveMalpunkter: string[]): Serie[] {
  const aktive = new Set(aktiveMalpunkter);
  const kart = new Map<string, Serie>();

  // Eldste først: grafen leses fra venstre, og API-et gir nyeste først.
  const sortert = [...utkvitteringer].sort((a, b) => a.completedAt.localeCompare(b.completedAt));

  for (const u of sortert) {
    for (const p of u.punkter) {
      if (p.value === null) continue;
      const verdi = Number(p.value);
      // Ikke-tall hoppes over i stillhet: en ødelagt rad skal ikke velte hele grafen.
      if (!Number.isFinite(verdi)) continue;

      const nokkel = `${p.itemId ?? `tekst:${p.text}`}|${p.unit ?? ""}`;
      const serie = kart.get(nokkel) ?? {
        nokkel,
        navn: p.text,
        enhet: p.unit,
        aktiv: p.itemId !== null && aktive.has(p.itemId),
        malinger: [],
      };
      serie.navn = p.text; // Nyeste tekst vinner som etikett.
      serie.malinger.push({ nar: u.completedAt, verdi });
      kart.set(nokkel, serie);
    }
  }

  // Aktive serier først, deretter flest avlesninger — det man følger med på skal ligge øverst.
  return [...kart.values()].sort(
    (a, b) => Number(b.aktiv) - Number(a.aktiv) || b.malinger.length - a.malinger.length,
  );
}
