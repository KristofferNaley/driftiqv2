"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import Layout from "@/components/Layout";
import { Faner, Feil, Tom, useOrgData } from "@/components/felles";
import { Knapperad, Modal, Nedtrekk, Tekstfelt, useSending } from "@/components/skjema";
import { useOkt } from "@/components/OktProvider";
import { Tavleskjerm } from "@/components/Tavleskjerm";
import {
  bir as birklient,
  oppslagstavle,
  tavleblokker,
  type Oppslag,
  type Skjerm,
  type SkjermEndring,
  type Tavlehendelse,
} from "@/lib/klient";
import { RETNING_ETIKETT, RETNINGER, type Retning, type Skjerminnhold } from "@/lib/oppslagstavleregler";
import { INNEBYGDE_BLOKKER, finnMal, ryddFelt } from "@/lib/tavlemaler";
import { Innhold, OppslagSkjema } from "./Innhold";
import { Drift, Skjermliste, Skjermoppsett, Utseende, type Utseendeverdi } from "./Oppsett";
import { sistSett } from "./felles";

/**
 * Oppslagstavla — det styret legger ut her, vises på skjermene i bygget innen ett minutt.
 *
 * To faner: Innhold (det daglige: oppslag og kalender) og Skjermer og oppsett (mal og felt
 * per skjerm, oppsettet for det som står i feltene, utseende og drift). Uten skjermer
 * erstattes fanene av tre steg (`Forstegang`).
 *
 * ## Én lagremodell
 *
 * Skjerminnstillinger (navn, adresse, retning, skalering, mal, felt), farger og nettbrudd-valget
 * er et UTKAST som eies her: `skjermUtkast` og `utseendeUtkast` er bare endringene, lagt over
 * det serveren har. Linja nederst vises når utkastet avviker, og forhåndsvisningen tegner
 * utkastet, så styret ser endringen før den er lagret. Forhåndsvisningen er samme komponent
 * som skjermen på veggen, med de samme dataene fra serveren.
 */
type Fane = "innhold" | "oppsett";

