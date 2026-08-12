"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import Layout from "@/components/Layout";
import { Faner, Feil, Kort, Rad, Tom, dato, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, useSending } from "@/components/skjema";
import { internkontroll, type HmsMal } from "@/lib/klient";
import { useOkt } from "@/components/OktProvider";
import { Risiko } from "./risiko";

const OMRADE: Record<string, string> = {
  brannvern: "Brannvern",
  el_sikkerhet: "El-sikkerhet",
  utearealer: "Utearealer",
};

/** § 5-punktene og om de er dekket i år. Grunnlaget for oversikten. */
function Oversikt() {
  const router = useRouter();
  const { data, feil, laster } = useOrgData((o) => internkontroll.status(o));
  const maal = useOrgData((o) => internkontroll.maal(o));

  const punkter: Array<[string, boolean]> = data
    ? [
        [`HMS-mål satt for ${data.aar}`, data.maalSatt],
        ["Ansvar fordelt på alle områder", data.ansvarFordelt],
        ["Risiko kartlagt", data.risikoKartlagt],
        ["Vernerunde gjennomført", data.vernerundeGjennomfort],
        [`Årlig evaluering for ${data.aar}`, data.evaluert],
      ]
    : [];

  return (
    <>
      <Feil melding={feil} />
      <Kort tittel="Krav i internkontrollforskriften § 5">
        {laster ? (
          <Tom tekst="Henter …" />
        ) : (
          punkter.map(([tekst, oppfylt]) => (
            <Rad
              key={tekst}
              tittel={tekst}
              hoyre={
                oppfylt ? (
                  <span className="badge ok">
                    <Check size={13} strokeWidth={2.5} aria-hidden /> Dekket
                  </span>
                ) : (
                  <span className="badge warn">
                    <X size={13} strokeWidth={2.5} aria-hidden /> Mangler
                  </span>
                )
              }
            />
          ))
        )}
      </Kort>

      <Kort tittel="HMS-mål">
        {maal.laster ? (
          <Tom tekst="Henter …" />
        ) : (maal.data ?? []).length === 0 ? (
          <Tom tekst="Ingen HMS-mål satt. Ett mål per år." />
        ) : (
          (maal.data ?? []).map((m) => (
            <Rad
              key={m.id}
              onClick={() => router.push(`/internkontroll/maal/${m.id}`)}
              tittel={`${m.year} — ${m.goalText}`}
              hoyre={
                <span className={`badge ${m.approved ? "ok" : "muted"}`}>
                  {m.approved ? "Godkjent" : "Ikke godkjent"}
                </span>
              }
            />
          ))
        )}
      </Kort>
    </>
  );
}

