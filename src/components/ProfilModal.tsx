"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as ikoner from "lucide-react";
import {
  Bell,
  Building2,
  History,
  KeyRound,
  LogOut,
  ShieldCheck,
  User,
  type LucideIcon,
} from "lucide-react";
import { authKlient, signOut } from "@/lib/auth-klient";
import { brukere, meg, type MegSvar } from "@/lib/klient";
// Ren fil uten server-importer — se kommentaren der. `lib/aktivitet.ts` ville dratt pg hit.
import { AKTIVITETSSLAG, SLAG, type MinAktivitet } from "@/lib/aktivitetsslag";
import { NIVA_ETIKETT, erPlattformadminRolle } from "@/lib/nivaer";
import { VARSLER, VARSEL_STANDARD } from "@/lib/varselvalg";
import { Feil, dato } from "./felles";
import { Fanemodal, Tekstfelt, type Fanevalg } from "./skjema";

/**
 * «Min profil» — egne opplysninger, egne varsler, hvilke lag man sitter i, og passord.
 *
 * ## Hvorfor faner, og hvorfor vertikale
 *
 * Modalen var én kolonne: navn, telefon, fem varselbrytere, «Bytt passord» og «Logg ut» rett
 * under hverandre. Den scrollet allerede med det som fantes, og alt vi vil legge til —
 * tofaktor, aktive innlogginger, egen aktivitet — hører hjemme HER, ikke på en ny side.
 * Vertikale faner tar imot flere punkter uten å endre resten; en horisontal rad må brekke om
 * eller scrolle sidelengs så snart den blir full.
 *
 * ## Hvorfor varslene ligger BÅDE her og under Brukere
 *
 * Valgene er personlige, så de hører hjemme på ens egen profil. Samtidig kan en kontoadmin
 * sette dem for andre fra brukermodalen — ellers måtte et styremedlem be om hjelp for å skru
 * av en e-post de ikke vil ha. To innganger, samme lagring: `user_org_memberships`.
 *
 * ## «Logg ut» står i bunnraden, ikke i en fane
 *
 * Profilblokken i sidemenyen er eneste vei ut av appen. Å legge utloggingen inne i én av seks
 * faner ville skjult den bak et valg man må ta først. Bunnraden står stille på alle faner.
 */

type Fane = "profil" | "varsler" | "lag" | "sikkerhet" | "tofaktor" | "aktivitet";

