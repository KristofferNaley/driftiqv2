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
  notes: string | null;
  lease: { id: string; tenantName: string; pricePerMonth: number } | null;
};

export type Ventende = {
  id: string;
  name: string;
  requestedType: string;
  requestedAt: string;
  notes: string | null;
};

export const parkering = {
  plasser: (orgId: string) => api.hent<Plass[]>(org(orgId, "/parking/spots")),
  nyPlass: (orgId: string, data: unknown) => api.send<Plass>(org(orgId, "/parking/spots"), data),
  endrePlass: (orgId: string, id: string, data: unknown) =>
    api.endre<Plass>(org(orgId, `/parking/spots/${id}`), data),
  slettPlass: (orgId: string, id: string) => api.slett(org(orgId, `/parking/spots/${id}`)),

  nyAvtale: (orgId: string, data: unknown) => api.send(org(orgId, "/parking/leases"), data),
  avsluttAvtale: (orgId: string, id: string) => api.slett(org(orgId, `/parking/leases/${id}`)),

  venteliste: (orgId: string) => api.hent<Ventende[]>(org(orgId, "/parking/waitlist")),
  nyVentende: (orgId: string, data: unknown) => api.send<Ventende>(org(orgId, "/parking/waitlist"), data),
  slettVentende: (orgId: string, id: string) => api.slett(org(orgId, `/parking/waitlist/${id}`)),
};

export type MegSvar = {
  id: string;
  name: string;
  email: string;
  role: string;
  organisasjoner: Array<{ id: string; name: string; nivaa: string; enabledModules: string | null }>;
};

export const meg = {
  hent: () => api.hent<MegSvar>("/meg"),
};
