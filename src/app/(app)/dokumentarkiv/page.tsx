"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import Layout from "@/components/Layout";
import { Feil, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { dokumenter } from "@/lib/klient";

/** De seks faste mappene. Kundens egne mapper kommer i tillegg fra API-et. */
const FASTE: Array<[string, string]> = [
  ["vedtekter", "Vedtekter"],
  ["generalforsamling", "Generalforsamling"],
  ["styrereferater", "Styrereferater"],
  ["bygningsdok", "Bygningsdokumentasjon"],
  ["forsikring", "Forsikring"],
  ["annet", "Annet"],
];

const kb = (n: number | null) => (n ? `${Math.round(n / 1024)} kB` : "");

export default function Dokumentarkiv() {
  const [mappe, setMappe] = useState<string | null>(null);
  const { data, feil, setFeil, laster, last, orgId } = useOrgData(
    (o) => dokumenter.liste(o, mappe ?? undefined),
    [mappe],
  );
  const liste = data ?? [];

  async function lastOpp(e: React.ChangeEvent<HTMLInputElement>) {
    const fil = e.target.files?.[0];
    if (!fil || !orgId) return;
    const form = new FormData();
    form.append("file", fil);
    form.append("title", fil.name);
    if (mappe) form.append("folder", mappe);
    try {
      await dokumenter.lastOpp(orgId, form);
      await last();
    } catch (err) {
      // Kvote (413) og filtype (400) kommer hit med API-ets egen norske melding.
      setFeil(err instanceof Error ? err.message : "Opplasting feilet");
    } finally {
      e.target.value = "";
    }
  }

  return (
    <Layout
      tittel="Dokumentarkiv"
      handlinger={
        <label className="btn btn-primary" style={{ cursor: "pointer" }}>
          <Upload size={16} strokeWidth={2} aria-hidden />
          Last opp
          <input type="file" hidden onChange={lastOpp} />
        </label>
      }
    >
      <div className="page-content">
        <Feil melding={feil} />

        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button
            className={`badge ${mappe === null ? "info" : "muted"}`}
            style={{ border: "none", cursor: "pointer" }}
            onClick={() => setMappe(null)}
          >
            Alle
          </button>
          {FASTE.map(([nokkel, etikett]) => (
            <button
              key={nokkel}
              className={`badge ${mappe === nokkel ? "info" : "muted"}`}
              style={{ border: "none", cursor: "pointer" }}
              onClick={() => setMappe(nokkel)}
            >
              {etikett}
            </button>
          ))}
        </div>

        <Kort tittel={mappe ? (FASTE.find(([k]) => k === mappe)?.[1] ?? mappe) : "Alle dokumenter"}>
          {laster ? (
            <Tom tekst="Henter …" />
          ) : liste.length === 0 ? (
            <Tom tekst="Ingen dokumenter i denne mappen." />
          ) : (
            liste.map((d) => (
              <Rad
                key={d.id}
                tittel={d.title}
                meta={[dato(d.documentDate), d.originalName, kb(d.fileSize)].filter(Boolean).join(" · ")}
                hoyre={d.aiReadable ? <span className="badge info">Delt med AI</span> : null}
              />
            ))
          )}
        </Kort>
      </div>
    </Layout>
  );
}
