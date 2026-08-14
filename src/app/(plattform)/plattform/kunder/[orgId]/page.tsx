"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ramme } from "../../ramme";
import { dato, datoTid } from "@/components/felles";
import { Knapperad, Modal, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { api } from "@/lib/klient";
import { ALLE_MODULER, ALLTID_PA, MENY, TILLEGGSMODULER } from "@/lib/moduler";
import { NIVA_ETIKETT } from "@/lib/nivaer";
import { formatOrgNr } from "@/lib/orgnr";
import { arssum, grunnpakke, kroner, type Trinn } from "@/lib/prisregler";

/**
 * Kundedetaljen — DriftIQs bilde av ÉN kunde. Etter `mockups/kundeside-v3-mockup.html`:
 * vertikal fane-skinne i tre grupper (kundeforhold, abonnement, tilgang og sikkerhet),
 * sammendraget først — det svarer på «hvordan står det til» uten å åpne noe.
 *
 * Support-modus står som stripe øverst på ALLE fanene med vilje: det er den mest
 * inngripende handlingen i panelet, og den skal ikke ligge bak en fane man må huske.
 */

type Kunde = {
  id: string;
  name: string;
  orgNr: string | null;
  orgForm: string | null;
  municipality: string | null;
  unitCount: number | null;
  active: boolean;
  enabledModules: string | null;
  antallOppgaver: number;
  antallAvvik: number;
  maksTimer: number;
  brukere: Array<{
    id: string;
    navn: string;
    epost: string;
    nivaa: string;
    sistInnlogget: string | null;
  }>;
  sesjoner: Array<{
    id: string;
    adminName: string | null;
    reason: string;
    startedAt: string;
    expiresAt: string | null;
    endedAt: string | null;
  }>;
};

type Org = {
  id: string;
  name: string;
  slug: string;
  orgNr: string | null;
  orgForm: string | null;
  municipality: string | null;
  unitCount: number | null;
  active: boolean;
  hasEmployees: boolean;
  phone: string | null;
  contactEmail: string | null;
  website: string | null;
  storageQuota: number | null;
  createdAt: string | null;
  affiliationType: string | null;
  bblId: string | null;
  bblNavn: string | null;
  managerType: string | null;
  managerBblId: string | null;
  managerBblNavn: string | null;
  managerName: string | null;
  managerOrgNr: string | null;
};

type Abonnement = {
  baseFee: number | null;
  annualFee: number | null;
  discountPercent: number;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
  moduler: Array<{ key: string; price: number }>;
} | null;

type Detalj = {
  org: Org;
  moduler: string[];
  abonnement: Abonnement;
  onboarding: {
    prosent: number;
    punkter: Array<{ nokkel: string; etikett: string; ok: boolean; detalj?: string | null }>;
  };
  prismodell: {
    gulvpris: number;
    trinn: Trinn[];
    modulpriser: Record<string, number>;
  };
  grunnpakkeNaa: number;
};

const GRUPPER = [
  {
    navn: "Kundeforhold",
    faner: [
      { nokkel: "sammendrag", etikett: "Sammendrag" },
      { nokkel: "organisasjon", etikett: "Organisasjon" },
      { nokkel: "onboarding", etikett: "Onboarding" },
    ],
  },
  {
    navn: "Abonnement",
    faner: [
      { nokkel: "moduler", etikett: "Moduler" },
      { nokkel: "fakturering", etikett: "Fakturering" },
    ],
  },
  {
    navn: "Tilgang og sikkerhet",
    faner: [
      { nokkel: "brukere", etikett: "Brukere" },
      { nokkel: "innsyn", etikett: "Innsynslogg" },
    ],
  },
] as const;

type Fane = (typeof GRUPPER)[number]["faner"][number]["nokkel"];

export default function Kundedetalj({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const [kunde, setKunde] = useState<Kunde | null>(null);
  const [detalj, setDetalj] = useState<Detalj | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [fane, setFane] = useState<Fane>("sammendrag");

  const last = useCallback(async () => {
    try {
      const [k, d] = await Promise.all([
        api.hent<Kunde>(`/plattform/kunder/${orgId}`),
        api.hent<Detalj>(`/plattform/kunder/${orgId}/detalj`),
      ]);
      setKunde(k);
      setDetalj(d);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke hente kunden");
    }
  }, [orgId]);

  useEffect(() => {
    void last();
  }, [last]);

  if (!kunde || !detalj) {
    return (
      <Ramme tittel="Kunde">
        {feil ? <div className="feilmelding">{feil}</div> : <p className="pf-dempet">Henter …</p>}
      </Ramme>
    );
  }

  const { org, onboarding } = detalj;
  const merker: Record<Fane, string | null> = {
    sammendrag: null,
    organisasjon: null,
    onboarding: `${onboarding.prosent} %`,
    moduler: `${detalj.moduler.length}/${ALLE_MODULER.length}`,
    fakturering: null,
    brukere: String(kunde.brukere.length),
    innsyn: null,
  };

  return (
    <Ramme tittel={kunde.name}>
      <Link href="/plattform/kunder" className="tilbake-lenke">
        ← Alle kunder
      </Link>

      {/* Merkene under tittelen — det man trenger for å vite HVEM man står i. */}
      <div className="pf-tags">
        <span className={`badge ${org.active ? "ok" : "danger"}`}>{org.active ? "Aktiv" : "Inaktiv"}</span>
        {org.orgForm && <span className="pf-tagg">{org.orgForm}</span>}
        {org.unitCount !== null && <span className="pf-tagg">{org.unitCount} andeler</span>}
        {org.createdAt && <span className="pf-tagg">Kunde siden {dato(org.createdAt)}</span>}
        <span className="pf-tagg">{formatOrgNr(org.orgNr) ?? "org.nr ikke satt"}</span>
      </div>

      {feil && <div className="feilmelding">{feil}</div>}

      <Support kunde={kunde} orgId={orgId} onEndret={last} onFeil={setFeil} />

      <div className="pf-skinne-layout">
        <nav className="pf-skinne" aria-label="Kundeseksjoner">
          {GRUPPER.map((g) => (
            <div key={g.navn} className="pf-skinne-gruppe">
              <h3>{g.navn}</h3>
              {g.faner.map((f) => (
                <button
                  key={f.nokkel}
                  className={`pf-skinnefane${fane === f.nokkel ? " valgt" : ""}`}
                  onClick={() => setFane(f.nokkel)}
                >
                  {f.etikett}
                  {merker[f.nokkel] && (
                    <span className={`badge ${f.nokkel === "onboarding" && onboarding.prosent < 100 ? "warn" : "muted"}`}>
                      {merker[f.nokkel]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div style={{ minWidth: 0 }}>
          {fane === "sammendrag" && <Sammendrag detalj={detalj} kunde={kunde} onGaTil={setFane} />}
          {fane === "organisasjon" && <Organisasjon detalj={detalj} onEndret={last} />}
          {fane === "onboarding" && <OnboardingFane detalj={detalj} />}
          {fane === "moduler" && <ModulFane detalj={detalj} orgId={orgId} onEndret={last} />}
          {fane === "fakturering" && (
            <Fakturering detalj={detalj} orgId={orgId} onEndret={last} onFeil={setFeil} />
          )}
          {fane === "brukere" && <Brukere kunde={kunde} />}
          {fane === "innsyn" && <Innsynslogg kunde={kunde} />}
        </div>
      </div>
    </Ramme>
  );
}

// ── Support-modus ───────────────────────────────────────────────────────────────────────

function Support({
  kunde,
  orgId,
  onEndret,
  onFeil,
}: {
  kunde: Kunde;
  orgId: string;
  onEndret: () => Promise<void>;
  onFeil: (f: string | null) => void;
}) {
  const [grunn, setGrunn] = useState("");
  const [jobber, setJobber] = useState(false);

  const aktiv = kunde.sesjoner.find(
    (s) => !s.endedAt && s.expiresAt && new Date(s.expiresAt) > new Date(),
  );

  async function kjor(handling: () => Promise<unknown>, feiltekst: string) {
    setJobber(true);
    onFeil(null);
    try {
      await handling();
      setGrunn("");
      await onEndret();
    } catch (e) {
      onFeil(e instanceof Error ? e.message : feiltekst);
    } finally {
      setJobber(false);
    }
  }

  return (
    <div className={`pf-kort support${aktiv ? " aktiv" : ""}`}>
      <div className="pf-kort-hode">
        <span>Support-modus</span>
        {aktiv && <span className="badge warn">Aktiv</span>}
      </div>
      <div className="pf-kort-kropp">
        {aktiv ? (
          <>
            <p className="pf-tekst">
              Du har innsyn i denne kundens data til <b>{datoTid(aktiv.expiresAt)}</b>.
              Begrunnelse: «{aktiv.reason}»
            </p>
            <button
              className="btn btn-ghost fjern-knapp"
              disabled={jobber}
              onClick={() =>
                void kjor(
                  () => api.slett(`/plattform/support?orgId=${orgId}`),
                  "Kunne ikke avslutte support-modus",
                )
              }
            >
              Avslutt support-modus
            </button>
          </>
        ) : (
          <>
            <p className="pf-tekst">
              Uten support-modus har du <b>ingen</b> tilgang til kundens oppgaver, avvik eller
              beboerdata — panelet viser bare kundeforholdet. Innsynet logges med begrunnelse og
              utløper automatisk etter {kunde.maksTimer} timer.
            </p>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <input
                className="input"
                style={{ flex: "1 1 260px" }}
                placeholder="Hvorfor trenger du innsyn?"
                aria-label="Begrunnelse for innsyn"
                value={grunn}
                onChange={(e) => setGrunn(e.target.value)}
              />
              <button
                className="btn btn-primary"
                disabled={jobber || grunn.trim().length < 3}
                onClick={() =>
                  void kjor(
                    () => api.send("/plattform/support", { orgId, reason: grunn.trim() }),
                    "Kunne ikke starte support-modus",
                  )
                }
              >
                Start support-modus
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Sammendrag ──────────────────────────────────────────────────────────────────────────

/** Svarer på «hvordan står det til med denne kunden» uten å gå inn i kundens data. */
function Sammendrag({
  detalj,
  kunde,
  onGaTil,
}: {
  detalj: Detalj;
  kunde: Kunde;
  onGaTil: (f: Fane) => void;
}) {
  const { org, abonnement, onboarding } = detalj;
  const gjenstaar = onboarding.punkter.filter((p) => !p.ok).length;
  // Listeprisen for dagens modulvalg — det abonnementet VILLE kostet uten rabatt.
  const listepris =
    detalj.grunnpakkeNaa +
    detalj.moduler
      .filter((n) => TILLEGGSMODULER.includes(n as (typeof TILLEGGSMODULER)[number]))
      .reduce((n, m) => n + (detalj.prismodell.modulpriser[m] ?? 0), 0);

  return (
    <>
      <div className="pf-grid">
        <button className="pf-kort pf-snarvei" onClick={() => onGaTil("fakturering")}>
          <span className="pf-snarvei-tittel">Abonnement</span>
          {abonnement ? (
            <>
              <span className="pf-snarvei-tall gronn">
                {kroner(
                  arssum({
                    grunnpakke: abonnement.baseFee,
                    arsavgift: abonnement.annualFee,
                    moduler: abonnement.moduler.map((m) => ({ pris: m.price })),
                    rabattProsent: abonnement.discountPercent,
                  }),
                )}
              </span>
              <span className="pf-under">
                per år
                {abonnement.discountPercent > 0 &&
                  ` — ${abonnement.discountPercent} % rabatt${abonnement.endDate ? ` til ${dato(abonnement.endDate)}` : ""}`}
              </span>
            </>
          ) : (
            <>
              <span className="pf-snarvei-tall">—</span>
              <span className="pf-under">ingen avtale registrert — opprett →</span>
            </>
          )}
        </button>

        <button className="pf-kort pf-snarvei" onClick={() => onGaTil("moduler")}>
          <span className="pf-snarvei-tittel">Aktive moduler</span>
          <span className="pf-snarvei-tall">
            {detalj.moduler.length} / {ALLE_MODULER.length}
          </span>
          <span className="pf-under">listepris {kroner(listepris)}/år</span>
        </button>

        <button className="pf-kort pf-snarvei" onClick={() => onGaTil("onboarding")}>
          <span className="pf-snarvei-tittel">Onboarding</span>
          <span className={`pf-snarvei-tall${onboarding.prosent === 100 ? " gronn" : ""}`}>
            {onboarding.prosent} %
          </span>
          <span className="pf-under">
            {gjenstaar === 0 ? "alt på plass" : `${gjenstaar} ${gjenstaar === 1 ? "punkt" : "punkter"} gjenstår`}
          </span>
        </button>
      </div>

      <div className="pf-grid">
        <div className="pf-kort">
          <div className="pf-kort-hode">
            <span>Nøkkelinfo</span>
            <button className="btn btn-ghost" onClick={() => onGaTil("organisasjon")}>
              Se alt
            </button>
          </div>
          <div className="pf-kort-kropp">
            <Felt etikett="Selskapsform" verdi={org.orgForm ?? "—"} />
            <Felt etikett="Kommune" verdi={org.municipality ?? "—"} />
            <Felt etikett="Antall andeler" verdi={org.unitCount?.toString() ?? "—"} />
            <Felt etikett="Har ansatte" verdi={org.hasEmployees ? "Ja" : "Nei"} />
            <Felt
              etikett="Boligbyggelag"
              verdi={org.affiliationType === "tilknyttet" ? (org.bblNavn ?? "Tilknyttet") : org.affiliationType === "frittstaende" ? "Frittstående" : "Ikke kartlagt"}
            />
            <Felt etikett="Forretningsfører" verdi={forretningsforer(org)} />
          </div>
        </div>

        <div className="pf-kort">
          <div className="pf-kort-hode">
            <span>Bruk</span>
          </div>
          <div className="pf-kort-kropp">
            <Felt etikett="Oppgaver" verdi={String(kunde.antallOppgaver)} />
            <Felt etikett="Avvik" verdi={String(kunde.antallAvvik)} />
            <Felt etikett="Brukere" verdi={String(kunde.brukere.length)} />
            <p className="field-note" style={{ marginTop: "10px" }}>
              Antall, ikke innhold. Innholdet krever support-modus.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Organisasjon ────────────────────────────────────────────────────────────────────────

function Organisasjon({ detalj, onEndret }: { detalj: Detalj; onEndret: () => Promise<void> }) {
  const [redigerer, setRedigerer] = useState(false);
  const [tilknytning, setTilknytning] = useState(false);
  const { org } = detalj;

  return (
    <>
      <div className="pf-grid">
        <div className="pf-kort">
          <div className="pf-kort-hode">
            <span>Identitet og kontakt</span>
            <button className="btn btn-ghost" onClick={() => setRedigerer(true)}>
              Rediger
            </button>
          </div>
          <div className="pf-kort-kropp">
            <Felt etikett="Navn" verdi={org.name} />
            <Felt etikett="Org.nr" verdi={formatOrgNr(org.orgNr) ?? "—"} />
            <Felt etikett="Selskapsform" verdi={org.orgForm ?? "—"} />
            <Felt etikett="Kommune" verdi={org.municipality ?? "—"} />
            <Felt etikett="Antall andeler" verdi={org.unitCount?.toString() ?? "—"} />
            <Felt etikett="E-post" verdi={org.contactEmail ?? "—"} />
            <Felt etikett="Telefon" verdi={org.phone ?? "—"} />
            <Felt etikett="Nettside" verdi={org.website ?? "—"} />
            <Felt etikett="Har ansatte" verdi={org.hasEmployees ? "Ja" : "Nei"} />
            <Felt etikett="Kunde siden" verdi={dato(org.createdAt)} />
            <Felt etikett="Status" verdi={org.active ? "Aktiv" : "Inaktiv"} />
            {!org.contactEmail && (
              <p className="field-note" style={{ marginTop: "10px", color: "var(--warn)" }}>
                Uten e-post kan systemet ikke sende varsler eller faktura til kunden.
              </p>
            )}
          </div>
        </div>

        <div className="pf-kort">
          <div className="pf-kort-hode">
            <span>Tilknytning</span>
            <button className="btn btn-ghost" onClick={() => setTilknytning(true)}>
              Rediger
            </button>
          </div>
          <div className="pf-kort-kropp">
            <Felt
              etikett="Tilknytning"
              verdi={
                org.affiliationType === "tilknyttet"
                  ? `Tilknyttet${org.bblNavn ? ` — ${org.bblNavn}` : ""}`
                  : org.affiliationType === "frittstaende"
                    ? "Frittstående"
                    : "Ikke kartlagt"
              }
            />
            <Felt etikett="Forretningsfører" verdi={forretningsforer(org)} />
          </div>
        </div>
      </div>

      {redigerer && (
        <OrgModal
          org={org}
          onLukk={() => setRedigerer(false)}
          onLagret={() => {
            setRedigerer(false);
            void onEndret();
          }}
        />
      )}
      {tilknytning && (
        <TilknytningModal
          org={org}
          onLukk={() => setTilknytning(false)}
          onLagret={() => {
            setTilknytning(false);
            void onEndret();
          }}
        />
      )}
    </>
  );
}

// ── Onboarding ──────────────────────────────────────────────────────────────────────────

function OnboardingFane({ detalj }: { detalj: Detalj }) {
  const { onboarding } = detalj;
  return (
    <div className="pf-kort">
      <div className="pf-kort-hode">
        <span>Fremdrift</span>
        <span className="pf-tall">{onboarding.prosent} %</span>
      </div>
      <div className="pf-kort-kropp">
        <div className="pf-stolpe">
          <div className="pf-stolpe-fyll" style={{ width: `${onboarding.prosent}%` }} />
        </div>
        {onboarding.punkter.map((p) => (
          <div key={p.nokkel} className="pf-punkt">
            <span className={p.ok ? "pf-hake ok" : "pf-hake"} aria-hidden>
              {p.ok ? "✓" : "○"}
            </span>
            <span className={p.ok ? undefined : "pf-dempet"}>{p.etikett}</span>
            {p.detalj && <span className="pf-under">{p.detalj}</span>}
          </div>
        ))}
        <p className="field-note" style={{ marginTop: "10px" }}>
          Punktene teller kundens rader — hvor mange, aldri hva. De som gjenstår, er som
          regel de kunden må gjøre selv.
        </p>
      </div>
    </div>
  );
}

function forretningsforer(org: Org): string {
  if (org.managerType === "selvadministrert") return "Selvadministrert";
  if (org.managerType === "bbl") return org.managerBblNavn ?? "Boligbyggelag";
  if (org.managerType === "ekstern") return org.managerName ?? "Ekstern";
  return "Ikke kartlagt";
}

// ── Moduler ─────────────────────────────────────────────────────────────────────────────

function ModulFane({
  detalj,
  orgId,
  onEndret,
}: {
  detalj: Detalj;
  orgId: string;
  onEndret: () => Promise<void>;
}) {
  const [valgte, setValgte] = useState<string[]>(detalj.moduler);
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);

  const endret =
    valgte.length !== detalj.moduler.length || valgte.some((n) => !detalj.moduler.includes(n));

  async function lagre() {
    setLagrer(true);
    setFeil(null);
    try {
      await api.endre(`/plattform/kunder/${orgId}/moduler`, { moduler: valgte });
      await onEndret();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre modulvalget");
    } finally {
      setLagrer(false);
    }
  }

  // Listeprisen for VALGET slik det står nå — den som lagrer skal se hva det betyr for
  // neste faktura før de trykker, ikke etter.
  const listepris =
    detalj.grunnpakkeNaa +
    valgte
      .filter((n) => TILLEGGSMODULER.includes(n as (typeof TILLEGGSMODULER)[number]))
      .reduce((sum, n) => sum + (detalj.prismodell.modulpriser[n] ?? 0), 0);

  // Gruppene fra menyen — samme inndeling som kunden ser i sidemenyen sin.
  const grupper = new Map<string, typeof ALLE_MODULER[number][]>();
  for (const n of ALLE_MODULER) {
    const meny = MENY[n];
    if (!meny) continue;
    if (!grupper.has(meny.gruppe)) grupper.set(meny.gruppe, []);
    grupper.get(meny.gruppe)!.push(n);
  }

  return (
    <div className="pf-kort">
      <div className="pf-kort-hode">
        <span>Moduler</span>
        <span style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <span className="pf-under">Listepris {kroner(listepris)}/år</span>
          <button className="btn btn-primary" disabled={!endret || lagrer} onClick={() => void lagre()}>
            {lagrer ? "Lagrer …" : "Lagre modulvalg"}
          </button>
        </span>
      </div>
      {feil && <div className="feilmelding">{feil}</div>}

      {[...grupper.entries()].map(([gruppe, moduler]) => (
        <div key={gruppe}>
          <div className="pf-modulgruppe">{gruppe}</div>
          {moduler.map((n) => {
            const alltidPa = ALLTID_PA.has(n);
            const betalt = TILLEGGSMODULER.includes(n as (typeof TILLEGGSMODULER)[number]);
            return (
              <label key={n} className="pf-modul-valg">
                <input
                  type="checkbox"
                  checked={alltidPa || valgte.includes(n)}
                  // Dashboard kan ikke slås av — det er ikke en modul man selger, det er forsiden.
                  disabled={alltidPa}
                  onChange={(e) =>
                    setValgte(e.target.checked ? [...valgte, n] : valgte.filter((v) => v !== n))
                  }
                />
                <span style={{ minWidth: 0 }}>
                  <span className="pf-navn">{MENY[n]!.etikett}</span>
                </span>
                <span>
                  {alltidPa ? (
                    <span className="pf-under">Alltid på</span>
                  ) : betalt ? (
                    <span className="pf-merkelapp">{kroner(detalj.prismodell.modulpriser[n] ?? 0)}/år</span>
                  ) : (
                    <span className="pf-under">Inkludert</span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      ))}

      <p className="field-note" style={{ padding: "12px 16px" }}>
        Modulvalget styres bare herfra. Kundens egne innstillinger har ingen bryter — en
        kontoadmin som kunne skru på en betalt modul selv, ville fått den gratis.
      </p>
    </div>
  );
}

// ── Fakturering ─────────────────────────────────────────────────────────────────────────

function Fakturering({
  detalj,
  orgId,
  onEndret,
  onFeil,
}: {
  detalj: Detalj;
  orgId: string;
  onEndret: () => Promise<void>;
  onFeil: (f: string | null) => void;
}) {
  const [redigerer, setRedigerer] = useState(false);
  const [bekreft, setBekreft] = useState(false);
  const { abonnement, org } = detalj;

  const total = abonnement
    ? arssum({
        grunnpakke: abonnement.baseFee,
        arsavgift: abonnement.annualFee,
        moduler: abonnement.moduler.map((m) => ({ pris: m.price })),
        rabattProsent: abonnement.discountPercent,
      })
    : 0;

  async function slett() {
    setBekreft(false);
    onFeil(null);
    try {
      await api.slett(`/plattform/kunder/${orgId}/abonnement`);
      await onEndret();
    } catch (e) {
      onFeil(e instanceof Error ? e.message : "Kunne ikke slette abonnementet");
    }
  }

  return (
    <>
      <div className="pf-kort">
        <div className="pf-kort-hode">
          <span>Abonnement</span>
          <span style={{ display: "flex", gap: "6px" }}>
            {abonnement && (
              <button className="btn btn-ghost" onClick={() => setBekreft(true)}>
                Slett
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setRedigerer(true)}>
              {abonnement ? "Rediger" : "Opprett abonnement"}
            </button>
          </span>
        </div>

        {!abonnement ? (
          <p className="pf-dempet" style={{ padding: "16px" }}>
            Ingen avtale registrert. Kunden er ikke sperret av det — en manglende kontrakt er
            bokføring som mangler, ikke et signal om at tilgangen skal stenges.
          </p>
        ) : (
          <>
            <div className="pf-rad">
              <span>Grunnpakke</span>
              <span className="pf-dempet">
                {org.unitCount ?? 0} andeler · snapshot fra sist lagring
              </span>
              <span className="pf-tall">{kroner(abonnement.baseFee ?? 0)}</span>
            </div>
            {abonnement.moduler.map((m) => (
              <div key={m.key} className="pf-rad">
                <span>{MENY[m.key as keyof typeof MENY]?.etikett ?? m.key}</span>
                <span />
                <span className="pf-tall">{kroner(m.price)}</span>
              </div>
            ))}
            {abonnement.discountPercent > 0 && (
              <div className="pf-rad">
                <span>Rabatt</span>
                <span />
                <span className="pf-tall">−{abonnement.discountPercent} %</span>
              </div>
            )}
            <div className="pf-rad sum">
              <span>Sum per år</span>
              <span />
              <span className="pf-tall">{kroner(total)}</span>
            </div>
            <div className="pf-kort-kropp">
              <Felt etikett="Avtaleperiode" verdi={periode(abonnement)} />
              {abonnement.notes && <Felt etikett="Notat" verdi={abonnement.notes} />}
            </div>
            {/* Grunnpakken på kontrakten er et snapshot. Har andelstallet eller satsene
                endret seg siden, sier vi fra — ellers fakturerer man et gammelt tall uten
                å vite det. */}
            {abonnement.baseFee !== null && abonnement.baseFee !== detalj.grunnpakkeNaa && (
              <p className="field-note" style={{ padding: "0 16px 14px" }}>
                Med dagens prismodell og {org.unitCount ?? 0} andeler ville grunnpakken vært{" "}
                {kroner(detalj.grunnpakkeNaa)}. Lagre avtalen på nytt for å oppdatere den.
              </p>
            )}
          </>
        )}
      </div>

      {redigerer && (
        <AbonnementModal
          detalj={detalj}
          orgId={orgId}
          onLukk={() => setRedigerer(false)}
          onLagret={() => {
            setRedigerer(false);
            void onEndret();
          }}
        />
      )}

      {bekreft && (
        <Modal tittel="Slett abonnement" onLukk={() => setBekreft(false)} bredde={400}>
          <p style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
            Slette den registrerte avtalen for <strong>{org.name}</strong>?
          </p>
          <div className="tips-stripe" style={{ margin: "12px 0" }}>
            <span style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
              🛡 Kunden mister ingen tilgang. En manglende kontrakt sperrer ingenting — den er
              bokføring, ikke en bryter.
            </span>
          </div>
          <Knapperad
            onAvbryt={() => setBekreft(false)}
            sendEtikett="Slett avtalen"
            farlig
            onSend={() => void slett()}
          />
        </Modal>
      )}
    </>
  );
}

function periode(a: NonNullable<Abonnement>): string {
  if (!a.startDate && !a.endDate) return "Løpende";
  return `${a.startDate ? dato(a.startDate) : "—"} → ${a.endDate ? dato(a.endDate) : "løpende"}`;
}

function AbonnementModal({
  detalj,
  orgId,
  onLukk,
  onLagret,
}: {
  detalj: Detalj;
  orgId: string;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const { abonnement, prismodell, org } = detalj;
  const [rabatt, setRabatt] = useState(abonnement?.discountPercent ?? 0);
  const [start, setStart] = useState(abonnement?.startDate ?? "");
  const [slutt, setSlutt] = useState(abonnement?.endDate ?? "");
  const [notat, setNotat] = useState(abonnement?.notes ?? "");
  const [priser, setPriser] = useState<Record<string, number>>(() => {
    const fra = Object.fromEntries((abonnement?.moduler ?? []).map((m) => [m.key, m.price]));
    return { ...prismodell.modulpriser, ...fra };
  });
  const [valgte, setValgte] = useState<string[]>(
    () => abonnement?.moduler.map((m) => m.key) ?? [],
  );
  const { sender, feil, send } = useSending(onLagret);

  // Grunnpakken regnes ut MENS man ser på skjemaet, fra dagens satser — det er den som
  // lagres. Kontraktens gamle snapshot vises ikke her, nettopp for å unngå at man tror
  // tallet er uendret.
  const base = grunnpakke(org.unitCount, prismodell.gulvpris, prismodell.trinn);
  const modulsum = valgte.reduce((n, k) => n + (priser[k] ?? 0), 0);
  const total = Math.round((base + modulsum) * (1 - rabatt / 100));

  return (
    <Modal tittel="Abonnement" onLukk={onLukk} bredde={560}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            api.endre(`/plattform/kunder/${orgId}/abonnement`, {
              moduler: valgte.map((k) => ({ key: k, price: priser[k] ?? 0 })),
              discountPercent: rabatt,
              startDate: start || null,
              endDate: slutt || null,
              notes: notat.trim() || null,
            }),
          );
        }}
      >
        {feil && <div className="feilmelding">{feil}</div>}

        <div className="pf-rad">
          <span>Grunnpakke</span>
          <span className="pf-dempet">{org.unitCount ?? 0} andeler</span>
          <span className="pf-tall">{kroner(base)}</span>
        </div>

        <p className="field-label" style={{ marginTop: "14px" }}>
          Tilleggsmoduler
        </p>
        {TILLEGGSMODULER.map((n) => (
          <div key={n} className="pf-modul-valg">
            <input
              type="checkbox"
              checked={valgte.includes(n)}
              onChange={(e) =>
                setValgte(e.target.checked ? [...valgte, n] : valgte.filter((v) => v !== n))
              }
            />
            <span className="pf-navn">{MENY[n]?.etikett ?? n}</span>
            <input
              className="input"
              type="number"
              min={0}
              style={{ maxWidth: "120px" }}
              aria-label={`Pris for ${MENY[n]?.etikett ?? n}`}
              disabled={!valgte.includes(n)}
              value={priser[n] ?? 0}
              onChange={(e) => setPriser({ ...priser, [n]: parseInt(e.target.value, 10) || 0 })}
            />
          </div>
        ))}

        <Tekstfelt
          etikett="Rabatt (%)"
          type="number"
          verdi={String(rabatt)}
          onEndre={(v) => setRabatt(Math.min(100, Math.max(0, parseInt(v, 10) || 0)))}
        />
        <Tekstfelt etikett="Startdato" type="date" verdi={start} onEndre={setStart} />
        <Tekstfelt
          etikett="Sluttdato"
          type="date"
          verdi={slutt}
          onEndre={setSlutt}
          notat="Tomt = løpende avtale. En utløpt dato sperrer kundens tilgang."
        />
        <Tekstomrade etikett="Notat" verdi={notat} onEndre={setNotat} />

        <div className="pf-rad sum">
          <span>Sum per år</span>
          <span />
          <span className="pf-tall">{kroner(total)}</span>
        </div>

        <Knapperad onAvbryt={onLukk} sendEtikett="Lagre abonnement" sender={sender} />
      </form>
    </Modal>
  );
}

// ── Modaler for organisasjon og tilknytning ─────────────────────────────────────────────

function OrgModal({
  org,
  onLukk,
  onLagret,
}: {
  org: Org;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [navn, setNavn] = useState(org.name);
  const [orgNr, setOrgNr] = useState(org.orgNr ?? "");
  const [orgForm, setOrgForm] = useState(org.orgForm ?? "");
  const [kommune, setKommune] = useState(org.municipality ?? "");
  const [andeler, setAndeler] = useState(org.unitCount?.toString() ?? "");
  const [epost, setEpost] = useState(org.contactEmail ?? "");
  const [telefon, setTelefon] = useState(org.phone ?? "");
  const [nettside, setNettside] = useState(org.website ?? "");
  const [ansatte, setAnsatte] = useState(org.hasEmployees);
  const [aktiv, setAktiv] = useState(org.active);
  // Kvoten lagres i bytes, men ingen tenker i bytes. Skjemaet er i GB.
  const [kvoteGb, setKvoteGb] = useState(
    org.storageQuota ? String(org.storageQuota / 1024 / 1024 / 1024) : "",
  );
  const { sender, feil, send } = useSending(onLagret);

  return (
    <Modal tittel="Rediger organisasjon" onLukk={onLukk} bredde={520}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            api.endre(`/plattform/kunder/${org.id}`, {
              name: navn.trim(),
              orgNr: orgNr.trim() || null,
              orgForm: orgForm.trim() || null,
              municipality: kommune.trim() || null,
              unitCount: andeler.trim() ? parseInt(andeler, 10) : null,
              contactEmail: epost.trim() || null,
              phone: telefon.trim() || null,
              website: nettside.trim() || null,
              hasEmployees: ansatte,
              active: aktiv,
              storageQuota: kvoteGb.trim()
                ? Math.round(parseFloat(kvoteGb) * 1024 * 1024 * 1024)
                : null,
            }),
          );
        }}
      >
        {feil && <div className="feilmelding">{feil}</div>}
        <Tekstfelt etikett="Navn *" verdi={navn} onEndre={setNavn} />
        <Tekstfelt etikett="Organisasjonsnummer" verdi={orgNr} onEndre={setOrgNr} />
        <Tekstfelt etikett="Selskapsform" verdi={orgForm} onEndre={setOrgForm} />
        <Tekstfelt etikett="Kommune" verdi={kommune} onEndre={setKommune} />
        <Tekstfelt
          etikett="Antall andeler"
          type="number"
          verdi={andeler}
          onEndre={setAndeler}
          notat="Grunnlaget for grunnpakkeprisen. Endres den, må abonnementet lagres på nytt."
        />
        <Tekstfelt etikett="E-post" verdi={epost} onEndre={setEpost} />
        <Tekstfelt etikett="Telefon" verdi={telefon} onEndre={setTelefon} />
        <Tekstfelt etikett="Nettside" verdi={nettside} onEndre={setNettside} />
        <Tekstfelt
          etikett="Lagringskvote (GB)"
          type="number"
          verdi={kvoteGb}
          onEndre={setKvoteGb}
          notat="Tomt = standardkvoten."
        />

        <label className="pf-modul-valg">
          <input type="checkbox" checked={ansatte} onChange={(e) => setAnsatte(e.target.checked)} />
          <span style={{ minWidth: 0 }}>
            <span className="pf-navn">Har ansatte</span>
            <span className="pf-under">
              Avgjør hvilke lover internkontrollen må dekke — med ansatte slår
              arbeidsmiljøloven inn.
            </span>
          </span>
        </label>
        <label className="pf-modul-valg">
          <input type="checkbox" checked={aktiv} onChange={(e) => setAktiv(e.target.checked)} />
          <span className="pf-navn">Aktiv kunde</span>
        </label>

        <Knapperad onAvbryt={onLukk} sender={sender} deaktivert={!navn.trim()} />
      </form>
    </Modal>
  );
}

function TilknytningModal({
  org,
  onLukk,
  onLagret,
}: {
  org: Org;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [tilknytning, setTilknytning] = useState(org.affiliationType ?? "");
  const [bblId, setBblId] = useState(org.bblId ?? "");
  const [forer, setForer] = useState(org.managerType ?? "");
  const [forerBblId, setForerBblId] = useState(org.managerBblId ?? "");
  const [forerNavn, setForerNavn] = useState(org.managerName ?? "");
  const [forerOrgNr, setForerOrgNr] = useState(org.managerOrgNr ?? "");
  const [lag, setLag] = useState<Array<{ id: string; name: string }>>([]);
  const { sender, feil, send } = useSending(onLagret);

  useEffect(() => {
    api
      .hent<Array<{ id: string; name: string }>>("/plattform/bbl-valg")
      .then(setLag)
      .catch(() => setLag([]));
  }, []);

  return (
    <Modal tittel="Tilknytning og forretningsfører" onLukk={onLukk} bredde={520}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            api.endre(`/plattform/kunder/${org.id}/tilknytning`, {
              affiliationType: tilknytning || null,
              bblId: bblId || null,
              managerType: forer || null,
              managerBblId: forerBblId || null,
              managerName: forerNavn.trim() || null,
              managerOrgNr: forerOrgNr.trim() || null,
            }),
          );
        }}
      >
        {feil && <div className="feilmelding">{feil}</div>}

        <div className="field">
          <label className="field-label" htmlFor="tilknytning">
            Tilknytning
          </label>
          <select
            id="tilknytning"
            className="input"
            value={tilknytning}
            onChange={(e) => setTilknytning(e.target.value)}
          >
            <option value="">Ikke kartlagt</option>
            <option value="frittstaende">Frittstående</option>
            <option value="tilknyttet">Tilknyttet et boligbyggelag</option>
          </select>
        </div>

        {tilknytning === "tilknyttet" && (
          <div className="field">
            <label className="field-label" htmlFor="bbl">
              Boligbyggelag
            </label>
            <select id="bbl" className="input" value={bblId} onChange={(e) => setBblId(e.target.value)}>
              <option value="">Velg lag …</option>
              {lag.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="forer">
            Forretningsfører
          </label>
          <select id="forer" className="input" value={forer} onChange={(e) => setForer(e.target.value)}>
            <option value="">Ikke kartlagt</option>
            <option value="selvadministrert">Selvadministrert</option>
            <option value="bbl">Et boligbyggelag</option>
            <option value="ekstern">Eksternt byrå</option>
          </select>
          <div className="field-note">
            Et separat forhold fra tilknytningen. De faller ofte sammen, men et frittstående
            lag kan ha et regnskapsbyrå, og et tilknyttet lag kan være selvadministrert.
          </div>
        </div>

        {forer === "bbl" && (
          <div className="field">
            <label className="field-label" htmlFor="forer-bbl">
              Hvilket lag
            </label>
            <select
              id="forer-bbl"
              className="input"
              value={forerBblId}
              onChange={(e) => setForerBblId(e.target.value)}
            >
              <option value="">Velg lag …</option>
              {lag.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {forer === "ekstern" && (
          <>
            <Tekstfelt etikett="Navn på byrå" verdi={forerNavn} onEndre={setForerNavn} />
            <Tekstfelt etikett="Org.nr" verdi={forerOrgNr} onEndre={setForerOrgNr} />
          </>
        )}

        <Knapperad onAvbryt={onLukk} sender={sender} />
      </form>
    </Modal>
  );
}

// ── Brukere og innsynslogg ──────────────────────────────────────────────────────────────

function Brukere({ kunde }: { kunde: Kunde }) {
  return (
    <div className="pf-kort">
      <div className="pf-kort-hode">
        <span>Brukere ({kunde.brukere.length})</span>
      </div>
      <div className="pf-kort-kropp">
        {kunde.brukere.length === 0 ? (
          <p className="pf-dempet">Ingen brukere i denne organisasjonen.</p>
        ) : (
          kunde.brukere.map((b) => (
            <div key={b.id} className="pf-bruker">
              <span style={{ minWidth: 0 }}>
                <span className="pf-navn">{b.navn}</span>
                <span className="pf-under">{b.epost}</span>
              </span>
              <span className="pf-celle">{NIVA_ETIKETT[b.nivaa] ?? b.nivaa}</span>
              <span className="pf-celle pf-dempet">
                {b.sistInnlogget ? datoTid(b.sistInnlogget) : "aldri innlogget"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Innsynslogg({ kunde }: { kunde: Kunde }) {
  return (
    <div className="pf-kort">
      <div className="pf-kort-hode">
        <span>Innsynslogg</span>
      </div>
      <div className="pf-kort-kropp">
        {kunde.sesjoner.length === 0 ? (
          <p className="pf-dempet">Ingen har hatt support-innsyn i denne kunden.</p>
        ) : (
          kunde.sesjoner.map((s) => (
            <div key={s.id} className="pf-sesjon">
              <div>
                <span className="pf-navn">{s.adminName ?? "Slettet bruker"}</span>
                <span className="pf-under">«{s.reason}»</span>
              </div>
              <span className="pf-celle">
                {datoTid(s.startedAt)}
                {s.endedAt ? ` → ${datoTid(s.endedAt)}` : " → pågår"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Felt({ etikett, verdi }: { etikett: string; verdi: string }) {
  return (
    <div className="pf-felt">
      <span className="pf-under">{etikett}</span>
      <span>{verdi}</span>
    </div>
  );
}