export default function ProfilModal({
  orgId,
  onLukk,
  onLagret,
}: {
  orgId: string | null;
  onLukk: () => void;
  onLagret: () => void;
}) {
  const [fane, setFane] = useState<Fane>("profil");

  /** Hele svaret, ikke bare feltene: «Mine lag» leser medlemskapene fra det samme kallet. */
  const [profil, setProfil] = useState<MegSvar | null>(null);
  const [navn, setNavn] = useState("");
  const [telefon, setTelefon] = useState("");
  const [feil, setFeil] = useState<string | null>(null);
  const [lagret, setLagret] = useState(false);
  const [lagrer, setLagrer] = useState(false);

  const [varsler, setVarsler] = useState<Record<string, boolean> | null>(null);
  /**
   * Verdiene som ble HENTET. Uten et snapshot kan vi ikke vite om noe er endret — og med
   * faner er det nettopp det man ikke ser: endringen ligger bak en fane man ikke står på.
   */
  const [varslerStart, setVarslerStart] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    meg
      .hent()
      .then((b) => {
        setProfil(b);
        setNavn(b.name);
        setTelefon(b.phone ?? "");
      })
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente profilen"));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    brukere
      .egneVarsler(orgId)
      .then((r) => {
        const verdier = { ...VARSEL_STANDARD, ...r.prefs };
        setVarsler(verdier);
        setVarslerStart(verdier);
      })
      .catch(() => {
        setVarsler({ ...VARSEL_STANDARD });
        setVarslerStart({ ...VARSEL_STANDARD });
      });
  }, [orgId]);

  const profilEndret =
    profil !== null && (navn !== profil.name || telefon !== (profil.phone ?? ""));
  const varslerEndret =
    varsler !== null &&
    varslerStart !== null &&
    VARSLER.some((v) => varsler[v.nokkel] !== varslerStart[v.nokkel]);

  /**
   * Lagrer BÅDE profilfeltene og varslene, uansett hvilken fane man står på.
   *
   * Med faner er alternativet én «Lagre» per fane, og da mister man endringen i den andre
   * fanen idet man trykker. Én knapp som skriver alt som er endret er det brukeren tror
   * skjer — og prikkene i fanerekken viser hva det gjelder.
   */
  async function lagre() {
    setLagrer(true);
    setFeil(null);
    try {
      await meg.lagre({ name: navn.trim(), phone: telefon.trim() || null });
      // Feltene skrives inn i den HENTEDE profilen, ikke erstattet av svaret: PUT-en i
      // api/meg svarer med sesjonsbrukeren pluss de endrede feltene — uten `organisasjoner`.
      // Brukte vi svaret, ville «Mine lag» blitt tom idet man lagret navnet sitt.
      setProfil((f) => (f ? { ...f, name: navn.trim(), phone: telefon.trim() || null } : f));
      if (orgId && varsler) {
        await brukere.settEgneVarsler(orgId, varsler);
        setVarslerStart(varsler);
      }
      setLagret(true);
      onLagret();
      setTimeout(() => setLagret(false), 2000);
    } catch (e) {
      setFeil(e instanceof Error ? e.message : "Kunne ikke lagre");
    } finally {
      setLagrer(false);
    }
  }

  /**
   * Utlogging går gjennom Better Auth, ikke ved å tømme `localStorage` som i v1.
   * Forskjellen er at sesjonen faktisk avsluttes på SERVEREN — et token som bare er slettet
   * i nettleseren er fortsatt gyldig til det utløper av seg selv.
   */
  async function loggUt() {
    await signOut();
    window.location.href = "/logg-inn";
  }

  const aktiv = profil?.organisasjoner.find((o) => o.id === orgId) ?? null;

  const faner: ReadonlyArray<Fanevalg<Fane>> = [
    { nokkel: "profil", etikett: "Profil", Ikon: User, endret: profilEndret },
    // Varslene ligger på MEDLEMSKAPET. Uten et aktivt lag finnes de ikke, og en fane som
    // bare kan si «ikke tilgjengelig» er verre enn ingen fane.
    ...(orgId ? [{ nokkel: "varsler" as const, etikett: "Varsler", Ikon: Bell, endret: varslerEndret }] : []),
    { nokkel: "lag", etikett: "Mine lag", Ikon: Building2 },
    { nokkel: "sikkerhet", etikett: "Passord", Ikon: KeyRound },
    // Egen fane, ikke en seksjon under passord: tofaktor er en beslutning man tar én gang og
    // sjelden rører igjen, og den skal kunne finnes uten å scrolle forbi et passordskjema.
    { nokkel: "tofaktor", etikett: "Tofaktor", Ikon: ShieldCheck },
    { nokkel: "aktivitet", etikett: "Aktivitet", Ikon: History },
  ];

  /**
   * «Lagre» står framme på fanene som HAR noe å lagre — og dukker opp på de andre så snart
   * det ligger noe ulagret. Ellers måtte man tilbake til fanen man kom fra for å lagre det
   * prikken i fanerekken sier at man har endret.
   */
  const visLagre = fane === "profil" || fane === "varsler" || profilEndret || varslerEndret;

  return (
    <Fanemodal
      tittel="Min profil"
      onLukk={onLukk}
      faner={faner}
      valgt={fane}
      onVelg={setFane}
      // Ingen identitetsstripe over fanene. Den gjentok det modalen alt sier: navnet og
      // e-posten står som felter i Profil-fanen, laget og adressen står i varselnotatet, og
      // nivået står per lag under «Mine lag». En rad som bare gjentar er en rad som stjeler
      // høyde fra panelet.
      fot={
        <>
          {/* Utloggingen står i bunnraden, ikke i en fane: profilblokken i sidemenyen er
              eneste vei ut av appen, og den veien skal ikke ligge bak et fanevalg. */}
          <button type="button" className="btn btn-ghost" onClick={() => void loggUt()}>
            <LogOut size={15} strokeWidth={1.9} aria-hidden />
            Logg ut
          </button>
          {lagret && (
            <span style={{ fontSize: "var(--fs-label)", color: "var(--accent2)" }}>Lagret.</span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: "10px" }}>
            <button type="button" className="btn btn-ghost" onClick={onLukk}>
              Lukk
            </button>
            {visLagre && (
              // Vanlig knapp, ikke `submit`: den står i bunnraden UTENFOR panelets skjema, og
              // skal virke også fra en fane som ikke har noe skjema i seg.
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void lagre()}
                disabled={lagrer || !navn.trim() || !(profilEndret || varslerEndret)}
              >
                {lagrer ? "Lagrer …" : "Lagre"}
              </button>
            )}
          </div>
        </>
      }
    >
      <Feil melding={feil} />

      {fane === "profil" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void lagre();
          }}
          style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        >
          <Tekstfelt
            etikett="Navn"
            verdi={navn}
            onEndre={setNavn}
            notat="Navnet vises på det du kvitterer ut og melder — i alle lag du sitter i."
          />
          <Tekstfelt
            etikett="E-postadresse"
            verdi={profil?.email ?? ""}
            onEndre={() => {}}
            laast
            notat="E-posten er innloggingsnavnet ditt og kan ikke endres her."
          />
          <Tekstfelt
            etikett="Telefon"
            verdi={telefon}
            onEndre={setTelefon}
            plassholder="Valgfritt"
            notat="Brukes når noen i laget trenger å nå deg om en oppgave eller et avvik."
          />
        </form>
      )}

      {fane === "varsler" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void lagre();
          }}
          style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        >
          <div className="field">
            <div className="field-note">
              Hvilke e-poster du får fra {aktiv?.name ?? "denne organisasjonen"}, sendt til{" "}
              {profil?.email ?? "din adresse"}. Sitter du i flere lag, settes de hver for seg.
            </div>
            {varsler === null ? (
              <div className="field-note">Henter …</div>
            ) : (
              VARSLER.map((v) => (
                <label key={v.nokkel} className="varsel-valg">
                  <input
                    type="checkbox"
                    checked={varsler[v.nokkel] ?? false}
                    onChange={(e) => setVarsler({ ...varsler, [v.nokkel]: e.target.checked })}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span className="varsel-navn">{v.etikett}</span>
                    <span className="varsel-desc">{v.beskrivelse}</span>
                  </span>
                </label>
              ))
            )}
          </div>
        </form>
      )}

      {fane === "lag" && <MineLag profil={profil} aktivOrgId={orgId} />}

      {fane === "sikkerhet" && <Sikkerhet />}

      {fane === "tofaktor" && (
        <Tofaktor
          pa={profil?.twoFactorEnabled ?? false}
          plattformadmin={erPlattformadminRolle(profil?.role)}
          onEndret={() => meg.hent().then(setProfil).catch(() => {})}
        />
      )}

      {fane === "aktivitet" && <MinAktivitetPanel orgId={orgId} onLukk={onLukk} />}
    </Fanemodal>
  );
}

