"use client";

import { useMemo, useState } from "react";
import { Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { useOkt } from "@/components/OktProvider";
import { Faner, Feil, Kort, Nokkeltall, Rad, Tom, dato, kr, useOrgData } from "@/components/felles";
import KontraktModal from "@/components/KontraktModal";
import { kontrakter, type Kontrakt } from "@/lib/klient";
import {
  SNART_UT_DAGER,
  erAktiv,
  kontraktKategoriEtikett,
  kontraktStatus,
  type KontraktStatusNokkel,
} from "@/lib/kontraktregler";

type StatusFilter = "alle" | Exclude<KontraktStatusNokkel, "arkiv">;

export default function Kontrakter() {
  const router = useRouter();
  const { aktivOrg } = useOkt();
  const [fane, setFane] = useState<"aktive" | "arkiverte">("aktive");
  const { data, feil, laster, last, orgId } = useOrgData(
    (o) => kontrakter.liste(o, fane === "arkiverte"),
    [fane],
  );
  const [nyKontrakt, setNyKontrakt] = useState(false);
  const [leverandor, setLeverandor] = useState("");
  const [kategori, setKategori] = useState("");
  const [status, setStatus] = useState<StatusFilter>("alle");
  const [sok, setSok] = useState("");

  const liste = useMemo(() => data ?? [], [data]);
  const kanRedigere = aktivOrg?.nivaa === "orgadmin" || aktivOrg?.nivaa === "redigering";

  // Valgene som faktisk BRUKES, ikke alt som kunne vært valgt — et filter med valg som ikke
  // treffer noe er verre enn ingen filter. Samme grep som leverandørfilteret på Oppgaver.
  const brukteLeverandorer = useMemo(() => {
    const sett = new Map<string, string>();
    for (const k of liste) if (k.vendorName) sett.set(k.vendorId, k.vendorName);
    return [...sett.entries()].sort((a, b) => a[1].localeCompare(b[1], "nb"));
  }, [liste]);

  const brukteKategorier = useMemo(() => {
    const sett = new Set<string>();
    for (const k of liste) if (k.category) sett.add(k.category);
    return [...sett]
      .map((verdi) => ({ verdi, etikett: kontraktKategoriEtikett(verdi) ?? verdi }))
      .sort((a, b) => a.etikett.localeCompare(b.etikett, "nb"));
  }, [liste]);

  // Nøkkeltallene regnes FØR filtrene: kortene beskriver porteføljen, ikke utvalget.
  const kpi = useMemo(() => {
    const aktive = liste.filter((k) => erAktiv(k));
    return {
      aktive: aktive.length,
      snartUt: liste.filter((k) => kontraktStatus(k).nokkel === "snartut").length,
      utlopte: liste.filter((k) => kontraktStatus(k).nokkel === "utlopt").length,
      innkjop: aktive.reduce((s, k) => s + (k.annualSum ?? 0), 0),
      manglerPris: aktive.filter((k) => !k.annualSum).length,
    };
  }, [liste]);

  const etterUtvalg = useMemo(() => {
    const sokestreng = sok.trim().toLowerCase();
    return liste.filter((k) => {
      if (leverandor && k.vendorId !== leverandor) return false;
      if (kategori && k.category !== kategori) return false;
      if (sokestreng) {
        const grunnlag = [k.title, k.vendorName, kontraktKategoriEtikett(k.category), k.notes]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!grunnlag.includes(sokestreng)) return false;
      }
      return true;
    });
  }, [liste, leverandor, kategori, sok]);

  const tell = (n: StatusFilter) =>
    n === "alle" ? etterUtvalg.length : etterUtvalg.filter((k) => kontraktStatus(k).nokkel === n).length;
  const vist =
    fane === "arkiverte" || status === "alle"
      ? etterUtvalg
      : etterUtvalg.filter((k) => kontraktStatus(k).nokkel === status);

  const statusFiltre: Array<{ nokkel: StatusFilter; etikett: string }> = [
    { nokkel: "alle", etikett: "Alle" },
    { nokkel: "lopende", etikett: "Løpende" },
    { nokkel: "snartut", etikett: "Snart ut" },
    { nokkel: "utlopt", etikett: "Utløpt" },
  ];

  return (
    <Layout
      tittel="Kontrakter"
      handlinger={
        kanRedigere && (
          <button className="btn btn-primary" onClick={() => setNyKontrakt(true)}>
            ＋ Ny kontrakt
          </button>
        )
      }
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={[
            { nokkel: "aktive", etikett: "Aktive" },
            { nokkel: "arkiverte", etikett: "Arkiverte" },
          ]}
        />
      }
    >
      <div className="page-content">
        <Feil melding={feil} />

        {fane === "aktive" && (
          <div className="auto-grid">
            <Nokkeltall etikett="Aktive avtaler" verdi={kpi.aktive} />
            <Nokkeltall etikett={`Utløper innen ${SNART_UT_DAGER} dager`} verdi={kpi.snartUt} />
            <Nokkeltall etikett="Utløpte" verdi={kpi.utlopte} />
            <Nokkeltall
              etikett="Innkjøp per år"
              verdi={
                <span style={{ fontSize: "var(--fs-xl)" }}>
                  {kr(kpi.innkjop)}
                  {kpi.manglerPris > 0 && (
                    <span style={{ display: "block", fontSize: "var(--fs-label)", fontWeight: 400, color: "var(--muted)" }}>
                      {kpi.manglerPris} {kpi.manglerPris === 1 ? "avtale" : "avtaler"} mangler pris
                    </span>
                  )}
                </span>
              }
            />
          </div>
        )}

        <div className="avvik-filter">
          {brukteLeverandorer.length > 1 && (
            <select
              className="input"
              aria-label="Filtrer på leverandør"
              value={leverandor}
              onChange={(e) => setLeverandor(e.target.value)}
            >
              <option value="">Alle leverandører</option>
              {brukteLeverandorer.map(([id, navn]) => (
                <option key={id} value={id}>
                  {navn}
                </option>
              ))}
            </select>
          )}
          {brukteKategorier.length > 1 && (
            <select
              className="input"
              aria-label="Filtrer på kategori"
              value={kategori}
              onChange={(e) => setKategori(e.target.value)}
            >
              <option value="">Alle kategorier</option>
              {brukteKategorier.map((k) => (
                <option key={k.verdi} value={k.verdi}>
                  {k.etikett}
                </option>
              ))}
            </select>
          )}
          {fane === "aktive" && (
            <div className="pille-gruppe" style={{ marginLeft: 0 }}>
              {statusFiltre.map((f) => (
                <button
                  key={f.nokkel}
                  className={`pille${status === f.nokkel ? " valgt" : ""}`}
                  onClick={() => setStatus(f.nokkel)}
                >
                  {f.etikett} ({tell(f.nokkel)})
                </button>
              ))}
            </div>
          )}
          <input
            className="input"
            style={{ marginLeft: "auto", maxWidth: "220px" }}
            placeholder="Søk kontrakt …"
            aria-label="Søk kontrakt"
            value={sok}
            onChange={(e) => setSok(e.target.value)}
          />
        </div>

        <Kort tittel={fane === "aktive" ? "Alle avtaler" : "Arkiverte avtaler"}>
          {laster ? (
            <Tom tekst="Henter …" />
          ) : vist.length === 0 ? (
            <Tom tekst={liste.length === 0 ? "Ingen avtaler her." : "Ingen avtaler matcher filteret."} />
          ) : (
            vist.map((k) => <KontraktRad key={k.id} k={k} onClick={() => router.push(`/kontrakter/${k.id}`)} />)
          )}
        </Kort>
      </div>

      {nyKontrakt && orgId && (
        <KontraktModal
          tittel="Ny kontrakt"
          orgId={orgId}
          sendEtikett="Opprett kontrakt"
          onLukk={() => setNyKontrakt(false)}
          onLagre={async (felter) => {
            await kontrakter.ny(orgId, felter);
            await last();
          }}
        />
      )}
    </Layout>
  );
}

