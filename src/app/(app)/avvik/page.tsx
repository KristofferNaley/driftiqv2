"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Feil, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, Tekstomrade, useSending } from "@/components/skjema";
import { avvik, enheter, leverandorer, oppgaver, type Avvik, type AvvikSok } from "@/lib/klient";
import { STATUS_VISNING, kategoriEtikett, lesKategorier } from "@/lib/avvikkategorier";
import EnhetVelger, { type VelgbarEnhet } from "@/components/EnhetVelger";

/** Kolonnene. `sorter` er feltet API-et godtar — mangler det, er kolonnen ikke sorterbar. */
const KOLONNER: Array<{ sorter?: string; etikett: string; synkendeForst?: boolean; smal?: boolean }> = [
  { sorter: "number", etikett: "#", synkendeForst: true, smal: true },
  { sorter: "title", etikett: "Tittel" },
  { sorter: "reported_at", etikett: "Dato", synkendeForst: true },
  { sorter: "due_date", etikett: "Frist" },
  { sorter: "reported_by", etikett: "Meldt av" },
  { sorter: "assigned_to", etikett: "Ansvarlig" },
  { sorter: "category", etikett: "Kategori" },
  { sorter: "status", etikett: "Status" },
];

const iDag = () => new Date().toISOString().slice(0, 10);