const lik = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function Oppslagstavle() {
  const { aktivOrg } = useOkt();
  const router = useRouter();
  const kanRedigere = aktivOrg?.nivaa === "orgadmin" || aktivOrg?.nivaa === "redigering";
  const erAdmin = aktivOrg?.nivaa === "orgadmin";

  const [fane, setFane] = useState<Fane>("innhold");
  // `o` følger med svaret: etter et orgbytte står forrige orgs data igjen til de nye er hentet,
  // og første gangs oppsett skal avgjøres av riktig borettslag.
  const { data, feil, last, orgId } = useOrgData((o) =>
    Promise.all([
      oppslagstavle.oppslag(o),
      oppslagstavle.hendelser(o),
      oppslagstavle.skjermer(o),
      oppslagstavle.utseende(o),
      oppslagstavle.kontakter(o),
      tavleblokker.liste(o),
      birklient.status(o),
    ]).then((d) => ({ o, d })),
  );
  const fersk = data && data.o === orgId ? data.d : null;
  const [oppslag, hendelser, skjermer, utseende, kontakter, blokker, bir] = fersk ?? [[], [], [], null, [], [], null];

  const [valgtSkjerm, setValgtSkjerm] = useState<string | null>(null);
  const skjerm = skjermer.find((s) => s.id === valgtSkjerm) ?? skjermer[0] ?? null;
  const [valgtFelt, setValgtFelt] = useState<string | null>(null);
  const [visOppslagId, setVisOppslagId] = useState<string | null>(null);
  // Forhåndsvisningen hentes på nytt etter hver endring — `versjon` er utløseren.
  const [versjon, setVersjon] = useState(0);
  const oppdater = () => {
    void last();
    setVersjon((v) => v + 1);
  };

  // --- Utkastet -------------------------------------------------------------------------
  const [skjermUtkast, setSkjermUtkast] = useState<{ id: string; e: Partial<SkjermEndring> } | null>(null);
  const [utseendeUtkast, setUtseendeUtkast] = useState<Partial<Utseendeverdi>>({});
  const [lagrer, setLagrer] = useState(false);
  const [lagrefeil, setLagrefeil] = useState<string | null>(null);
  /** Noe brukeren ville gjøre mens det lå ulagrede endringer: venter på svaret i dialogen. */
  const [ventende, setVentende] = useState<{ handling: () => void } | null>(null);

  const lagretSkjerm: SkjermEndring | null = useMemo(
    () =>
      skjerm && {
        navn: skjerm.navn,
        adresse: skjerm.adresse,
        retning: skjerm.retning,
        skala: skjerm.skala,
        mal: skjerm.mal,
        felt: skjerm.soner,
      },
    [skjerm],
  );
  const skjermVerdi: SkjermEndring | null = useMemo(() => {
    if (!skjerm || !lagretSkjerm) return null;
    const v = { ...lagretSkjerm, ...(skjermUtkast?.id === skjerm.id ? skjermUtkast.e : {}) };
    // En blokk som er slettet etter at den ble lagt i utkastet, skal ikke følge med i lagringen.
    const gyldige = new Set<string>([...INNEBYGDE_BLOKKER, ...blokker.map((b) => b.nokkel)]);
    return { ...v, felt: ryddFelt(finnMal(v.mal, v.retning), v.felt, gyldige) };
  }, [skjerm, lagretSkjerm, skjermUtkast, blokker]);
  const lagretUtseende: Utseendeverdi | null = utseende && {
    background: utseende.background,
    accent: utseende.accent,
    offlineMode: utseende.offlineMode,
  };
  const utseendeVerdi = lagretUtseende && { ...lagretUtseende, ...utseendeUtkast };
  const skjermEndret = erAdmin && skjermVerdi !== null && !lik(skjermVerdi, lagretSkjerm);
  const utseendeEndret = erAdmin && utseendeVerdi !== null && !lik(utseendeVerdi, lagretUtseende);
  const endret = skjermEndret || utseendeEndret;

  const endreSkjerm = (e: Partial<SkjermEndring>) =>
    skjerm && setSkjermUtkast((u) => ({ id: skjerm.id, e: { ...(u?.id === skjerm.id ? u.e : {}), ...e } }));
  const endreUtseende = (e: Partial<Utseendeverdi>) => setUtseendeUtkast((u) => ({ ...u, ...e }));

  function forkast() {
    setSkjermUtkast(null);
    setUtseendeUtkast({});
    setLagrefeil(null);
  }

  async function lagre(): Promise<boolean> {
    if (!orgId) return false;
    setLagrer(true);
    setLagrefeil(null);
    try {
      if (skjermEndret && skjerm && skjermVerdi) await oppslagstavle.endreSkjerm(orgId, skjerm.id, skjermVerdi);
      if (utseendeEndret && utseendeVerdi) await oppslagstavle.lagreUtseende(orgId, utseendeVerdi);
      // Utkastet slippes først når de nye verdiene er hentet, ellers blinker forhåndsvisningen
      // tilbake til det gamle et øyeblikk.
      await last();
      forkast();
      setVersjon((v) => v + 1);
      return true;
    } catch (e) {
      setLagrefeil(e instanceof Error ? e.message : "Kunne ikke lagre");
      void last();
      return false;
    } finally {
      setLagrer(false);
    }
  }

  /** Kjører handlingen, eller spør først hvis den ville kastet ulagrede endringer. */
  const vokt = (handling: () => void, gjelder: boolean = endret) => (gjelder ? setVentende({ handling }) : handling());

  /** Begge skjermvelgerne (kortene og nedtrekket i forhåndsvisningen) går gjennom denne. */
  const velgSkjerm = (id: string) => {
    if (id === skjerm?.id) return;
    vokt(() => {
      setSkjermUtkast(null);
      setValgtFelt(null);
      setValgtSkjerm(id);
    }, skjermEndret);
  };

  // Orgbytte: utkastet hører til forrige borettslag.
  useEffect(() => {
    setSkjermUtkast(null);
    setUtseendeUtkast({});
    setValgtSkjerm(null);
    setValgtFelt(null);
    setVentende(null);
  }, [orgId]);

  // Advarsel før siden forlates. Next har ingen sperre for klientnavigasjon, så lenkeklikk
  // fanges her; lukking og omlasting tar nettleseren selv (`beforeunload`).
  useEffect(() => {
    if (!endret) return;
    const paaKlikk = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || a.target === "_blank") return;
      if (a.origin !== window.location.origin || a.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      const mal = a.pathname + a.search + a.hash;
      setVentende({ handling: () => router.push(mal) });
    };
    const paaLukk = (e: BeforeUnloadEvent) => e.preventDefault();
    document.addEventListener("click", paaKlikk, true);
    window.addEventListener("beforeunload", paaLukk);
    return () => {
      document.removeEventListener("click", paaKlikk, true);
      window.removeEventListener("beforeunload", paaLukk);
    };
  }, [endret, router]);

  // --- Første gangs oppsett -------------------------------------------------------------
  /** Avgjøres én gang per borettslag, når dataene er hentet: ingen skjermer ⇒ tre steg. */
  const [forstegang, setForstegang] = useState<{ o: string; aktiv: boolean } | null>(null);
  const [steg2Ferdig, setSteg2Ferdig] = useState(false);
  useEffect(() => {
    if (!fersk || !orgId || forstegang?.o === orgId) return;
    setForstegang({ o: orgId, aktiv: fersk[2].length === 0 });
    setSteg2Ferdig(false);
  }, [fersk, orgId, forstegang]);
  const iForstegang = forstegang?.o === orgId && forstegang?.aktiv === true;
  const avsluttForstegang = () => orgId && setForstegang({ o: orgId, aktiv: false });

  /** «nytt» = tomt skjema; ellers oppslaget eller hendelsen som redigeres. */
  const [redigerer, setRedigerer] = useState<{ oppslag: Oppslag } | { hendelse: Tavlehendelse } | "nytt" | null>(null);
  const [kobler, setKobler] = useState(false);

  const oppsett = skjerm && skjermVerdi && orgId && (
    <Skjermoppsett
      key={skjerm.id}
      orgId={orgId}
      skjerm={skjerm}
      verdi={skjermVerdi}
      onEndre={endreSkjerm}
      valgtFelt={valgtFelt}
      onVelgFelt={setValgtFelt}
      blokker={blokker}
      bir={bir}
      kontakter={kontakter}
      erAdmin={erAdmin}
      kanRedigere={kanRedigere}
      onEndret={oppdater}
      onFjernet={() => {
        forkast();
        setValgtSkjerm(null);
        setValgtFelt(null);
        oppdater();
      }}
      utenFjern={iForstegang}
    />
  );

  return (
    <Layout
      tittel="Oppslagstavle"
      subnav={
        !iForstegang && (
          <Faner
            valgt={fane}
            onVelg={setFane}
            faner={[
              { nokkel: "innhold", etikett: "Innhold" },
              { nokkel: "oppsett", etikett: "Skjermer og oppsett" },
            ]}
          />
        )
      }
      handlinger={
        iForstegang
          ? null
          : fane === "innhold"
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
        <div className={`ot-oppsett${skjermVerdi?.retning === "liggende" ? " liggende" : ""}`}>
          <div className="ot-kolonne">
            {!fersk || !orgId ? null : iForstegang ? (
              <Forstegang
                erAdmin={erAdmin}
                kanRedigere={kanRedigere}
                harSkjerm={skjermer.length > 0}
                steg2Ferdig={steg2Ferdig}
                lagrer={lagrer}
                lagrefeil={lagrefeil}
                oppsett={oppsett}
                onKoble={() => setKobler(true)}
                onSteg2={async () => {
                  if (!endret || (await lagre())) setSteg2Ferdig(true);
                }}
                onOppslag={() => setRedigerer("nytt")}
                onHoppOver={() => vokt(avsluttForstegang)}
              />
            ) : fane === "innhold" ? (
              <Innhold
                orgId={orgId}
                oppslag={oppslag}
                hendelser={hendelser}
                skjermer={skjermer}
                kanRedigere={kanRedigere}
                valgtOppslag={visOppslagId}
                onEndret={oppdater}
                onVelgOppslag={(p) => {
                  setVisOppslagId(p.id);
                  if (kanRedigere) setRedigerer({ oppslag: p });
                }}
                onVelgHendelse={(h) => setRedigerer({ hendelse: h })}
              />
            ) : (
              <>
                {skjermer.length === 0 ? (
                  <Tom tekst={erAdmin ? "Ingen skjermer ennå. Trykk «Koble til skjerm»." : "Ingen skjermer ennå. Bare orgadmin kan koble til skjermer."} />
                ) : (
                  <Skjermliste
                    skjermer={skjermer}
                    valgt={skjerm}
                    valgtFelt={skjermVerdi && { mal: finnMal(skjermVerdi.mal, skjermVerdi.retning), felt: skjermVerdi.felt }}
                    onVelg={velgSkjerm}
                    blokker={blokker}
                    bir={bir}
                  />
                )}
                {oppsett}
                {erAdmin && utseendeVerdi && (
                  <>
                    <Utseende
                      orgId={orgId}
                      harLogo={utseende?.harLogo ?? false}
                      verdi={utseendeVerdi}
                      onEndre={endreUtseende}
                      onEndret={oppdater}
                    />
                    <Drift verdi={utseendeVerdi} onEndre={endreUtseende} />
                  </>
                )}
              </>
            )}
          </div>
          <Forhandsvisning
            orgId={orgId}
            skjermer={skjermer}
            skjerm={skjerm}
            skjermVerdi={skjermVerdi}
            utseendeVerdi={utseendeVerdi}
            onVelg={velgSkjerm}
            versjon={versjon}
            harLogo={utseende?.harLogo ?? false}
            markertSone={iForstegang || fane === "oppsett" ? valgtFelt : null}
            visOppslagId={visOppslagId}
            ulagret={endret}
          />
        </div>

        {endret && !iForstegang && (
          <div className="ot-lagrelinje" role="status">
            <div>
              <b>Ulagrede endringer</b>
              {lagrefeil && <span className="ot-lagrelinje-feil">{lagrefeil}</span>}
            </div>
            <div className="ot-lagrelinje-knapper">
              <button type="button" className="btn btn-ghost" disabled={lagrer} onClick={forkast}>
                Forkast
              </button>
              <button type="button" className="btn btn-primary" disabled={lagrer} onClick={() => void lagre()}>
                {lagrer ? "Lagrer …" : "Lagre"}
              </button>
            </div>
          </div>
        )}
      </div>

      {redigerer && orgId && (
        <OppslagSkjema
          orgId={orgId}
          skjermer={skjermer}
          eksisterende={redigerer !== "nytt" && "oppslag" in redigerer ? redigerer.oppslag : null}
          hendelse={redigerer !== "nytt" && "hendelse" in redigerer ? redigerer.hendelse : null}
          onLukk={() => setRedigerer(null)}
          onLagret={() => {
            setRedigerer(null);
            oppdater();
            // Første oppslag er lagt ut: oppsettet er ferdig, og det daglige tar over.
            if (iForstegang && !endret) {
              avsluttForstegang();
              setFane("innhold");
            }
          }}
        />
      )}
      {kobler && orgId && (
        <KobleSkjerm
          orgId={orgId}
          nummer={skjermer.length + 1}
          onLukk={() => setKobler(false)}
          onKoblet={(s) => {
            setKobler(false);
            setSkjermUtkast(null);
            setValgtFelt(null);
            setValgtSkjerm(s.id);
            oppdater();
          }}
        />
      )}
      {ventende && (
        <Modal tittel="Ulagrede endringer" onLukk={() => setVentende(null)} bredde={460}>
          <div>Du har endringer som ikke er lagret. Vil du lagre dem før du går videre?</div>
          <Feil melding={lagrefeil} />
          <div className="ot-skjemafot">
            <button type="button" className="btn btn-ghost" onClick={() => setVentende(null)}>
              Bli her
            </button>
            <div className="ot-lagrelinje-knapper">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={lagrer}
                onClick={() => {
                  const { handling } = ventende;
                  setVentende(null);
                  forkast();
                  handling();
                }}
              >
                Forkast
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={lagrer}
                onClick={async () => {
                  const { handling } = ventende;
                  if (!(await lagre())) return;
                  setVentende(null);
                  handling();
                }}
              >
                {lagrer ? "Lagrer …" : "Lagre"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

// ---------------------------------------------------------------------------------------
// Første gangs oppsett
// ---------------------------------------------------------------------------------------

/**
 * Tre steg i stedet for fanene når borettslaget ikke har noen skjerm: koble til, velg mal og
 * innhold i feltene, legg ut første oppslag. Alt på én flate, så et styremedlem kommer fra
 * start til første oppslag uten å lete i faner.
 */
function Forstegang({
  erAdmin,
  kanRedigere,
  harSkjerm,
  steg2Ferdig,
  lagrer,
  lagrefeil,
  oppsett,
  onKoble,
  onSteg2,
  onOppslag,
  onHoppOver,
}: {
  erAdmin: boolean;
  kanRedigere: boolean;
  harSkjerm: boolean;
  steg2Ferdig: boolean;
  lagrer: boolean;
  lagrefeil: string | null;
  oppsett: React.ReactNode;
  onKoble: () => void;
  onSteg2: () => void;
  onOppslag: () => void;
  onHoppOver: () => void;
}) {
  const aktivt = !harSkjerm ? 1 : !steg2Ferdig ? 2 : 3;
  const steg = (nr: number, tittel: string, kropp: React.ReactNode) => (
    <div className={`card ot-steg${nr < aktivt ? " ferdig" : nr === aktivt ? " aktiv" : ""}`}>
      <div className="ot-steg-hode">
        <span className="ot-steg-nr">{nr < aktivt ? <Check size={14} aria-label="Ferdig" /> : nr}</span>
        <b>{tittel}</b>
      </div>
      {nr === aktivt && <div className="ot-steg-kropp">{kropp}</div>}
    </div>
  );
  return (
    <>
      <div className="field-note">
        Oppslagstavla viser oppslag fra styret på skjermer i bygget. Tre steg, så er den første skjermen i gang.
      </div>
      {steg(
        1,
        "Koble til skjerm",
        <>
          <div>
            Åpne <b>/skjerm</b> på appens adresse i nettleseren på skjermen, i fullskjerm. Skjermen viser en kode på
            seks tegn.
          </div>
          {erAdmin ? (
            <div>
              <button className="btn btn-primary" onClick={onKoble}>
                <Plus size={16} strokeWidth={2} aria-hidden />
                Koble til skjerm
              </button>
            </div>
          ) : (
            <div className="field-note">Bare orgadmin kan koble til skjermer.</div>
          )}
        </>,
      )}
      {steg(
        2,
        "Velg mal og innhold i feltene",
        <>
          <div>
            Velg hvordan skjermen deles opp, og klikk på et felt i kartet for å velge hva som står der. Skjermen starter
            med et vanlig oppsett, så du kan også gå rett videre.
          </div>
          {oppsett}
          <Feil melding={lagrefeil} />
          <div>
            <button className="btn btn-primary" disabled={lagrer} onClick={onSteg2}>
              {lagrer ? "Lagrer …" : "Lagre og gå videre"}
            </button>
          </div>
        </>,
      )}
      {steg(
        3,
        "Legg ut første oppslag",
        <>
          <div>Skriv en beskjed til beboerne. Den vises på skjermen innen ett minutt.</div>
          {kanRedigere && (
            <div>
              <button className="btn btn-primary" onClick={onOppslag}>
                <Plus size={16} strokeWidth={2} aria-hidden />
                Legg ut første oppslag
              </button>
            </div>
          )}
        </>,
      )}
      {harSkjerm && (
        <div>
          <button type="button" className="ot-lenke" onClick={onHoppOver}>
            Hopp over og gå til oppslagstavla
          </button>
        </div>
      )}
    </>
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
          notat="Følger hvordan skjermen er montert. Kan endres senere."
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
  skjermVerdi,
  utseendeVerdi,
  onVelg,
  versjon,
  harLogo,
  markertSone,
  visOppslagId,
  ulagret,
}: {
  orgId: string | undefined;
  skjermer: Skjerm[];
  skjerm: Skjerm | null;
  /** Utkastet: legges over det serveren svarte, så ulagrede endringer vises med en gang. */
  skjermVerdi: SkjermEndring | null;
  utseendeVerdi: Utseendeverdi | null;
  onVelg: (id: string) => void;
  versjon: number;
  harLogo: boolean;
  markertSone: string | null;
  visOppslagId: string | null;
  ulagret: boolean;
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
  const innhold: Skjerminnhold | null = useMemo(() => {
    if (!data || data.skjerm.id !== skjermId) return null;
    return {
      ...data,
      skjerm: skjermVerdi
        ? {
            ...data.skjerm,
            navn: skjermVerdi.navn,
            adresse: skjermVerdi.adresse,
            retning: skjermVerdi.retning,
            skala: skjermVerdi.skala,
            mal: skjermVerdi.mal,
            soner: skjermVerdi.felt,
          }
        : data.skjerm,
      utseende: { ...data.utseende, ...utseendeVerdi },
    };
  }, [data, skjermId, skjermVerdi, utseendeVerdi]);

  return (
    <div className="ot-forhand">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
        <div className="card-title">Forhåndsvisning</div>
        {skjermer.length > 1 && (
          <select
            className="select"
            style={{ width: "auto" }}
            aria-label="Skjerm"
            value={skjermId ?? ""}
            onChange={(e) => onVelg(e.target.value)}
          >
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
        innhold && (
          <>
            <div className="ot-ramme">
              <Tavleskjerm
                innhold={innhold}
                logoUrl={logo}
                markertSone={markertSone}
                visOppslagId={visOppslagId}
                bildeUrl={(id) => (orgId ? oppslagstavle.bildeSti(orgId, id) : null)}
                kontaktbildeUrl={(id) => {
                  const k = innhold.kontakter.find((x) => x.id === id);
                  return orgId && k ? `${oppslagstavle.kontaktbildeSti(orgId, id)}?v=${k.bildeVersjon}` : null;
                }}
              />
            </div>
            <div className="field-note">
              {ulagret
                ? "Viser ulagrede endringer. Skjermen på veggen endres først når du lagrer."
                : `${skjerm.paaNett ? "På nett" : sistSett(skjerm.sistSett)} · Endringer vises på skjermen innen ett minutt.`}
            </div>
          </>
        )
      )}
    </div>
  );
}
