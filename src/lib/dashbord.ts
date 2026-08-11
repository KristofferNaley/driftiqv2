/**
 * Dashbordet — aggregeringen bak widgetene.
 *
 * ## Ett kall, ikke seks
 *
 * v1 hentet ett datasett per widget-gruppe fra klienten: oppgaver, avvik, kontrakter,
 * årshjul … Det ga fem–seks parallelle kall ved hver sidelast, og hver av dem måtte gates
 * for seg. Her samles det i ett endepunkt som selv vet hvilke moduler org-en har.
 *
 * ## Gatingen er her, ikke i widgeten
 *
 * En avslått modul returnerer `null` for sitt felt — ikke en tom liste. Forskjellen er at
 * `null` betyr «du har ikke denne modulen» og tom liste betyr «du har den, men ingenting å
 * vise». Widgetene tegner ulikt i de to tilfellene, og uten skillet ville en kunde uten
 * Avvik sett «0 åpne avvik» i stedet for ingenting.
 */

import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { deviations } from "../db/schema/avvik";
import { documents } from "../db/schema/dokumenter";
import { annualEvents } from "../db/schema/arshjul";
import { hmsGoals } from "../db/schema/internkontroll";
import { contracts } from "../db/schema/kontrakter";
import { logEntries } from "../db/schema/driftslogg";
import { organizations } from "../db/schema/organizations";
import { parkingSpots } from "../db/schema/parking";
import { routines } from "../db/schema/rutiner";
import { buildingElements } from "../db/schema/vedlikehold";
import { vendors } from "../db/schema/vendors";
import { modulErAktivert, type ModulNokkel } from "./moduler";
import { hentOppgaver } from "./oppgaver";
import { effektivStatus } from "./rutiner";

const iDag = () => new Date().toISOString().slice(0, 10);

