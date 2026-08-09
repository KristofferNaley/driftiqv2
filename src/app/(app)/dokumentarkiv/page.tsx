"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Feil, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Tekstfelt, useSending } from "@/components/skjema";
import { dokumenter, type Arkivoversikt, type Dokument, type Mappe } from "@/lib/klient";

/**
 * Dokumentarkivet.
 *
 * ## Hvorfor mapper og ikke bare en liste
 *
 * Første utkast i v2 var én flat liste med filterknapper. Det fungerer på ti dokumenter og
 * bryter sammen på hundre — som er der et borettslag ligger etter noen år. Et arkiv er noe
 * man LETER i, ikke noe man blar i, og mappene er hvordan styret allerede tenker: vedtekter,
 * protokoller, referater.
 *
 * ## Speilmappene eier ingenting
 *
 * FDV-filene tilhører Vedlikehold og kontraktfilene Kontrakter. De vises her fordi det er
 * her folk leter, men de kopieres ikke — kortene teller, og klikk sender deg til modulen som
 * eier dem. To steder å laste opp samme fil ville gitt to sannheter om hvilken versjon som
 * gjelder.
 */

const FASTE_NAVN: Record<string, { navn: string; ikon: string }> = {
  vedtekter: { navn: "Vedtekter & husordensregler", ikon: "📜" },
  generalforsamling: { navn: "Generalforsamling", ikon: "📦" },
  styrereferater: { navn: "Styrereferater", ikon: "📝" },
  bygningsdok: { navn: "Bygningsdokumentasjon", ikon: "🏢" },
  forsikring: { navn: "Forsikring", ikon: "🛡" },
  annet: { navn: "Annet", ikon: "📁" },
};

/** Mapper som grupperes på år i stedet for undermapper. Må matche AARSGRUPPERTE i libet. */
const AARSGRUPPERT = new Set(["styrereferater"]);

const UTEN_DATO = "Uten dato";

/**
 * Filstørrelse i kB, MB eller GB.
 *
 * GB-trinnet er ikke pynt: kvoten er 5 GB, og uten det sto det «5120,0 MB» i
 * lagringskortet — et tall ingen leser som «fem gigabyte».
 */
function storrelse(n: number | null | undefined): string {
  if (!n) return "—";
  const komma = (x: number) => x.toFixed(1).replace(".", ",");
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  if (n < 1024 * 1024 * 1024) return `${komma(n / 1024 / 1024)} MB`;
  return `${komma(n / 1024 / 1024 / 1024)} GB`;
}

function filikon(ct: string | null): string {
  if (!ct) return "📄";
  if (ct.startsWith("image/")) return "🖼";
  if (ct.includes("word")) return "📝";
  if (ct.includes("sheet") || ct.includes("excel")) return "📊";
  return "📄";
}

export default function Dokumentarkiv() {
  /** `null` = forsiden med mappene. Ellers slug eller mappe-id. */
  const [mappe, setMappe] = useState<string | null>(null);
  const [sok, setSok] = useState("");
  const [nyMappe, setNyMappe] = useState(false);

  const { data, feil, setFeil, laster, last, orgId } = useOrgData(
    (o) => dokumenter.oversikt(o),
    [],
  );

  return (
    <Layout
      tittel="Dokumentarkiv"
      aside={data ? <Sidepanel oversikt={data} onVelgMappe={setMappe} /> : undefined}
    >
      <div className="page-content">
        <Feil melding={feil} />

        {laster && !data ? (
          <Tom tekst="Henter …" />
        ) : !data ? null : mappe ? (
          <Mappevisning
            mappe={mappe}
            orgId={orgId}
            oversikt={data}
            onTilbake={() => setMappe(null)}
            onVelgMappe={setMappe}
            onEndret={last}
            onFeil={setFeil}
          />
        ) : (
          <Forside
            oversikt={data}
            orgId={orgId}
            sok={sok}
            onSok={setSok}
            onVelgMappe={setMappe}
            onNyMappe={() => setNyMappe(true)}
          />
        )}
      </div>

      {nyMappe && orgId && (
        <MappeModal
          orgId={orgId}
          forelder={mappe}
          onLukk={() => setNyMappe(false)}
          onLagret={() => {
            setNyMappe(false);
            void last();
          }}
        />
      )}
    </Layout>
  );
}