/**
 * Tofaktor med engangskode fra telefonen (TOTP).
 *
 * ## Hva som IKKE er nytt her
 *
 * Selve mekanismen har vært på plass siden Better Auths `twoFactor`-plugin ble satt opp i
 * `lib/auth.ts`: kolonnen i `users`, hemmelighetstabellen, og trinn to i innloggingen
 * (`logg-inn/skjema.tsx`). Det som manglet var veien INN — en bruker hadde ingen måte å slå
 * det på. Denne fanen er den veien, og ingenting annet.
 *
 * ## Fire steg, i denne rekkefølgen med vilje
 *
 * 1. **Passord.** Å skru på tofaktor er en sikkerhetsendring, og den skal koste at du beviser
 *    at det er deg — ikke bare at nettleseren din står ulåst. Better Auth krever det.
 * 2. **QR-kode.** Tegnes i NETTLESEREN. Hemmeligheten kommer i svaret fra `enable` og skal
 *    ikke innom en ekstra server for å bli et bilde.
 * 3. **Bekreft med en kode.** `skipVerificationOnEnable` står AV i auth.ts, så tofaktor er
 *    ikke i kraft før en gyldig kode er tastet. Uten det steget kunne noen aktivert 2FA med
 *    en QR-kode de aldri skannet — og låst seg selv ute ved neste innlogging.
 * 4. **Backup-koder.** Vises ÉN gang, etter bekreftelsen. Mister du telefonen, er de eneste
 *    veien inn; derfor står de i et eget felt man kan kopiere, ikke i en setning man skummer.
 *
 * ## Påkrevd for plattformadmin
 *
 * Skal komme, men håndheves ikke her. Riktig sted er `sjekkInnloggingssperrer` i
 * `lib/tilgang.ts`, som allerede kjøres på hver innlogging — en sperre i UI-et er ingen
 * sperre. Fanen sier det til plattformadminer, slik at de kan slå det på før det blir et krav.
 */
