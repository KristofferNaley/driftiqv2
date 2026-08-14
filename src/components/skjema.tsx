"use client";

// React-typen importeres under et ANNET navn med vilje. Heter den `KeyboardEvent` her, skygger
// den over DOM-ens globale `KeyboardEvent` for hele fila — og `window.addEventListener("keydown", …)`
// nede i `Modal` slutter å kompilere, med en overload-feil som peker på lytteren og ikke på
// importen som forårsaket den.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactTastetrykk,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Modal og skjemafelter. Delt av alle detaljvisningene.
 *
 * Modalen lukkes med Escape og ved klikk utenfor. Begge deler er forventet oppførsel, og
 * begge glemmes lett når hver side lager sin egen — resultatet er at halvparten av dem
 * fanger brukeren i et skjema de ikke finner ut av.
 */

export function Modal({
  tittel,
  onLukk,
  children,
  bredde = 520,
  utenPolstring,
}: {
  tittel: string;
  onLukk: () => void;
  children: ReactNode;
  bredde?: number;
  /**
   * Skru av kroppens polstring og scrolling, og la innholdet eie hele flaten.
   *
   * For modaler som har sine EGNE faste soner — en fanerad som skal gå kant til kant, en
   * bunnrad som skal stå stille mens innholdet scroller. Med standardpolstringen scroller
   * kroppen som én blokk, og da forsvinner «Lagre» oppover idet skjemaet blir langt.
   */
  utenPolstring?: boolean;
}) {
  useEffect(() => {
    const påEsc = (e: KeyboardEvent) => e.key === "Escape" && onLukk();
    window.addEventListener("keydown", påEsc);
    return () => window.removeEventListener("keydown", påEsc);
  }, [onLukk]);

  return (
    <div
      onClick={onLukk}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        zIndex: 60,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={tittel}
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "100%", maxWidth: `${bredde}px`, maxHeight: "88dvh", display: "flex", flexDirection: "column" }}
      >
        <div className="card-header">
          {/* Egen klasse: korttitlene ellers er små og KAPITALISERTE etiketter, men her er
              tittelen objektets NAVN — «Vaktmestertjenester Vest AS» skal leses som navn. */}
          <div className="card-title modal-tittel">{tittel}</div>
          <button className="btn btn-ghost" onClick={onLukk} aria-label="Lukk">
            ✕
          </button>
        </div>
        <div
          style={
            utenPolstring
              ? // `minHeight: 0` er ikke pynt: uten den nekter en flex-boks å bli kortere enn
                // innholdet, og de indre panelene får aldri en høyde de kan scrolle innenfor.
                { display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }
              : { padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "15px" }
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Skuff fra høyre — modalens søster for redigering av ETT objekt fra en liste.
 *
 * Forskjellen fra `Modal` er hva som skjer bak: lista og oversikten står synlige ved siden
 * av, så man beholder konteksten mens man justerer én rad. Først bygget for risikovurderingen,
 * delt her så brukersiden (og de neste) får identisk oppførsel i stedet for hver sin kopi.
 *
 * `fot` står UTENFOR kroppen og scroller ikke — lagreknappen skal aldri forsvinne oppover
 * når skjemaet blir langt. Skjema i kroppen + knapp i foten kobles med `<form id>` og
 * knappens `form`-attributt.
 */
export function Skuff({
  tittel,
  onLukk,
  children,
  fot,
}: {
  tittel: string;
  onLukk: () => void;
  children: ReactNode;
  fot?: ReactNode;
}) {
  useEffect(() => {
    const påEsc = (e: KeyboardEvent) => e.key === "Escape" && onLukk();
    window.addEventListener("keydown", påEsc);
    return () => window.removeEventListener("keydown", påEsc);
  }, [onLukk]);

  return (
    <>
      <div className="skuff-scrim" onClick={onLukk} />
      <aside className="skuff" role="dialog" aria-modal="true" aria-label={tittel}>
        <div className="skuff-hode">
          <h2>{tittel}</h2>
          <button className="skuff-lukk" onClick={onLukk} aria-label="Lukk">
            ×
          </button>
        </div>
        <div className="skuff-kropp">{children}</div>
        {fot && <div className="skuff-fot">{fot}</div>}
      </aside>
    </>
  );
}

export type Fanevalg<T extends string> = {
  nokkel: T;
  etikett: string;
  /** Lucide-ikon. Rekken leses raskere med ikoner enn med fem like tekstlinjer. */
  Ikon?: LucideIcon;
  /**
   * Fanen er en SKISSE — den viser hva som kommer, og har ingenting å lagre.
   *
   * Faner merket slik samles nederst i rekken, med en skillelinje over den første. De er
   * fullt klikkbare med vilje: en deaktivert fane kan ikke fortelle hva den skal bli, og
   * poenget med å vise den er nettopp å si det.
   */
  kommer?: boolean;
  /** Prikk på fanen: her står det endringer som ikke er lagret. */
  endret?: boolean;
};

/**
 * Modal med VERTIKAL fanerad til venstre.
 *
 * ## Hvorfor vertikalt, og hvorfor faner i det hele tatt
 *
 * «Min profil» var én lang kolonne: navn, telefon, fem varselbrytere, passord og utlogging
 * under hverandre. Den scrollet allerede, og hver ny funksjon gjorde den verre — det er
 * formen som ikke tar imot mer, ikke innholdet som er for stort. Vertikale faner tar imot
 * nye punkter uten å endre resten: rekken vokser nedover, der det er plass, mens en
 * horisontal fanerad må brekke om eller scrolle sidelengs så snart den blir full.
 *
 * ## Tre soner som IKKE scroller
 *
 * Toppen (hvem dette er), fanerekken og bunnraden står stille; bare panelet i midten
 * scroller. Uten det forsvinner «Lagre» oppover i det ene panelet som er langt, og brukeren
 * må scrolle for å finne knappen som lagrer det de nettopp skrev.
 *
 * Kroppen er IKKE et `<form>`. Panelene eier sine egne skjemaer — profilfeltene og
 * passordbyttet er to ulike lagringer, og nøstede `<form>` er ugyldig HTML. Kallstedet lar
 * bunnradens knapp kalle lagringen direkte, slik at den virker også fra en fane uten skjema,
 * mens panelets eget `<form>` beholder Enter i feltene.
 */
export function Fanemodal<T extends string>({
  tittel,
  onLukk,
  bredde = 760,
  topp,
  faner,
  valgt,
  onVelg,
  fot,
  children,
}: {
  tittel: string;
  onLukk: () => void;
  bredde?: number;
  /** Identitetsstripe e.l. over fanene. Står fast når man bytter fane. */
  topp?: ReactNode;
  faner: ReadonlyArray<Fanevalg<T>>;
  valgt: T;
  onVelg: (n: T) => void;
  /** Fast bunnrad. Kallstedet setter den per fane — en fane uten noe å lagre trenger ingen «Lagre». */
  fot?: ReactNode;
  children: ReactNode;
}) {
  const rad = useRef<HTMLDivElement>(null);
  // Egen id-rot, ellers kolliderer `aria-controls` om to fanemodaler noen gang står oppe samtidig.
  const rot = useId();
  const fanId = (n: string) => `${rot}-fane-${n}`;
  const panelId = `${rot}-panel`;

  /**
   * Piltaster flytter mellom fanene, som i mønsteret for `tablist`.
   *
   * Bare den valgte fanen står i tabbrekkefølgen (`tabIndex`). Ellers må man tabbe gjennom
   * hele rekken for å komme til feltene i panelet — og med seks faner er det seks trykk før
   * man er der man skulle.
   */
  function pilTast(e: ReactTastetrykk<HTMLDivElement>) {
    const steg =
      e.key === "ArrowDown" || e.key === "ArrowRight" ? 1
      : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1
      : 0;
    if (steg === 0) return;
    e.preventDefault();
    const naa = faner.findIndex((f) => f.nokkel === valgt);
    const neste = faner[(naa + steg + faner.length) % faner.length];
    if (!neste) return;
    onVelg(neste.nokkel);
    // Slås opp på `data-fane`, ikke på id-en: `useId()` lager verdier med kolon i seg, og de
    // må escapes i en id-selektor. Attributtselektoren slipper hele det problemet.
    // `HTMLElement` og ikke `HTMLButtonElement`: globallista i eslint.config.mjs er kort med
    // vilje, og `.focus()` ligger på HTMLElement uansett.
    rad.current?.querySelector<HTMLElement>(`[data-fane="${neste.nokkel}"]`)?.focus();
  }

  const forsteKommer = faner.findIndex((f) => f.kommer);

  return (
    <Modal tittel={tittel} onLukk={onLukk} bredde={bredde} utenPolstring>
      <div className="fanemodal">
        {topp && <div className="fanemodal-topp">{topp}</div>}

        <div className="fanemodal-kropp">
          <div
            ref={rad}
            className="sidefaner"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Seksjoner"
            onKeyDown={pilTast}
          >
            {faner.map((f, i) => (
              <button
                key={f.nokkel}
                id={fanId(f.nokkel)}
                data-fane={f.nokkel}
                type="button"
                role="tab"
                aria-selected={valgt === f.nokkel}
                aria-controls={panelId}
                tabIndex={valgt === f.nokkel ? 0 : -1}
                className={`sidefane${valgt === f.nokkel ? " valgt" : ""}${
                  i === forsteKommer ? " skille" : ""
                }`}
                onClick={() => onVelg(f.nokkel)}
              >
                {f.Ikon && <f.Ikon size={15} strokeWidth={1.9} aria-hidden />}
                <span className="sidefane-etikett">{f.etikett}</span>
                {f.kommer && <span className="sidefane-kommer">Kommer</span>}
                {/* Med faner er endringene i de andre panelene usynlige. Prikken er det
                    eneste som sier at det ligger noe ulagret bak en fane du ikke ser. */}
                {f.endret && <span className="sidefane-prikk" title="Ikke lagret" />}
              </button>
            ))}
          </div>

          <div
            id={panelId}
            className="fanemodal-panel"
            role="tabpanel"
            aria-labelledby={fanId(valgt)}
          >
            {children}
          </div>
        </div>

        {fot && <div className="fanemodal-fot">{fot}</div>}
      </div>
    </Modal>
  );
}

/**
 * «Kommer» — hva fanen skal bli, med ord om hva som faktisk mangler.
 *
 * Punktene er konkrete med vilje. En tom fane som bare sier «kommer snart» er et løfte uten
 * innhold; en liste over hva som skal stå der er noe brukeren kan si seg uenig i.
 */
export function Kommer({
  Ikon,
  tekst,
  punkter,
  notat,
}: {
  Ikon?: LucideIcon;
  tekst: string;
  punkter: readonly string[];
  /** Hva som står i veien i dag. Uten dette leses lista som noe som er rett rundt hjørnet. */
  notat?: string;
}) {
  return (
    <div className="kommer-panel">
      <div className="kommer-hode">
        {Ikon && (
          <span className="kommer-ikon" aria-hidden>
            <Ikon size={19} strokeWidth={1.7} />
          </span>
        )}
        <span className="badge muted">Kommer</span>
      </div>
      <p className="kommer-tekst">{tekst}</p>
      <ul className="kommer-liste">
        {punkter.map((p) => (
          <li key={p} className="kommer-punkt">
            {p}
          </li>
        ))}
      </ul>
      {notat && <div className="field-note">{notat}</div>}
    </div>
  );
}

export function Felt({
  etikett,
  notat,
  children,
}: {
  etikett: string;
  notat?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label">{etikett}</label>
      {children}
      {notat && <div className="field-note">{notat}</div>}
    </div>
  );
}

export function Tekstfelt({
  etikett,
  verdi,
  onEndre,
  type = "text",
  notat,
  plassholder,
  laast,
}: {
  etikett: string;
  verdi: string;
  onEndre: (v: string) => void;
  type?: string;
  notat?: string;
  plassholder?: string;
  /** Vis verdien, men ikke la den endres — for felter som e-post, der verdien er nøkkelen. */
  laast?: boolean;
}) {
  return (
    <Felt etikett={etikett} notat={notat}>
      <input
        className="input"
        type={type}
        value={verdi}
        placeholder={plassholder}
        disabled={laast}
        onChange={(e) => onEndre(e.target.value)}
      />
    </Felt>
  );
}

export function Tekstomrade({
  etikett,
  verdi,
  onEndre,
  notat,
  plassholder,
}: {
  etikett: string;
  verdi: string;
  onEndre: (v: string) => void;
  notat?: string;
  plassholder?: string;
}) {
  return (
    <Felt etikett={etikett} notat={notat}>
      <textarea
        className="textarea"
        value={verdi}
        placeholder={plassholder}
        onChange={(e) => onEndre(e.target.value)}
      />
    </Felt>
  );
}

export function Nedtrekk({
  etikett,
  verdi,
  valg,
  onEndre,
  notat,
}: {
  etikett: string;
  verdi: string;
  valg: ReadonlyArray<{ verdi: string; etikett: string }>;
  onEndre: (v: string) => void;
  notat?: string;
}) {
  return (
    <Felt etikett={etikett} notat={notat}>
      <select className="select" value={verdi} onChange={(e) => onEndre(e.target.value)}>
        {valg.map((v) => (
          <option key={v.verdi} value={v.verdi}>
            {v.etikett}
          </option>
        ))}
      </select>
    </Felt>
  );
}

export function Avkryssing({
  etikett,
  verdi,
  onEndre,
  notat,
}: {
  etikett: string;
  verdi: boolean;
  onEndre: (v: boolean) => void;
  notat?: string;
}) {
  return (
    <div className="field">
      <label style={{ display: "flex", alignItems: "center", gap: "9px", cursor: "pointer" }}>
        <input type="checkbox" checked={verdi} onChange={(e) => onEndre(e.target.checked)} />
        <span className="field-label" style={{ margin: 0 }}>
          {etikett}
        </span>
      </label>
      {notat && <div className="field-note">{notat}</div>}
    </div>
  );
}

/**
 * Av/på-bryter med teksten til venstre og bryteren HELT til høyre.
 *
 * For innstillinger som er i kraft med en gang (varsler): en bryter sier «dette er PÅ», en
 * avkryssingsboks sier «dette blir valgt når du lagrer». Skjemafelter som lagres med resten
 * skal fortsatt bruke `Avkryssing`.
 */
export function Bryter({
  etikett,
  beskrivelse,
  verdi,
  onEndre,
}: {
  etikett: string;
  beskrivelse?: string;
  verdi: boolean;
  onEndre: (v: boolean) => void;
}) {
  return (
    <label className="bryter-rad">
      <span style={{ minWidth: 0, flex: 1 }}>
        <span className="varsel-navn">{etikett}</span>
        {beskrivelse && <span className="varsel-desc">{beskrivelse}</span>}
      </span>
      {/* Ekte checkbox for tastatur og skjermleser — det visuelle er spennet etterpå. */}
      <input
        type="checkbox"
        role="switch"
        className="bryter-boks"
        checked={verdi}
        onChange={(e) => onEndre(e.target.checked)}
      />
      <span className="bryter" aria-hidden />
    </label>
  );
}

/** Knapperad nederst i en modal. Primærhandlingen til høyre, som ellers i appen. */
export function Knapperad({
  onAvbryt,
  avbrytEtikett = "Avbryt",
  sendEtikett = "Lagre",
  sender,
  deaktivert,
  farlig,
  onSend,
}: {
  onAvbryt: () => void;
  /** «Tilbake» når raden står i et steg som har et steg foran seg. */
  avbrytEtikett?: string;
  sendEtikett?: string;
  sender?: boolean;
  deaktivert?: boolean;
  farlig?: boolean;
  /** Gjør knappen til en vanlig knapp i stedet for submit — for bekreftelsesdialoger. */
  onSend?: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
      <button type="button" className="btn btn-ghost" onClick={onAvbryt}>
        {avbrytEtikett}
      </button>
      <button
        type={onSend ? "button" : "submit"}
        onClick={onSend}
        className={`btn ${farlig ? "btn-danger" : "btn-primary"}`}
        disabled={sender || deaktivert}
      >
        {sender ? "Lagrer …" : sendEtikett}
      </button>
    </div>
  );
}

/** Håndterer send-tilstand og feil for et modalskjema, så hver side slipper å gjenta det. */
export function useSending(onFerdig: () => void) {
  const [sender, setSender] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);

  async function send(handling: () => Promise<unknown>) {
    setSender(true);
    setFeil(null);
    try {
      await handling();
      onFerdig();
    } catch (e) {
      // API-ets egne norske meldinger — duplikatnummer, kvote, låst runde — havner her.
      setFeil(e instanceof Error ? e.message : "Noe gikk galt");
    } finally {
      setSender(false);
    }
  }

  return { sender, feil, send };
}