function omDager(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Kontrakter regnes som «snart utløpt» i dette vinduet — samme grense som v1. */
export const UTLOP_VARSEL_DAGER = 180;

export type Dashborddata = Awaited<ReturnType<typeof hentDashbord>>;

export async function hentDashbord(db: Db, orgId: string) {
  const rader = await db
    .select({
      enabledModules: organizations.enabledModules,
      bannerFileName: organizations.bannerFileName,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  const lagret = rader[0]?.enabledModules ?? null;
  const pa = (n: ModulNokkel) => modulErAktivert(lagret, n);

  // Bare det org-en faktisk har, hentes. En avslått modul koster ingen spørring.
  const [oppgaver, avvik, kontrakter, hendelser, mal, rutinerRader, bygningsdeler, plasser, logg, dok, lev] =
    await Promise.all([
      pa("tasks") ? hentOppgaver(db, orgId) : null,
      pa("avvik")
        ? db.select().from(deviations).where(eq(deviations.orgId, orgId)).orderBy(desc(deviations.number))
        : null,
      pa("kontrakter")
        ? db
            .select({ k: contracts, vendorName: vendors.name })
            .from(contracts)
            .leftJoin(vendors, eq(vendors.id, contracts.vendorId))
            .where(and(eq(contracts.orgId, orgId), isNull(contracts.archivedAt)))
        : null,
      pa("arshjul")
        ? db.select().from(annualEvents).where(eq(annualEvents.orgId, orgId)).orderBy(asc(annualEvents.eventDate))
        : null,
      pa("internkontroll")
        ? db.select().from(hmsGoals).where(eq(hmsGoals.orgId, orgId)).orderBy(desc(hmsGoals.year))
        : null,
      pa("rutiner") ? db.select().from(routines).where(eq(routines.orgId, orgId)) : null,
      pa("vedlikehold")
        ? db.select().from(buildingElements).where(eq(buildingElements.orgId, orgId))
        : null,
      pa("parkering")
        ? db.select().from(parkingSpots).where(eq(parkingSpots.orgId, orgId))
        : null,
      pa("driftslogg")
        ? db
            .select()
            .from(logEntries)
            .where(eq(logEntries.orgId, orgId))
            .orderBy(desc(logEntries.entryDate))
            .limit(6)
        : null,
      pa("dokumentarkiv")
        ? db.select({ n: count() }).from(documents).where(eq(documents.orgId, orgId))
        : null,
      pa("leverandorer")
        ? db.select({ aktiv: vendors.active, n: count() }).from(vendors).where(eq(vendors.orgId, orgId)).groupBy(vendors.active)
        : null,
    ]);

  const forsinkede = oppgaver?.filter((t) => t.forsinket) ?? [];
  const apneAvvik = avvik?.filter((a) => a.status !== "lukket") ?? [];
  const nyeAvvik = avvik?.filter((a) => a.status === "ny") ?? [];
  const snartUtlopt =
    kontrakter?.filter((r) => r.k.endDate && r.k.endDate >= iDag() && r.k.endDate <= omDager(UTLOP_VARSEL_DAGER)) ?? [];

  const aar = new Date().getFullYear();
  const aaretsMal = mal?.find((m) => m.year === aar) ?? null;

  return {
    /** Dashbordbanneret settes i Innstillinger → Generelt; forsiden viser det øverst. */
    banner: Boolean(rader[0]?.bannerFileName),
    moduler: {
      tasks: pa("tasks"),
      avvik: pa("avvik"),
      kontrakter: pa("kontrakter"),
      arshjul: pa("arshjul"),
      internkontroll: pa("internkontroll"),
      rutiner: pa("rutiner"),
      vedlikehold: pa("vedlikehold"),
      parkering: pa("parkering"),
      driftslogg: pa("driftslogg"),
      dokumentarkiv: pa("dokumentarkiv"),
      leverandorer: pa("leverandorer"),
    },

    kpi: {
      oppgaver: oppgaver?.length ?? null,
      aJour: oppgaver ? oppgaver.length - forsinkede.length : null,
      forsinket: oppgaver ? forsinkede.length : null,
      apneAvvik: avvik ? apneAvvik.length : null,
    },

    /**
     * Alt på tvers av modulene som trenger en handling. Rekkefølgen er prioritert: et nytt
     * avvik ingen har sett på haster mer enn en kontrakt som utløper om et halvår.
     */
    oppfolging: [
      ...(pa("avvik") && nyeAvvik.length
        ? [{
            slag: "avvik" as const,
            alvor: "hoy" as const,
            tekst: `${nyeAvvik.length} ${nyeAvvik.length === 1 ? "nytt avvik venter" : "nye avvik venter"} på behandling`,
            detalj: nyeAvvik.slice(0, 2).map((a) => `«${a.title}»`).join(", "),
            sti: "/avvik",
          }]
        : []),
      ...(pa("tasks") && forsinkede.length
        ? [{
            slag: "oppgaver" as const,
            alvor: "middels" as const,
            tekst: forsinkede.length === 1 ? "1 forsinket oppgave" : `${forsinkede.length} forsinkede oppgaver`,
            detalj: forsinkede.slice(0, 2).map((t) => t.title).join(", "),
            sti: "/oppgaver",
          }]
        : []),
      ...(pa("kontrakter") && snartUtlopt.length
        ? [{
            slag: "kontrakter" as const,
            alvor: "middels" as const,
            tekst: `${snartUtlopt.length} ${snartUtlopt.length === 1 ? "kontrakt utløper" : "kontrakter utløper"} innen seks måneder`,
            detalj: snartUtlopt.slice(0, 2).map((r) => `${r.k.title} (${r.k.endDate})`).join(", "),
            sti: "/kontrakter",
          }]
        : []),
      ...(pa("internkontroll") && aaretsMal && !aaretsMal.approved
        ? [{
            slag: "internkontroll" as const,
            alvor: "lav" as const,
            tekst: `HMS-målet for ${aar} er ikke godkjent`,
            detalj: "Mangler godkjenning fra styret",
            sti: "/internkontroll",
          }]
        : []),
      ...(pa("internkontroll") && !aaretsMal
        ? [{
            slag: "internkontroll" as const,
            alvor: "lav" as const,
            tekst: `Ingen HMS-mål satt for ${aar}`,
            detalj: "Internkontrollforskriften § 5 pkt. 4",
            sti: "/internkontroll",
          }]
        : []),
    ],

    /** Kontraktsutløp, oppgavefrister og årshjul på én tidslinje. Kun kommende. */
    frister: [
      ...(kontrakter ?? [])
        .filter((r) => r.k.endDate && r.k.endDate >= iDag())
        .map((r) => ({ dato: r.k.endDate!, navn: `${r.k.title} utløper`, kilde: "Kontrakt" })),
      ...(oppgaver ?? [])
        .filter((t) => t.nesteFrist && t.nesteFrist >= iDag())
        .map((t) => ({
          dato: t.nesteFrist!,
          navn: t.title,
          kilde: t.vendorName ? `Oppgave · ${t.vendorName}` : "Oppgave",
        })),
      ...(hendelser ?? [])
        .filter((h) => h.eventDate >= iDag())
        .map((h) => ({ dato: h.eventDate, navn: h.title, kilde: "Årshjul" })),
    ]
      .sort((a, b) => a.dato.localeCompare(b.dato))
      .slice(0, 8),

    oppgaveliste: oppgaver
      ? [...forsinkede, ...oppgaver.filter((t) => !t.forsinket)].slice(0, 6).map((t) => ({
          id: t.id,
          title: t.title,
          vendorName: t.vendorName,
          nesteFrist: t.nesteFrist,
          forsinket: t.forsinket,
        }))
      : null,

    avviksliste: avvik
      ? apneAvvik.slice(0, 6).map((a) => ({
          id: a.id,
          number: a.number,
          title: a.title,
          status: a.status,
          severity: a.severity,
        }))
      : null,

    utlopende: kontrakter
      ? snartUtlopt.slice(0, 6).map((r) => ({
          id: r.k.id,
          title: r.k.title,
          vendorName: r.vendorName,
          endDate: r.k.endDate,
        }))
      : null,

    /** Tilstandsgrad etter NS 3424, for vedlikeholdswidgeten. */
    tilstand: bygningsdeler
      ? (["TG0", "TG1", "TG2", "TG3"] as const).map((tg) => ({
          tg,
          antall: bygningsdeler.filter((e) => e.conditionGrade === tg).length,
        }))
      : null,

    parkering: plasser
      ? {
          totalt: plasser.length,
          ledige: plasser.filter((p) => p.status === "ledig").length,
          utleid: plasser.filter((p) => p.status === "utleid").length,
        }
      : null,

    rutinerTilRevisjon: rutinerRader
      ? rutinerRader
          .filter((r) => effektivStatus(r) === "trenger_gjennomgang")
          .slice(0, 5)
          .map((r) => ({ id: r.id, title: r.title, lastReviewedAt: r.lastReviewedAt }))
      : null,

    aktivitet: logg
      ? logg.map((l) => ({ id: l.id, title: l.title, entryDate: l.entryDate, createdBy: l.createdBy }))
      : null,

    antallDokumenter: dok ? (dok[0]?.n ?? 0) : null,

    leverandorer: lev
      ? {
          aktive: lev.find((r) => r.aktiv)?.n ?? 0,
          inaktive: lev.find((r) => !r.aktiv)?.n ?? 0,
        }
      : null,
  };
}

/** Antall åpne avvik gruppert på kategori — egen spørring, brukes av kategoriwidgeten. */
export async function avvikPerKategori(db: Db, orgId: string) {
  return db
    .select({ kategori: deviations.category, antall: count() })
    .from(deviations)
    .where(and(eq(deviations.orgId, orgId), sql`${deviations.status} <> 'lukket'`))
    .groupBy(deviations.category)
    .orderBy(desc(count()));
}
