"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import Layout from "@/components/Layout";
import { Faner, Feil, Kort, Rad, Tom, dato, initialer, siden, useOrgData } from "@/components/felles";
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
import { useOkt } from "@/components/OktProvider";
import { Tavleskjerm } from "@/components/Tavleskjerm";
import { BirKort } from "./BirKort";
import { BLOKKTYPE_NAVN, BlokkListe, BlokkSkjema } from "./Blokker";
import { SoneOppsett } from "./SoneOppsett";
import {
  bir,
  oppslagstavle,
  tavleblokker,
  type Oppslag,
  type Skjerm,
  type Tavleblokk,
  type Tavlekontakt,
  type Tavleutseende,
} from "@/lib/klient";
import { INNEBYGDE_BLOKKER, INNEBYGD_NAVN } from "@/lib/tavlemaler";
import {
  FORVALG,
  KATEGORI_BESKRIVELSE,
  KATEGORI_ETIKETT,
  KATEGORIER,
  RETNING_ETIKETT,
  RETNINGER,
  SKALERINGER,
  STANDARD_SEKUNDER,
  STANDARD_SKALERING,
  STATUS_ETIKETT,
  VISNINGSTIDER,
  osloIDag,
  type Kategori,
  type Retning,
  type Status,
} from "@/lib/oppslagstavleregler";

/**
 * Oppslagstavla — det styret legger ut her, vises på skjermene i bygget innen ett minutt.
 *
 * To faner: Innhold (oppslag, kalender, vær, avganger, tømmedager og kontaktpersoner — alt
 * som skal VISES) og Skjermer (kobling, mal og soner per skjerm, utseende — HVOR det vises,
 * for orgadmin). Forhåndsvisningen står til høyre på begge og er den samme komponenten som
 * skjermen på veggen tegner, med de samme dataene fra serveren.
 */
type Fane = "innhold" | "skjermer";