export default function AvvikSide() {
  const router = useRouter();
  const [sok, setSok] = useState("");
  const [treg, setTreg] = useState("");
  const [kategori, setKategori] = useState("");
  const [unitId, setUnitId] = useState("");
  const [lukkede, setLukkede] = useState(false);
  const [sorter, setSorter] = useState("reported_at");
  const [retning, setRetning] = useState<"asc" | "desc">("desc");
  const [side, setSide] = useState(1);
  const [melder, setMelder] = useState(false);

  // Søket treffer databasen, så det skal ikke gjøre det på hvert tastetrykk.
  useEffect(() => {
    const t = setTimeout(() => setTreg(sok), 300);
    return () => clearTimeout(t);
  }, [sok]);

  // Nytt filter betyr ny side 1 — ellers står man på side 3 i et resultat med én side.
  useEffect(() => setSide(1), [treg, kategori, unitId, lukkede, sorter, retning]);

  const query: AvvikSok = { side, sok: treg, kategori, unitId, lukkede, sorter, retning };
  const { data, feil, laster, last, orgId } = useOrgData((o) => avvik.liste(o, query), [
    side,
    treg,
    kategori,
    unitId,
    lukkede,
    sorter,
    retning,
  ]);

  const kategorier = useMemo(() => lesKategorier(data?.kategorier), [data?.kategorier]);
  const rader = data?.items ?? [];
  const stats = data?.stats;

  function sorterPa(kol: (typeof KOLONNER)[number]) {
    if (!kol.sorter) return;
    if (sorter === kol.sorter) setRetning((r) => (r === "desc" ? "asc" : "desc"));
    else {
      setSorter(kol.sorter);
      setRetning(kol.synkendeForst ? "desc" : "asc");
    }
  }

  return (
    <Layout
      tittel="Avvik"
      handlinger={
        <button className="btn btn-primary" onClick={() => setMelder(true)}>
          ＋ Meld avvik
        </button>
      }
    >
      <div className="page-content">
        <Feil melding={feil} />

        {stats && (
          <div className="kpi-grid">
            <Kpi
              farge="blaa"
              etikett="Avvik hittil i år"
              verdi={stats.ytd}
              under={
                stats.ytdEndring === null
                  ? stats.ytdIFjor === 0
                    ? "Ingen data fra i fjor"
                    : ""
                  : stats.ytdEndring > 0
                    ? `↑ ${stats.ytdEndring} % mot samme tid i fjor (${stats.ytdIFjor})`
                    : stats.ytdEndring < 0
                      ? `↓ ${Math.abs(stats.ytdEndring)} % mot samme tid i fjor (${stats.ytdIFjor})`
                      : `Uendret mot i fjor (${stats.ytdIFjor})`
              }
              // Flere avvik er ikke nødvendigvis verre — det kan bety at folk melder fra.
              // Fargen sier bare retning, og teksten forklarer hva den sammenlignes med.
              underFarge={
                stats.ytdEndring === null || stats.ytdEndring === 0
                  ? undefined
                  : stats.ytdEndring > 0
                    ? "var(--danger)"
                    : "var(--accent2)"
              }
            />
            <Kpi farge="roed" etikett="Meldte avvik" verdi={stats.ny} under="Behandling ikke startet" />
            <Kpi farge="gul" etikett="Under behandling" verdi={stats.underBehandling} under="Behandling pågår" />
            <Kpi farge="gronn" etikett="Mine åpne avvik" verdi={stats.mine} under="Tildelt meg, ikke lukket" />
          </div>
        )}

        <div className="avvik-filter">
          <input
            className="input"
            placeholder="Søk på #nummer eller tittel …"
            aria-label="Søk i avvik"
            value={sok}
            onChange={(e) => setSok(e.target.value)}
          />
          <select
            className="input"
            aria-label="Filtrer på kategori"
            value={kategori}
            onChange={(e) => setKategori(e.target.value)}
          >
            <option value="">Alle kategorier</option>
            {kategorier.map((k) => (
              <option key={k.verdi} value={k.verdi}>
                {k.etikett}
              </option>
            ))}
          </select>
          <Stedsfilter orgId={orgId} verdi={unitId} onEndre={setUnitId} />
          <div className="pille-gruppe">
            <button className={`pille${lukkede ? "" : " valgt"}`} onClick={() => setLukkede(false)}>
              Aktive
            </button>
            <button className={`pille${lukkede ? " valgt" : ""}`} onClick={() => setLukkede(true)}>
              Lukkede
            </button>
          </div>
        </div>

        <div className="card">
          <div className="avvik-tabell">
            <div className="avvik-rad hode">
              {KOLONNER.map((k) => (
                <button
                  key={k.etikett}
                  className={`avvik-sorter${sorter === k.sorter ? " aktiv" : ""}${k.smal ? " smal" : ""}`}
                  onClick={() => sorterPa(k)}
                  disabled={!k.sorter}
                >
                  {k.etikett}
                  {sorter === k.sorter && <span>{retning === "desc" ? " ↓" : " ↑"}</span>}
                </button>
              ))}
              <span />
            </div>

            {laster ? (
              <Tom tekst="Henter …" />
            ) : rader.length === 0 ? (
              <Tom tekst="Ingen avvik i denne visningen." />
            ) : (
              rader.map((a) => (
                <AvviksRad
                  key={a.id}
                  avvik={a}
                  kategori={kategoriEtikett(kategorier, a.category)}
                  onKlikk={() => router.push(`/avvik/${a.id}`)}
                />
              ))
            )}
          </div>

          {data && data.sider > 1 && (
            <Sider side={data.side} sider={data.sider} total={data.total} onBytt={setSide} />
          )}
        </div>
      </div>

      {melder && orgId && (
        <MeldAvvik
          orgId={orgId}
          kategorier={kategorier}
          onLukk={() => setMelder(false)}
          onMeldt={async () => {
            // Nye avvik er alltid åpne — bytt visning så brukeren ser det de nettopp meldte.
            setLukkede(false);
            setSide(1);
            await last();
          }}
        />
      )}
    </Layout>
  );
}

function Kpi({
  farge,
  etikett,
  verdi,
  under,
  underFarge,
}: {
  farge: string;
  etikett: string;
  verdi: number;
  under: string;
  underFarge?: string;
}) {
  return (
    <div className={`card kpi-kort k-${farge}`} style={{ padding: "16px 18px" }}>
      <div className="kpi-etikett">{etikett}</div>
      <div className="kpi-verdi">{verdi}</div>
      {under && (
        <div className="kpi-under" style={underFarge ? { color: underFarge, fontWeight: 600 } : undefined}>
          {under}
        </div>
      )}
    </div>
  );
}