// ── Forsiden ────────────────────────────────────────────────────────────────────────────

function Forside({
  oversikt,
  orgId,
  sok,
  onSok,
  onVelgMappe,
  onNyMappe,
}: {
  oversikt: Arkivoversikt;
  orgId: string | undefined;
  sok: string;
  onSok: (v: string) => void;
  onVelgMappe: (m: string) => void;
  onNyMappe: () => void;
}) {
  const router = useRouter();
  const treff = useMemo(() => {
    const q = sok.trim().toLowerCase();
    if (!q) return null;
    // Søket går mot de sist opplastede vi allerede har. For et fullt arkivsøk trengs et
    // eget endepunkt — det er ikke bygget, og lista sier fra om at den er avgrenset.
    return oversikt.nylig.filter(
      (d) =>
        d.title.toLowerCase().includes(q) || d.originalName.toLowerCase().includes(q),
    );
  }, [sok, oversikt.nylig]);

  return (
    <>
      <input
        className="input arkiv-sok"
        placeholder="Søk i dokumenter …"
        aria-label="Søk i dokumenter"
        value={sok}
        onChange={(e) => onSok(e.target.value)}
      />

      {treff ? (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              {treff.length} treff blant de sist opplastede
            </div>
          </div>
          {treff.length === 0 ? (
            <Tom tekst="Ingen treff. Åpne mappa dokumentet ligger i for å se alt." />
          ) : (
            treff.map((d) => (
              <Dokumentrad
                key={d.id}
                dok={d}
                orgId={orgId}
                mappenavn={mappenavn(d.folder, oversikt)}
              />
            ))
          )}
        </div>
      ) : (
        <>
          <div className="arkiv-seksjon">Mapper</div>
          <div className="arkiv-rutenett">
            {oversikt.faste.map((f) => (
              <Mappekort
                key={f.nokkel}
                ikon={FASTE_NAVN[f.nokkel]?.ikon ?? "📁"}
                navn={FASTE_NAVN[f.nokkel]?.navn ?? f.nokkel}
                under={undertekst(f.antall, f.antallUndermapper)}
                onClick={() => onVelgMappe(f.nokkel)}
              />
            ))}

            {oversikt.egne.map((m) => (
              <Mappekort
                key={m.id}
                ikon={m.icon}
                navn={m.name}
                under={undertekst(m.antall, m.antallUndermapper)}
                onClick={() => onVelgMappe(m.id)}
              />
            ))}

            {/* Speilmapper — eies av andre moduler, derfor egen stil og en pil ut. */}
            {oversikt.speil.vedlikehold.antall > 0 && (
              <Mappekort
                ikon="🏗"
                navn="Vedlikehold"
                under={`${oversikt.speil.vedlikehold.antall} FDV-dokumenter · ${oversikt.speil.vedlikehold.antallDeler} bygningsdeler`}
                speil
                onClick={() => router.push("/vedlikehold")}
              />
            )}
            {oversikt.speil.kontrakter.antall > 0 && (
              <Mappekort
                ikon="📄"
                navn="Kontrakter"
                under={`${oversikt.speil.kontrakter.antall} dokumenter · ${oversikt.speil.kontrakter.antallLeverandorer} leverandører`}
                speil
                onClick={() => router.push("/kontrakter")}
              />
            )}

            <button className="arkiv-kort ny" onClick={onNyMappe}>
              <span className="arkiv-ikon">＋</span>
              <span className="arkiv-navn">Ny mappe</span>
              <span className="arkiv-under">Lag din egen</span>
            </button>
          </div>

          {oversikt.nylig.length > 0 && (
            <div className="card">
              <div className="card-header">
                <div className="card-title">Nylig lastet opp</div>
              </div>
              {oversikt.nylig.map((d) => (
                <Dokumentrad
                  key={d.id}
                  dok={d}
                  orgId={orgId}
                  mappenavn={mappenavn(d.folder, oversikt)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

const undertekst = (antall: number, under: number) =>
  [
    `${antall} dokument${antall === 1 ? "" : "er"}`,
    under > 0 ? `${under} undermappe${under === 1 ? "" : "r"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * Mappene OVER denne, ytterst først. Tom for en mappe på toppnivå.
 *
 * Går oppover via `parentId`, som er enten en fast slug eller en mappe-id — samme
 * «slug eller id»-mønster som resten av arkivet.
 */
function forfedre(
  nokkel: string,
  mapper: Mappe[],
  oversikt: Arkivoversikt,
): Array<{ nokkel: string; navn: string }> {
  const kjede: Array<{ nokkel: string; navn: string }> = [];
  let n: string | null = mapper.find((m) => m.id === nokkel)?.parentId ?? null;
  // Taket er MAKS_DYBDE i libet; grensa her er bare en sperre mot en ødelagt kjede.
  for (let i = 0; n && i < 5; i++) {
    kjede.unshift({ nokkel: n, navn: mappenavn(n, oversikt) });
    n = mapper.find((m) => m.id === n)?.parentId ?? null;
  }
  return kjede;
}

function mappenavn(nokkel: string, oversikt: Arkivoversikt): string {
  return (
    FASTE_NAVN[nokkel]?.navn ??
    oversikt.egne.find((m) => m.id === nokkel)?.name ??
    "Annet"
  );
}

function Mappekort({
  ikon,
  navn,
  under,
  speil,
  onClick,
}: {
  ikon: string;
  navn: string;
  under: string;
  speil?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`arkiv-kort${speil ? " speil" : ""}`} onClick={onClick}>
      <span className="arkiv-ikon">{ikon}</span>
      <span className="arkiv-navn">
        {navn}
        {speil && <span className="arkiv-pil"> ↗</span>}
      </span>
      <span className="arkiv-under">{under}</span>
    </button>
  );
}

// ── Inne i en mappe ─────────────────────────────────────────────────────────────────────

function Mappevisning({
  mappe,
  orgId,
  oversikt,
  onTilbake,
  onVelgMappe,
  onEndret,
  onFeil,
}: {
  mappe: string;
  orgId: string | undefined;
  oversikt: Arkivoversikt;
  onTilbake: () => void;
  onVelgMappe: (m: string) => void;
  onEndret: () => Promise<void>;
  onFeil: (f: string | null) => void;
}) {
  const { data, laster, last } = useOrgData((o) => dokumenter.liste(o, mappe), [mappe]);
  const { data: alleMapper } = useOrgData((o) => dokumenter.mapper(o), []);
  const [laster_opp, setLasterOpp] = useState(false);
  // Egen memo: `data ?? []` gir en ny referanse hver render, og årsgrupperingen under ville
  // da regnet seg om hver gang.
  const liste = useMemo(() => data ?? [], [data]);
  const navn = mappenavn(mappe, oversikt);
  const sti = forfedre(mappe, alleMapper ?? [], oversikt);

  async function lastOpp(e: React.ChangeEvent<HTMLInputElement>) {
    const fil = e.target.files?.[0];
    if (!fil || !orgId) return;
    setLasterOpp(true);
    onFeil(null);
    const form = new FormData();
    form.append("file", fil);
    form.append("title", fil.name.replace(/\.[^.]+$/, ""));
    form.append("folder", mappe);
    try {
      await dokumenter.lastOpp(orgId, form);
      await last();
      await onEndret();
    } catch (err) {
      // Kvote (413) og filtype (400) kommer hit med API-ets egen norske melding.
      onFeil(err instanceof Error ? err.message : "Opplasting feilet");
    } finally {
      setLasterOpp(false);
      e.target.value = "";
    }
  }

  async function slett(d: Dokument) {
    onFeil(null);
    try {
      await dokumenter.slett(orgId!, d.id);
      await last();
      await onEndret();
    } catch (err) {
      onFeil(err instanceof Error ? err.message : "Kunne ikke slette dokumentet");
    }
  }

  // Årsgrupperte mapper sorteres på dokumentdato, ikke opplastingsdato: et referat fra 2024
  // lastet opp i dag hører hjemme under 2024.
  const grupper = useMemo(() => {
    if (!AARSGRUPPERT.has(mappe)) return null;
    const kart = new Map<string, Dokument[]>();
    for (const d of liste) {
      const aar = d.documentDate ? d.documentDate.slice(0, 4) : UTEN_DATO;
      if (!kart.has(aar)) kart.set(aar, []);
      kart.get(aar)!.push(d);
    }
    // Nyeste år først, «Uten dato» sist — den er en restkategori, ikke et årstall.
    return [...kart.entries()].sort(([a], [b]) =>
      a === UTEN_DATO ? 1 : b === UTEN_DATO ? -1 : b.localeCompare(a),
    );
  }, [liste, mappe]);

  return (
    <>
      <div className="arkiv-sti">
        <button className="btn btn-ghost" onClick={onTilbake}>
          ← Alle mapper
        </button>
        {/* Brødsmulesti: på tre nivåer holder det ikke med én vei ut til rota — da mister
            man plassen sin hver gang man skal ett hakk opp. */}
        {sti.map((f) => (
          <span key={f.nokkel} className="arkiv-sti-ledd">
            <button className="arkiv-sti-lenke" onClick={() => onVelgMappe(f.nokkel)}>
              {f.navn}
            </button>
            <span aria-hidden>›</span>
          </span>
        ))}
        <span className="arkiv-sti-navn">{navn}</span>
        <label className="btn btn-primary arkiv-opplast">
          {laster_opp ? "Laster opp …" : "Last opp hit"}
          <input type="file" hidden disabled={laster_opp} onChange={(e) => void lastOpp(e)} />
        </label>
      </div>

      {/* Undermapper i denne mappa. Årsgrupperte mapper har dem ikke — to konkurrerende
          ordninger i samme mappe ville gjort det uforutsigbart hvor noe havner. */}
      {!AARSGRUPPERT.has(mappe) && (
        <Undermapper mapper={alleMapper ?? []} mappe={mappe} onVelgMappe={onVelgMappe} />
      )}

      {laster && !data ? (
        <Tom tekst="Henter …" />
      ) : liste.length === 0 ? (
        <Tom tekst="Ingen dokumenter i denne mappa ennå." />
      ) : grupper ? (
        grupper.map(([aar, docs]) => (
          <div key={aar} className="card">
            <div className="card-header">
              <div className="card-title">{aar}</div>
            </div>
            {docs.map((d) => (
              <Dokumentrad key={d.id} dok={d} orgId={orgId} onSlett={() => void slett(d)} />
            ))}
          </div>
        ))
      ) : (
        <div className="card">
          {liste.map((d) => (
            <Dokumentrad key={d.id} dok={d} orgId={orgId} onSlett={() => void slett(d)} />
          ))}
        </div>
      )}
    </>
  );
}

function Undermapper({
  mapper,
  mappe,
  onVelgMappe,
}: {
  mapper: Mappe[];
  mappe: string;
  onVelgMappe: (m: string) => void;
}) {
  const barn = mapper.filter((m) => m.parentId === mappe);
  if (barn.length === 0) return null;

  return (
    <div className="arkiv-rutenett">
      {barn.map((m) => (
        <Mappekort
          key={m.id}
          ikon={m.icon}
          navn={m.name}
          under="Undermappe"
          onClick={() => onVelgMappe(m.id)}
        />
      ))}
    </div>
  );
}

function Dokumentrad({
  dok,
  orgId,
  mappenavn,
  onSlett,
}: {
  dok: { id: string; title: string; originalName: string; contentType: string; fileSize: number | null; documentDate: string | null; uploadedAt: string };
  orgId: string | undefined;
  mappenavn?: string;
  onSlett?: () => void;
}) {
  return (
    <div className="doc-rad">
      <span className="doc-ikon" aria-hidden>
        {filikon(dok.contentType)}
      </span>
      <span style={{ minWidth: 0 }}>
        {/* Lenke, ikke knapp: da virker «åpne i ny fane» og høyreklikk → lagre som. */}
        <a
          className="doc-tittel"
          href={orgId ? `/api/organizations/${orgId}/documents/${dok.id}/file` : undefined}
          target="_blank"
          rel="noreferrer"
        >
          {dok.title}
        </a>
        <span className="doc-meta">
          {[mappenavn, dok.originalName].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="doc-celle">{storrelse(dok.fileSize)}</span>
      <span className="doc-celle">{dato(dok.documentDate ?? dok.uploadedAt)}</span>
      {onSlett ? (
        <button className="btn btn-ghost" onClick={onSlett} aria-label={`Slett ${dok.title}`}>
          Slett
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

// ── Sidepanel ───────────────────────────────────────────────────────────────────────────

function Sidepanel({
  oversikt,
  onVelgMappe,
}: {
  oversikt: Arkivoversikt;
  onVelgMappe: (m: string) => void;
}) {
  return (
    <>
      <div className="card">
        <div className="card-header">
          <div className="card-title">Anbefalt innhold</div>
        </div>
        <p className="field-note" style={{ padding: "0 14px 8px" }}>
          Det et velorganisert arkiv bør inneholde.
        </p>
        {oversikt.anbefalt.map((a) => (
          <button key={a.mappe} className="anbefalt-rad" onClick={() => onVelgMappe(a.mappe)}>
            <span className={a.ok ? "anbefalt-hake ok" : "anbefalt-hake mangler"} aria-hidden>
              {a.ok ? "✓" : "!"}
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="anbefalt-tittel">{a.tittel}</span>
              {a.hint && <span className="anbefalt-hint">{a.hint}</span>}
              {/* Punktet sjekker bare om mappa har innhold — vi kan ikke vite om en PDF
                  faktisk ER tegningene. Derfor «legg til», ikke «mangler». */}
              {!a.ok && <span className="anbefalt-legg-til">+ Legg til</span>}
            </span>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Lagringsplass</div>
        </div>
        <div style={{ padding: "0 14px 14px" }}>
          <div className="lagring-tekst">
            {storrelse(oversikt.lagring.brukt)} av {storrelse(oversikt.lagring.kvote)} brukt
            <span className="lagring-prosent">{oversikt.lagring.prosent} %</span>
          </div>
          <div className="lagring-stolpe">
            <div
              className={`lagring-fyll${oversikt.lagring.prosent > 85 ? " full" : ""}`}
              style={{ width: `${Math.min(oversikt.lagring.prosent, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

// ── Ny mappe ────────────────────────────────────────────────────────────────────────────

const IKONER = ["📁", "📂", "🏗", "🔧", "🌳", "🚗", "💡", "🧾", "🗝", "🏢"];

function MappeModal({
  orgId,
  forelder,
  onLukk,
  onLagret,
}: {
  orgId: string;
  forelder: string | null;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [navn, setNavn] = useState("");
  const [ikon, setIkon] = useState("📁");
  const { sender, feil, send } = useSending(onLagret);

  return (
    <Modal tittel="Ny mappe" onLukk={onLukk} bredde={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            dokumenter.nyMappe(orgId, { name: navn.trim(), icon: ikon, parentId: forelder }),
          );
        }}
      >
        {feil && <div className="feilmelding">{feil}</div>}
        <Tekstfelt etikett="Navn *" verdi={navn} onEndre={setNavn} plassholder="F.eks. «Byggeprosjekt garasje»" />
        <div className="field">
          <label className="field-label">Ikon</label>
          <div className="ikonvelger">
            {IKONER.map((i) => (
              <button
                key={i}
                type="button"
                className={`ikonvalg${ikon === i ? " valgt" : ""}`}
                onClick={() => setIkon(i)}
                aria-label={`Velg ikon ${i}`}
                aria-pressed={ikon === i}
              >
                {i}
              </button>
            ))}
          </div>
        </div>
        <Knapperad onAvbryt={onLukk} sendEtikett="Opprett mappe" sender={sender} deaktivert={!navn.trim()} />
      </form>
    </Modal>
  );
}
