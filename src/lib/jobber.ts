/**
 * Registeret over bakgrunnsjobbene — både appens egne (node-cron i instrumentation.ts) og
 * vertens crontab-jobber. Importfri fil (jf. nivaer.ts-mønsteret): ren data + ren utregning,
 * så både serverkode og plattformpanelet kan lese samme liste.
 *
 * Vertsjobbene er DOKUMENTASJON av crontab-en på verten — kilden er `crontab -l` der, og
 * endres den, må denne lista følge etter. Det er samme avveining som moduler/meny: én
 * registerfil som kan drifte, framfor stille usynlighet.
 */

export type Jobb = {
  nokkel: string;
  navn: string;
  beskrivelse: string;
  /** Standard cron-uttrykk: minutt time dag måned ukedag. */
  cron: string;
  /** IANA-tidssone uttrykket tolkes i. Verten kjører UTC; appen planlegger i Europe/Oslo. */
  timezone: string;
  /** Lesbar plan — eksplisitt tekst framfor cron-parsing i UI-et. */
  plan: string;
  kilde: "app" | "vert";
  /** For vertsjobber: hvor loggen ligger på verten. Appjobber logger til job_runs. */
  logg?: string;
};

export const JOBBER: Jobb[] = [
  {
    nokkel: "varsler",
    navn: "Varselsjobb",
    beskrivelse: "Forsinkede oppgaver, personlige varsler og kontraktutløp på e-post",
    cron: "0 7 * * *",
    timezone: "Europe/Oslo",
    plan: "Hver dag kl. 07:00 (Europe/Oslo)",
    kilde: "app",
  },
  {
    nokkel: "hendelsesrydding",
    navn: "Hendelsesrydding",
    beskrivelse: "Sletter hendelseslogg eldre enn 3 år og innloggingslogg eldre enn 90 dager",
    cron: "0 4 * * *",
    timezone: "Europe/Oslo",
    plan: "Hver natt kl. 04:00 (Europe/Oslo)",
    kilde: "app",
  },
  {
    nokkel: "fiken-synk",
    navn: "Fiken-synk",
    beskrivelse: "Speiler bokførte kjøp fra Fiken for orger med regnskapskobling",
    cron: "30 5 * * *",
    timezone: "Europe/Oslo",
    plan: "Hver natt kl. 05:30 (Europe/Oslo)",
    kilde: "app",
  },
  // Vertsjobbene går i vertens LOKALTID (satt til Europe/Oslo 14.08.2026 — cron må
  // restartes etter et tidssonebytte, den leser sonen ved oppstart).
  {
    nokkel: "backup",
    navn: "Backup",
    beskrivelse: "backup.sh på verten — databasedump og volumer",
    cron: "30 3 * * *",
    timezone: "Europe/Oslo",
    plan: "Hver natt kl. 03:30",
    kilde: "vert",
    logg: "~/backups/backup.log",
  },
  {
    nokkel: "docker-byggecache",
    navn: "Docker-byggecache",
    beskrivelse: "docker buildx prune av byggecache eldre enn 7 dager — frigjør diskplass",
    cron: "30 4 * * 0",
    timezone: "Europe/Oslo",
    plan: "Søndager kl. 04:30",
    kilde: "vert",
    logg: "~/backups/docker-prune.log",
  },
];

/** `*`, enkeltverdi eller kommaliste. Mer trenger ikke jobbene våre — og mer ville løyet. */
function treffer(felt: string, verdi: number): boolean {
  return felt === "*" || felt.split(",").some((d) => Number(d) === verdi);
}

const UKEDAG: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Neste kjøring for et cron-uttrykk i en gitt tidssone.
 *
 * Brute force minutt for minutt (maks åtte døgn) med Intl som klokke — det er den eneste
 * DST-trygge måten uten et bibliotek: «kl. 07:00 Europe/Oslo» er et annet UTC-tidspunkt
 * sommer og vinter, og en aritmetisk parser ville truffet feil to netter i året.
 */
export function nesteKjoring(cron: string, timezone: string, fra: Date = new Date()): Date | null {
  const deler = cron.trim().split(/\s+/);
  if (deler.length !== 5) return null;
  const [minutt, time, dag, maaned, ukedag] = deler as [string, string, string, string, string];

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    minute: "numeric",
    hour: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "short",
  });

  // Fra neste hele minutt — en jobb som skulle gått akkurat nå, er ikke «neste».
  const start = new Date(Math.ceil((fra.getTime() + 1) / 60_000) * 60_000);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    const t = new Date(start.getTime() + i * 60_000);
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
    if (
      treffer(minutt, Number(p.minute)) &&
      treffer(time, Number(p.hour) % 24) &&
      treffer(dag, Number(p.day)) &&
      treffer(maaned, Number(p.month)) &&
      treffer(ukedag, UKEDAG[p.weekday ?? ""] ?? -1)
    ) {
      return t;
    }
  }
  return null;
}