export default function Oppslagstavle() {
  const { aktivOrg } = useOkt();
  const kanRedigere = aktivOrg?.nivaa === "orgadmin" || aktivOrg?.nivaa === "redigering";
  const erAdmin = aktivOrg?.nivaa === "orgadmin";

  const [fane, setFane] = useState<Fane>("innhold");
  const { data, feil, last, orgId } = useOrgData((o) =>
    Promise.all([
      oppslagstavle.oppslag(o),
      oppslagstavle.hendelser(o),
      oppslagstavle.skjermer(o),
      oppslagstavle.utseende(o),
      oppslagstavle.kontakter(o),
      tavleblokker.liste(o),
      bir.status(o),
    ]),
  );
  const [oppslag, hendelser, skjermer, utseende, kontakter, blokker, birStatus] = data ?? [[], [], [], null, [], [], null];
  // Det som kan plasseres i en sone: de innebygde blokkene og orgens egne.
  const plasserbare = [
    ...INNEBYGDE_BLOKKER.map((n) => ({
      nokkel: n as string,
      navn: INNEBYGD_NAVN[n],
      merknad: n === "tommedager" && !birStatus ? "Ikke koblet til BIR — vises ikke før det er gjort" : undefined,
    })),
    ...blokker.map((b) => ({ nokkel: b.nokkel, navn: `${BLOKKTYPE_NAVN[b.type]}: ${b.navn}` })),
  ];

  const [valgtSkjerm, setValgtSkjerm] = useState<string | null>(null);
  const skjerm = skjermer.find((s) => s.id === valgtSkjerm) ?? skjermer[0] ?? null;
  // Forhåndsvisningen hentes på nytt etter hver endring — `versjon` er utløseren.
  const [versjon, setVersjon] = useState(0);
  const oppdater = () => {
    void last();
    setVersjon((v) => v + 1);
  };

  /** «nytt» = tomt skjema; et oppslag = redigering av det. */
  const [redigerer, setRedigerer] = useState<Oppslag | "nytt" | null>(null);
  const [kobler, setKobler] = useState(false);
  const [blokkRedigering, setBlokkRedigering] = useState<Tavleblokk | null>(null);

  return (
    <Layout
      tittel="Oppslagstavle"
      subnav={
        <Faner
          valgt={fane}
          onVelg={setFane}
          faner={[
            { nokkel: "innhold", etikett: "Innhold" },
            { nokkel: "skjermer", etikett: "Skjermer og utseende" },
          ]}
        />
      }
      handlinger={
        fane === "innhold"
          ? kanRedigere && (
              <button className="btn btn-primary" onClick={() => setRedigerer("nytt")}>
                <Plus size={16} strokeWidth={2} aria-hidden />
                Nytt innhold
              </button>
            )
          : erAdmin && (
              <button className="btn btn-primary" onClick={() => setKobler(true)}>
                <Plus size={16} strokeWidth={2} aria-hidden />
                Koble til skjerm
              </button>
            )
      }
    >
      <div className="page-content">
        <Feil melding={feil} />
        <div className={`ot-oppsett${skjerm?.retning === "liggende" ? " liggende" : ""}`}>
          <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
            {fane === "innhold" ? (
              <>
              <Innhold
                orgId={orgId}
                oppslag={oppslag}
                hendelser={hendelser}
                skjermer={skjermer}
                kanRedigere={kanRedigere}
                onEndret={oppdater}
                onRediger={setRedigerer}
              />
              {orgId && (
                <BlokkListe
                  orgId={orgId}
                  blokker={blokker}
                  kanRedigere={kanRedigere}
                  onRediger={setBlokkRedigering}
                  onEndret={oppdater}
                />
              )}
              <BirKort erAdmin={kanRedigere} onEndret={oppdater} />
              {orgId && <Kontaktpersoner orgId={orgId} kontakter={kontakter} erAdmin={erAdmin} onEndret={oppdater} />}
              </>
            ) : (
              <Skjermer
                orgId={orgId}
                skjermer={skjermer}
                valgt={skjerm}
                onVelg={setValgtSkjerm}
                utseende={utseende}
                plasserbare={plasserbare}
                erAdmin={erAdmin}
                onEndret={oppdater}
              />
            )}
          </div>
          <Forhandsvisning
            orgId={orgId}
            skjermer={skjermer}
            skjerm={skjerm}
            onVelg={setValgtSkjerm}
            versjon={versjon}
            harLogo={utseende?.harLogo ?? false}
          />
        </div>
      </div>

      {redigerer && orgId && (
        <OppslagSkjema
          orgId={orgId}
          skjermer={skjermer}
          eksisterende={redigerer === "nytt" ? null : redigerer}
          onLukk={() => setRedigerer(null)}
          onLagret={() => {
            setRedigerer(null);
            oppdater();
          }}
        />
      )}
      {blokkRedigering && orgId && (
        <Modal
          tittel={`Endre ${BLOKKTYPE_NAVN[blokkRedigering.type].toLowerCase()}`}
          onLukk={() => setBlokkRedigering(null)}
          bredde={720}
        >
          <BlokkSkjema
            orgId={orgId}
            type={blokkRedigering.type}
            eksisterende={blokkRedigering}
            onAvbryt={() => setBlokkRedigering(null)}
            onLagret={() => {
              setBlokkRedigering(null);
              oppdater();
            }}
          />
        </Modal>
      )}
      {kobler && orgId && (
        <KobleSkjerm
          orgId={orgId}
          nummer={skjermer.length + 1}
          onLukk={() => setKobler(false)}
          onKoblet={(s) => {
            setKobler(false);
            setValgtSkjerm(s.id);
            oppdater();
          }}
        />
      )}
    </Layout>
  );
}

// ---------------------------------------------------------------------------------------
// Innhold
// ---------------------------------------------------------------------------------------

