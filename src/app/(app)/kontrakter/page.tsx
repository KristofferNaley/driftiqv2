"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Faner, Feil, Kort, Nokkeltall, Rad, Tom, dato, kr, useOrgData } from "@/components/felles";
import { kontrakter } from "@/lib/klient";

const iDag = () => new Date().toISOString().slice(0, 10);

export default function Kontrakter() {
  const router = useRouter();
  const [fane, setFane] = useState<"aktive" | "arkiverte">("aktive");
  const { data, feil, laster } = useOrgData(
    (o) => kontrakter.liste(o, fane === "arkiverte"),
    [fane],
  );
  const liste = data ?? [];
  // Utløpt, men ikke arkivert: «åpen til den lukkes», som Oppgaver og Avvik.
  const utlopte = liste.filter((k) => k.endDate && k.endDate < iDag());

  return (
    <Layout
      tittel="Kontrakter"
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
            <Nokkeltall etikett="Avtaler" verdi={liste.length} />
            <Nokkeltall etikett="Utløpte" verdi={utlopte.length} />
            <Nokkeltall
              etikett="Årlig sum"
              verdi={
                <span style={{ fontSize: "var(--fs-xl)" }}>
                  {kr(liste.reduce((s, k) => s + (k.annualSum ?? 0), 0))}
                </span>
              }
            />
          </div>
        )}

        {utlopte.length > 0 && fane === "aktive" && (
          <Kort tittel={`Utløpte avtaler (${utlopte.length})`}>
            {utlopte.map((k) => (
              <Rad
                key={k.id}
                onClick={() => router.push(`/kontrakter/${k.id}`)}
                tittel={k.title}
                meta={`${k.vendorName ?? "Ukjent leverandør"} · utløp ${dato(k.endDate)}`}
                hoyre={<span className="badge warn">Utløpt</span>}
              />
            ))}
          </Kort>
        )}

        <Kort tittel={fane === "aktive" ? "Alle avtaler" : "Arkiverte avtaler"}>
          {laster ? (
            <Tom tekst="Henter …" />
          ) : liste.length === 0 ? (
            <Tom tekst="Ingen avtaler her." />
          ) : (
            liste.map((k) => (
              <Rad
                key={k.id}
                onClick={() => router.push(`/kontrakter/${k.id}`)}
                tittel={k.title}
                meta={[k.vendorName, k.category, kr(k.annualSum), k.endDate ? `til ${dato(k.endDate)}` : "løpende"]
                  .filter(Boolean)
                  .join(" · ")}
                hoyre={
                  <>
                    {k.fileName && (
                      <span className="badge muted" title={k.fileOriginalName ?? undefined}>
                        <Paperclip size={13} strokeWidth={2} aria-hidden />
                        Dokument
                      </span>
                    )}
                    {/* Opt-in per avtale — AI-rådgiveren leser bare det styret har delt. */}
                    {k.aiReadable && <span className="badge info">Delt med AI</span>}
                  </>
                }
              />
            ))
          )}
        </Kort>
      </div>
    </Layout>
  );
}
