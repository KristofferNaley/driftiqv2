"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarDays, FileText, GripVertical } from "lucide-react";
import { Feil, Kort, Rad, Tom, dato } from "@/components/felles";
import {
  Avkryssing,
  Felt as Skjemafelt,
  Knapperad,
  Modal,
  Nedtrekk,
  Tekstfelt,
  Tekstomrade,
  useSending,
} from "@/components/skjema";
import { oppslagstavle, type Oppslag, type Skjerm, type Tavlehendelse } from "@/lib/klient";
import {
  KATEGORI_BESKRIVELSE,
  KATEGORI_ETIKETT,
  KATEGORIER,
  STANDARD_SEKUNDER,
  STATUS_ETIKETT,
  VISNINGSTIDER,
  osloIDag,
  type Kategori,
} from "@/lib/oppslagstavleregler";
import { Bekreft } from "./felles";

/**
 * Innhold-fanen: det daglige. Oppslag og kalender, ingenting om hvor på skjermen det står —
 * det hører til skjermoppsettet.
 */

const STATUSFARGE = { na: "ok", planlagt: "info", utlopt: "muted" } as const;

/** Miniatyr for bilder, ellers et ikon etter typen. */
function Radikon({ orgId, p }: { orgId: string; p: Oppslag }) {
  if (p.kind === "bilde") return <img className="ot-radikon" src={oppslagstavle.bildeSti(orgId, p.id)} alt="" />;
  const Ikon = p.category === "viktig" ? AlertTriangle : p.category === "arrangement" ? CalendarDays : FileText;
  return (
    <span className={`ot-radikon ${p.category ?? "info"}`} aria-hidden>
      <Ikon size={16} />
    </span>
  );
}