function Tofaktor({
  pa,
  plattformadmin,
  onEndret,
}: {
  pa: boolean;
  plattformadmin: boolean;
  onEndret: () => void;
}) {
  type Steg = "oversikt" | "passord" | "bekreft";
  const [steg, setSteg] = useState<Steg>("oversikt");
  const [passord, setPassord] = useState("");
  const [kode, setKode] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [hemmelighet, setHemmelighet] = useState<string | null>(null);
  const [backupkoder, setBackupkoder] = useState<string[] | null>(null);
  const [feil, setFeil] = useState<string | null>(null);
  const [jobber, setJobber] = useState(false);
  /** Satt når vi er inne i avslåing i stedet for påslåing — samme passordsteg, ulik handling. */
  const [slarAv, setSlarAv] = useState(false);

  function nullstill() {
    setSteg("oversikt");
    setPassord("");
    setKode("");
    setQr(null);
    setHemmelighet(null);
    setFeil(null);
    setSlarAv(false);
  }

  /** Steg 1 → 2: passordet gir oss hemmeligheten, og vi gjør den til et bilde. */
  async function startOppsett() {
    setJobber(true);
    setFeil(null);
    const svar = await authKlient.twoFactor.enable({ password: passord });
    if (svar.error) {
      setJobber(false);
      setFeil(svar.error.message ?? "Feil passord, eller oppsettet kunne ikke startes.");
      return;
    }
    // Backup-kodene kommer HER, sammen med hemmeligheten — men vises først etter at koden er
    // bekreftet. Vises de før, har brukeren nøkler til en dør som ikke er satt inn ennå.
    setBackupkoder(svar.data?.backupCodes ?? null);
    const uri = svar.data?.totpURI ?? "";
    // `secret`-parameteren, for den som skriver hemmeligheten inn manuelt i stedet for å
    // skanne. Alle authenticator-apper tar imot begge veier.
    setHemmelighet(new URL(uri).searchParams.get("secret"));
    // `qrcode` er allerede en avhengighet (oppgavearkene bruker den) og har en egen
    // nettleservariant — `fs` er mappet bort i pakkens `browser`-felt.
    const QRCode = (await import("qrcode")).default;
    setQr(await QRCode.toDataURL(uri, { margin: 1, width: 220 }));
    setPassord("");
    setJobber(false);
    setSteg("bekreft");
  }

  /** Steg 3: koden setter tofaktor i kraft. Før dette er ingenting slått på. */
  async function bekreft() {
    setJobber(true);
    setFeil(null);
    const svar = await authKlient.twoFactor.verifyTotp({ code: kode.trim() });
    setJobber(false);
    if (svar.error) {
      setFeil(svar.error.message ?? "Koden stemmer ikke. Prøv den som står i appen nå.");
      return;
    }
    setKode("");
    setQr(null);
    setHemmelighet(null);
    setSteg("oversikt");
    onEndret();
  }

  async function slaAv() {
    setJobber(true);
    setFeil(null);
    const svar = await authKlient.twoFactor.disable({ password: passord });
    setJobber(false);
    if (svar.error) {
      setFeil(svar.error.message ?? "Feil passord — tofaktor er ikke slått av.");
      return;
    }
    setBackupkoder(null);
    nullstill();
    onEndret();
  }

  // ── Passordsteget, felles for på og av ────────────────────────────────────────────────
  if (steg === "passord") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (slarAv ? slaAv() : startOppsett());
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <span className="field-label">{slarAv ? "Slå av tofaktor" : "Slå på tofaktor"}</span>
        <Feil melding={feil} />
        <Tekstfelt
          etikett="Passordet ditt"
          type="password"
          verdi={passord}
          onEndre={setPassord}
          notat={
            slarAv
              ? "Å fjerne tofaktor svekker kontoen din, og da skal det bevises at det er deg."
              : "Bekrefter at det er deg som slår på tofaktor, ikke en åpen nettleser."
          }
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button type="button" className="btn btn-ghost" onClick={nullstill}>
            Avbryt
          </button>
          <button className={`btn ${slarAv ? "btn-danger" : "btn-primary"}`} disabled={jobber || !passord}>
            {jobber ? "Vent …" : slarAv ? "Slå av tofaktor" : "Fortsett"}
          </button>
        </div>
      </form>
    );
  }

  // ── QR-koden og bekreftelsen ──────────────────────────────────────────────────────────
  if (steg === "bekreft") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void bekreft();
        }}
        style={{ display: "flex", flexDirection: "column", gap: "15px" }}
      >
        <span className="field-label">Skann koden i authenticator-appen</span>
        <Feil melding={feil} />
        <div className="tofa-oppsett">
          {/* `<img>` og ikke `next/image`: kilden er en data-URI laget i nettleseren dette
              sekundet. Det finnes ingen fil å optimalisere, ingen URL å cache — og bildet
              inneholder kontoens tofaktor-hemmelighet, som ikke skal innom en bildeproxy. */}
          {qr && (
            <img src={qr} alt="QR-kode for tofaktor" width={220} height={220} className="tofa-qr" />
          )}
          <div style={{ minWidth: 0, flex: "1 1 220px" }}>
            <div className="field-note" style={{ lineHeight: 1.6 }}>
              Bruk Google Authenticator, Microsoft Authenticator, 1Password eller en annen
              authenticator-app. Kan du ikke skanne, skriv inn nøkkelen under manuelt.
            </div>
            {hemmelighet && <code className="tofa-hemmelighet">{hemmelighet}</code>}
          </div>
        </div>
        <Tekstfelt
          etikett="Koden fra appen"
          verdi={kode}
          onEndre={setKode}
          plassholder="6 siffer"
          notat="Tofaktor er ikke slått på før denne koden er godkjent."
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button type="button" className="btn btn-ghost" onClick={nullstill}>
            Avbryt
          </button>
          <button className="btn btn-primary" disabled={jobber || kode.trim().length < 6}>
            {jobber ? "Sjekker …" : "Bekreft og slå på"}
          </button>
        </div>
      </form>
    );
  }

  // ── Oversikten ────────────────────────────────────────────────────────────────────────
  return (
    <>
      <Feil melding={feil} />

      <div className="field">
        <span className="field-label">Tofaktor</span>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span className={`badge ${pa ? "ok" : "muted"}`}>{pa ? "Slått på" : "Ikke slått på"}</span>
          <span className="field-note" style={{ margin: 0 }}>
            {pa
              ? "Ved innlogging spør vi om en engangskode fra appen din."
              : "Innlogging krever bare passordet ditt."}
          </span>
        </div>
        <div className="field-note" style={{ marginTop: "8px", lineHeight: 1.6 }}>
          Med tofaktor holder det ikke å kjenne passordet ditt — man må også ha telefonen din.
          Det er det enkeltgrepet som beskytter kontoen best, og det tar to minutter å sette opp.
        </div>
      </div>

      {/* Kodene vises ÉN gang, rett etter bekreftelsen. Blir de stående på skjermen etter at
          fanen er forlatt, er de ikke lenger noe brukeren har tatt vare på — de er noe som
          ligger framme. */}
      {backupkoder && backupkoder.length > 0 && (
        <div className="field">
          <span className="field-label">Backup-koder — skriv dem ned nå</span>
          <div className="field-note" style={{ marginBottom: "6px" }}>
            Hver kode kan brukes én gang, og de vises ikke igjen. Mister du telefonen, er de
            eneste veien inn i kontoen din.
          </div>
          <code className="tofa-backup">{backupkoder.join("\n")}</code>
          <button
            type="button"
            className="btn btn-ghost profil-handling"
            style={{ marginTop: "8px" }}
            onClick={() => setBackupkoder(null)}
          >
            Jeg har lagret dem
          </button>
        </div>
      )}

      {plattformadmin && (
        <div className="tips-stripe">
          <span style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6 }}>
            🛡 <b>Du er plattformadministrator i DriftIQ.</b> Tofaktor blir påkrevd for
            plattformkontoer — slå det på nå, så merker du ikke overgangen.
          </span>
        </div>
      )}

      <div className="field">
        {pa ? (
          <button
            type="button"
            className="btn btn-ghost profil-handling fjern-knapp"
            onClick={() => {
              setSlarAv(true);
              setSteg("passord");
            }}
          >
            Slå av tofaktor
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary profil-handling"
            onClick={() => {
              setSlarAv(false);
              setSteg("passord");
            }}
          >
            Slå på tofaktor
          </button>
        )}
      </div>
    </>
  );
}