function AvviksRad({
  avvik: a,
  kategori,
  onKlikk,
}: {
  avvik: Avvik;
  kategori: string | null;
  onKlikk: () => void;
}) {
  const st = STATUS_VISNING[a.status] ?? STATUS_VISNING.ny!;
  const forfalt = !!a.dueDate && a.status !== "lukket" && a.dueDate < iDag();

  return (
    <button className="avvik-rad" onClick={onKlikk}>
      <span className="avvik-nr">{a.number ? `#${String(a.number).padStart(3, "0")}` : "—"}</span>
      <span className="avvik-tittel" title={a.title}>
        {a.title}
      </span>
      <span className="avvik-celle" title={a.reportedAt}>
        {dato(a.reportedAt)}
      </span>
      {a.dueDate ? (
        <span className={`avvik-celle${forfalt ? " forfalt" : ""}`}>
          {forfalt && "⚠ "}
          {dato(a.dueDate)}
        </span>
      ) : (
        <span className="avvik-celle tom">—</span>
      )}
      <span className="avvik-celle">{a.reportedBy}</span>
      <span className={`avvik-celle${a.assignedTo ? "" : " tom"}`}>{a.assignedTo ?? "—"}</span>
      {/* Ren tekst, ikke et farget merke. Kategorien er en av åtte kolonner; et merke her
          konkurrerer med statusen om oppmerksomheten, og statusen er den som betyr noe. */}
      <span className={`avvik-celle${kategori ? "" : " tom"}`} title={kategori ?? undefined}>
        {kategori ?? "—"}
      </span>
      <span className={`avvik-status s-${a.status}`}>{st.etikett.toUpperCase()}</span>
      <span className="avvik-pil">›</span>
    </button>
  );
}

function Sider({
  side,
  sider,
  total,
  onBytt,
}: {
  side: number;
  sider: number;
  total: number;
  onBytt: (n: number) => void;
}) {
  // Første, siste og naboene til gjeldende side. Resten kollapses til «…», ellers blir
  // radet med sidetall bredere enn tabellen på et lag med noen års historikk.
  const tall: Array<number | "…"> = [];
  for (let i = 1; i <= sider; i++) {
    if (i === 1 || i === sider || Math.abs(i - side) <= 1) tall.push(i);
    else if (tall[tall.length - 1] !== "…") tall.push("…");
  }

  return (
    <div className="paginering">
      <span className="field-note">
        Viser {(side - 1) * 25 + 1}–{Math.min(side * 25, total)} av {total} avvik
      </span>
      <div style={{ display: "flex", gap: "4px" }}>
        <button className="side-knapp" onClick={() => onBytt(side - 1)} disabled={side === 1}>
          ‹
        </button>
        {tall.map((n, i) =>
          n === "…" ? (
            <span key={`e${i}`} className="field-note" style={{ padding: "5px 4px" }}>
              …
            </span>
          ) : (
            <button
              key={n}
              className={`side-knapp${n === side ? " valgt" : ""}`}
              onClick={() => onBytt(n)}
            >
              {n}
            </button>
          ),
        )}
        <button className="side-knapp" onClick={() => onBytt(side + 1)} disabled={side === sider}>
          ›
        </button>
      </div>
    </div>
  );
}

/**
 * Stedsfilteret vises bare når enhetsregisteret faktisk er tatt i bruk — en tom
 * nedtrekksliste er støy for kunder som ikke har lagt inn enheter.
 *
 * Søkbar velger, ikke en `<select>`: registeret har 84 rader her, alle med et H-nummer, og
 * i en `<select>` kan man bare hoppe med førstebokstav — som er «H» for samtlige.
 */
function Stedsfilter({
  orgId,
  verdi,
  onEndre,
}: {
  orgId: string | undefined;
  verdi: string;
  onEndre: (v: string) => void;
}) {
  const [liste, setListe] = useState<VelgbarEnhet[]>([]);
  useEffect(() => {
    if (!orgId) return;
    enheter.liste(orgId).then(setListe).catch(() => setListe([]));
  }, [orgId]);

  if (liste.length === 0) return null;
  return (
    <div style={{ minWidth: "190px" }}>
      <EnhetVelger
        verdi={verdi}
        onEndre={onEndre}
        enheter={liste}
        tomEtikett="Alle steder"
        ariaEtikett="Filtrer på sted"
      />
    </div>
  );
}

