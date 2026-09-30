/**
 * ENESTE sted for API-kall fra klienten. Ingen `fetch` i sider eller komponenter.
 *
 * Samme regel som v1s `frontend/src/api.js`, og av samme grunn: token, 401-håndtering og
 * feilmeldinger skal skje ett sted. Ligger de i komponentene, oppdager du først i
 * produksjon at én av dem glemte å lese `detail` og viste «[object Object]».
 *
 * v2 trenger ikke Authorization-headeren v1 satte — Better Auth bruker sesjonscookie, og
 * `credentials: "same-origin"` er nok. Til gjengjeld MÅ 401 håndteres her, siden ingen
 * enkeltside vet hva den skal gjøre med en utløpt sesjon.
 */

import type { MinAktivitet } from "./aktivitetsslag";
import type { Driftslogg } from "./driftsloggslag";
import type { Kategori, Oppslagstype, Retning, Skjerminnhold, Status } from "./oppslagstavleregler";

export class ApiKlientFeil extends Error {
  constructor(
    readonly status: number,
    melding: string,
  ) {
    super(melding);
    this.name = "ApiKlientFeil";
  }
}

async function request<T>(sti: string, init: RequestInit = {}): Promise<T> {
  const svar = await fetch(`/api${sti}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init.headers,
    },
  });

  if (svar.status === 401) {
    // Sesjonen er borte. Send brukeren til innlogging med retur-sti, i stedet for å la
    // siden stå og vise en feilmelding de ikke kan gjøre noe med.
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/logg-inn")) {
      window.location.href = `/logg-inn?retur=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiKlientFeil(401, "Ikke innlogget");
  }

  if (svar.status === 204) return undefined as T;

  const data = await svar.json().catch(() => null);
  if (!svar.ok) {
    // API-et svarer alltid `{ detail }` — se `tilSvar()` i lib/api.ts.
    throw new ApiKlientFeil(svar.status, data?.detail ?? "Noe gikk galt");
  }
  return data as T;
}

const org = (orgId: string, sti: string) => `/organizations/${orgId}${sti}`;

export const api = {
  hent: <T>(sti: string) => request<T>(sti),
  send: <T>(sti: string, kropp: unknown) =>
    request<T>(sti, { method: "POST", body: JSON.stringify(kropp) }),
  endre: <T>(sti: string, kropp: unknown) =>
    request<T>(sti, { method: "PUT", body: JSON.stringify(kropp) }),
  /** Delvis endring (PATCH) — for enkeltfelter der PUT allerede betyr noe annet. */
  lapp: <T>(sti: string, kropp: unknown) =>
    request<T>(sti, { method: "PATCH", body: JSON.stringify(kropp) }),
  slett: (sti: string) => request<void>(sti, { method: "DELETE" }),
  /** Filopplasting. `content-type` settes IKKE — nettleseren må sette grensen selv. */
  lastOpp: <T>(sti: string, form: FormData) => request<T>(sti, { method: "POST", body: form }),
};

// ---------------------------------------------------------------------------------------
// Endepunktene, per modul. Sidene kaller disse, aldri `api` direkte med en håndskrevet sti.
// ---------------------------------------------------------------------------------------

export type Plass = {
  id: string;
  number: string;
  areaLabel: string | null;
  ownershipType: string;
  spotType: string;
  status: string;
  holderName: string | null;
  unitLabel: string | null;
  /** Seksjonen plassen hører til — grunnlaget for å fakturere lading til eieren. */
  unitId: string | null;
  hasCharger: boolean;
  chargerLabel: string | null;
  notes: string | null;
  lease: { id: string; tenantName: string; pricePerMonth: number; endDate: string | null } | null;
};

export type Ventende = {
  id: string;
  name: string;
  unitLabel: string | null;
  requestedType: string;
  requestedAt: string;
  notes: string | null;
};

export type Parkeringsavtale = {
  id: string;
  spotId: string;
  tenantName: string;
  pricePerMonth: number;
  startDate: string | null;
  endDate: string | null;
  noticePeriodMonths: number | null;
  powerBilling: string | null;
  endedAt: string | null;
};

export const parkering = {
  plasser: (orgId: string) => api.hent<Plass[]>(org(orgId, "/parking/spots")),
  nyPlass: (orgId: string, data: unknown) => api.send<Plass>(org(orgId, "/parking/spots"), data),
  nySerie: (orgId: string, data: unknown) => api.send<Plass[]>(org(orgId, "/parking/spots/serie"), data),
  endrePlass: (orgId: string, id: string, data: unknown) =>
    api.endre<Plass>(org(orgId, `/parking/spots/${id}`), data),
  slettPlass: (orgId: string, id: string) => api.slett(org(orgId, `/parking/spots/${id}`)),

  avtaler: (orgId: string) => api.hent<Parkeringsavtale[]>(org(orgId, "/parking/leases")),
  nyAvtale: (orgId: string, data: unknown) => api.send(org(orgId, "/parking/leases"), data),
  avsluttAvtale: (orgId: string, id: string) => api.slett(org(orgId, `/parking/leases/${id}`)),

  venteliste: (orgId: string) => api.hent<Ventende[]>(org(orgId, "/parking/waitlist")),
  nyVentende: (orgId: string, data: unknown) => api.send<Ventende>(org(orgId, "/parking/waitlist"), data),
  slettVentende: (orgId: string, id: string) => api.slett(org(orgId, `/parking/waitlist/${id}`)),
};

export type Oppgave = {
  id: string; title: string; description: string | null; location: string | null;
  frequency: string; startDate: string | null; dueDate: string | null; active: boolean;
  qrToken: string | null; vendorId: string; vendorName: string | null; unitNavn: string | null;
  ansvarligNavn: string | null;
  /**
   * `unitId`, `responsibleUserId` og `showOnArshjul` manglet i typen selv om API-et alltid
   * har sendt dem — ruta returnerer hele oppgaveraden. Følgen var at redigeringsskjemaet ikke
   * kunne forhåndsfylle sted og ansvarlig: verdiene var i svaret, men usynlige for TypeScript.
   * Samme glipp som er dokumentert på `Dokument` lenger ned.
   */
  unitId: string | null; responsibleUserId: string | null; showOnArshjul: boolean;
  lastCompletedAt: string | null; nesteFrist: string | null; forsinket: boolean;
};

/**
 * Ett SJEKKPUNKT slik det sto ved én utførelse — kopien i `completion_checklist_results`.
 *
 * `itemId` peker på malpunktet og er nullbar: malen kan endres, og punkter som er tatt bort
 * settes til null. `text` er derfor protokollen, id-en er søkenøkkelen — samme skille som for
 * aktørene i `lib/aktor.ts`.
 */
export type Utkvitteringspunkt = {
  id: string;
  itemId: string | null;
  text: string;
  checked: boolean;
  /**
   * Måleverdien, som STRENG.
   *
   * `numeric` kommer slik fra node-postgres, akkurat som bigint — gjennom `Number()` før noe
   * regnes eller tegnes. Typen sier det med vilje, i stedet for å love et tall som ikke er der.
   */
  value: string | null;
  /** Enheten slik den sto den dagen. Kan avvike fra malens nåværende — det er poenget. */
  unit: string | null;
  order: number;
};

/**
 * Et malpunkt på oppgaven.
 *
 * `tall` er punktet som krever en avlesning — sprinklertrykk, temperatur. `unit` er kun satt
 * for dem, og kopieres inn i hver utførelse slik at gamle avlesninger ikke omtolkes hvis
 * enheten endres i malen senere.
 */
export type Sjekkpunkt = {
  id: string;
  text: string;
  order: number;
  type: "avkryssing" | "tall";
  unit: string | null;
  required: boolean;
};

/** Bildet leverandøren tok på stedet. Filen hentes fra utkvitteringens egen filrute. */
export type Utkvitteringsbilde = {
  id: string;
  originalName: string;
  contentType: string | null;
  fileSize: number | null;
};

export type Utkvittering = {
  id: string;
  completedAt: string;
  completedBy: string;
  notes: string | null;
  manual: boolean;
  punkter: Utkvitteringspunkt[];
  bilder: Utkvitteringsbilde[];
};

export type OppgaveMedHistorikk = Oppgave & {
  sjekkliste: Sjekkpunkt[];
  utkvitteringer: Utkvittering[];
};