export function Innhold({
  orgId,
  oppslag,
  hendelser,
  skjermer,
  kanRedigere,
  valgtOppslag,
  onEndret,
  onVelgOppslag,
  onVelgHendelse,
}: {
  orgId: string;
  oppslag: Oppslag[];
  hendelser: Tavlehendelse[];
  skjermer: Skjerm[];
  kanRedigere: boolean;
  /** Oppslaget forhåndsvisningen står på. */
  valgtOppslag: string | null;
  onEndret: () => void;
  onVelgOppslag: (p: Oppslag) => void;
  onVelgHendelse: (h: Tavlehendelse) => void;
}) {
  const [visUtlopte, setVisUtlopte] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [drar, setDrar] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // Rekkefølgen vises med en gang raden slippes; serveren bekrefter etterpå.
  const [lokal, setLokal] = useState<string[] | null>(null);
  useEffect(() => setLokal(null), [oppslag]);

  const navn = new Map(skjermer.map((s) => [s.id, s.navn]));
  const aktiveRaa = oppslag.filter((p) => p.status !== "utlopt");
  const aktive = lokal ? lokal.flatMap((id) => aktiveRaa.find((p) => p.id === id) ?? []) : aktiveRaa;
  const utlopte = oppslag.filter((p) => p.status === "utlopt");

  function slipp(maal: string) {
    const fra = aktive.findIndex((p) => p.id === drar);
    const til = aktive.findIndex((p) => p.id === maal);
    setDrar(null);
    setOver(null);
    if (fra < 0 || til < 0 || fra === til) return;
    const ider = aktive.map((p) => p.id);
    ider.splice(til, 0, ider.splice(fra, 1)[0]!);
    setLokal(ider);
    setFeil(null);
    oppslagstavle
      .settRekkefolge(orgId, ider)
      .then(onEndret)
      .catch((e: unknown) => {
        setLokal(null);
        setFeil(e instanceof Error ? e.message : "Kunne ikke lagre rekkefølgen");
      });
  }

  const rad = (p: Oppslag, kanDras: boolean) => (
    <div
      key={p.id}
      className={`list-item ot-oppslagrad${valgtOppslag === p.id ? " valgt" : ""}${drar === p.id ? " dras" : ""}${over === p.id && drar !== p.id ? " over" : ""}`}
      draggable={kanDras}
      onDragStart={(e) => {
        setDrar(p.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!drar || !kanDras) return;
        e.preventDefault();
        setOver(p.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (kanDras) slipp(p.id);
      }}
      onDragEnd={() => {
        setDrar(null);
        setOver(null);
      }}
      onClick={() => onVelgOppslag(p)}
    >
      {kanDras && <GripVertical size={14} className="ot-grep" aria-hidden />}
      <Radikon orgId={orgId} p={p} />
      <div className="ot-oppslagrad-tekst">
        <div className="list-tittel">{p.title}</div>
        <div className="list-meta">
          {[
            p.kind === "bilde" ? "Bilde" : KATEGORI_ETIKETT[p.category ?? "info"],
            `${dato(p.showFrom)} til ${dato(p.showUntil)}`,
            !p.allScreens && p.screenIds.map((id) => navn.get(id) ?? "Fjernet skjerm").join(", "),
            p.displaySeconds !== STANDARD_SEKUNDER && `${p.displaySeconds} sek`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <span className={`badge ${STATUSFARGE[p.status]}`}>{STATUS_ETIKETT[p.status]}</span>
    </div>
  );

  return (
    <>
      <Feil melding={feil} />
      <Kort tittel="Oppslag">
        {aktive.length === 0 && (
          <Tom tekst={oppslag.length === 0 ? "Ingen oppslag ennå. Trykk «Nytt innhold» for å legge ut noe." : "Ingen aktive oppslag."} />
        )}
        {aktive.map((p) => rad(p, kanRedigere && aktive.length > 1))}
        {aktive.length > 1 && kanRedigere && (
          <div className="ot-listefot field-note">Dra radene for å endre rekkefølgen oppslagene vises i.</div>
        )}
        {utlopte.length > 0 && (
          <div className="ot-listefot">
            <button type="button" className="ot-lenke" onClick={() => setVisUtlopte((v) => !v)}>
              {visUtlopte ? "Skjul utløpte" : `Vis ${utlopte.length} ${utlopte.length === 1 ? "utløpt" : "utløpte"}`}
            </button>
          </div>
        )}
        {visUtlopte && utlopte.map((p) => rad(p, false))}
      </Kort>

      <Kort tittel="Kalender">
        {hendelser.length === 0 && <Tom tekst="Ingen kommende hendelser." />}
        {hendelser.map((h) => (
          <Rad
            key={h.id}
            tittel={h.title}
            meta={[dato(h.eventDate), h.eventTime && `kl. ${h.eventTime}`, h.place].filter(Boolean).join(" · ")}
            onClick={kanRedigere ? () => onVelgHendelse(h) : undefined}
          />
        ))}
      </Kort>
    </>
  );
}

type Innholdstype = "tekst" | "bilde" | "hendelse";

/**
 * Nytt innhold, eller redigering av et oppslag eller en kalenderhendelse. Ved redigering
 * står typen fast (et nytt bilde er et nytt oppslag), og sletting ligger her.
 */
export function OppslagSkjema({
  orgId,
  skjermer,
  eksisterende: e,
  hendelse: h,
  onLukk,
  onLagret,
}: {
  orgId: string;
  skjermer: Skjerm[];
  eksisterende: Oppslag | null;
  hendelse: Tavlehendelse | null;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const iDag = osloIDag();
  const omToUker = osloIDag(new Date(Date.now() + 14 * 86_400_000));
  const [type, setType] = useState<Innholdstype>(h ? "hendelse" : (e?.kind ?? "tekst"));
  const [tittel, setTittel] = useState(h?.title ?? e?.title ?? "");
  const [tekst, setTekst] = useState(e?.body ?? "");
  const [kategori, setKategori] = useState<Kategori>(e?.category ?? "info");
  const [fil, setFil] = useState<File | null>(null);
  const [fra, setFra] = useState(e?.showFrom ?? iDag);
  const [til, setTil] = useState(e?.showUntil ?? omToUker);
  const [alle, setAlle] = useState(e?.allScreens ?? true);
  const [utvalg, setUtvalg] = useState<string[]>(e?.screenIds ?? []);
  const [sekunder, setSekunder] = useState(e?.displaySeconds ?? STANDARD_SEKUNDER);
  const [hDato, setHDato] = useState(h?.eventDate ?? iDag);
  const [hTid, setHTid] = useState(h?.eventTime ?? "");
  const [hSted, setHSted] = useState(h?.place ?? "");
  const [sletter, setSletter] = useState(false);
  const { sender, feil, send } = useSending(onLagret);
  const redigerer = Boolean(e || h);

  function lagre(ev: React.FormEvent) {
    ev.preventDefault();
    const periode = { fra, til, alleSkjermer: alle, skjermIder: alle ? [] : utvalg, sekunder };
    void send(async () => {
      if (type === "hendelse") {
        const d = { tittel, dato: hDato, tid: hTid || null, sted: hSted || null };
        return h ? oppslagstavle.endreHendelse(orgId, h.id, d) : oppslagstavle.nyHendelse(orgId, d);
      }
      if (e) return oppslagstavle.endreOppslag(orgId, e.id, { tittel, tekst: tekst || null, kategori, ...periode });
      if (type === "bilde") {
        if (!fil) throw new Error("Velg et bilde");
        return oppslagstavle.nyttBildeoppslag(orgId, { tittel, ...periode }, fil);
      }
      return oppslagstavle.nyttTekstoppslag(orgId, { tittel, tekst: tekst || null, kategori, ...periode });
    });
  }

  return (
    <Modal tittel={h ? "Endre hendelse" : e ? "Endre oppslag" : "Nytt innhold"} onLukk={onLukk} bredde={720}>
      {!redigerer && (
        <div className="ot-typer">
          {(
            [
              ["tekst", "Tekst", "Oppslag med overskrift og tekst"],
              ["bilde", "Bilde", "JPG, PNG eller WebP med bildetekst"],
              ["hendelse", "Kalender", "Hendelse i kalenderfeltet"],
            ] as const
          ).map(([n, t, b]) => (
            <button type="button" key={n} className={`ot-type${type === n ? " valgt" : ""}`} onClick={() => setType(n)}>
              <b>{t}</b>
              <span>{b}</span>
            </button>
          ))}
        </div>
      )}
      <form onSubmit={lagre} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {type === "hendelse" ? (
          <>
            <Tekstfelt etikett="Hva" verdi={tittel} onEndre={setTittel} plassholder="Åpent styremøte" />
            <div className="ot-to">
              <Tekstfelt etikett="Dato" type="date" verdi={hDato} onEndre={setHDato} />
              <Tekstfelt etikett="Klokkeslett" type="time" verdi={hTid} onEndre={setHTid} notat="Valgfritt" />
            </div>
            <Tekstfelt etikett="Hvor" verdi={hSted} onEndre={setHSted} plassholder="Fellesrommet" />
          </>
        ) : (
          <>
            {type === "bilde" && !e && (
              <Skjemafelt etikett="Bilde" notat="Liggende bilder passer best. Maks 10 MB.">
                <input
                  className="input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(ev) => setFil(ev.target.files?.[0] ?? null)}
                />
              </Skjemafelt>
            )}
            <Tekstfelt
              etikett={type === "bilde" ? "Bildetekst" : "Overskrift"}
              verdi={tittel}
              onEndre={setTittel}
              plassholder={type === "bilde" ? "Nytt uteområde er ferdig" : "Vannet stenges torsdag"}
            />
            {type === "tekst" && (
              <>
                <Tekstomrade
                  etikett="Tekst"
                  verdi={tekst}
                  onEndre={setTekst}
                  rader={5}
                  notat={`${tekst.length}/400 tegn. Kort er best, det leses i forbifarten. Teksten skaleres så den fyller feltet.`}
                />
                <Nedtrekk
                  etikett="Type"
                  verdi={kategori}
                  onEndre={(v) => setKategori(v as Kategori)}
                  valg={KATEGORIER.map((k) => ({ verdi: k, etikett: KATEGORI_ETIKETT[k] }))}
                  notat={`${KATEGORI_BESKRIVELSE[kategori]} Typen endrer bare merkelappen og fargen.`}
                />
              </>
            )}
            <div className="ot-to">
              <Tekstfelt etikett="Vis fra" type="date" verdi={fra} onEndre={setFra} />
              <Tekstfelt etikett="Til og med" type="date" verdi={til} onEndre={setTil} />
            </div>
            <Nedtrekk
              etikett="Visningstid"
              verdi={String(sekunder)}
              onEndre={(v) => setSekunder(Number(v))}
              valg={VISNINGSTIDER.map((n) => ({
                verdi: String(n),
                etikett: `${n} sekunder${n === STANDARD_SEKUNDER ? " (standard)" : ""}`,
              }))}
              notat="Hvor lenge oppslaget står før skjermen går videre til neste."
            />
            <Avkryssing
              etikett="Vis på alle skjermer"
              verdi={alle}
              onEndre={setAlle}
              notat="Gjelder også skjermer som kobles til senere."
            />
            {!alle && (
              <div className="ot-filter">
                {skjermer.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={`ot-chip${utvalg.includes(s.id) ? " valgt" : ""}`}
                    onClick={() => setUtvalg((u) => (u.includes(s.id) ? u.filter((x) => x !== s.id) : [...u, s.id]))}
                  >
                    {s.navn}
                  </button>
                ))}
                {skjermer.length === 0 && <span className="field-note">Ingen skjermer er koblet til ennå.</span>}
              </div>
            )}
          </>
        )}
        <Feil melding={feil} />
        <div className="ot-skjemafot">
          {redigerer ? (
            <button type="button" className="btn btn-ghost" onClick={() => setSletter(true)}>
              Slett
            </button>
          ) : (
            <span />
          )}
          <Knapperad
            onAvbryt={onLukk}
            sender={sender}
            sendEtikett={redigerer ? "Lagre" : type === "hendelse" ? "Legg i kalenderen" : "Legg ut"}
          />
        </div>
      </form>
      {sletter && (
        <Bekreft
          tittel={`Slette «${h?.title ?? e?.title}»?`}
          etikett="Slett"
          sender={sender}
          onAvbryt={() => setSletter(false)}
          onBekreft={() =>
            void send(() => (h ? oppslagstavle.slettHendelse(orgId, h.id) : oppslagstavle.slettOppslag(orgId, e!.id)))
          }
        >
          {h ? "Hendelsen forsvinner fra kalenderen på skjermene." : "Oppslaget forsvinner fra skjermene med en gang."}
        </Bekreft>
      )}
    </Modal>
  );
}
