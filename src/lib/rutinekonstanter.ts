/**
 * Delte konstanter for Rutiner-modulen — port av v1s `routineConstants.js`.
 *
 * **Ingen importer.** Leses av både listesiden, byggeren, detaljsiden og utskriftsarket —
 * samme grunn som `nivaer.ts`: en server-import her ville dratt databasedriveren inn i
 * nettleserbundlet.
 */

export const RUTINEKATEGORIER = [
  { verdi: "vann_lekkasje", etikett: "Vann & lekkasje", farge: "#00c2ff" },
  { verdi: "brann_sikkerhet", etikett: "Brann & sikkerhet", farge: "#f04040" },
  { verdi: "adgang_nokler", etikett: "Adgang & nøkler", farge: "#8b5cf6" },
  { verdi: "beboerhenvendelser", etikett: "Beboerhenvendelser", farge: "#0fba81" },
  { verdi: "eierskifte", etikett: "Eierskifte", farge: "#f5a623" },
] as const;

/** Ukjente verdier (fri tekst fra migrerte rutiner) får nøytral farge, ikke en krasj. */
export function kategoriInfo(verdi: string | null | undefined) {
  return (
    RUTINEKATEGORIER.find((k) => k.verdi === verdi) ?? {
      verdi: verdi ?? "",
      etikett: verdi || "Uten kategori",
      farge: "#8892a4",
    }
  );
}

/** Fri tekst i databasen — dette er bare forslagene UI-et tilbyr. */
export const ANSVARLIG_VALG = ["Styret", "Vaktmester", "Beboer", "Beboer → Styret", "Alle"] as const;
export const GJELDER_FOR_VALG = ["Alle beboere", "Kun styret", "Leverandører"] as const;

/** NULL = ingen påminnelse; rutinen flagges da aldri som «trenger gjennomgang». */
export const REVISJONSINTERVALLER: ReadonlyArray<{ verdi: number | null; etikett: string }> = [
  { verdi: 6, etikett: "Hver 6. måned" },
  { verdi: 12, etikett: "Hver 12. måned" },
  { verdi: 24, etikett: "Hver 24. måned" },
  { verdi: null, etikett: "Ingen påminnelse" },
];

export type Malsteg = { title: string; description: string; isCritical: boolean };

/**
 * Startmaler for de vanligste rutinene — DriftIQ-forfattet innhold, fritt redigerbart
 * etter innsetting. Konstanter og ikke databaserader: malene er del av produktet, ikke
 * kundens data, og en tabell hadde bare gitt dem et sted å råtne.
 */
export const RUTINEMALER: ReadonlyArray<{
  navn: string;
  beskrivelse: string;
  kategori: string;
  steg: Malsteg[];
}> = [
  {
    navn: "Branninstruks",
    beskrivelse: "Varsle, redde, slukke, evakuere",
    kategori: "brann_sikkerhet",
    steg: [
      { title: "Varsle", description: "Utløs nærmeste brannalarm. Ring 110 og oppgi adressen. Bank på dørene du passerer på vei ut.", isCritical: true },
      { title: "Redde", description: "Hjelp de som ikke kommer seg ut selv. Prioriter barn, eldre og bevegelseshemmede. Ikke gå inn i rom med tett røyk.", isCritical: true },
      { title: "Slukke", description: "Bruk brannslange eller pulverapparat kun hvis brannen er liten og du har fri fluktvei bak deg.", isCritical: false },
      { title: "Evakuere", description: "Gå raskt ut av bygningen. Bruk ikke heis. Møt opp på avtalt møteplass og meld fra om noen mangler.", isCritical: true },
    ],
  },
  {
    navn: "Vannlekkasje i leilighet",
    beskrivelse: "Steng hovedkran, varsle styret, dokumenter skaden",
    kategori: "vann_lekkasje",
    steg: [
      { title: "Steng vannet", description: "Steng stoppekranen i leiligheten. Finner du den ikke, steng hovedkranen for oppgangen.", isCritical: true },
      { title: "Begrens skaden", description: "Flytt møbler og løsøre vekk fra vannet. Bruk håndklær og bøtter for å samle opp det som renner.", isCritical: false },
      { title: "Varsle styret", description: "Gi beskjed til styret med en gang, også utenom arbeidstid — vann i etasjeskillene blir dyrere for hver time.", isCritical: true },
      { title: "Varsle naboene under", description: "Bank på hos naboen(e) under leiligheten, vann følger rør og vegger nedover.", isCritical: false },
      { title: "Dokumenter skaden", description: "Ta bilder av skadested og skadeomfang før opprydding — forsikringen trenger dem.", isCritical: false },
    ],
  },
  {
    navn: "Heisstans med person i heisen",
    beskrivelse: "Ro ned, kontakt heisleverandør, ikke forsøk selv",
    kategori: "beboerhenvendelser",
    steg: [
      { title: "Få kontakt", description: "Snakk med den som sitter fast gjennom døren. Fortell at hjelp er på vei, og hold kontakten.", isCritical: true },
      { title: "Ring heisalarmen", description: "Bruk nødtelefonen i heisen eller nummeret på heisdøren. Oppgi adresse og hvilken heis det gjelder.", isCritical: true },
      { title: "Ikke forsøk å åpne selv", description: "Døren skal kun åpnes av heismontør. Å tvinge den opp kan skade både personen og heisen.", isCritical: true },
      { title: "Meld fra til styret", description: "Gi styret beskjed etterpå, så stansen kommer med i driftsloggen og mot leverandøren.", isCritical: false },
    ],
  },
  {
    navn: "Strømbrudd i fellesareal",
    beskrivelse: "Sjekk sikringsskap, varsle nettselskap",
    kategori: "beboerhenvendelser",
    steg: [
      { title: "Sjekk omfanget", description: "Gjelder det bare fellesarealet, hele bygget eller hele gaten? Se ut av vinduet og spør en nabo.", isCritical: false },
      { title: "Sjekk sikringsskapet", description: "Fellesarealets sikringsskap står vanligvis i kjeller eller inngangsparti. Legg inn igjen kurser som har slått ut én gang — slår de ut igjen, la dem være.", isCritical: true },
      { title: "Varsle nettselskapet", description: "Er det mer enn egne sikringer, meld strømbruddet til nettselskapet og informer styret.", isCritical: false },
    ],
  },
];