export const oppgaver = {
  /** Deaktiverte er ute som standard — send `medDeaktiverte` for å få dem med. */
  liste: (o: string, medDeaktiverte = false) =>
    api.hent<Oppgave[]>(org(o, `/tasks${medDeaktiverte ? "?deaktiverte=1" : ""}`)),
  hent: (o: string, id: string) => api.hent<OppgaveMedHistorikk>(org(o, `/tasks/${id}`)),
  ny: (o: string, d: unknown) => api.send<Oppgave>(org(o, "/tasks"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Oppgave>(org(o, `/tasks/${id}`), d),
  deaktiver: (o: string, id: string) => api.slett(org(o, `/tasks/${id}`)),
  kvitterUt: (o: string, id: string, d: unknown) => api.send(org(o, `/tasks/${id}/completions`), d),
  settSjekkliste: (o: string, id: string, d: unknown) => api.endre(org(o, `/tasks/${id}/checklist`), d),
};

export type Avvik = {
  id: string; number: number | null; title: string; description: string | null;
  status: string; severity: string | null; assignedTo: string | null; dueDate: string | null;
  reportedBy: string; reportedAt: string; category: string | null; unitNavn: string | null;
};

export type AvvikDetalj = Avvik & {
  responsibleUserId: string | null;
  vendorId: string | null;
  taskId: string | null;
  unitId: string | null;
  vendorNavn: string | null;
  taskTittel: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  behandlinger: Array<{ id: string; text: string; createdBy: string; createdAt: string }>;
  vedlegg: Array<{
    id: string; originalName: string; contentType: string | null; fileSize: number | null;
    uploadedBy: string; uploadedAt: string; treatmentId: string | null;
  }>;
  logg: Array<{ id: string; event: string; changedBy: string; changedAt: string }>;
};

export type AvvikSok = {
  side?: number;
  sok?: string;
  kategori?: string;
  unitId?: string;
  lukkede?: boolean;
  sorter?: string;
  retning?: "asc" | "desc";
};

export type AvvikSvar = {
  items: Avvik[];
  total: number;
  side: number;
  sider: number;
  stats: {
    ytd: number; ytdIFjor: number; ytdEndring: number | null;
    ny: number; underBehandling: number; lukket: number; mine: number;
  };
  kategorier: string | null;
};

export const avvik = {
  /** Liste + nøkkeltall + kategorier i ett kall — se kommentaren på GET-ruta. */
  liste: (o: string, sok: AvvikSok = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sok)) {
      if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
    }
    return api.hent<AvvikSvar>(org(o, `/deviations?${p.toString()}`));
  },
  hent: (o: string, id: string) =>
    api.hent<AvvikDetalj>(org(o, `/deviations/${id}`)),
  meld: (o: string, d: unknown) => api.send<Avvik>(org(o, "/deviations"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Avvik>(org(o, `/deviations/${id}`), d),
  lukk: (o: string, id: string, d: unknown) => api.send(org(o, `/deviations/${id}/close`), d),
  behandle: (o: string, id: string, d: unknown) => api.send(org(o, `/deviations/${id}/treatments`), d),
  lastOppVedlegg: (o: string, id: string, f: FormData) =>
    api.lastOpp(org(o, `/deviations/${id}/vedlegg`), f),
  slettVedlegg: (o: string, id: string, vId: string) =>
    api.slett(org(o, `/deviations/${id}/vedlegg/${vId}`)),
};

export type Kontrakt = {
  id: string; title: string; category: string | null; annualSum: number | null; account: number | null;
  startDate: string | null; endDate: string | null; vendorId: string; vendorName: string | null;
  fileName: string | null; fileOriginalName: string | null; aiReadable: boolean;
  archivedAt: string | null; archiveNote: string | null;
  // API-et returnerer hele raden; uten disse i typen kunne ikke redigeringsskjemaet
  // forhåndsfylle notat og kontaktperson — samme glipp som er dokumentert på `Dokument`.
  notes: string | null; contactName: string | null; contactEmail: string | null;
  contactPhone: string | null; predecessorId: string | null;
};

export const kontrakter = {
  liste: (o: string, arkiverte?: boolean) =>
    api.hent<Kontrakt[]>(org(o, `/contracts${arkiverte === undefined ? "" : `?arkiverte=${arkiverte}`}`)),
  hent: (o: string, id: string) =>
    api.hent<Kontrakt & { prishistorikk: Array<{ id: string; effectiveDate: string; annualSum: number; note: string | null }> }>(org(o, `/contracts/${id}`)),
  ny: (o: string, d: unknown) => api.send<Kontrakt>(org(o, "/contracts"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Kontrakt>(org(o, `/contracts/${id}`), d),
  slett: (o: string, id: string) => api.slett(org(o, `/contracts/${id}`)),
  arkiver: (o: string, id: string, d: unknown) => api.send(org(o, `/contracts/${id}/archive`), d),
  gjenopprett: (o: string, id: string) => api.slett(org(o, `/contracts/${id}/archive`)),
  lastOppFil: (o: string, id: string, f: FormData) => api.lastOpp(org(o, `/contracts/${id}/file`), f),
  slettFil: (o: string, id: string) => api.slett(org(o, `/contracts/${id}/file`)),
  nyPris: (o: string, id: string, d: unknown) => api.send(org(o, `/contracts/${id}/prices`), d),
  slettPris: (o: string, id: string, prisId: string) =>
    api.slett(org(o, `/contracts/${id}/prices/${prisId}`)),
};

export type Leverandor = {
  id: string; name: string; active: boolean; relationshipType: string; category: string | null;
  customerNumber: string | null; ehf: boolean; orgNumber: string | null; notes: string | null;
};

/** Lista bærer oversiktsfeltene — detaljhentingen (`hent`) har dem ikke. */
export type LeverandorIListe = Leverandor & {
  primaryContactName: string | null;
  antallKontrakter: number;
  antallOppgaver: number;
};

export const leverandorer = {
  liste: (o: string) => api.hent<LeverandorIListe[]>(org(o, "/vendors")),
  hent: (o: string, id: string) =>
    api.hent<Leverandor & { kontakter: Array<{ id: string; name: string; role: string | null; email: string | null; phone: string | null; isPrimary: boolean }>; adgang: Array<{ id: string; title: string; status: string; issuedTo: string | null; areas: string | null; issuedAt: string | null }>; notater: Array<{ id: string; text: string; authorName: string | null; createdAt: string }> }>(org(o, `/vendors/${id}`)),
  ny: (o: string, d: unknown) => api.send<Leverandor>(org(o, "/vendors"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Leverandor>(org(o, `/vendors/${id}`), d),
  slett: (o: string, id: string) => api.slett(org(o, `/vendors/${id}`)),
  nyKontakt: (o: string, id: string, d: unknown) => api.send(org(o, `/vendors/${id}/contacts`), d),
  endreKontakt: (o: string, id: string, kontaktId: string, d: unknown) =>
    api.endre(org(o, `/vendors/${id}/contacts/${kontaktId}`), d),
  slettKontakt: (o: string, id: string, kontaktId: string) =>
    api.slett(org(o, `/vendors/${id}/contacts/${kontaktId}`)),
  nyAdgang: (o: string, id: string, d: unknown) => api.send(org(o, `/vendors/${id}/access-items`), d),
  endreAdgang: (o: string, id: string, itemId: string, d: unknown) =>
    api.endre(org(o, `/vendors/${id}/access-items/${itemId}`), d),
  slettAdgang: (o: string, id: string, itemId: string) =>
    api.slett(org(o, `/vendors/${id}/access-items/${itemId}`)),
  nyttNotat: (o: string, id: string, d: unknown) => api.send(org(o, `/vendors/${id}/notes`), d),
  slettNotat: (o: string, id: string, notatId: string) =>
    api.slett(org(o, `/vendors/${id}/notes/${notatId}`)),
  /**
   * Sender QR-informasjonen til leverandøren. Mottakeren valideres SERVERSIDE mot
   * kontaktpersonene — se `sendQrInfo`. Svaret bekrefter hvilken adresse som fikk den.
   */
  sendQrInfo: (o: string, id: string, d: { emne: string; tekst: string; til: string }) =>
    api.send<{ sendt: true; til: string }>(org(o, `/vendors/${id}/qr-info`), d),
};

export type Dokument = {
  id: string; title: string; folder: string; documentDate: string | null;
  originalName: string; fileSize: number | null; aiReadable: boolean;
  // API-et returnerer hele raden; disse manglet i typen og gjorde at kallsteder som
  // trengte filikon eller opplastingsdato ikke kompilerte.
  contentType: string; uploadedAt: string; description: string | null;
  /** Tekstsøk (docs/tekstsok.md). Selve teksten sendes aldri hit; `harTekst` sier om innholdet er søkbart. */
  harTekst: boolean; textSource: "pdf" | "docx" | "ocr" | "ingen" | "feil" | null;
  textExtractedAt: string | null; textError: string | null;
};
export type Mappe = { id: string; name: string; icon: string; parentId: string | null };

export const dokumenter = {
  liste: (o: string, mappe?: string) =>
    api.hent<Dokument[]>(org(o, `/documents${mappe ? `?mappe=${encodeURIComponent(mappe)}` : ""}`)),
  lastOpp: (o: string, f: FormData) => api.lastOpp<Dokument>(org(o, "/documents"), f),
  endre: (o: string, id: string, d: unknown) => api.endre<Dokument>(org(o, `/documents/${id}`), d),
  slett: (o: string, id: string) => api.slett(org(o, `/documents/${id}`)),
  mapper: (o: string) => api.hent<Mappe[]>(org(o, "/document-folders")),
  nyMappe: (o: string, d: unknown) => api.send<Mappe>(org(o, "/document-folders"), d),
  slettMappe: (o: string, id: string) => api.slett(org(o, `/document-folders/${id}`)),
  endreMappe: (o: string, id: string, d: unknown) =>
    api.endre<Mappe>(org(o, `/document-folders/${id}`), d),
  oversikt: (o: string) => api.hent<Arkivoversikt>(org(o, "/documents/oversikt")),
};

export type ArkivDok = {
  id: string; title: string; folder: string; fileSize: number | null;
  originalName: string; contentType: string; documentDate: string | null; uploadedAt: string;
};

export type Arkivoversikt = {
  faste: Array<{ nokkel: string; antall: number; antallUndermapper: number }>;
  egne: Array<Mappe & { antall: number; antallUndermapper: number }>;
  speil: {
    vedlikehold: { antall: number; antallDeler: number };
    kontrakter: { antall: number; antallLeverandorer: number };
  };
  anbefalt: Array<{ mappe: string; tittel: string; hint?: string; ok: boolean }>;
  lagring: { brukt: number; kvote: number; prosent: number };
  nylig: ArkivDok[];
  antallTotalt: number;
};

export type Bygningsdel = {
  id: string; name: string; icon: string; category: string | null; conditionGrade: string | null;
  installedYear: number | null; nextActionYear: number | null; estimatedCost: number | null;
  warrantyExpires: string | null; vendorName: string | null;
  garanti: "aktiv" | "utløpt" | "ukjent"; fdv: { fylt: number; av: number; prosent: number };
};

export type Service = { id: string; serviceDate: string; title: string; performedBy: string | null; notes: string | null };

/** Detaljen har hele raden — redigeringsskjemaet forhåndsutfylles fra den. */
export type BygningsdelDetalj = Bygningsdel & {
  expectedLifetimeYears: number | null;
  warrantyYears: number | null;
  vendorId: string | null;
  notes: string | null;
  dokumenter: Array<{ id: string; fdvType: string; title: string }>;
  historikk: Service[];
  antallEnhetsarbeider: number;
};

export const vedlikehold = {
  elementer: (o: string) => api.hent<Bygningsdel[]>(org(o, "/maintenance/elements")),
  hent: (o: string, id: string) => api.hent<BygningsdelDetalj>(org(o, `/maintenance/elements/${id}`)),
  nyttElement: (o: string, d: unknown) => api.send<Bygningsdel>(org(o, "/maintenance/elements"), d),
  endreElement: (o: string, id: string, d: unknown) => api.endre<Bygningsdel>(org(o, `/maintenance/elements/${id}`), d),
  slettElement: (o: string, id: string) => api.slett(org(o, `/maintenance/elements/${id}`)),
  nyService: (o: string, id: string, d: unknown) => api.send(org(o, `/maintenance/elements/${id}/services`), d),
  endreService: (o: string, id: string, serviceId: string, d: unknown) =>
    api.endre(org(o, `/maintenance/elements/${id}/services/${serviceId}`), d),
  slettService: (o: string, id: string, serviceId: string) =>
    api.slett(org(o, `/maintenance/elements/${id}/services/${serviceId}`)),
  lastOppFdv: (o: string, id: string, f: FormData) => api.lastOpp(org(o, `/maintenance/elements/${id}/documents`), f),
  slettFdv: (o: string, id: string, docId: string) => api.slett(org(o, `/maintenance/elements/${id}/documents/${docId}`)),
  arbeider: (o: string) => api.hent<Array<{ id: string; unitLabel: string; title: string; workDate: string; workType: string; paidBy: string; cost: number | null; vendorName: string | null }>>(org(o, "/maintenance/unit-works")),
  nyttArbeid: (o: string, d: unknown) => api.send(org(o, "/maintenance/unit-works"), d),
};

export type Logglinje = {
  id: string; title: string; description: string | null; entryDate: string;
  createdBy: string; vendorName: string | null;
};

export const driftslogg = {
  /** Den samlede tidslinja — fem kilder flettet på serveren. Typen bor i driftsloggslag.ts. */
  liste: (o: string) => api.hent<Driftslogg>(org(o, "/driftslogg")),
  ny: (o: string, d: unknown) => api.send<Logglinje>(org(o, "/driftslogg"), d),
  slett: (o: string, id: string) => api.slett(org(o, `/driftslogg/${id}`)),
};

export type Hendelse = {
  id: string; title: string; description: string | null; category: string;
  startDate: string | null; eventDate: string; isRecurring: boolean;
};

export const arshjul = {
  liste: (o: string) => api.hent<Hendelse[]>(org(o, "/annual-events")),
  ny: (o: string, d: unknown) => api.send<Hendelse>(org(o, "/annual-events"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Hendelse>(org(o, `/annual-events/${id}`), d),
  slett: (o: string, id: string) => api.slett(org(o, `/annual-events/${id}`)),
  hjul: (o: string, aar: number) => api.hent<Arshjulsdata>(org(o, `/arshjul/hjul?aar=${aar}`)),
};

export type Hjulhendelse = {
  id: string; tittel: string; under: string;
  kategori: "oppgave" | "dugnad" | "budsjett" | "frist" | "hms" | "annet";
  dato: string; startDato: string | null;
  kilde: "manuell" | "oppgaver" | "internkontroll";
  gjentas: boolean;
};

export type Arshjulsdata = {
  aar: number;
  hendelser: Hjulhendelse[];
  oppgavevalg: Array<{
    id: string; tittel: string; frekvens: string; leverandor: string | null; vises: boolean;
  }>;
};

export type Rutine = {
  id: string; title: string; description: string | null; category: string | null;
  responsible: string | null; appliesTo: string | null; isCritical: boolean;
  reviewIntervalMonths: number | null; status: string; version: number;
  lastReviewedAt: string | null;
  vendorId: string | null; contractId: string | null; documentId: string | null;
  taskId: string | null; internkontrollNote: string | null;
  effektivStatus: "utkast" | "aktiv" | "trenger_gjennomgang";
};

export const rutiner = {
  liste: (o: string) => api.hent<Rutine[]>(org(o, "/routines")),
  hent: (o: string, id: string) =>
    api.hent<Rutine & { steg: Array<{ id: string; title: string; description: string | null; isCritical: boolean; calloutType: string | null; calloutText: string | null; kontakt: { name: string; phone: string | null } | null }>; versjoner: Array<{ id: string; versionNumber: number; changedBy: string; changedAt: string }> }>(org(o, `/routines/${id}`)),
  ny: (o: string, d: unknown) => api.send<Rutine>(org(o, "/routines"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Rutine>(org(o, `/routines/${id}`), d),
  /** Fryser dagens kladd som versjon i historikken og setter status publisert. */
  publiser: (o: string, id: string) => api.send<Rutine>(org(o, `/routines/${id}/publiser`), {}),
  slett: (o: string, id: string) => api.slett(org(o, `/routines/${id}`)),
  markerGjennomgatt: (o: string, id: string) => api.send(org(o, `/routines/${id}/review`), {}),
};

export type IkStatus = {
  aar: number; maalSatt: boolean; ansvarFordelt: boolean; risikoKartlagt: boolean;
  vernerundeGjennomfort: boolean; evaluert: boolean;
};
export type Fare = {
  id: string; title: string; category: string | null; description: string | null;
  /** null = ikke vurdert — seedede farer starter slik til noen tar stilling. */
  probability: number | null; consequence: number | null;
  status: string; owner: string | null;
  /** null = løpende drift; ellers prosjektet vurderingen hører til. */
  context: string | null;
  lastAssessedAt: string | null;
  /** Aldri vurdert, eller vurderingen er over tolv måneder gammel. */
  trengerVurdering: boolean;
  risiko: number | null; niva: "lav" | "middels" | "hoy" | null;
  tiltak: Array<{ id: string; title: string; status: string; dueDate: string | null; owner: string | null }>;
};

export type HmsMal = {
  id: string; templateType: string; name: string; description: string | null; isDefault: boolean;
};

export type IkOversikt = {
  kpi: { registrerte: number; hoyRisiko: number; forfalteTiltak: number; handtert: number };
  sisteGjennomgang: {
    id: string; reviewDate: string; participants: string | null;
    fordeling: { lav: number; middels: number; hoy: number; uvurdert: number };
    utenTiltak: number;
    perOmrade: Array<{ omrade: string; antall: number }>;
  } | null;
  oppfolging: { risikoerUtenTiltak: number; apneAvvik: number; avvikFraRunder: number };
  frister: Array<{ tittel: string; dato: string | null; status: "fullfort" | "neste" }>;
  aktivitet: Array<{ dato: string; tekst: string }>;
};

export type Gjennomgang = {
  id: string; context: string | null; reviewDate: string;
  participants: string | null; conclusion: string | null; createdAt: string;
  antallFarer: number;
};

export type GjennomgangDetalj = Omit<Gjennomgang, "antallFarer"> & {
  punkter: Array<{
    id: string; title: string; category: string | null; description: string | null;
    probability: number | null; consequence: number | null;
    status: string; owner: string | null; actions: string | null;
    risiko: number | null; niva: "lav" | "middels" | "hoy" | null;
  }>;
};

export type Sjekkliste = {
  id: string; name: string; description: string | null; antallPunkter: number;
};

export type SjekklisteDetalj = {
  id: string; name: string; description: string | null;
  punkter: Array<{ id: string; text: string; section: string | null; order: number }>;
};

export type Rundepunkt = {
  id: string; text: string; section: string | null;
  /** ok | avvik | ikke_aktuelt | null = ubesvart. */
  status: string | null;
  checked: boolean; notes: string | null;
};

export type Runde = {
  id: string; title: string; status: string; roundDate: string | null; dueDate: string | null;
  notes: string | null;
  punkter: Rundepunkt[];
  deltakere: Array<{ id: string; name: string; role: string | null }>;
  /** Runde-endepunktet leverer hele avviksraden — koblingen til punktet er med. */
  avvik: Array<Avvik & { roundItemId: string | null }>;
};

export const internkontroll = {
  status: (o: string) => api.hent<IkStatus>(org(o, "/hms/status")),
  maal: (o: string) => api.hent<Array<{ id: string; year: number; goalText: string; approved: boolean }>>(org(o, "/hms/goals")),
  nyttMaal: (o: string, d: unknown) => api.send(org(o, "/hms/goals"), d),
  signer: (o: string, id: string) => api.send(org(o, `/hms/goals/${id}/sign`), {}),
  ansvar: (o: string) => api.hent<Array<{ area: string; personName: string | null; note: string | null }>>(org(o, "/hms/responsibilities")),
  settAnsvar: (o: string, d: unknown) => api.endre(org(o, "/hms/responsibilities"), d),
  maler: (o: string, type: string) => api.hent<HmsMal[]>(org(o, `/hms/maler?type=${encodeURIComponent(type)}`)),
  farer: (o: string) => api.hent<Fare[]>(org(o, "/hms/hazards")),
  nyFare: (o: string, d: unknown) => api.send<Fare>(org(o, "/hms/hazards"), d),
  endreFare: (o: string, id: string, d: unknown) => api.endre<Fare>(org(o, `/hms/hazards/${id}`), d),
  slettFare: (o: string, id: string) => api.slett(org(o, `/hms/hazards/${id}`)),
  seedFarer: (o: string, templateId: string) =>
    api.send<{ opprettet: number; hoppetOver: number }>(org(o, "/hms/hazards/seed"), { templateId }),
  nyttTiltak: (o: string, d: unknown) => api.send(org(o, "/hms/actions"), d),
  endreTiltak: (o: string, id: string, d: unknown) => api.endre(org(o, `/hms/actions/${id}`), d),
  slettTiltak: (o: string, id: string) => api.slett(org(o, `/hms/actions/${id}`)),
  oversikt: (o: string) => api.hent<IkOversikt>(org(o, "/hms/oversikt")),
  gjennomganger: (o: string) => api.hent<Gjennomgang[]>(org(o, "/hms/risk-reviews")),
  hentGjennomgang: (o: string, id: string) => api.hent<GjennomgangDetalj>(org(o, `/hms/risk-reviews/${id}`)),
  nyGjennomgang: (o: string, d: unknown) => api.send<GjennomgangDetalj>(org(o, "/hms/risk-reviews"), d),
  sjekklister: (o: string) => api.hent<Sjekkliste[]>(org(o, "/hms/checklists")),
  hentSjekkliste: (o: string, id: string) => api.hent<SjekklisteDetalj>(org(o, `/hms/checklists/${id}`)),
  nySjekkliste: (o: string, d: unknown) => api.send<SjekklisteDetalj>(org(o, "/hms/checklists"), d),
  endreSjekkliste: (o: string, id: string, d: unknown) => api.endre(org(o, `/hms/checklists/${id}`), d),
  slettSjekkliste: (o: string, id: string) => api.slett(org(o, `/hms/checklists/${id}`)),
  nyttSjekklistepunkt: (o: string, id: string, d: unknown) => api.send(org(o, `/hms/checklists/${id}/items`), d),
  endreSjekklistepunkt: (o: string, id: string, pid: string, d: unknown) => api.endre(org(o, `/hms/checklists/${id}/items/${pid}`), d),
  slettSjekklistepunkt: (o: string, id: string, pid: string) => api.slett(org(o, `/hms/checklists/${id}/items/${pid}`)),
  runder: (o: string) =>
    api.hent<Array<{ id: string; title: string; roundDate: string | null; dueDate: string | null; status: string; checklistName: string | null }>>(org(o, "/hms/rounds")),
  hentRunde: (o: string, id: string) => api.hent<Runde>(org(o, `/hms/rounds/${id}`)),
  nyRunde: (o: string, d: unknown) => api.send<{ id: string }>(org(o, "/hms/rounds"), d),
  slettRunde: (o: string, id: string) => api.slett(org(o, `/hms/rounds/${id}`)),
  kryssAv: (o: string, rid: string, pid: string, d: unknown) => api.endre(org(o, `/hms/rounds/${rid}/items/${pid}`), d),
  nyttPunkt: (o: string, rid: string, d: unknown) => api.send<Rundepunkt>(org(o, `/hms/rounds/${rid}/items`), d),
  slettPunkt: (o: string, rid: string, pid: string) => api.slett(org(o, `/hms/rounds/${rid}/items/${pid}`)),
  nyDeltaker: (o: string, rid: string, d: unknown) => api.send(org(o, `/hms/rounds/${rid}/participants`), d),
  slettDeltaker: (o: string, rid: string, did: string) => api.slett(org(o, `/hms/rounds/${rid}/participants/${did}`)),
  fullfor: (o: string, id: string) => api.send(org(o, `/hms/rounds/${id}/complete`), {}),
  evalueringer: (o: string) => api.hent<Array<{ id: string; year: number; conclusion: string | null; evaluatedDate: string | null }>>(org(o, "/hms/evaluations")),
  nyEvaluering: (o: string, d: unknown) => api.send(org(o, "/hms/evaluations"), d),
};

export type Samtale = { id: string; title: string; updatedAt: string };

/** Inngangskortene på rådgiversiden. Speiler `AiKort` i lib/ai.ts — regnes av serveren. */
export type AiKort = {
  antall: number; enhet: string; tittel: string; detalj: string;
  sporsmal: string; tone: "rod" | "gul" | "gronn";
};

export const aiRadgiver = {
  samtaler: (o: string) => api.hent<Samtale[]>(org(o, "/ai/conversations")),
  hent: (o: string, id: string) =>
    api.hent<Samtale & { meldinger: Array<{ id: string; role: string; content: string; sources: string | null }> }>(org(o, `/ai/conversations/${id}`)),
  slett: (o: string, id: string) => api.slett(org(o, `/ai/conversations/${id}`)),
  spor: (o: string, d: unknown) =>
    api.send<{ svar: string; kilder: string[]; samtaleId: string }>(org(o, "/ai/ask"), d),
  oversikt: (o: string) => api.hent<AiKort[]>(org(o, "/ai/oversikt")),
};

export type Enhet = {
  id: string; type: string; navn: string | null; andelsnr: string | null;
  leilighetsnr: string | null; oppgang: string | null; etasje: string | null;
  arealM2: string | null; archivedAt: string | null; apneAvvik: number; antallAvvik: number;
  brokTeller: number | null; brokNevner: number | null;
};

export type Adressetreff = {
  adressetekst: string | null; nummer: number | null; bokstav: string;
  postnummer: string | null; poststed: string | null; kommunenavn: string | null;
  bruksenhetsnummer: string[];
};

export const enheter = {
  liste: (o: string, medArkiverte = false) =>
    api.hent<Enhet[]>(org(o, `/units${medArkiverte ? "?arkiverte=true" : ""}`)),
  ny: (o: string, d: unknown) => api.send<Enhet>(org(o, "/units"), d),
  endre: (o: string, id: string, d: unknown) => api.endre<Enhet>(org(o, `/units/${id}`), d),
  arkiver: (o: string, id: string) => api.slett(org(o, `/units/${id}`)),
  adressesok: (o: string, adresse: string) =>
    api.hent<Adressetreff[]>(org(o, `/units/adressesok?adresse=${encodeURIComponent(adresse)}`)),
  importer: (o: string, rader: unknown) =>
    api.send<{ opprettet: number; hoppetOver: number }>(org(o, "/units/import"), { rader }),
};

// ---------------------------------------------------------------------------------------
// Økonomi. Alle beløp er ØRE (heltall) — se lib/okonomiregler.ts for konverteringen.
// ---------------------------------------------------------------------------------------

export type Eier = {
  id: string; unitId: string; name: string; email: string | null; phone: string | null;
  invoiceAddress: string | null; ownerFrom: string; ownerTo: string | null; note: string | null;
};

export type Seksjon = {
  unitId: string; navn: string; andelsnr: string | null; leilighetsnr: string | null;
  oppgang: string | null; arealM2: string | null; brokTeller: number | null; brokNevner: number | null;
  eier: Eier | null; antallTidligere: number;
  /** Gjeldende sats per måned i øre, eller null. */
  satsMnd: number | null;
};

export type SeksjonDetalj = {
  unitId: string; navn: string; fulltNavn: string; type: string; andelsnr: string | null;
  leilighetsnr: string | null; oppgang: string | null; etasje: string | null; arealM2: string | null;
  brokTeller: number | null; brokNevner: number | null;
  eier: Eier | null; tidligere: Eier[];
  sats: Sats | null; satser: Sats[];
  fakturalinjer: Array<{
    id: string; month: string; dueDate: string; amount: number; ownerName: string | null;
    orderReference: string; externalRef: string | null; kjoringStatus: string;
  }>;
  historikk: Array<{ dato: string; tone: "ok" | "info" | "warn" | "muted"; tittel: string; detalj: string }>;
};

export type Eierregister = {
  seksjoner: Seksjon[]; brokSum: number; utenBrok: number; utenEier: number; satsSumMnd: number;
};

export type Budsjettsummer = { felleskost: number; inntekter: number; kostnader: number; resultat: number };

export type Budsjett = {
  id: string; year: number; status: string; adoptedDate: string | null; note: string | null;
  createdAt: string; updatedAt: string; summer: Budsjettsummer; antallLinjer: number;
};

export type Budsjettlinje = {
  id: string; budgetId: string; kind: string; name: string; accountFrom: number | null;
  accountTo: number | null; amount: number; note: string | null; sortOrder: number;
  /** Godkjente og betalte fakturaer knyttet til linja, i øre. */
  faktisk: number;
};

export type BudsjettDetalj = Omit<Budsjett, "antallLinjer"> & {
  linjer: Budsjettlinje[]; faktiskKostnader: number;
  /** «fiken» når regnskapet er koblet — da er faktisk bokførte kjøp, ikke godkjente fakturaer. */
  faktiskKilde: "fiken" | "fakturaer";
};

export type FikenStatus = {
  konfigurert: { kryptering: boolean; oauth: boolean; apiNokkel: boolean };
  kobling: {
    companySlug: string; companyName: string; companyOrgNumber: string | null; vatType: string | null;
    authMode: string; connectedBy: string; createdAt: string; lastSyncAt: string | null; lastSyncError: string | null;
  } | null;
  kjop: { antall: number; sum: number };
};

export type FikenKjop = {
  id: string; fikenId: string; date: string; dueDate: string | null; identifier: string | null;
  supplierName: string | null; supplierOrgNumber: string | null; gross: number; paid: boolean;
  settled: boolean; deleted: boolean; syncedAt: string;
  linjer: Array<{ account: number | null; description: string | null; net: number; vat: number; gross: number }>;
};

export type Sats = {
  id: string; unitId: string; budgetId: string | null; monthlyAmount: number;
  validFrom: string; source: string; note: string | null;
};

export type Satsoversikt = {
  dato: string;
  rader: Array<{
    unitId: string; navn: string; oppgang: string | null; brokTeller: number | null; brokNevner: number | null;
    eierNavn: string | null; sats: Sats | null; alle: Sats[];
  }>;
  maanedligSum: number; utenSats: number;
};

export type Regnskapsstatus = {
  system: "fiken" | "tripletex" | null; navn: string; foretak: string | null; kanFakturere: boolean; grunn: string | null;
};

export type Ladekjoring = {
  id: string; periodStart: string; periodEnd: string; status: string; dueDate: string; incomeAccount: string;
  totalAmount: number; lineCount: number; missingRecipients: number; totalKwh: number;
  sentTo: string | null; sentAt: string | null; createdBy: string; note: string | null; createdAt: string;
};

export type LadekjoringDetalj = Ladekjoring & {
  etikett: string;
  linjer: Array<{
    id: string; unitId: string | null; ownerId: string | null; ownerName: string | null; ownerEmail: string | null;
    unitLabel: string | null; description: string; issue: string | null; kwh: number; kwhDay: number; kwhNight: number;
    energyAmount: number; gridAmount: number; fixedAmount: number; amount: number; orderReference: string;
    externalRef: string | null; externalNumber: string | null; sentToRecipient: string | null;
  }>;
};

export type Kjoring = {
  id: string; periodStart: string; periodEnd: string; status: string; dueDay: number;
  totalAmount: number; lineCount: number; missingOwners: number; createdBy: string;
  note: string | null; createdAt: string;
};

export type KjoringDetalj = Kjoring & {
  linjer: Array<{
    id: string; unitId: string; ownerId: string | null; ownerName: string | null; month: string;
    dueDate: string; amount: number; orderReference: string; externalRef: string | null;
    enhetNavn: string; oppgang: string | null; andelsnr: string | null;
  }>;
};

export type Faktura = {
  id: string; vendorId: string | null; supplierName: string | null; contractId: string | null;
  budgetLineId: string | null; invoiceNumber: string | null; invoiceDate: string;
  dueDate: string | null; amount: number; kid: string | null; description: string | null;
  note: string | null; status: string; registeredBy: string; decidedBy: string | null;
  decidedAt: string | null; decisionNote: string | null; paidDate: string | null;
  fileName: string | null; fileOriginalName: string | null; fileSize: number | null;
  createdAt: string;
  leverandorNavn: string; budsjettlinjeNavn: string | null; budsjettAar: number | null;
  kontraktTittel: string | null; forfalt: boolean;
};

export type Budsjettforslag = {
  prosent: number;
  linjer: Array<{
    lineId: string; name: string; kind: string; accountFrom: number | null; accountTo: number | null;
    naavaerende: number;
    /** Sum av kildene i øre, FØR justering. */
    grunnlag: number;
    /** Grunnlag × (1 + prosent/100), rundet til hele kroner. Null når linja ikke har kilder. */
    forslag: number | null;
    kilder: Array<{ slag: "avtale" | "vedlikehold"; navn: string; belop: number; maaneder: number }>;
    fjoraretsBudsjett: number | null;
    fjoraretsFaktisk: number | null;
  }>;
  /** Avtaler som ikke er med: mangler konto, pris, eller treffer ingen linje. */
  utenom: Array<{ id: string; title: string; grunn: string }>;
};

export type Okonomioversikt = {
  aar: number;
  budsjett: {
    id: string; year: number; status: string; adoptedDate: string | null;
    summer: Budsjettsummer; faktiskKostnader: number;
    linjer: Array<{ id: string; name: string; amount: number; faktisk: number }>;
  } | null;
  nesteBudsjett: Budsjett | null;
  fakturaer: {
    tilGodkjenning: { antall: number; sum: number };
    forfalte: { antall: number; sum: number };
    godkjentIkkeBetalt: { antall: number; sum: number };
    betaltIAar: { antall: number; sum: number };
    nyeste: Faktura[];
  };
  eiere: { seksjoner: number; utenEier: number; utenBrok: number; brokSum: number };
  satser: { maanedligSum: number; utenSats: number; aarligSum: number };
  sisteKjoring: Kjoring | null;
};

export const okonomi = {
  oversikt: (o: string) => api.hent<Okonomioversikt>(org(o, "/okonomi/oversikt")),

  eiere: (o: string) => api.hent<Eierregister>(org(o, "/okonomi/eiere")),
  seksjon: (o: string, unitId: string) => api.hent<SeksjonDetalj>(org(o, `/okonomi/enheter/${unitId}`)),
  registrerEier: (o: string, d: unknown) => api.send<Eier>(org(o, "/okonomi/eiere"), d),
  endreEier: (o: string, id: string, d: unknown) => api.endre<Eier>(org(o, `/okonomi/eiere/${id}`), d),
  slettEier: (o: string, id: string) => api.slett(org(o, `/okonomi/eiere/${id}`)),
  settBrok: (o: string, unitId: string, d: { teller: number | null; nevner: number | null; arealM2?: string | null }) =>
    api.endre(org(o, `/okonomi/enheter/${unitId}`), d),

  budsjetter: (o: string) => api.hent<Budsjett[]>(org(o, "/okonomi/budsjett")),
  budsjett: (o: string, id: string) => api.hent<BudsjettDetalj>(org(o, `/okonomi/budsjett/${id}`)),
  nyttBudsjett: (o: string, d: unknown) => api.send<BudsjettDetalj>(org(o, "/okonomi/budsjett"), d),
  endreBudsjett: (o: string, id: string, d: unknown) => api.endre<BudsjettDetalj>(org(o, `/okonomi/budsjett/${id}`), d),
  slettBudsjett: (o: string, id: string) => api.slett(org(o, `/okonomi/budsjett/${id}`)),
  vedta: (o: string, id: string, d: { adoptedDate: string }) =>
    api.send<BudsjettDetalj>(org(o, `/okonomi/budsjett/${id}/vedtak`), d),
  gjenapne: (o: string, id: string) => api.slett(org(o, `/okonomi/budsjett/${id}/vedtak`)),
  beregnSatser: (o: string, id: string) =>
    api.send<{ beregnet: number; overstyrt: number; utenBrok: number; validFrom: string }>(
      org(o, `/okonomi/budsjett/${id}/satser`), {},
    ),
  forslag: (o: string, id: string, prosent: number) =>
    api.hent<Budsjettforslag>(org(o, `/okonomi/budsjett/${id}/forslag?prosent=${encodeURIComponent(prosent)}`)),
  brukForslag: (o: string, id: string, linjer: Array<{ lineId: string; amount: number }>) =>
    api.send<BudsjettDetalj>(org(o, `/okonomi/budsjett/${id}/forslag`), { linjer }),
  nyLinje: (o: string, id: string, d: unknown) => api.send<Budsjettlinje>(org(o, `/okonomi/budsjett/${id}/linjer`), d),
  endreLinje: (o: string, id: string, lid: string, d: unknown) =>
    api.endre<Budsjettlinje>(org(o, `/okonomi/budsjett/${id}/linjer/${lid}`), d),
  slettLinje: (o: string, id: string, lid: string) => api.slett(org(o, `/okonomi/budsjett/${id}/linjer/${lid}`)),

  satser: (o: string, dato?: string) =>
    api.hent<Satsoversikt>(org(o, `/okonomi/satser${dato ? `?dato=${dato}` : ""}`)),
  settSats: (o: string, unitId: string, d: unknown) => api.endre<Sats>(org(o, `/okonomi/satser/${unitId}`), d),
  slettSats: (o: string, rateId: string) => api.slett(org(o, `/okonomi/satser/rad/${rateId}`)),

  kjoringer: (o: string) => api.hent<Kjoring[]>(org(o, "/okonomi/kjoringer")),
  kjoring: (o: string, id: string) => api.hent<KjoringDetalj>(org(o, `/okonomi/kjoringer/${id}`)),
  nyKjoring: (o: string, d: unknown) => api.send<KjoringDetalj>(org(o, "/okonomi/kjoringer"), d),
  annullerKjoring: (o: string, id: string) => api.slett(org(o, `/okonomi/kjoringer/${id}`)),
  /** CSV-en lenkes direkte (`<a href>`) — ruta svarer med fil, ikke JSON. */
  eksportUrl: (o: string, id: string) => `/api${org(o, `/okonomi/kjoringer/${id}/eksport`)}`,

  // Ladekjøringer — fakturagrunnlaget for lading (docs/easee.md «Etappe 3»). Sendes til
  // det regnskapssystemet orgen er koblet til; `regnskap()` sier hvilket, aldri antatt.
  regnskap: (o: string) => api.hent<Regnskapsstatus>(org(o, "/okonomi/regnskap")),
  ladekjoringer: (o: string) => api.hent<Ladekjoring[]>(org(o, "/okonomi/ladekjoringer")),
  ladekjoring: (o: string, id: string) => api.hent<LadekjoringDetalj>(org(o, `/okonomi/ladekjoringer/${id}`)),
  nyLadekjoring: (o: string, d: { periodStart: string; maaneder: 1 | 3 | 6 | 12; dueDate: string; incomeAccount: string; note: string | null }) =>
    api.send<LadekjoringDetalj>(org(o, "/okonomi/ladekjoringer"), d),
  annullerLadekjoring: (o: string, id: string) => api.slett(org(o, `/okonomi/ladekjoringer/${id}`)),
  endreLadekjoring: (o: string, id: string, d: { dueDate?: string; incomeAccount?: string }) =>
    api.lapp<LadekjoringDetalj>(org(o, `/okonomi/ladekjoringer/${id}`), d),
  sendLadekjoring: (o: string, id: string) => api.send<LadekjoringDetalj>(org(o, `/okonomi/ladekjoringer/${id}/send`), {}),
  ladekjoringEksportUrl: (o: string, id: string) => `/api${org(o, `/okonomi/ladekjoringer/${id}/eksport`)}`,

  fakturaer: (o: string, filter: { status?: string; aar?: number } = {}) => {
    const q = new URLSearchParams();
    if (filter.status) q.set("status", filter.status);
    if (filter.aar) q.set("aar", String(filter.aar));
    const s = q.toString();
    return api.hent<Faktura[]>(org(o, `/okonomi/fakturaer${s ? `?${s}` : ""}`));
  },
  faktura: (o: string, id: string) => api.hent<Faktura>(org(o, `/okonomi/fakturaer/${id}`)),
  nyFaktura: (o: string, d: unknown) => api.send<Faktura>(org(o, "/okonomi/fakturaer"), d),
  endreFaktura: (o: string, id: string, d: unknown) => api.endre<Faktura>(org(o, `/okonomi/fakturaer/${id}`), d),
  slettFaktura: (o: string, id: string) => api.slett(org(o, `/okonomi/fakturaer/${id}`)),
  godkjenn: (o: string, id: string, d: { note?: string | null }) =>
    api.send<Faktura>(org(o, `/okonomi/fakturaer/${id}/godkjenn`), d),
  gjenapneFaktura: (o: string, id: string) => api.slett(org(o, `/okonomi/fakturaer/${id}/godkjenn`)),
  avvis: (o: string, id: string, d: { note: string }) => api.send<Faktura>(org(o, `/okonomi/fakturaer/${id}/avvis`), d),
  betalt: (o: string, id: string, d: { paidDate: string }) =>
    api.send<Faktura>(org(o, `/okonomi/fakturaer/${id}/betalt`), d),
  lastOppFakturafil: (o: string, id: string, f: FormData) =>
    api.lastOpp<Faktura>(org(o, `/okonomi/fakturaer/${id}/fil`), f),
  slettFakturafil: (o: string, id: string) => api.slett(org(o, `/okonomi/fakturaer/${id}/fil`)),

  fiken: {
    status: (o: string) => api.hent<FikenStatus>(org(o, "/okonomi/fiken")),
    /** Testmiljøet: personlig nøkkel mot demoforetaket. 404 i prod. */
    kobleTilMedNokkel: (o: string, d: { apiKey: string; slug?: string | null }) =>
      api.send<FikenStatus>(org(o, "/okonomi/fiken/noekkel"), d),
    /** OAuth starter med en vanlig navigasjon — ruta svarer med redirect til Fiken. */
    startUrl: (o: string) => `/api${org(o, "/okonomi/fiken/start")}`,
    synk: (o: string) =>
      api.send<{ ok: true; nye: number; oppdaterte: number; hentet: number } | { ok: false; feil: string }>(org(o, "/okonomi/fiken/synk"), {}),
    kobleFra: (o: string) => api.slett(org(o, "/okonomi/fiken")),
    kjop: (o: string, aar?: number) => api.hent<FikenKjop[]>(org(o, `/okonomi/fiken/kjop${aar ? `?aar=${aar}` : ""}`)),
    /** Leverandørkortet: kjøpene som matcher leverandøren på orgnr eller navn. */
    kjopForLeverandor: (o: string, vendorId: string) =>
      api.hent<{
        koblet: boolean; kjop: FikenKjop[]; treffPaa: "orgnr" | "navn" | null;
        perAar: Array<{ aar: number; antall: number; sum: number }>; sisteKjop: string | null;
      }>(org(o, `/okonomi/fiken/kjop?vendorId=${encodeURIComponent(vendorId)}`)),
  },
};

export type Dashbord = {
  banner: boolean;
  moduler: Record<string, boolean>;
  kpi: { oppgaver: number | null; aJour: number | null; forsinket: number | null; apneAvvik: number | null };
  oppfolging: Array<{ slag: string; alvor: "hoy" | "middels" | "lav"; tekst: string; detalj: string; sti: string }>;
  frister: Array<{ dato: string; navn: string; kilde: string }>;
  oppgaveliste: Array<{ id: string; title: string; vendorName: string | null; nesteFrist: string | null; forsinket: boolean }> | null;
  avviksliste: Array<{ id: string; number: number | null; title: string; status: string; severity: string | null }> | null;
  utlopende: Array<{ id: string; title: string; vendorName: string | null; endDate: string | null }> | null;
  tilstand: Array<{ tg: string; antall: number }> | null;
  parkering: { totalt: number; ledige: number; utleid: number } | null;
  rutinerTilRevisjon: Array<{ id: string; title: string; lastReviewedAt: string | null }> | null;
  aktivitet: Array<{ id: string; title: string; entryDate: string; createdBy: string }> | null;
  antallDokumenter: number | null;
  leverandorer: { aktive: number; inaktive: number } | null;
  /** Økonomiwidgeten. Beløp i øre. */
  okonomi: {
    tilGodkjenning: { antall: number; sum: number };
    forfalte: { antall: number; sum: number };
    felleskostMnd: number;
    utenSats: number;
    seksjoner: number;
  } | null;
};

export const dashbord = {
  hent: (o: string) => api.hent<Dashbord>(org(o, "/dashboard")),
  /** Widget-oppsettet til den innloggede, i denne org-en. `null` = ikke tilpasset. */
  oppsett: (o: string) =>
    api.hent<Array<{ nokkel: string; storrelse: "s" | "m" | "l" }> | null>(
      org(o, "/dashboard/oppsett"),
    ),
  settOppsett: (o: string, widgets: Array<{ nokkel: string; storrelse: "s" | "m" | "l" }> | null) =>
    api.endre(org(o, "/dashboard/oppsett"), { widgets }),
};

export type OrgInfo = {
  id: string; name: string; slug: string; orgNr: string | null; orgForm: string | null;
  /** Kundens egne avvikskategorier som JSON, eller null for standardsettet. */
  deviationCategories: string | null;
  municipality: string | null; unitCount: number | null; enabledModules: string | null;
  buildingInfo: string | null; hasEmployees: boolean;
  bannerFileName: string | null; bannerOriginalName: string | null;
  lagring: { brukt: number; kvote: number; prosent: number };
};

export const organisasjon = {
  hent: (o: string) => api.hent<OrgInfo>(`/organizations/${o}`),
  endre: (o: string, d: unknown) => api.endre<OrgInfo>(`/organizations/${o}`, d),
  lastOppBanner: (o: string, f: FormData) => api.lastOpp<OrgInfo>(`/organizations/${o}/banner`, f),
  fjernBanner: (o: string) => api.slett(`/organizations/${o}/banner`),
  /**
   * Modulvalg — plattformadmin. Blir stående her fordi plattformpanelet skal bruke det;
   * kundens innstillinger gjør det IKKE, og API-et avviser dem uansett.
   */
  settKategorier: (o: string, kategorier: Array<{ verdi?: string; etikett: string; aktiv: boolean }>) =>
    api.endre<{ kategorier: Array<{ verdi: string; etikett: string; aktiv?: boolean }> }>(
      `/organizations/${o}/avvikskategorier`,
      { kategorier },
    ),
  settModuler: (o: string, moduler: string[]) => api.endre(`/organizations/${o}/modules`, { moduler }),
};

// `Hendelse` er opptatt av årshjulet — dette er hendelsesLOGGEN («hvem gjorde hva»).
export type Logghendelse = {
  id: string; orgId: string; actorName: string; actorUserId: string | null;
  occurredAt: string; module: string; entity: string; entityId: string | null; event: string;
};

export type Hendelsesside = {
  hendelser: Logghendelse[]; antall: number; side: number; sideStorrelse: number;
};

export const hendelser = {
  liste: (o: string, filter: { modul?: string; aktor?: string; side?: number } = {}) => {
    const q = new URLSearchParams();
    if (filter.modul) q.set("modul", filter.modul);
    if (filter.aktor) q.set("aktor", filter.aktor);
    if (filter.side) q.set("side", String(filter.side));
    const s = q.toString();
    return api.hent<Hendelsesside>(org(o, `/hendelser${s ? `?${s}` : ""}`));
  },
};

export type Webhook = {
  id: string; name: string; targetType: string; url: string; events: string[];
  active: boolean; lastAttemptAt: string | null; lastOk: boolean | null; lastError: string | null;
  createdAt: string;
};

export type WebhookInn = {
  name: string; targetType: string; url: string; events: string[]; active: boolean;
};

export const webhooks = {
  liste: (o: string) => api.hent<Webhook[]>(org(o, "/webhooks")),
  ny: (o: string, d: WebhookInn) => api.send<Webhook>(org(o, "/webhooks"), d),
  endre: (o: string, id: string, d: WebhookInn) => api.endre<Webhook>(org(o, `/webhooks/${id}`), d),
  slett: (o: string, id: string) => api.slett(org(o, `/webhooks/${id}`)),
  test: (o: string, id: string) => api.send<{ ok: boolean; feil: string | null }>(org(o, `/webhooks/${id}/test`), {}),
};

export type OrgBruker = {
  id: string; name: string; email: string; active: boolean; lastLoginAt: string | null;
  platformRole: string; nivaa: string; title: string | null; harSattPassord: boolean;
  tofaktor: boolean;
};

export const brukere = {
  liste: (o: string) => api.hent<OrgBruker[]>(org(o, "/users")),
  inviter: (o: string, d: unknown) => api.send(org(o, "/users"), d),
  endre: (o: string, id: string, d: unknown) => api.endre(org(o, `/users/${id}`), d),
  fjern: (o: string, id: string) => api.slett(org(o, `/users/${id}`)),
  // Varslene ligger på medlemskapet, ikke på kontoen — samme person kan sitte i flere lag
  // og vil sjelden ha samme oppsett i alle.
  varsler: (o: string, id: string) => api.hent<{ prefs: Record<string, boolean> }>(org(o, `/users/${id}/varsler`)),
  settVarsler: (o: string, id: string, prefs: Record<string, boolean>) =>
    api.endre(org(o, `/users/${id}/varsler`), { prefs }),
  /** Sender oppsett-/tilbakestillingslenken på nytt. */
  sendOppsett: (o: string, id: string) => api.send(org(o, `/users/${id}/oppsett-epost`), {}),
  /** Nullstiller tofaktor for en ANNEN bruker — de setter den opp på nytt selv. Se lib/brukere.ts. */
  resettTofaktor: (o: string, id: string) => api.slett(org(o, `/users/${id}/tofaktor`)),
  egneVarsler: (o: string) => api.hent<{ prefs: Record<string, boolean> }>(org(o, "/users/meg/varsler")),
  settEgneVarsler: (o: string, prefs: Record<string, boolean>) =>
    api.endre(org(o, "/users/meg/varsler"), { prefs }),
  /** Egen aktivitet på tvers av modulene. Ingen `[brukerId]`-variant — se kommentaren på ruta. */
  egenAktivitet: (o: string) => api.hent<MinAktivitet>(org(o, "/users/meg/aktivitet")),
  // Typen kommer fra `lib/aktivitetsslag.ts`, ikke fra `lib/aktivitet.ts`: sistnevnte
  // importerer databaseklienten. Importen er `type`-only og forsvinner ved kompilering, men
  // fila den peker på skal uansett være ren — se kommentaren der.
};

export type StyreSvar = {
  status: "ok" | "mangler-orgnr" | "ingen-svar";
  orgNr: string | null;
  styre: Array<{ navn: string; rolle: string }>;
};

/** Enhetsregisteret. Kallet gjøres av API-et, ikke av nettleseren — se lib/brreg.ts. */
export const brreg = {
  styre: (o: string) => api.hent<StyreSvar>(org(o, "/brreg/styre")),
};

export type MegSvar = {
  /** Domenet plattformpanelet ligger på, når vertene er delt. Ellers `null`. */
  adminVert: string | null;
  /** Org-er du har aktivt support-innsyn i. Tom for vanlige brukere. */
  supportOrger: string[];
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  /** Bekreftet tofaktor. Settes av Better Auth først når første kode er godkjent. */
  twoFactorEnabled: boolean;
  organisasjoner: Array<{
    id: string; name: string; nivaa: string;
    /** Vervet i DENNE org-en — «Styreleder». Null når det ikke er fylt ut. */
    tittel: string | null;
    enabledModules: string | null;
  }>;
};

export const navtall = {
  hent: (o: string) =>
    api.hent<{ forsinkedeOppgaver: number; apneAvvik: number }>(org(o, "/navtall")),
};

export const meg = {
  hent: () => api.hent<MegSvar>("/meg"),
  /** Navn og telefon. E-post kan ikke endres her — se kommentaren i api/meg/route.ts. */
  lagre: (d: { name?: string; phone?: string | null }) => api.endre<MegSvar>("/meg", d),
};

/** Ett treff i det globale søket. `modul` avgjør hvor lenken peker — se SokModal. */
export type SokTreff = {
  modul: string;
  id: string;
  tittel: string;
  undertekst: string | null;
  dato: string | null;
  /** Kun avvik: løpenummeret, vist som «#21». */
  nummer: number | null;
};

export const sok = {
  hent: (o: string, q: string) => api.hent<SokTreff[]>(org(o, `/sok?q=${encodeURIComponent(q)}`)),
};

// ---------------------------------------------------------------------------------------
// Unloc — digitale nøkler til leverandører (docs/unloc.md). Én fjernbar blokk.
// ---------------------------------------------------------------------------------------

export type UnlocStatus = {
  konfigurert: { kryptering: boolean };
  kobling: {
    clientId: string; projectId: string; projectName: string; connectedBy: string; createdAt: string;
    lastError: string | null; lastCheckedAt: string | null;
  } | null;
  nokler: { aktive: number };
};

export type UnlocLaas = { id: string; name: string; vendor: string | null; floor: string | null; battery: string | null };

export type UnlocNokkelState = "creating" | "scheduled" | "active" | "inactive" | "expired" | "revoked" | "error";

export type UnlocNokkel = {
  id: string; unlocKeyId: string; lockId: string; lockName: string; phone: string; holderName: string;
  startAt: string; endAt: string | null; state: UnlocNokkelState; stateCheckedAt: string | null; note: string | null;
  issuedBy: string; issuedByUserId: string | null; revokedBy: string | null; revokedAt: string | null; createdAt: string;
};

export const unloc = {
  status: (o: string) => api.hent<UnlocStatus>(org(o, "/unloc")),
  kobleTil: (o: string, d: { clientId: string; clientSecret: string; projectId?: string | null }) =>
    api.endre<UnlocStatus>(org(o, "/unloc"), d),
  kobleFra: (o: string) => api.slett(org(o, "/unloc")),
  laaser: (o: string) => api.hent<UnlocLaas[]>(org(o, "/unloc/locks")),
  /** Leverandørkortet: nøklene med tilstand frisket opp fra Unloc; `feil` når Unloc ikke svarte. */
  nokler: (o: string, vendorId: string) =>
    api.hent<{ koblet: boolean; feil: string | null; nokler: UnlocNokkel[] }>(org(o, `/vendors/${vendorId}/unloc-keys`)),
  delUt: (o: string, vendorId: string, d: { lockId: string; phone: string; holderName: string; startAt?: string | null; endAt?: string | null; note?: string | null }) =>
    api.send<UnlocNokkel>(org(o, `/vendors/${vendorId}/unloc-keys`), d),
  tilbakekall: (o: string, vendorId: string, id: string) => api.slett(org(o, `/vendors/${vendorId}/unloc-keys/${id}`)),
};

// ---------------------------------------------------------------------------------------
// Easee — ladeanlegget i parkeringsmodulen (docs/easee.md). Én fjernbar blokk.
// ---------------------------------------------------------------------------------------

export type EaseeStatus = {
  konfigurert: { kryptering: boolean };
  kobling: {
    siteId: number; siteName: string; userName: string; accountEmail: string | null; tokenExpiresAt: string;
    connectedBy: string; createdAt: string; lastError: string | null; lastCheckedAt: string | null;
  } | null;
  ladere: { antall: number; koblet: number };
};

export type EaseeLader = {
  id: string; chargerId: string; name: string; circuitName: string | null; spotId: string | null; active: boolean;
  opMode: number | null; isOnline: boolean | null; totalPower: number | null; sessionEnergy: number | null;
  lifetimeEnergy: number | null; latestPulse: string | null; errorCode: number | null; reasonForNoCurrent: number | null;
  stateCheckedAt: string | null; usageCheckedAt: string | null;
  plass: { number: string; holderName: string | null; unitLabel: string | null } | null;
  avtale: { tenantName: string; powerBilling: string | null } | null;
  sisteOkt: { carConnected: string; carDisconnected: string | null; kwh: number } | null;
};

export type EaseeForbruk = { chargerRowId: string; year: number; month: number; kwh: number };

export type EaseeLading = {
  koblet: boolean;
  feil: string | null;
  anlegg: { siteName: string } | null;
  ladere: EaseeLader[];
  forbruk: EaseeForbruk[];
  /** Tolv måneder, eldste først. `kwhNatt` er null når måneden mangler timesdata eller prisplan. */
  maaneder: Array<{ year: number; month: number; kwh: number; kwhNatt: number | null }>;
};

/** Prisplan for lading — reglene i lib/laderegler.ts. Alle beløp i øre inkl. mva. */
export type Prisplan = {
  id: string; validFrom: string; name: string; kraftModel: "norgespris" | "spot"; kraftOre: number; paaslagOre: number;
  priceArea: "NO1" | "NO2" | "NO3" | "NO4" | "NO5" | null; mvaProsent: number; nettDagOre: number; nettNattOre: number;
  nattFra: number; nattTil: number; helgSomNatt: boolean; fastleddOre: number; note: string | null; createdBy: string; createdAt: string;
};
export type PrisplanInn = Omit<Prisplan, "id" | "createdBy" | "createdAt">;

export type Rapportlinje = {
  laderId: string; laderNavn: string; chargerId: string; aktiv: boolean;
  plass: { id: string; number: string; holderName: string | null; unitLabel: string | null } | null;
  seksjon: { id: string; navn: string } | null;
  eier: { id: string; name: string; email: string | null } | null;
  avtale: { tenantName: string; powerBilling: string | null } | null;
  okter: number; kwhDag: number; kwhNatt: number; kwh: number;
  kraftOre: number; nettOre: number; fastleddOre: number; sumOre: number; timerUtenPris: number; kwhUtenPris: number;
  status: "klar" | "mangler_plass" | "mangler_seksjon" | "mangler_eier";
};

export type Laderapport = {
  aar: number; maaned: number; plan: Prisplan | null; linjer: Rapportlinje[];
  sum: { kwh: number; kwhDag: number; kwhNatt: number; kraftOre: number; nettOre: number; fastleddOre: number; sumOre: number };
  advarsler: string[]; spotTimer: number;
  klar: { antall: number; sumOre: number };
};

export type Ladeokt = { id: string; carConnected: string; carDisconnected: string | null; kwh: number; isComplete: boolean; kwhNatt: number | null; kostnadOre: number | null };
export type Ladeokter = { okter: Ladeokt[]; fastleddOre: number; priset: boolean; sumOre: number };

export type EaseeAnlegg = { id: number; name: string; adresse: string | null };

export const easee = {
  status: (o: string) => api.hent<EaseeStatus>(org(o, "/easee")),
  /** Anleggene kontoen når — tilkoblingen velger automatisk ved ett, ellers spør dialogen. */
  anlegg: (o: string, d: { userName: string; password: string }) => api.send<{ anlegg: EaseeAnlegg[] }>(org(o, "/easee/anlegg"), d),
  /** Passordet sendes én gang og lagres aldri — bare tokenene Easee gir tilbake. */
  kobleTil: (o: string, d: { userName: string; password: string; siteId?: number | null }) => api.endre<EaseeStatus>(org(o, "/easee"), d),
  kobleFra: (o: string) => api.slett(org(o, "/easee")),
  prisplaner: (o: string) => api.hent<Prisplan[]>(org(o, "/easee/prisplaner")),
  lagrePrisplan: (o: string, d: PrisplanInn, id?: string) =>
    id ? api.endre<Prisplan[]>(org(o, `/easee/prisplaner/${id}`), d) : api.send<Prisplan[]>(org(o, "/easee/prisplaner"), d),
  slettPrisplan: (o: string, id: string) => api.slett(org(o, `/easee/prisplaner/${id}`)),
  rapport: (o: string, aar: number, maaned: number) => api.hent<Laderapport>(org(o, `/easee/rapport?aar=${aar}&maaned=${maaned}`)),
  /** Til en vanlig `<a href>` — nedlasting går utenom `request()`. */
  rapportCsvSti: (o: string, aar: number, maaned: number) => `/api${org(o, `/easee/rapport/csv?aar=${aar}&maaned=${maaned}`)}`,
  okter: (o: string, laderId: string, aar: number, maaned: number) =>
    api.hent<Ladeokter>(org(o, `/easee/chargers/${laderId}/okter?aar=${aar}&maaned=${maaned}`)),
  /** Lading-fanen. `oppdater` tvinger ny henting av laderliste, tilstand og forbruk. */
  lading: (o: string) => api.hent<EaseeLading>(org(o, "/easee/lading")),
  oppdater: (o: string) => api.send<EaseeLading>(org(o, "/easee/lading"), {}),
  kobleTilPlass: (o: string, laderId: string, spotId: string | null) =>
    api.lapp<EaseeLader>(org(o, `/easee/chargers/${laderId}`), { spotId }),
};

// ---------------------------------------------------------------------------------------
// Oppslagstavla (docs/oppslagstavle.md)
// ---------------------------------------------------------------------------------------

export type Oppslag = {
  id: string;
  kind: Oppslagstype;
  title: string;
  body: string | null;
  category: Kategori | null;
  originalName: string | null;
  showFrom: string;
  showUntil: string;
  allScreens: boolean;
  screenIds: string[];
  displaySeconds: number;
  createdBy: string;
  createdAt: string;
  status: Status;
};

export type OppslagInn = {
  tittel: string;
  tekst?: string | null;
  kategori?: Kategori | null;
  fra: string;
  til: string;
  alleSkjermer: boolean;
  skjermIder: string[];
  sekunder: number;
};

/** Navn, telefon og e-post er fra brukerprofilen; rollen er medlemskapets tittel. */
export type Tavlekontakt = {
  id: string;
  brukerId: string;
  navn: string;
  rolle: string | null;
  telefon: string | null;
  epost: string | null;
  visTelefon: boolean;
  visEpost: boolean;
  harBilde: boolean;
  bildeVersjon: string | null;
};

export type Kontaktkandidat = { id: string; navn: string; telefon: string | null; epost: string; tittel: string | null };

export type Tavlehendelse = {
  id: string;
  title: string;
  eventDate: string;
  eventTime: string | null;
  place: string | null;
  createdBy: string;
};

export type Skjerm = {
  id: string;
  navn: string;
  adresse: string | null;
  retning: Retning;
  mal: string;
  /** Blokknøklene per felt i malen (`a`–`d` og `stripe`). Flere i samme felt roterer. */
  soner: Record<string, string[]>;
  skala: number;
  sistSett: string | null;
  paaNett: boolean;
  koblet: string;
};

export type SkjermEndring = {
  navn: string;
  adresse: string | null;
  retning: Retning;
  skala: number;
  mal: string;
  felt: Record<string, string[]>;
};

export type Tavleutseende = {
  background: string;
  accent: string;
  offlineMode: "siste" | "melding";
  harLogo: boolean;
};

export const oppslagstavle = {
  oppslag: (o: string) => api.hent<Oppslag[]>(org(o, "/oppslagstavle/oppslag")),
  nyttTekstoppslag: (o: string, d: OppslagInn) => api.send<Oppslag>(org(o, "/oppslagstavle/oppslag"), d),
  /** Bildet og feltene i ett kall — et oppslag skal aldri stå uten bildet sitt. */
  nyttBildeoppslag: (o: string, d: OppslagInn, fil: File) => {
    const f = new FormData();
    f.set("data", JSON.stringify(d));
    f.set("fil", fil);
    return api.lastOpp<Oppslag>(org(o, "/oppslagstavle/oppslag"), f);
  },
  endreOppslag: (o: string, id: string, d: OppslagInn) => api.endre<Oppslag>(org(o, `/oppslagstavle/oppslag/${id}`), d),
  settRekkefolge: (o: string, ider: string[]) => api.endre<Oppslag[]>(org(o, "/oppslagstavle/oppslag/rekkefolge"), { ider }),
  slettOppslag: (o: string, id: string) => api.slett(org(o, `/oppslagstavle/oppslag/${id}`)),
  /** Til `<img src>` — cookien følger med, så bildet går gjennom de samme gatene. */
  bildeSti: (o: string, id: string) => `/api${org(o, `/oppslagstavle/oppslag/${id}/fil`)}`,

  hendelser: (o: string) => api.hent<Tavlehendelse[]>(org(o, "/oppslagstavle/hendelser")),
  nyHendelse: (o: string, d: { tittel: string; dato: string; tid: string | null; sted: string | null }) =>
    api.send<Tavlehendelse>(org(o, "/oppslagstavle/hendelser"), d),
  endreHendelse: (o: string, id: string, d: { tittel: string; dato: string; tid: string | null; sted: string | null }) =>
    api.endre<Tavlehendelse>(org(o, `/oppslagstavle/hendelser/${id}`), d),
  slettHendelse: (o: string, id: string) => api.slett(org(o, `/oppslagstavle/hendelser/${id}`)),

  skjermer: (o: string) => api.hent<Skjerm[]>(org(o, "/oppslagstavle/skjermer")),
  koble: (o: string, d: { kode: string; navn: string; adresse: string | null; retning: Retning }) =>
    api.send<Skjerm>(org(o, "/oppslagstavle/skjermer"), d),
  endreSkjerm: (
    o: string,
    id: string,
    d: SkjermEndring,
  ) =>
    api.endre<Skjerm>(org(o, `/oppslagstavle/skjermer/${id}`), d),
  slettSkjerm: (o: string, id: string) => api.slett(org(o, `/oppslagstavle/skjermer/${id}`)),
  forhandsvisning: (o: string, id: string) =>
    api.hent<Skjerminnhold>(org(o, `/oppslagstavle/skjermer/${id}/innhold`)),

  kontakter: (o: string) => api.hent<Tavlekontakt[]>(org(o, "/oppslagstavle/kontakter")),
  /** Bildet er valgfritt og sendes i samme kall som feltene. */
  kontaktkandidater: (o: string) => api.hent<Kontaktkandidat[]>(org(o, "/oppslagstavle/kontakter/kandidater")),
  nyKontakt: (o: string, d: { brukerId: string; visTelefon: boolean; visEpost: boolean }, fil: File | null) => {
    const f = new FormData();
    f.set("data", JSON.stringify(d));
    if (fil) f.set("fil", fil);
    return api.lastOpp<Tavlekontakt>(org(o, "/oppslagstavle/kontakter"), f);
  },
  endreKontakt: (o: string, id: string, d: { visTelefon: boolean; visEpost: boolean }) =>
    api.endre<Tavlekontakt>(org(o, `/oppslagstavle/kontakter/${id}`), d),
  slettKontakt: (o: string, id: string) => api.slett(org(o, `/oppslagstavle/kontakter/${id}`)),
  flyttKontakt: (o: string, id: string, retning: "opp" | "ned") =>
    api.send<Tavlekontakt[]>(org(o, `/oppslagstavle/kontakter/${id}/flytt`), { retning }),
  settKontaktbilde: (o: string, id: string, fil: File) => {
    const f = new FormData();
    f.set("fil", fil);
    return api.lastOpp<Tavlekontakt>(org(o, `/oppslagstavle/kontakter/${id}/bilde`), f);
  },
  fjernKontaktbilde: (o: string, id: string) =>
    request<Tavlekontakt>(org(o, `/oppslagstavle/kontakter/${id}/bilde`), { method: "DELETE" }),
  kontaktbildeSti: (o: string, id: string) => `/api${org(o, `/oppslagstavle/kontakter/${id}/bilde`)}`,

  utseende: (o: string) => api.hent<Tavleutseende>(org(o, "/oppslagstavle/utseende")),
  lagreUtseende: (o: string, d: Omit<Tavleutseende, "harLogo">) =>
    api.endre<Tavleutseende>(org(o, "/oppslagstavle/utseende"), d),
  lastOppLogo: (o: string, fil: File) => {
    const f = new FormData();
    f.set("fil", fil);
    return api.lastOpp<Tavleutseende>(org(o, "/oppslagstavle/utseende/logo"), f);
  },
  slettLogo: (o: string) => request<Tavleutseende>(org(o, "/oppslagstavle/utseende/logo"), { method: "DELETE" }),
  logoSti: (o: string) => `/api${org(o, "/oppslagstavle/utseende/logo")}`,
};

/**
 * Selve skjermen (`/skjerm`). Egen fetch og ikke `request()`: skjermen har ingen sesjon,
 * og en 401 betyr «fjernet i appen — vis koblingskoden igjen», ikke «send til innlogging».
 */
async function skjermkall<T>(sti: string, token: string | null, init: RequestInit = {}): Promise<T> {
  const svar = await fetch(`/api/skjerm${sti}`, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = await svar.json().catch(() => null);
  if (!svar.ok) throw new ApiKlientFeil(svar.status, data?.detail ?? "Noe gikk galt");
  return data as T;
}

export const skjermklient = {
  startKobling: () => skjermkall<{ kode: string; hemmelighet: string; utloper: string }>("/kobling", null, { method: "POST" }),
  koblingsstatus: (hemmelighet: string) =>
    skjermkall<{ status: "venter" | "utlopt" } | { status: "koblet"; token: string }>("/kobling/status", null, {
      method: "POST",
      body: JSON.stringify({ hemmelighet }),
    }),
  innhold: (token: string) => skjermkall<Skjerminnhold>("/innhold", token),
  /** Bilder må hentes med tokenet i headeren — `<img src>` kan ikke sende det. */
  fil: async (sti: string, token: string): Promise<Blob> => {
    const svar = await fetch(`/api/skjerm${sti}`, { headers: { authorization: `Bearer ${token}` } });
    if (!svar.ok) throw new ApiKlientFeil(svar.status, "Kunne ikke hente bildet");
    return svar.blob();
  },
};

// ---------------------------------------------------------------------------------------
// BIR — tømmedager til oppslagstavla (docs/bir.md). Fjernbar pakke.
// ---------------------------------------------------------------------------------------

export type BirTreff = { id: string; navn: string; sted: string | null; eiendom: string | null };

export type BirStatus = {
  birId: string;
  navn: string;
  eiendom: string | null;
  koblet: string;
  sistHentet: string | null;
  feil: string | null;
  datoer: Array<{ fraksjon: string; etikett: string; dato: string }>;
} | null;

export const bir = {
  status: (o: string) => api.hent<BirStatus>(org(o, "/oppslagstavle/bir")),
  sok: (o: string, q: string) => api.hent<BirTreff[]>(org(o, `/oppslagstavle/bir/sok?q=${encodeURIComponent(q)}`)),
  koble: (o: string, t: BirTreff) =>
    api.endre<BirStatus>(org(o, "/oppslagstavle/bir"), { id: t.id, navn: t.navn, eiendom: t.eiendom }),
  hentNaa: (o: string) => api.send<BirStatus>(org(o, "/oppslagstavle/bir/synk"), {}),
  kobleFra: (o: string) => api.slett(org(o, "/oppslagstavle/bir")),
};

// ---------------------------------------------------------------------------------------
// Innholdsblokker på oppslagstavla — vær (MET/yr) og avganger (Entur). docs/entur-yr.md
// ---------------------------------------------------------------------------------------

export type Holdeplasstreff = { id: string; navn: string; sted: string | null; moduser: string[] };
export type Stedstreff = { tekst: string; lat: number; lon: number };

export type VaerKonfig = { sted: string; lat: number; lon: number; visning: "timer" | "dager" };
export type AvgangerKonfig = { holdeplasser: Array<{ id: string; navn: string }> };

export type Tavleblokk =
  | { id: string; nokkel: string; type: "vaer"; navn: string; konfig: VaerKonfig | null }
  | { id: string; nokkel: string; type: "avganger"; navn: string; konfig: AvgangerKonfig | null };

export type BlokkInn =
  | { type: "vaer"; navn: string; konfig: VaerKonfig }
  | { type: "avganger"; navn: string; konfig: AvgangerKonfig };

export const tavleblokker = {
  liste: (o: string) => api.hent<Tavleblokk[]>(org(o, "/oppslagstavle/blokker")),
  ny: (o: string, d: BlokkInn) => api.send<Tavleblokk>(org(o, "/oppslagstavle/blokker"), d),
  endre: (o: string, id: string, d: BlokkInn) => api.endre<Tavleblokk>(org(o, `/oppslagstavle/blokker/${id}`), d),
  slett: (o: string, id: string) => api.slett(org(o, `/oppslagstavle/blokker/${id}`)),
  sokHoldeplass: (o: string, q: string) =>
    api.hent<Holdeplasstreff[]>(org(o, `/oppslagstavle/blokker/sok/holdeplass?q=${encodeURIComponent(q)}`)),
  sokSted: (o: string, q: string) =>
    api.hent<Stedstreff[]>(org(o, `/oppslagstavle/blokker/sok/sted?q=${encodeURIComponent(q)}`)),
};