/**
 * «Min aktivitet» — hva du har gjort i dette laget, siste året.
 *
 * ## Hvorfor lista kan være tom selv om du har gjort noe
 *
 * Historikken lagrer navnet KOPIERT INN, ikke en peker til brukeren — en utkvittering skal
 * fortsatt vise hvem som gjorde jobben etter at kontoen er fjernet. Oppslaget må derfor gå
 * baklengs, fra navnet du har nå til radene som bærer det. Bytter du navn, blir de gamle
 * radene stående i loggen under det gamle navnet, og de finnes ikke igjen her.
 *
 * Det står i panelet, ikke bare i denne kommentaren. En tom liste som ikke forklarer seg
 * leses som at systemet har mistet arbeidet ditt.
 */
function MinAktivitetPanel({ orgId, onLukk }: { orgId: string | null; onLukk: () => void }) {
  const [data, setData] = useState<MinAktivitet | null>(null);
  const [feil, setFeil] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    brukere
      .egenAktivitet(orgId)
      .then(setData)
      .catch((e) => setFeil(e instanceof Error ? e.message : "Kunne ikke hente aktiviteten"));
  }, [orgId]);

  if (!orgId) {
    return <div className="field-note">Velg et lag i sidemenyen for å se aktiviteten din der.</div>;
  }
  if (feil) return <Feil melding={feil} />;
  if (data === null) return <div className="field-note">Henter …</div>;

  // Bare slagene som HAR noe. En rad med «0 avvik meldt» er ikke informasjon, den er en
  // påminnelse om alt du ikke har gjort.
  const medInnhold = AKTIVITETSSLAG.filter((s) => data.antall[s] > 0);

  return (
    <>
      {medInnhold.length > 0 && (
        <div className="akt-sum">
          {medInnhold.map((s) => (
            <span key={s} className="akt-sum-post">
              <b>{data.antall[s]}</b>{" "}
              {data.antall[s] === 1 ? SLAG[s].entall : SLAG[s].flertall}
            </span>
          ))}
        </div>
      )}

      {data.hendelser.length === 0 ? (
        <div className="field-note" style={{ lineHeight: 1.6 }}>
          Ingen aktivitet registrert på <strong>{data.navn}</strong> i dette laget siden{" "}
          {dato(data.fra)}.
          <br />
          Vi finner igjen aktivitet på navnet ditt slik det sto på føringen. Har du byttet navn,
          står det du gjorde før byttet i loggen under det gamle navnet.
        </div>
      ) : (
        <>
          <div className="akt-liste">
            {data.hendelser.map((h, i) => {
              const Ikon =
                (ikoner as unknown as Record<string, LucideIcon>)[SLAG[h.slag].ikon] ?? ikoner.Dot;
              // Lenke når raden har en side å gå til — og da må modalen lukkes, ellers
              // navigerer man bak et overlegg som fortsatt dekker skjermen.
              const innhold = (
                <>
                  <span className={`akt-ikon ${h.slag}`} aria-hidden>
                    <Ikon size={15} strokeWidth={1.9} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="akt-tittel">{h.tittel}</span>
                    <span className="akt-meta">
                      {SLAG[h.slag].etikett}
                      {h.detalj && ` · ${h.detalj}`}
                    </span>
                  </span>
                  <span className="akt-dato">{dato(h.dato)}</span>
                </>
              );

              return h.sti ? (
                <Link
                  key={`${h.slag}-${h.dato}-${i}`}
                  href={h.sti}
                  className="akt-rad lenke"
                  onClick={onLukk}
                >
                  {innhold}
                </Link>
              ) : (
                <div key={`${h.slag}-${h.dato}-${i}`} className="akt-rad">
                  {innhold}
                </div>
              );
            })}
          </div>
          <div className="field-note">
            Siste året, fra {dato(data.fra)}. Funnet på navnet <strong>{data.navn}</strong> —
            aktivitet ført under et tidligere navn står i loggen, men ikke her.
          </div>
        </>
      )}
    </>
  );
}

