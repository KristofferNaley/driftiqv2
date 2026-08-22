/**
 * Webhooks — kundens «varsle oss i Teams/Slack/Discord når …». Ny i v2, ingen v1-fasit.
 *
 * ## Tre regler som bærer modulen
 *
 * 1. **Sending feiler stille.** Et varsel som ikke kom frem skal aldri velte handlingen
 *    brukeren utførte — samme kontrakt som e-post (epost.ts) og driftsvarsler
 *    (driftsvarsel.ts). Feilen føres i stedet på raden (`lastOk`/`lastError`), så
 *    innstillingssiden kan vise at kanalen er død.
 * 2. **URL-en er kundedata som VI poster til.** Serveren står på samme Docker-nett som
 *    Postgres og andre interne tjenester, så en fritt valgt URL er en SSRF-vei inn dit.
 *    `validerWebhookUrl` krever https og avviser interne/private adresser — både ved
 *    lagring og ved sending (raden kan være lagret før regelen kom).
 * 3. **Kalles ETTER commit.** Fra rutehandlere via `etterCommit`, fra bakgrunnsjobber etter
 *    at jobbtransaksjonen er ferdig. `varsleWebhooks` åpner derfor sin egen org-kontekst.
 *
 * ## Formatene
 *
 * Teams' klassiske Incoming Webhook-connectorer er pensjonert (mai 2026) — erstatningen er
 * Workflows (Power Automate), som vil ha meldingen som Adaptive Card. Slack og Discord tar
 * enkel tekst-JSON. `generisk` sender hele hendelsen som strukturert JSON og er kontrakten
 * mot Zapier/Make/n8n og boligbyggelagenes egne systemer — feltene der er utad og skal ikke
 * omdøpes.
 */

import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withOrg, type Db } from "../db/client";
import { organizations } from "../db/schema/organizations";
import { orgWebhooks, type OrgWebhook } from "../db/schema/webhooks";
import type { Aktor } from "./aktor";
import { ikkeFunnet } from "./api";
import { loggHendelse } from "./hendelser";
import { MARKED_URL } from "./urler";
import {
  WEBHOOK_HENDELSER,
  WEBHOOK_TYPER,
  WEBHOOK_TYPE_ETIKETT,
  type WebhookHendelse,
  type WebhookType,
} from "./webhookvalg";

export { WEBHOOK_HENDELSER, WEBHOOK_TYPER, WEBHOOK_TYPE_ETIKETT };

// ---------------------------------------------------------------------------------------
// Validering
// ---------------------------------------------------------------------------------------

/** 10.x, 172.16–31.x, 192.168.x, 127.x, 169.254.x (link-local), 0.x og 100.64/10 (CGNAT). */
function erPrivatIpv4(vert: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(vert);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * Norsk feilmelding, eller null når URL-en er grei å poste til.
 *
 * Sjekken er statisk (ingen DNS-oppslag), og et vertsnavn som PEKER på en intern adresse
 * slipper derfor gjennom her. Det er en akseptert rest: appcontaineren når uansett bare det
 * `edge`-nettet eksponerer, og gevinsten ved DNS-validering står ikke i forhold til at den
 * måtte gjøres på nytt ved hver sending (adressen kan endres etter lagring).
 */
export function validerWebhookUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "Ugyldig adresse — lim inn hele webhook-URL-en";
  }
  if (u.protocol !== "https:") return "Webhook-adressen må bruke https";
  if (u.username || u.password) return "Webhook-adressen kan ikke inneholde brukernavn/passord";

  const vert = u.hostname.toLowerCase();
  const ipv6 = vert.includes(":");
  if (
    vert === "localhost" ||
    !vert.includes(".") || // rene tjenestenavn («postgres», «app») er alltid interne
    vert.endsWith(".local") ||
    vert.endsWith(".internal") ||
    vert.endsWith(".home.arpa") ||
    erPrivatIpv4(vert) ||
    (ipv6 && (vert === "::1" || vert.startsWith("fc") || vert.startsWith("fd") || vert.startsWith("fe80")))
  ) {
    return "Webhook-adressen må peke på en offentlig tjeneste, ikke en intern adresse";
  }
  return null;
}

