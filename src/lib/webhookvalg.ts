/**
 * Valglistene for webhooks — måltyper og hendelser. **Ingen importer**: leses av både
 * innstillingssiden (klient) og lib/webhooks.ts (server), samme mønster som `varselvalg.ts`.
 */

/**
 * Måltypene avgjør hvilken JSON-form meldingen pakkes i — se `byggKropp` i lib/webhooks.ts.
 * `generisk` er den som gjør at lista ikke trenger å vokse: Zapier, Make, n8n, Home Assistant
 * og boligbyggelagenes egne systemer tar alle imot rå JSON.
 */
export const WEBHOOK_TYPER = ["teams", "slack", "discord", "generisk"] as const;

export type WebhookType = (typeof WEBHOOK_TYPER)[number];

export const WEBHOOK_TYPE_ETIKETT: Record<WebhookType, string> = {
  teams: "Microsoft Teams",
  slack: "Slack",
  discord: "Discord",
  generisk: "Generisk (JSON)",
};

/**
 * Hendelsene en webhook kan abonnere på. Nøklene lagres i databasen (`org_webhooks.events`)
 * og sendes i generisk-payloaden — de er en kontrakt utad og skal ikke omdøpes.
 */
export const WEBHOOK_HENDELSER = [
  "avvik.nytt",
  "oppgave.fullfort",
  "oppgave.forsinket",
  "kontrakt.utloper",
] as const;

export type WebhookHendelse = (typeof WEBHOOK_HENDELSER)[number];

export const WEBHOOK_HENDELSE_ETIKETT: Record<WebhookHendelse, string> = {
  "avvik.nytt": "Nytt avvik meldt",
  "oppgave.fullfort": "Oppgave kvittert ut",
  "oppgave.forsinket": "Forsinkede oppgaver (ukentlig, mandag)",
  "kontrakt.utloper": "Avtale nærmer seg utløp",
};