/**
 * Lagene man sitter i — med nivå og verv per lag.
 *
 * Read-only med vilje: org-VELGEREN står øverst i sidemenyen, og to steder å bytte lag fra
 * er ett for mange. Denne fanen svarer på et annet spørsmål — «hvor har jeg tilgang, og som
 * hva?» — og det spørsmålet har ikke hatt noe svar i UI-et før nå.
 */
function MineLag({ profil, aktivOrgId }: { profil: MegSvar | null; aktivOrgId: string | null }) {
  const lag = profil?.organisasjoner ?? [];

  if (profil === null) return <div className="field-note">Henter …</div>;
  if (lag.length === 0) {
    return (
      <div className="field-note">
        Du er ikke medlem i noen organisasjon. Har du fått en invitasjon, må den som sendte den
        legge deg inn på nytt.
      </div>
    );
  }

  return (
    <div className="field">
      <div className="field-note" style={{ marginBottom: "4px" }}>
        Tilgangen din settes per lag av deres egen kontoadmin — den samme personen kan ha ulikt
        nivå i to lag.
      </div>
      {lag.map((o) => (
        <div key={o.id} className="lag-rad">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="lag-navn">{o.name}</div>
            <div className="lag-meta">
              {/* Etiketten, ikke råverdien — «orgadmin» er et kodenavn. */}
              {o.tittel?.trim() ? `${o.tittel} · ` : ""}
              {NIVA_ETIKETT[o.nivaa] ?? o.nivaa}
            </div>
          </div>
          {o.id === aktivOrgId && <span className="badge info">Du er her nå</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * Passordbytte gjennom Better Auth, og hva sikkerhetsfanen skal romme.
 *
 * Byttet står nå I fanen, ikke i en egen modal bak en knapp: et skritt mindre, og man mister
 * ikke resten av profilen mens man gjør det. Skjemaet er sitt EGET `<form>` — passordbytte og
 * profillagring er to ulike skrivinger, og nøstede `<form>` er ugyldig HTML.
 *
 * `revokeOtherSessions` er satt: bytter du passord fordi du tror noen andre har det, hjelper
 * det lite om deres innlogging fortsetter å virke.
 */
function Sikkerhet() {
  const [naa, setNaa] = useState("");
  const [nytt, setNytt] = useState("");
  const [gjenta, setGjenta] = useState("");
  const [feil, setFeil] = useState<string | null>(null);
  const [byttet, setByttet] = useState(false);
  const [lagrer, setLagrer] = useState(false);

  async function bytt() {
    if (nytt.length < 8) return setFeil("Passordet må være minst 8 tegn.");
    if (nytt !== gjenta) return setFeil("De to passordene er ikke like.");
    setLagrer(true);
    setFeil(null);
    const svar = await authKlient.changePassword({
      currentPassword: naa,
      newPassword: nytt,
      revokeOtherSessions: true,
    });
    setLagrer(false);
    if (svar.error) {
      setFeil(svar.error.message ?? "Kunne ikke bytte passord. Stemmer det nåværende passordet?");
      return;
    }
    // Modalen lukkes IKKE. Byttet er ikke det man kom for å gjøre nødvendigvis — man kan ha
    // vært innom for varslene også, og den jobben skal ikke avbrytes av en kvittering.
    setNaa("");
    setNytt("");
    setGjenta("");
    setByttet(true);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void bytt();
      }}
      style={{ display: "flex", flexDirection: "column", gap: "15px" }}
    >
      <span className="field-label">Bytt passord</span>
      <Feil melding={feil} />
      {byttet && (
        <div className="field-note" style={{ color: "var(--accent2)" }}>
          Passordet er byttet. Andre enheter du var logget inn på er logget ut.
        </div>
      )}
      <Tekstfelt etikett="Nåværende passord" type="password" verdi={naa} onEndre={setNaa} />
      <Tekstfelt
        etikett="Nytt passord"
        type="password"
        verdi={nytt}
        onEndre={setNytt}
        notat="Minst 8 tegn."
      />
      <Tekstfelt etikett="Gjenta nytt passord" type="password" verdi={gjenta} onEndre={setGjenta} />
      <div className="field-note">
        Andre enheter du er logget inn på blir logget ut. Bytter du passord fordi noen andre
        kan ha hatt det, er det nettopp det du vil.
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="btn btn-primary" disabled={lagrer || !naa || !nytt || !gjenta}>
          {lagrer ? "Bytter …" : "Bytt passord"}
        </button>
      </div>
    </form>
  );
}