export const webhookInn = z.object({
  name: z.string().trim().min(1, "Gi webhooken et navn").max(100),
  targetType: z.enum(WEBHOOK_TYPER),
  url: z
    .string()
    .trim()
    .max(1000)
    .superRefine((v, ctx) => {
      const feil = validerWebhookUrl(v);
      if (feil) ctx.addIssue({ code: "custom", message: feil });
    }),
  events: z.array(z.enum(WEBHOOK_HENDELSER)).min(1, "Velg minst én hendelse"),
  active: z.boolean().default(true),
});

/** `events`-kolonnen er en JSON-liste — en ødelagt verdi leses som «ingen», aldri som krasj. */
export function lesEvents(lagret: string): WebhookHendelse[] {
  try {
    const v: unknown = JSON.parse(lagret);
    if (!Array.isArray(v)) return [];
    return v.filter((e): e is WebhookHendelse =>
      (WEBHOOK_HENDELSER as readonly string[]).includes(String(e)),
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------------------

/** Raden slik API-et og UI-et ser den — `events` som liste, ikke som lagret JSON-streng. */
function utad(rad: OrgWebhook) {
  return { ...rad, events: lesEvents(rad.events) };
}

export async function hentWebhooks(db: Db, orgId: string) {
  const rader = await db
    .select()
    .from(orgWebhooks)
    .where(eq(orgWebhooks.orgId, orgId))
    .orderBy(asc(orgWebhooks.createdAt));
  return rader.map(utad);
}

export async function opprettWebhook(
  db: Db,
  orgId: string,
  av: Aktor,
  data: z.infer<typeof webhookInn>,
) {
  const [ny] = await db
    .insert(orgWebhooks)
    .values({
      id: randomUUID(),
      orgId,
      name: data.name,
      targetType: data.targetType,
      url: data.url,
      events: JSON.stringify(data.events),
      active: data.active,
    })
    .returning();
  await loggHendelse(db, orgId, av, {
    modul: "org",
    entitet: "webhook",
    entitetId: ny!.id,
    hendelse: `Opprettet webhook «${data.name}» (${WEBHOOK_TYPE_ETIKETT[data.targetType]})`,
  });
  return utad(ny!);
}

export async function endreWebhook(
  db: Db,
  orgId: string,
  webhookId: string,
  av: Aktor,
  data: z.infer<typeof webhookInn>,
) {
  const [endret] = await db
    .update(orgWebhooks)
    .set({
      name: data.name,
      targetType: data.targetType,
      url: data.url,
      events: JSON.stringify(data.events),
      active: data.active,
    })
    .where(and(eq(orgWebhooks.id, webhookId), eq(orgWebhooks.orgId, orgId)))
    .returning();
  if (!endret) throw ikkeFunnet("Webhook");
  await loggHendelse(db, orgId, av, {
    modul: "org",
    entitet: "webhook",
    entitetId: webhookId,
    hendelse: `Endret webhook «${data.name}»`,
  });
  return utad(endret);
}

export async function slettWebhook(db: Db, orgId: string, webhookId: string, av: Aktor) {
  const [slettet] = await db
    .delete(orgWebhooks)
    .where(and(eq(orgWebhooks.id, webhookId), eq(orgWebhooks.orgId, orgId)))
    .returning();
  if (!slettet) throw ikkeFunnet("Webhook");
  await loggHendelse(db, orgId, av, {
    modul: "org",
    entitet: "webhook",
    entitetId: webhookId,
    hendelse: `Slettet webhook «${slettet.name}»`,
  });
}

// ---------------------------------------------------------------------------------------
// Melding og formater
// ---------------------------------------------------------------------------------------

export type WebhookMelding = {
  /** `test` finnes bare for testknappen — den kan ikke abonneres på, men generisk-mottakere
   *  skal kunne skille en prøvesending fra et ekte avvik. */
  hendelse: WebhookHendelse | "test";
  /** Kort overskrift — «Nytt avvik: Vannlekkasje i garasjen». */
  tittel: string;
  /** Brødtekst i ren tekst; linjeskift beholdes i alle formatene. */
  tekst: string;
  /** Absolutt lenke inn i appen (APP_URL-basert), eller null når det ikke finnes et mål. */
  lenke?: string | null;
  /** Strukturerte felter — sendes kun i generisk-formatet. */
  data?: Record<string, unknown>;
};

/**
 * JSON-kroppen for én måltype. Eksportert for testene — formatene er kontrakter mot
 * tredjeparter og skal låses av tester, ikke av forsiktighet.
 */
export function byggKropp(type: WebhookType, orgNavn: string, m: WebhookMelding): unknown {
  // Avsenderprofilen. Ikonet må ligge på en OFFENTLIG adresse — Discord henter det selv,
  // og markedsverten er den som garantert svarer uten sesjon.
  const AVSENDER = "DriftIQ";
  const IKON = `${MARKED_URL}/ikon-512.png`;

  switch (type) {
    case "discord":
      // <lenke> hindrer Discord i å lage forhåndsvisningskort av app-lenken.
      // `username`/`avatar_url` overstyrer webhookens egen profil per melding, så varselet
      // står som «DriftIQ» med logo uansett hva kunden kalte webhooken sin.
      return {
        username: AVSENDER,
        avatar_url: IKON,
        content: `**${orgNavn} — ${m.tittel}**\n${m.tekst}${m.lenke ? `\n<${m.lenke}>` : ""}`,
      };
    case "slack":
      // `username`/`icon_url` respekteres bare av ELDRE incoming webhooks — moderne
      // Slack-apper ignorerer dem stille (krever chat:write.customize, som en webhook ikke
      // har). Sendes likevel: gratis der det virker, harmløst der det ikke gjør det.
      // Reelt bestemmes avsenderen av appen kunden lager — derav rådet i hjelpeteksten om
      // å kalle den DriftIQ og laste opp logoen.
      return {
        username: AVSENDER,
        icon_url: IKON,
        text: `*${orgNavn} — ${m.tittel}*\n${m.tekst}${m.lenke ? `\n<${m.lenke}|Åpne i DriftIQ>` : ""}`,
      };
    case "teams":
      // Workflows («When a Teams webhook request is received») forventer Adaptive Card i en
      // message-konvolutt — ren tekst-JSON blir avvist eller vist tom. Versjon 1.4 er den
      // høyeste alle Teams-klienter garantert har.
      return {
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
              $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
              type: "AdaptiveCard",
              version: "1.4",
              body: [
                // Avsenderen i Teams er alltid Workflows-boten — det eier Microsoft. Logoen
                // ligger derfor i kortet i stedet, som visuell signatur.
                {
                  type: "ColumnSet",
                  columns: [
                    {
                      type: "Column",
                      width: "auto",
                      items: [{ type: "Image", url: IKON, size: "Small", width: "24px", altText: "DriftIQ" }],
                    },
                    {
                      type: "Column",
                      width: "stretch",
                      verticalContentAlignment: "Center",
                      items: [{ type: "TextBlock", text: `DriftIQ · ${orgNavn}`, size: "Small", isSubtle: true, wrap: true }],
                    },
                  ],
                },
                { type: "TextBlock", text: m.tittel, weight: "Bolder", size: "Medium", wrap: true },
                { type: "TextBlock", text: m.tekst, wrap: true },
              ],
              ...(m.lenke
                ? { actions: [{ type: "Action.OpenUrl", title: "Åpne i DriftIQ", url: m.lenke }] }
                : {}),
            },
          },
        ],
      };
    case "generisk":
      // Kontrakten utad — dokumentert på innstillingssiden. Nye felter kan legges TIL;
      // eksisterende skal ikke omdøpes eller fjernes.
      return {
        hendelse: m.hendelse,
        tidspunkt: new Date().toISOString(),
        organisasjon: orgNavn,
        tittel: m.tittel,
        tekst: m.tekst,
        lenke: m.lenke ?? null,
        data: m.data ?? {},
      };
  }
}