/**
 * «Meld avvik».
 *
 * Bare tittelen er påkrevd. Et avvik som ikke blir meldt fordi skjemaet var for langt, er
 * verre enn et avvik uten kategori — resten kan fylles ut på detaljsiden etterpå.
 */
function MeldAvvik({
  orgId,
  kategorier,
  onLukk,
  onMeldt,
}: {
  orgId: string;
  kategorier: Array<{ verdi: string; etikett: string; aktiv?: boolean }>;
  onLukk: () => void;
  onMeldt: () => Promise<void>;
}) {
  const [tittel, setTittel] = useState("");
  const [beskrivelse, setBeskrivelse] = useState("");
  const [kategori, setKategori] = useState("");
  const [frist, setFrist] = useState("");
  const [unitId, setUnitId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [steder, setSteder] = useState<VelgbarEnhet[]>([]);
  const [firmaer, setFirmaer] = useState<Array<{ id: string; navn: string }>>([]);
  const [oppgaveliste, setOppgaveliste] = useState<Array<{ id: string; navn: string }>>([]);

  const { sender, feil, send } = useSending(async () => {
    await onMeldt();
    onLukk();
  });

  useEffect(() => {
    // Feiler ett av oppslagene, skal skjemaet fortsatt kunne brukes — feltene er valgfrie.
    void enheter.liste(orgId).then(setSteder).catch(() => {});
    void leverandorer.liste(orgId).then((v) => setFirmaer(v.map((f) => ({ id: f.id, navn: f.name })))).catch(() => {});
    void oppgaver.liste(orgId).then((t) => setOppgaveliste(t.map((o) => ({ id: o.id, navn: o.title })))).catch(() => {});
  }, [orgId]);

  return (
    <Modal tittel="Meld nytt avvik" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(() =>
            avvik.meld(orgId, {
              title: tittel.trim(),
              description: beskrivelse.trim() || null,
              category: kategori || null,
              dueDate: frist || null,
              unitId: unitId || null,
              vendorId: vendorId || null,
              taskId: taskId || null,
            }),
          );
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt
          etikett="Tittel *"
          verdi={tittel}
          onEndre={setTittel}
          plassholder="Kort beskrivelse av avviket"
        />
        <Tekstomrade etikett="Beskrivelse" verdi={beskrivelse} onEndre={setBeskrivelse} />

        <Nedtrekk
          etikett="Kategori"
          verdi={kategori}
          onEndre={setKategori}
          valg={[
            { verdi: "", etikett: "Velg kategori …" },
            ...kategorier.filter((k) => k.aktiv !== false).map((k) => ({ verdi: k.verdi, etikett: k.etikett })),
          ]}
        />
        <Tekstfelt etikett="Frist for tiltak" type="date" verdi={frist} onEndre={setFrist} />

        {steder.length > 0 && (
          <div className="field">
            <label className="field-label">Sted</label>
            <EnhetVelger
              verdi={unitId}
              onEndre={setUnitId}
              enheter={steder}
              tomEtikett="Ingen bestemt enhet"
              ariaEtikett="Sted"
            />
            <div className="field-note">
              Et avvik i et fellesareal hører ikke til noen enhet — tomt er et gyldig svar.
            </div>
          </div>
        )}
        {firmaer.length > 0 && (
          <Nedtrekk
            etikett="Leverandør involvert"
            verdi={vendorId}
            onEndre={setVendorId}
            valg={[{ verdi: "", etikett: "Ingen leverandør" }, ...firmaer.map((f) => ({ verdi: f.id, etikett: f.navn }))]}
          />
        )}
        {oppgaveliste.length > 0 && (
          <Nedtrekk
            etikett="Knyttet til oppgave"
            verdi={taskId}
            onEndre={setTaskId}
            valg={[{ verdi: "", etikett: "Ingen / generelt" }, ...oppgaveliste.map((o) => ({ verdi: o.id, etikett: o.navn }))]}
          />
        )}

        <Knapperad onAvbryt={onLukk} sendEtikett="Meld avvik" sender={sender} deaktivert={!tittel.trim()} />
      </form>
    </Modal>
  );
}
