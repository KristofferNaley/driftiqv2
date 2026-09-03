"use client";

import { FileSpreadsheet, Link2, Sheet } from "lucide-react";
import { Kort } from "@/components/felles";
import { Kommer } from "@/components/skjema";

/**
 * Regnskapskoblingen — det som KOMMER, og det som virker uten den.
 *
 * Fanen er en skisse med vilje (se `Kommer` i skjema.tsx): den sier hva koblingen skal
 * gjøre, i ord brukeren kan si seg uenig i, i stedet for en tom fane. Rekkefølgen og
 * grensene står i docs/fiken.md — DriftIQ oppretter fakturaer og kontakter i regnskapet,
 * bokfører aldri kjøp, sletter aldri, endrer aldri noe det ikke selv har laget.
 */
export default function Integrasjon() {
  return (
    <div className="ok-to-kolonner">
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Kort tittel="Fiken">
          <Kommer
            Ikon={Link2}
            tekst="Sameiet kobler sitt eget Fiken-foretak til DriftIQ. DriftIQ styrer, Fiken fører: budsjett, brøk, sats og fakturagrunnlag lever her — bokføring, utsending, betalingsoppfølging og årsoppgjør lever i Fiken."
            punkter={[
              "Eiere som er fakturamottakere opprettes som kontakter i Fiken, merket med seksjonen så koblingen overlever navnebytte",
              "Halvårskjøringen oppretter seks fakturaer per seksjon i Fiken med fremtidig dato og forfall den 15., og lar Fiken sende dem (e-post, EHF eller eFaktura)",
              "Betalingsstatus leses tilbake hver natt — «hvem har ikke betalt» per seksjon uten at DriftIQ rører en krone",
              "Bokførte kjøp speiles inn som «faktisk» på budsjettlinjene etter kontointervall, og på leverandørkortet",
              "Eierskifte midt i halvåret krediterer resterende fakturaer og lager nye til ny eier — én handling",
            ]}
            notat="Fiken-appen «DriftIQ» er registrert i utviklingsmodus. Produksjonsgodkjenning hos Fiken søkes når koblingen er klikkbar i testmiljøet. KID og AvtaleGiro krever avtale med banken og er ikke avklart."
          />
        </Kort>
        <Kort tittel="Tripletex">
          <Kommer
            Ikon={Sheet}
            tekst="Samme kobling bak samme grensesnitt, for sameier med regnskapsfører på Tripletex. Ingen Fiken-spesifikke felt lagres i DriftIQ, så adapteret byttes uten at grunndataene gjør det."
            punkter={[
              "Eiere blir kunder, felleskostnader blir fakturaer, kontoplanen leses fra Tripletex",
              "Egen innlogging: forbrukertoken og ansatt-token fra Tripletex i stedet for OAuth",
            ]}
            notat="Bygges etter Fiken, når adapter-grensesnittet er bevist i drift."
          />
        </Kort>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <Kort tittel="Virker uten regnskapssystem">
          <div className="ok-integrasjon-tekst">
            <p className="ok-tekst">
              Alt i denne modulen virker i dag uten kobling. Budsjett og satsberegning trenger ingen regnskapssystem, og
              halvårskjøringen lager fakturagrunnlaget som CSV til forretningsfører, regnskapsbyrå eller for manuell
              fakturering fra Fiken.
            </p>
            <ul className="kommer-liste">
              <li className="kommer-punkt">
                <FileSpreadsheet size={14} strokeWidth={1.9} aria-hidden style={{ verticalAlign: "-2px", marginRight: "6px" }} />
                CSV per halvår: seksjon, eier, e-post, fakturaadresse, måned, forfall, beløp og referanse
              </li>
              <li className="kommer-punkt">Kontointervallene i budsjettet følger NS 4102 — samme nummer i Fiken, Tripletex og hos forretningsfører</li>
              <li className="kommer-punkt">Fakturagodkjenningen er styrets egen beslutningslogg; regnskapet bokfører og betaler som før</li>
            </ul>
          </div>
        </Kort>
        <Kort tittel="Grensene for koblingen">
          <ul className="kommer-liste">
            <li className="kommer-punkt">DriftIQ oppretter fakturaer, kreditnotaer og kontakter i regnskapet — bokfører aldri kjøp, sletter aldri, endrer aldri noe det ikke selv har laget</li>
            <li className="kommer-punkt">Felleskostnader føres alltid uten mva på konto 3601; et sameie er normalt utenfor mva-området</li>
            <li className="kommer-punkt">Personlig API-nøkkel brukes aldri i produktet — koblingen er OAuth per sameie</li>
            <li className="kommer-punkt">Kobling og frakobling logges i hendelsesloggen; ved frakobling slettes speilet, fakturahistorikken beholdes</li>
          </ul>
        </Kort>
      </div>
    </div>
  );
}