// ---------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------

/**
 * Én POST. Teams-workflows kan bruke flere sekunder på å svare — 10 s før tidsavbrudd.
 * Svarkroppen leses ikke: 2xx er alt vi trenger å vite.
 */
async function post(url: string, kropp: unknown): Promise<{ ok: boolean; feil: string | null }> {
  try {
    const svar = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kropp),
      redirect: "error", // en redirect kunne pekt sendingen mot en intern adresse
      signal: AbortSignal.timeout(10_000),
    });
    return svar.ok ? { ok: true, feil: null } : { ok: false, feil: `HTTP ${svar.status}` };
  } catch (e) {
    const melding = e instanceof Error ? e.message : String(e);
    return { ok: false, feil: melding.includes("abort") ? "Tidsavbrudd (10 s)" : melding.slice(0, 200) };
  }
}

/**
 * Sender til ÉN webhook — uten databasehåndtak, så POST-en aldri holder en transaksjon
 * åpen. Resultatet føres på raden av kalleren (`forStatus`).
 */
export async function sendTilWebhook(
  krok: Pick<OrgWebhook, "targetType" | "url">,
  orgNavn: string,
  melding: WebhookMelding,
): Promise<{ ok: boolean; feil: string | null }> {
  // Valideres også her, ikke bare ved lagring: raden kan være eldre enn regelen som ville
  // stoppet den, og det er sendingen som er den farlige operasjonen.
  const ugyldig = validerWebhookUrl(krok.url);
  if (ugyldig) return { ok: false, feil: ugyldig };
  return post(krok.url, byggKropp(krok.targetType as WebhookType, orgNavn, melding));
}