function Vernerunder() {
  const router = useRouter();
  const { data, feil, laster, last, orgId } = useOrgData((o) => internkontroll.runder(o));
  const [nyRunde, setNyRunde] = useState(false);
  const liste = data ?? [];

  return (
    <>
      <Feil melding={feil} />
      <Kort
        tittel="Vernerunder"
        handling={
          <button className="btn btn-ghost" onClick={() => setNyRunde(true)}>
            ＋ Ny vernerunde
          </button>
        }
      >
        {laster ? (
          <Tom tekst="Henter …" />
        ) : liste.length === 0 ? (
          <Tom tekst="Ingen vernerunder ennå. Den første opprettes fra en HMS-mal — deretter kopierer hver runde lagets egen punktliste." />
        ) : (
          liste.map((r) => (
            <Rad
              key={r.id}
              onClick={() => router.push(`/internkontroll/vernerunde/${r.id}`)}
              tittel={r.title}
              meta={[
                r.roundDate && `startet ${dato(r.roundDate)}`,
                r.dueDate && r.status !== "completed" && `frist ${dato(r.dueDate)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
              hoyre={
                // En fullført runde er låst — den dokumenterer hva som ble observert den dagen.
                <span className={`badge ${r.status === "completed" ? "ok" : "muted"}`}>
                  {r.status === "completed" ? "Fullført og låst" : "Planlagt"}
                </span>
              }
            />
          ))
        )}
      </Kort>

      {nyRunde && orgId && (
        <NyRundeModal
          orgId={orgId}
          forsteRunde={liste.length === 0}
          onLukk={() => setNyRunde(false)}
          onOpprettet={async (id) => {
            await last();
            router.push(`/internkontroll/vernerunde/${id}`);
          }}
        />
      )}
    </>
  );
}

/**
 * Ny vernerunde. Første gang velges HMS-malen som gir sjekklista; senere runder kopierer
 * lagets forrige punktliste — tilpasningene deres blir med videre av seg selv.
 */
function NyRundeModal({
  orgId,
  forsteRunde,
  onLukk,
  onOpprettet,
}: {
  orgId: string;
  forsteRunde: boolean;
  onLukk: () => void;
  onOpprettet: (id: string) => Promise<void>;
}) {
  const { aktivOrg } = useOkt();
  const halvaar = new Date().getMonth() < 6 ? "vår" : "høst";
  const [tittel, setTittel] = useState(`Vernerunde ${halvaar} ${new Date().getFullYear()}`);
  const [rundeDato, setRundeDato] = useState(new Date().toISOString().slice(0, 10));
  // Bransjepraksis: innen 1. juni og 1. desember.
  const [frist, setFrist] = useState(
    `${new Date().getFullYear()}-${new Date().getMonth() < 6 ? "06-01" : "12-01"}`,
  );
  const [maler, setMaler] = useState<HmsMal[] | null>(null);
  const [malId, setMalId] = useState("");
  const { sender, feil, send } = useSending(() => {});

  useEffect(() => {
    if (!forsteRunde) return;
    internkontroll
      .maler(orgId, "vernerunde")
      .then((m) => {
        setMaler(m);
        setMalId(m.find((x) => x.isDefault)?.id ?? m[0]?.id ?? "");
      })
      .catch(() => setMaler([]));
  }, [orgId, forsteRunde]);

  return (
    <Modal tittel="Ny vernerunde" onLukk={onLukk} bredde={480}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(async () => {
            const ny = await internkontroll.nyRunde(orgId, {
              title: tittel.trim(),
              roundDate: rundeDato || null,
              dueDate: frist || null,
              templateId: forsteRunde ? malId || null : null,
            });
            await onOpprettet(ny.id);
          });
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <Feil melding={feil} />
        <Tekstfelt etikett="Navn *" verdi={tittel} onEndre={setTittel} />
        <div className="field-row">
          <Tekstfelt etikett="Startdato" type="date" verdi={rundeDato} onEndre={setRundeDato} />
          <Tekstfelt
            etikett="Frist"
            type="date"
            verdi={frist}
            onEndre={setFrist}
            notat="Bransjepraksis: innen 1. juni og 1. desember."
          />
        </div>

        {forsteRunde ? (
          maler === null ? (
            <Tom tekst="Henter maler …" />
          ) : maler.length === 0 ? (
            <div className="field-note">
              Ingen vernerundemal er lagt inn i plattformpanelet — runden starter uten
              punkter, og dere legger til egne.
            </div>
          ) : (
            <Nedtrekk
              etikett="Sjekkliste fra mal"
              verdi={malId}
              onEndre={setMalId}
              valg={maler.map((m) => ({ verdi: m.id, etikett: m.isDefault ? `${m.name} (standard)` : m.name }))}
              notat="Punktene kopieres inn og blir lagets egne — legg til og fjern fritt. Senere runder kopierer lagets liste."
            />
          )
        ) : (
          <div className="field-note">
            Sjekklista kopieres fra forrige runde — tilpasningene deres er med videre.
            {aktivOrg ? ` Runden gjelder ${aktivOrg.name}.` : ""}
          </div>
        )}

        <Knapperad onAvbryt={onLukk} sendEtikett="Opprett runde" sender={sender} deaktivert={!tittel.trim()} />
      </form>
    </Modal>
  );
}

function Ansvar() {
  const { data, feil, laster } = useOrgData((o) => internkontroll.ansvar(o));
  const liste = data ?? [];

  return (
    <>
      <Feil melding={feil} />
      <Kort tittel="Ansvarsfordeling (§ 5 pkt. 5)">
        {laster ? (
          <Tom tekst="Henter …" />
        ) : (
          // Alle områdene vises, også de tomme — et manglende område er nettopp det
          // kunden skal se at mangler.
          liste.map((a) => (
            <Rad
              key={a.area}
              tittel={OMRADE[a.area] ?? a.area}
              meta={a.note ?? undefined}
              hoyre={
                a.personName ? (
                  <span className="badge ok">{a.personName}</span>
                ) : (
                  <span className="badge warn">Ikke fordelt</span>
                )
              }
            />
          ))
        )}
      </Kort>
    </>
  );
}

export default function Internkontroll() {
  const [fane, setFane] = useState<"oversikt" | "risiko" | "runder" | "ansvar">("oversikt");
  return (
    <Layout
      tittel="Internkontroll"
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={[
            { nokkel: "oversikt", etikett: "Oversikt" },
            { nokkel: "risiko", etikett: "Risikovurdering" },
            { nokkel: "runder", etikett: "Vernerunder" },
            { nokkel: "ansvar", etikett: "Ansvar" },
          ]}
        />
      }
    >
      <div className="page-content">
        {fane === "oversikt" && <Oversikt />}
        {fane === "risiko" && <Risiko />}
        {fane === "runder" && <Vernerunder />}
        {fane === "ansvar" && <Ansvar />}
      </div>
    </Layout>
  );
}
