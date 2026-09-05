/**
 * Widgetene på dashbordet — nøkkel, navn, størrelse og hvilken modul de hører til.
 *
 * **Ingen importer.** Både dashbordsiden (klient) og valideringen ved lagring (server) leser
 * denne lista. Hentet siden den fra et sted som rørte databasen, ville hele det laget havnet
 * i nettleserbundelen. Femte fil i dette mønsteret — se `nivaer.ts`.
 *
 * At server og klient deler lista er selve poenget: en widget som finnes i UI-et, men ikke i
 * hvitelista, ville blitt lagret og så stille forsvunnet ved neste innlasting.
 */

/** `s` = én kolonne, `m` = to, `l` = full bredde. Syklusen når man klikker størrelse. */
export const STORRELSER = ["s", "m", "l"] as const;
export type Storrelse = (typeof STORRELSER)[number];

export type Widgetdef = {
  nokkel: string;
  navn: string;
  gruppe: string;
  beskrivelse: string;
  /** Standardstørrelse når widgeten legges til fra biblioteket. */
  storrelse: Storrelse;
  /**
   * Modulen widgeten krever. Er den av for kunden, vises verken widgeten eller kortet i
   * biblioteket — en forside som tilbyr Parkering til et lag uten parkering er støy.
   */
  modul?: string;
};

export const WIDGETDEFS: readonly Widgetdef[] = [
  { nokkel: "kpi_oppgaver", navn: "Aktive oppgaver", gruppe: "Nøkkeltall", beskrivelse: "Antall oppgaver totalt.", storrelse: "s", modul: "tasks" },
  { nokkel: "kpi_ajour", navn: "À jour", gruppe: "Nøkkeltall", beskrivelse: "Oppgaver utført i tide.", storrelse: "s", modul: "tasks" },
  { nokkel: "kpi_forsinket", navn: "Forsinket", gruppe: "Nøkkeltall", beskrivelse: "Oppgaver over frist.", storrelse: "s", modul: "tasks" },
  { nokkel: "kpi_avvik", navn: "Åpne avvik", gruppe: "Nøkkeltall", beskrivelse: "Avvik som ikke er lukket.", storrelse: "s", modul: "avvik" },

  { nokkel: "oppfolging", navn: "Krever oppfølging", gruppe: "Anbefalt", beskrivelse: "Det som haster, samlet ett sted.", storrelse: "m" },
  { nokkel: "frister", navn: "Kommende frister", gruppe: "Anbefalt", beskrivelse: "Oppgaver, kontrakter og årshjul på én tidslinje.", storrelse: "m" },

  { nokkel: "oppgaver", navn: "Oppgaver", gruppe: "Oppgaver", beskrivelse: "De nærmeste forfallene.", storrelse: "m", modul: "tasks" },
  { nokkel: "avvik", navn: "Åpne avvik", gruppe: "Avvik", beskrivelse: "Avvik som ikke er lukket.", storrelse: "s", modul: "avvik" },
  { nokkel: "kontrakter", navn: "Kontrakter som utløper", gruppe: "Kontrakter", beskrivelse: "Avtaler som nærmer seg sluttdato.", storrelse: "s", modul: "kontrakter" },
  { nokkel: "tilstand", navn: "Tilstandsgrad (TG)", gruppe: "Vedlikehold", beskrivelse: "Anlegg fordelt på tilstand.", storrelse: "s", modul: "vedlikehold" },
  { nokkel: "parkering", navn: "Parkering", gruppe: "Parkering", beskrivelse: "Ledige og utleide plasser.", storrelse: "s", modul: "parkering" },
  { nokkel: "rutiner", navn: "Rutiner å revidere", gruppe: "Rutiner", beskrivelse: "Rutiner som ikke er gjennomgått på lenge.", storrelse: "s", modul: "rutiner" },
  { nokkel: "aktivitet", navn: "Siste aktivitet", gruppe: "Driftslogg", beskrivelse: "De siste innførslene i driftsloggen.", storrelse: "s", modul: "driftslogg" },
  { nokkel: "okonomi", navn: "Økonomi", gruppe: "Økonomi", beskrivelse: "Fakturaer til godkjenning, forfalte og felleskostnader per måned.", storrelse: "s", modul: "okonomi" },
  { nokkel: "smatall", navn: "Småtall", gruppe: "Verktøy", beskrivelse: "Dokumenter og leverandører i korte tall.", storrelse: "s" },
];

export const WIDGETS: Readonly<Record<string, Widgetdef>> = Object.fromEntries(
  WIDGETDEFS.map((d) => [d.nokkel, d]),
);

export type Widgetvalg = { nokkel: string; storrelse: Storrelse };

/** Oppsettet en kunde får uten å ha tilpasset noe. Filtreres mot aktiverte moduler. */
export const STANDARDOPPSETT: readonly Widgetvalg[] = [
  { nokkel: "kpi_oppgaver", storrelse: "s" },
  { nokkel: "kpi_ajour", storrelse: "s" },
  { nokkel: "kpi_forsinket", storrelse: "s" },
  { nokkel: "kpi_avvik", storrelse: "s" },
  { nokkel: "oppfolging", storrelse: "m" },
  { nokkel: "frister", storrelse: "m" },
  { nokkel: "oppgaver", storrelse: "m" },
  { nokkel: "avvik", storrelse: "s" },
  { nokkel: "kontrakter", storrelse: "s" },
  { nokkel: "okonomi", storrelse: "s" },
  { nokkel: "aktivitet", storrelse: "s" },
];

/**
 * Tolker et lagret oppsett.
 *
 * Ukjente nøkler og ugyldige størrelser siles bort i stedet for å velte visningen: en widget
 * som fjernes fra koden skal ikke gjøre dashbordet til en feilmelding for alle som hadde den
 * i oppsettet sitt.
 *
 * Tom liste etter silingen gir `null` — «ikke tilpasset» — slik at kallstedet faller tilbake
 * til standarden. Et tomt dashbord er aldri noe noen har ment å be om.
 */
export function lesOppsett(json: string | null | undefined): Widgetvalg[] | null {
  if (!json) return null;
  try {
    const rader = JSON.parse(json);
    if (!Array.isArray(rader)) return null;
    const rene: Widgetvalg[] = [];
    const sett = new Set<string>();
    for (const r of rader) {
      const nokkel = typeof r?.nokkel === "string" ? r.nokkel : r?.key;
      const storrelse = typeof r?.storrelse === "string" ? r.storrelse : r?.size;
      if (typeof nokkel !== "string" || !WIDGETS[nokkel] || sett.has(nokkel)) continue;
      sett.add(nokkel);
      rene.push({
        nokkel,
        storrelse: (STORRELSER as readonly string[]).includes(storrelse)
          ? (storrelse as Storrelse)
          : WIDGETS[nokkel]!.storrelse,
      });
    }
    return rene.length > 0 ? rene : null;
  } catch {
    return null;
  }
}