/** Fører resultatet av siste sending på raden — innstillingssidens eneste feilsignal. */
export async function forStatus(
  db: Db,
  webhookId: string,
  resultat: { ok: boolean; feil: string | null },
): Promise<void> {
  await db
    .update(orgWebhooks)
    .set({ lastAttemptAt: new Date(), lastOk: resultat.ok, lastError: resultat.feil })
    .where(eq(orgWebhooks.id, webhookId));
}

/**
 * Sender `melding` til alle aktive webhooks i org-en som abonnerer på hendelsen.
 *
 * Åpner sin egen org-kontekst og kaster ALDRI — kall den fra `etterCommit` i rutehandlere,
 * eller fra bakgrunnsjobber ETTER at jobbtransaksjonen er ferdig (aldri inne i en
 * `withoutRls`-blokk; sending hører ikke hjemme i en transaksjon).
 */
export async function varsleWebhooks(orgId: string, melding: WebhookMelding): Promise<void> {
  try {
    const { kroker, orgNavn } = await withOrg(orgId, async (db) => {
      const alle = await db
        .select()
        .from(orgWebhooks)
        .where(and(eq(orgWebhooks.orgId, orgId), eq(orgWebhooks.active, true)));
      const [org] = await db
        .select({ navn: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      return {
        kroker: alle.filter((k) => (lesEvents(k.events) as string[]).includes(melding.hendelse)),
        orgNavn: org?.navn ?? "DriftIQ",
      };
    });

    for (const krok of kroker) {
      // POST-en skjer UTENFOR org-kontekst med vilje — statusskrivingen etterpå er sin egen,
      // korte transaksjon i stedet for å holde en åpen gjennom et tregt eksternt kall.
      const resultat = await sendTilWebhook(krok, orgNavn, melding);
      await withOrg(orgId, (db) => forStatus(db, krok.id, resultat));
      if (!resultat.ok) {
        console.error(`[webhooks] «${krok.name}» (${krok.targetType}) feilet: ${resultat.feil}`);
      }
    }
  } catch (e) {
    console.error("[webhooks] Utsending feilet:", e instanceof Error ? e.message : e);
  }
}