function Innhold({
  orgId,
  oppslag,
  hendelser,
  skjermer,
  kanRedigere,
  onEndret,
  onRediger,
}: {
  orgId: string | undefined;
  onRediger: (p: Oppslag) => void;
  oppslag: Oppslag[];
  hendelser: Awaited<ReturnType<typeof oppslagstavle.hendelser>>;
  skjermer: Skjerm[];
  kanRedigere: boolean;
  onEndret: () => void;
}) {
  const [filter, setFilter] = useState<Status | "alle">("alle");
  const [feil, setFeil] = useState<string | null>(null);
  const synlige = oppslag.filter((p) => filter === "alle" || p.status === filter);
  const navn = new Map(skjermer.map((s) => [s.id, s.navn]));

  async function slett(handling: () => Promise<unknown>) {
    setFeil(null);
    try {
      await handling();
      onEndret();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke slette");
    }
  }

  return (
    <>
      <Feil melding={feil} />
      <Kort
        tittel="Oppslag"
        handling={
          <div className="ot-filter">
            {(["alle", "na", "planlagt", "utlopt"] as const).map((f) => (
              <button key={f} className={`ot-chip${filter === f ? " valgt" : ""}`} onClick={() => setFilter(f)}>
                {f === "alle" ? "Alle" : STATUS_ETIKETT[f]}
              </button>
            ))}
          </div>
        }
      >
        {synlige.length === 0 && (
          <Tom tekst={oppslag.length === 0 ? "Ingen oppslag ennå. Trykk «Nytt innhold» for å legge ut noe." : "Ingen oppslag her."} />
        )}
        {synlige.map((p) => (
          <Rad
            key={p.id}
            tittel={p.title}
            meta={[
              p.kind === "bilde" ? "Bilde" : KATEGORI_ETIKETT[p.category ?? "info"],
              `${dato(p.showFrom)} – ${dato(p.showUntil)}`,
              p.allScreens ? "Alle skjermer" : p.screenIds.map((id) => navn.get(id) ?? "Fjernet skjerm").join(", "),
              `${p.displaySeconds} sek`,
            ].join(" · ")}
            onClick={kanRedigere ? () => onRediger(p) : undefined}
            hoyre={
              <>
                <span className={`badge ${p.status === "na" ? "ok" : p.status === "planlagt" ? "info" : ""}`}>
                  {STATUS_ETIKETT[p.status]}
                </span>
                {kanRedigere && (
                  <button
                    className="btn btn-ghost btn-sm"
                    aria-label={`Endre ${p.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRediger(p);
                    }}
                  >
                    <Pencil size={14} aria-hidden />
                  </button>
                )}
                {kanRedigere && orgId && (
                  <button
                    className="btn btn-ghost btn-sm"
                    aria-label={`Slett ${p.title}`}
                    onClick={(e) => {
                      // Raden selv åpner redigering — slettknappen skal ikke gjøre begge deler.
                      e.stopPropagation();
                      if (window.confirm(`Slette «${p.title}»? Det forsvinner fra skjermene med en gang.`)) {
                        void slett(() => oppslagstavle.slettOppslag(orgId, p.id));
                      }
                    }}
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                )}
              </>
            }
          />
        ))}
      </Kort>

      <Kort tittel="Kalender">
        {hendelser.length === 0 && <Tom tekst="Ingen kommende hendelser." />}
        {hendelser.map((h) => (
          <Rad
            key={h.id}
            tittel={h.title}
            meta={[dato(h.eventDate), h.eventTime && `kl. ${h.eventTime}`, h.place].filter(Boolean).join(" · ")}
            hoyre={
              kanRedigere &&
              orgId && (
                <button
                  className="btn btn-ghost btn-sm"
                  aria-label={`Slett ${h.title}`}
                  onClick={() =>
                    window.confirm(`Slette «${h.title}» fra kalenderen?`) &&
                    void slett(() => oppslagstavle.slettHendelse(orgId, h.id))
                  }
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              )
            }
          />
        ))}
      </Kort>
    </>
  );
}

type Innholdstype = "tekst" | "bilde" | "hendelse" | "vaer" | "avganger" | "tommedager";

/**
 * Nytt innhold, eller redigering av et oppslag. Ved redigering står typen fast — et nytt
 * bilde er et nytt oppslag — og kalenderhendelser redigeres ikke her.
 */
function OppslagSkjema({
  orgId,
  skjermer,
  eksisterende,
  onLukk,
  onLagret,
}: {
  orgId: string;
  skjermer: Skjerm[];
  eksisterende: Oppslag | null;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const iDag = osloIDag();
  const omToUker = osloIDag(new Date(Date.now() + 14 * 86_400_000));
  const e = eksisterende;
  const [type, setType] = useState<Innholdstype>(e?.kind ?? "tekst");
  const erBlokk = type === "vaer" || type === "avganger" || type === "tommedager";
  const [tittel, setTittel] = useState(e?.title ?? "");
  const [tekst, setTekst] = useState(e?.body ?? "");
  const [kategori, setKategori] = useState<Kategori>(e?.category ?? "info");
  const [fil, setFil] = useState<File | null>(null);
  const [fra, setFra] = useState(e?.showFrom ?? iDag);
  const [til, setTil] = useState(e?.showUntil ?? omToUker);
  const [alle, setAlle] = useState(e?.allScreens ?? true);
  const [utvalg, setUtvalg] = useState<string[]>(e?.screenIds ?? []);
  const [sekunder, setSekunder] = useState(e?.displaySeconds ?? STANDARD_SEKUNDER);
  const [hDato, setHDato] = useState(iDag);
  const [hTid, setHTid] = useState("");
  const [hSted, setHSted] = useState("");
  const { sender, feil, send } = useSending(onLagret);

  function lagre(ev: React.FormEvent) {
    ev.preventDefault();
    const periode = { fra, til, alleSkjermer: alle, skjermIder: alle ? [] : utvalg, sekunder };
    void send(async () => {
      if (e) {
        return oppslagstavle.endreOppslag(orgId, e.id, { tittel, tekst: tekst || null, kategori, ...periode });
      }
      if (type === "hendelse") {
        return oppslagstavle.nyHendelse(orgId, { tittel, dato: hDato, tid: hTid || null, sted: hSted || null });
      }
      if (type === "bilde") {
        if (!fil) throw new Error("Velg et bilde");
        return oppslagstavle.nyttBildeoppslag(orgId, { tittel, ...periode }, fil);
      }
      return oppslagstavle.nyttTekstoppslag(orgId, { tittel, tekst: tekst || null, kategori, ...periode });
    });
  }

  return (
    <Modal tittel={e ? "Endre oppslag" : "Nytt innhold"} onLukk={onLukk} bredde={720}>
      {!e && (
        <div className="ot-typer">
          {(
            [
              ["tekst", "Tekst", "Oppslag med overskrift og tekst"],
              ["bilde", "Bilde", "JPG, PNG eller WebP med bildetekst"],
              ["hendelse", "Kalender", "Hendelse i kalenderfeltet"],
              ["vaer", "Vær", "Varsel fra MET Norway (yr) for et sted"],
              ["avganger", "Avganger", "Sanntid fra Entur for en eller to holdeplasser"],
              ["tommedager", "Tømmedager", "Hentes fra BIR hver natt"],
            ] as const
          ).map(([n, t, b]) => (
            <button type="button" key={n} className={`ot-type${type === n ? " valgt" : ""}`} onClick={() => setType(n)}>
              <b>{t}</b>
              <span>{b}</span>
            </button>
          ))}
        </div>
      )}
      {(type === "vaer" || type === "avganger") && (
        <BlokkSkjema key={type} orgId={orgId} type={type} eksisterende={null} onAvbryt={onLukk} onLagret={onLagret} />
      )}
      {type === "tommedager" && (
        <>
          <BirKort erAdmin onEndret={() => {}} />
          <div className="field-note">
            Tømmedagene er én blokk for hele borettslaget. Plasser den på skjermene under «Skjermer og utseende».
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-primary" onClick={onLagret}>
              Ferdig
            </button>
          </div>
        </>
      )}
      {!erBlokk && (
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
                  onChange={(e) => setFil(e.target.files?.[0] ?? null)}
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
                  notat={`${tekst.length}/400 tegn. Kort er bedre — det leses i forbifarten.`}
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
              valg={VISNINGSTIDER.map((n) => ({ verdi: String(n), etikett: `${n} sekunder` }))}
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
                    onClick={() =>
                      setUtvalg((u) => (u.includes(s.id) ? u.filter((x) => x !== s.id) : [...u, s.id]))
                    }
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
        <Knapperad
          onAvbryt={onLukk}
          sender={sender}
          sendEtikett={e ? "Lagre" : type === "hendelse" ? "Legg i kalenderen" : "Legg ut"}
        />
      </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------
// Skjermer og utseende
// ---------------------------------------------------------------------------------------

function Skjermer({
  orgId,
  skjermer,
  valgt,
  onVelg,
  utseende,
  plasserbare,
  erAdmin,
  onEndret,
}: {
  orgId: string | undefined;
  skjermer: Skjerm[];
  valgt: Skjerm | null;
  onVelg: (id: string) => void;
  utseende: Tavleutseende | null;
  plasserbare: ReadonlyArray<{ nokkel: string; navn: string; merknad?: string }>;
  erAdmin: boolean;
  onEndret: () => void;
}) {
  return (
    <>
      {!erAdmin && (
        <div className="field-note">Bare orgadmin kan koble til skjermer og endre utseendet.</div>
      )}
      <Kort tittel={`Skjermer (${skjermer.length})`}>
        <div className="card-body">
          {skjermer.length === 0 ? (
            <div className="field-note">
              Ingen skjermer ennå. Åpne <b>/skjerm</b> på appens adresse i nettleseren på skjermen — den
              viser en kode på seks tegn. Trykk så «Koble til skjerm» her.
            </div>
          ) : (
            <div className="auto-grid">
              {skjermer.map((s) => (
                <button
                  key={s.id}
                  className={`ot-skjermkort${valgt?.id === s.id ? " valgt" : ""}`}
                  onClick={() => onVelg(s.id)}
                >
                  <b>{s.navn}</b>
                  <span>
                    <i className={`ot-prikk ${s.paaNett ? "ok" : "nede"}`} />
                    {s.paaNett ? "På nett" : `Sist sett ${siden(s.sistSett)}`}
                  </span>
                  <span>{RETNING_ETIKETT[s.retning]}{s.adresse ? ` · ${s.adresse}` : ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Kort>

      {valgt && orgId && erAdmin && (
        <Skjerminnstillinger key={valgt.id} orgId={orgId} skjerm={valgt} plasserbare={plasserbare} onEndret={onEndret} />
      )}
      {utseende && orgId && erAdmin && <Utseende orgId={orgId} utseende={utseende} onEndret={onEndret} />}
    </>
  );
}

function Skjerminnstillinger({
  orgId,
  skjerm,
  plasserbare,
  onEndret,
}: {
  orgId: string;
  skjerm: Skjerm;
  plasserbare: ReadonlyArray<{ nokkel: string; navn: string; merknad?: string }>;
  onEndret: () => void;
}) {
  const [navn, setNavn] = useState(skjerm.navn);
  const [adresse, setAdresse] = useState(skjerm.adresse ?? "");
  const [retning, setRetning] = useState<Retning>(skjerm.retning);
  const [mal, setMal] = useState(skjerm.mal);
  const [soner, setSoner] = useState(skjerm.soner);
  const [skala, setSkala] = useState(skjerm.skala);
  const { sender, feil, send } = useSending(onEndret);

  return (
    <Kort tittel={`Innstillinger for ${skjerm.navn}`}>
      <form
        className="card-body"
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => oppslagstavle.endreSkjerm(orgId, skjerm.id, { navn, adresse: adresse || null, retning, skala, mal, soner }));
        }}
      >
        <div className="ot-to">
          <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} />
          <Tekstfelt etikett="Adresse på skjermen" verdi={adresse} onEndre={setAdresse} />
        </div>
        <Nedtrekk
          etikett="Retning"
          verdi={retning}
          onEndre={(v) => setRetning(v as Retning)}
          valg={RETNINGER.map((r) => ({ verdi: r, etikett: RETNING_ETIKETT[r] }))}
          notat="Følger hvordan skjermen er montert."
        />
        <Nedtrekk
          etikett="Skalering"
          verdi={String(skala)}
          onEndre={(v) => setSkala(Number(v))}
          valg={SKALERINGER.map((n) => ({ verdi: String(n), etikett: `${n} %${n === STANDARD_SKALERING ? " (standard)" : ""}` }))}
          notat="Mindre gir plass til mer innhold, større leses på lengre avstand. Oppløsningen spiller ingen rolle — 4K og Full HD ser like ut."
        />
        <SoneOppsett
          retning={retning}
          malId={mal}
          soner={soner}
          blokker={plasserbare}
          onEndre={(m, s) => {
            setMal(m);
            setSoner(s);
          }}
        />
        <Feil melding={feil} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              window.confirm(`Fjerne «${skjerm.navn}»? Skjermen går tilbake til koblingskoden og må kobles på nytt.`) &&
              void send(() => oppslagstavle.slettSkjerm(orgId, skjerm.id))
            }
          >
            Fjern skjerm
          </button>
          <button type="submit" className="btn btn-primary" disabled={sender}>
            {sender ? "Lagrer …" : "Lagre"}
          </button>
        </div>
      </form>
    </Kort>
  );
}

/**
 * Kontaktpersonene i kontaktfeltet: DriftIQ-brukere i borettslaget. Navn, telefon og e-post
 * kommer fra profilen, rollen fra tittelen under Brukere — styret velger bare hvem og hva
 * som vises. De roterer på skjermen i rekkefølgen her. Uten noen vises borettslagets egen
 * telefon og e-post.
 */
function Kontaktpersoner({
  orgId,
  kontakter,
  erAdmin,
  onEndret,
}: {
  orgId: string;
  kontakter: Tavlekontakt[];
  erAdmin: boolean;
  onEndret: () => void;
}) {
  const [skjema, setSkjema] = useState<Tavlekontakt | "ny" | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  async function utfor(handling: () => Promise<unknown>) {
    setFeil(null);
    try {
      await handling();
      onEndret();
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Noe gikk galt");
    }
  }

  return (
    <Kort
      tittel="Kontaktpersoner på skjermen"
      handling={
        erAdmin && (
          <button className="btn btn-ghost btn-sm" onClick={() => setSkjema("ny")}>
            <Plus size={14} aria-hidden /> Legg til
          </button>
        )
      }
    >
      <Feil melding={feil} />
      {kontakter.length === 0 && (
        <Tom tekst="Ingen kontaktpersoner. Skjermen viser borettslagets telefon og e-post." />
      )}
      {kontakter.map((k, i) => (
        <Rad
          key={k.id}
          tittel={
            <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span className="ot-kontakt-mini">
                {k.harBilde ? <img src={`${oppslagstavle.kontaktbildeSti(orgId, k.id)}?v=${k.bildeVersjon}`} alt="" /> : initialer(k.navn)}
              </span>
              {k.navn}
              {k.rolle && <span className="field-note">{k.rolle}</span>}
            </span>
          }
          meta={
            [k.visTelefon && k.telefon, k.visEpost && k.epost].filter(Boolean).join(" · ") ||
            "Verken telefon eller e-post vises"
          }
          onClick={erAdmin ? () => setSkjema(k) : undefined}
          hoyre={
            erAdmin &&
            kontakter.length > 1 && (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  aria-label={`Flytt ${k.navn} opp`}
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    void utfor(() => oppslagstavle.flyttKontakt(orgId, k.id, "opp"));
                  }}
                >
                  <ArrowUp size={14} aria-hidden />
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  aria-label={`Flytt ${k.navn} ned`}
                  disabled={i === kontakter.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    void utfor(() => oppslagstavle.flyttKontakt(orgId, k.id, "ned"));
                  }}
                >
                  <ArrowDown size={14} aria-hidden />
                </button>
              </>
            )
          }
        />
      ))}
      {skjema && (
        <KontaktSkjema
          orgId={orgId}
          eksisterende={skjema === "ny" ? null : skjema}
          onLukk={() => setSkjema(null)}
          onLagret={() => {
            setSkjema(null);
            onEndret();
          }}
        />
      )}
    </Kort>
  );
}

function KontaktSkjema({
  orgId,
  eksisterende: e,
  onLukk,
  onLagret,
}: {
  orgId: string;
  eksisterende: Tavlekontakt | null;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const { data: kandidater } = useOrgData((o) => oppslagstavle.kontaktkandidater(o));
  const [brukerId, setBrukerId] = useState(e?.brukerId ?? "");
  const [visTelefon, setVisTelefon] = useState(e?.visTelefon ?? true);
  const [visEpost, setVisEpost] = useState(e?.visEpost ?? false);
  const [fil, setFil] = useState<File | null>(null);
  const [fjernBilde, setFjernBilde] = useState(false);
  const { sender, feil, send } = useSending(onLagret);
  const valgt = e ?? kandidater?.find((k) => k.id === brukerId) ?? null;
  const telefon = valgt?.telefon ?? null;
  const epost = valgt?.epost ?? null;

  return (
    <Modal tittel={e ? `Kontaktperson: ${e.navn}` : "Ny kontaktperson"} onLukk={onLukk}>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void send(async () => {
            if (!e) {
              if (!brukerId) throw new Error("Velg en person");
              return oppslagstavle.nyKontakt(orgId, { brukerId, visTelefon, visEpost }, fil);
            }
            await oppslagstavle.endreKontakt(orgId, e.id, { visTelefon, visEpost });
            if (fil) await oppslagstavle.settKontaktbilde(orgId, e.id, fil);
            else if (fjernBilde) await oppslagstavle.fjernKontaktbilde(orgId, e.id);
          });
        }}
      >
        {!e && (
          <Nedtrekk
            etikett="Person"
            verdi={brukerId}
            onEndre={setBrukerId}
            valg={[
              { verdi: "", etikett: kandidater ? "Velg en bruker …" : "Henter brukere …" },
              ...(kandidater ?? []).map((k) => ({ verdi: k.id, etikett: k.tittel ? `${k.navn} — ${k.tittel}` : k.navn })),
            ]}
            notat="Brukerne i borettslaget. Mangler noen, inviter dem under Brukere først."
          />
        )}
        {valgt && (
          <div className="field-note" style={{ marginBottom: "10px" }}>
            Rolle på skjermen: <b>{"rolle" in valgt ? (valgt.rolle ?? "ingen") : (valgt.tittel ?? "ingen")}</b> — det er
            tittelen under Brukere, og endres der. Telefon og e-post er fra personens profil.
          </div>
        )}
        <Avkryssing
          etikett={`Vis telefon${telefon ? ` (${telefon})` : ""}`}
          verdi={visTelefon}
          onEndre={setVisTelefon}
          notat={valgt && !telefon ? "Profilen har ikke telefonnummer — ingenting vises før det er lagt inn." : undefined}
        />
        <Avkryssing etikett={`Vis e-post${epost ? ` (${epost})` : ""}`} verdi={visEpost} onEndre={setVisEpost} />
        <Skjemafelt
          etikett="Bilde (valgfritt)"
          notat="Et portrett gjør det lettere for beboerne å kjenne igjen personen. Vises rundt på skjermen."
        >
          <input
            className="input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(ev) => setFil(ev.target.files?.[0] ?? null)}
          />
        </Skjemafelt>
        {e?.harBilde && !fil && <Avkryssing etikett="Fjern bildet" verdi={fjernBilde} onEndre={setFjernBilde} />}
        <div className="field-note" style={{ marginBottom: "10px" }}>
          Navn, bilde og det du slår på over, vises offentlig i oppgangen. Legg bare inn personer som har sagt ja.
        </div>
        <Feil melding={feil} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          {e ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                window.confirm(`Fjerne ${e.navn} fra skjermene?`) && void send(() => oppslagstavle.slettKontakt(orgId, e.id))
              }
            >
              Fjern
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: "10px" }}>
            <button type="button" className="btn btn-ghost" onClick={onLukk}>
              Avbryt
            </button>
            <button type="submit" className="btn btn-primary" disabled={sender}>
              {sender ? "Lagrer …" : "Lagre"}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function Utseende({ orgId, utseende, onEndret }: { orgId: string; utseende: Tavleutseende; onEndret: () => void }) {
  const [bg, setBg] = useState(utseende.background);
  const [aksent, setAksent] = useState(utseende.accent);
  const [offline, setOffline] = useState(utseende.offlineMode);
  const { sender, feil, send } = useSending(onEndret);
  // Ny logo ⇒ ny URL, ellers viser nettleseren den gamle fra hurtigbufferen.
  const [logoVersjon, setLogoVersjon] = useState(0);

  return (
    <Kort tittel="Utseende for hele borettslaget">
      <form
        className="card-body"
        onSubmit={(e) => {
          e.preventDefault();
          void send(() => oppslagstavle.lagreUtseende(orgId, { background: bg, accent: aksent, offlineMode: offline }));
        }}
      >
        <Skjemafelt etikett="Farger">
          <div className="ot-filter" style={{ marginBottom: "10px" }}>
            {FORVALG.map((f) => (
              <button
                type="button"
                key={f.id}
                className={`ot-chip${bg === f.background && aksent === f.accent ? " valgt" : ""}`}
                onClick={() => {
                  setBg(f.background);
                  setAksent(f.accent);
                }}
              >
                {f.navn}
              </button>
            ))}
          </div>
          <div className="ot-farger">
            <label>
              Bakgrunn
              <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
            </label>
            <label>
              Aksent
              <input type="color" value={aksent} onChange={(e) => setAksent(e.target.value)} />
            </label>
          </div>
        </Skjemafelt>
        <Skjemafelt etikett="Logo" notat="PNG, JPG eller WebP, gjerne kvadratisk. Uten logo vises initialene.">
          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            <div className="ot-logo-forh">
              {utseende.harLogo ? <img src={`${oppslagstavle.logoSti(orgId)}?v=${logoVersjon}`} alt="Logo" /> : "—"}
            </div>
            <input
              className="input"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ maxWidth: "260px" }}
              onChange={(e) => {
                const fil = e.target.files?.[0];
                if (fil) void send(() => oppslagstavle.lastOppLogo(orgId, fil).then(() => setLogoVersjon((v) => v + 1)));
              }}
            />
            {utseende.harLogo && (
              <button type="button" className="btn btn-ghost" onClick={() => void send(() => oppslagstavle.slettLogo(orgId))}>
                Bruk initialer
              </button>
            )}
          </div>
        </Skjemafelt>
        <Nedtrekk
          etikett="Når skjermen mister nett"
          verdi={offline}
          onEndre={(v) => setOffline(v as "siste" | "melding")}
          valg={[
            { verdi: "siste", etikett: "Vis siste innhold, med en linje om at den er uten nett" },
            { verdi: "melding", etikett: "Vis en melding om at skjermen er uten nett" },
          ]}
        />
        <Feil melding={feil} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="submit" className="btn btn-primary" disabled={sender}>
            {sender ? "Lagrer …" : "Lagre utseende"}
          </button>
        </div>
      </form>
    </Kort>
  );
}

function KobleSkjerm({
  orgId,
  nummer,
  onLukk,
  onKoblet,
}: {
  orgId: string;
  nummer: number;
  onLukk: () => void;
  onKoblet: (s: Skjerm) => void;
}) {
  const [kode, setKode] = useState("");
  const [navn, setNavn] = useState(`Skjerm ${nummer}`);
  const [adresse, setAdresse] = useState("");
  const [retning, setRetning] = useState<Retning>("staende");
  // Tom `onFerdig`: modalen lukkes av `onKoblet`, som trenger skjermen svaret ga.
  const { sender, feil, send } = useSending(() => {});

  return (
    <Modal tittel="Koble til skjerm" onLukk={onLukk}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(async () =>
            onKoblet(await oppslagstavle.koble(orgId, { kode, navn, adresse: adresse || null, retning })),
          );
        }}
      >
        <div className="field-note" style={{ marginBottom: "12px" }}>
          Åpne <b>/skjerm</b> på appens adresse i nettleseren på skjermen, i fullskjerm. Den viser en kode
          på seks tegn.
        </div>
        <div className="ot-kodefelt">
          <Tekstfelt etikett="Kode fra skjermen" verdi={kode} onEndre={setKode} plassholder="K7M-4QX" />
        </div>
        <div className="ot-to">
          <Tekstfelt etikett="Navn" verdi={navn} onEndre={setNavn} plassholder="Oppgang A" />
          <Tekstfelt etikett="Adresse på skjermen" verdi={adresse} onEndre={setAdresse} plassholder="Fjellveien 12 A" />
        </div>
        <Nedtrekk
          etikett="Retning"
          verdi={retning}
          onEndre={(v) => setRetning(v as Retning)}
          valg={RETNINGER.map((r) => ({ verdi: r, etikett: RETNING_ETIKETT[r] }))}
        />
        <Feil melding={feil} />
        <Knapperad onAvbryt={onLukk} sender={sender} sendEtikett="Koble til" />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------
// Forhåndsvisning
// ---------------------------------------------------------------------------------------

function Forhandsvisning({
  orgId,
  skjermer,
  skjerm,
  onVelg,
  versjon,
  harLogo,
}: {
  orgId: string | undefined;
  skjermer: Skjerm[];
  skjerm: Skjerm | null;
  onVelg: (id: string) => void;
  versjon: number;
  harLogo: boolean;
}) {
  const skjermId = skjerm?.id ?? null;
  const { data, feil } = useOrgData(
    (o) => (skjermId ? oppslagstavle.forhandsvisning(o, skjermId) : Promise.resolve(null)),
    [skjermId, versjon],
  );
  const logo = useMemo(
    () => (orgId && harLogo ? `${oppslagstavle.logoSti(orgId)}?v=${versjon}` : null),
    [orgId, harLogo, versjon],
  );

  return (
    <div className="ot-forhand">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <div className="card-title">Forhåndsvisning</div>
        {skjermer.length > 1 && (
          <select className="select" style={{ width: "auto" }} value={skjermId ?? ""} onChange={(e) => onVelg(e.target.value)}>
            {skjermer.map((s) => (
              <option key={s.id} value={s.id}>
                {s.navn}
              </option>
            ))}
          </select>
        )}
      </div>
      <Feil melding={feil} />
      {!skjerm ? (
        <Tom tekst="Koble til en skjerm for å se forhåndsvisningen." />
      ) : (
        data && (
          <>
            <div className="ot-ramme">
              <Tavleskjerm
                innhold={data}
                logoUrl={logo}
                bildeUrl={(id) => (orgId ? oppslagstavle.bildeSti(orgId, id) : null)}
                kontaktbildeUrl={(id) => {
                  const k = data.kontakter.find((x) => x.id === id);
                  return orgId && k ? `${oppslagstavle.kontaktbildeSti(orgId, id)}?v=${k.bildeVersjon}` : null;
                }}
              />
            </div>
            <div className="field-note">
              {skjerm.paaNett ? "På nett" : `Sist sett ${siden(skjerm.sistSett)}`} · {data.oppslag.length} oppslag
              roterer. Endringer vises på skjermen innen ett minutt.
            </div>
          </>
        )
      )}
    </div>
  );
}