function KontraktRad({ k, onClick }: { k: Kontrakt; onClick: () => void }) {
  const status = kontraktStatus(k);
  const meta = k.archivedAt
    ? [
        k.vendorName ?? "Ukjent leverandør",
        `arkivert ${dato(k.archivedAt)}${k.archiveNote ? ` — ${k.archiveNote}` : ""}`,
      ]
    : [
        k.vendorName ?? "Ukjent leverandør",
        kontraktKategoriEtikett(k.category),
        !k.startDate && !k.endDate
          ? "ingen datoer"
          : `${dato(k.startDate)} → ${k.endDate ? dato(k.endDate) : "løpende"}`,
      ];

  return (
    <Rad
      onClick={onClick}
      tittel={k.title}
      meta={meta.filter(Boolean).join(" · ")}
      hoyre={
        <>
          {k.fileName && (
            <span className="badge muted" title={k.fileOriginalName ?? undefined}>
              <Paperclip size={13} strokeWidth={2} aria-hidden />
            </span>
          )}
          {/* Opt-in per avtale — AI-rådgiveren leser bare det styret har delt. */}
          {k.aiReadable && <span className="badge info">Delt med AI</span>}
          <span style={{ fontWeight: 600, fontSize: "var(--fs-sm)" }}>
            {k.annualSum ? kr(k.annualSum) : "—"}
          </span>
          {!k.archivedAt && <span className={`badge ${status.merke}`}>{status.etikett}</span>}
        </>
      }
    />
  );
}
