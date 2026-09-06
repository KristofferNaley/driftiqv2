/**
 * Driftsvarsler til Discord — kanalen for «noe er galt med selve appen».
 *
 * Dette er varsling til driftsansvarlig, ikke til kundene: appen startet (= deploy eller
 * restart) og bakgrunnsjobber som feiler. Nedetid fanges IKKE her — er appen nede, får den
 * ikke sendt noe. Det gjør den eksterne overvåkingen (Uptime Kuma), som pinger /api/health
 * utenfra og varsler i samme Discord-kanal.
 *
 * Tom DISCORD_WEBHOOK_URL = ingenting sendes, alt går videre — samme mønster som
 * RESEND_API_KEY i epost.ts. Et varsel som ikke kom frem skal aldri bli en ny feil,
 * så sending feiler stille med en logglinje.
 */

import { MARKED_URL } from "./urler";

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL ?? "";

/**
 * Avsenderprofilen — samme som kundevarslene i `webhooks.ts`: `username`/`avatar_url`
 * overstyrer webhookens egen profil per melding, så varselet står som «DriftIQ» med logo
 * uansett hva webhooken heter i Discord. Ikonet må ligge på en OFFENTLIG adresse (Discord
 * henter det selv); markedsverten svarer uten sesjon.
 */
const AVSENDER = "DriftIQ";
const IKON = `${MARKED_URL}/ikon-512.png`;

/** Miljønavnet i meldingen, så prod og test kan dele kanal uten å forveksles. */
function miljo(): string {
  try {
    return new URL(process.env.BASE_URL ?? "").hostname;
  } catch {
    return "lokalt miljø";
  }
}

/** Poster én melding til Discord-kanalen. No-op uten webhook-URL. */
export async function sendDriftsvarsel(tekst: string): Promise<void> {
  if (!WEBHOOK_URL) return;
  try {
    const svar = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: AVSENDER,
        avatar_url: IKON,
        content: `**${miljo()}** — ${tekst}`,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!svar.ok) {
      console.error(`[driftsvarsel] Discord svarte ${svar.status}: ${(await svar.text()).slice(0, 200)}`);
    }
  } catch (e) {
    console.error("[driftsvarsel] Fikk ikke sendt til Discord:", e instanceof Error ? e.message : e);
  }
}
