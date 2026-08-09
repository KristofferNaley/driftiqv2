import Anthropic from "@anthropic-ai/sdk";
import { ApiFeil, lesKropp, orgRute } from "@/lib/api";
import {
  MAKS_RUNDER,
  MODELL,
  hentSamtale,
  leggTilMelding,
  opprettSamtale,
  registrerForbruk,
  sporsmalInn,
  systemprompt,
  verktoyskjemaer,
} from "@/lib/ai";
import { kjorVerktoy } from "@/lib/ai-verktoy";

/**
 * Stiller et spørsmål og kjører verktøyloopen til modellen er ferdig.
 *
 * `orgId` bindes HER, fra den verifiserte org-tilgangen `orgRute` allerede har sjekket, og
 * sendes som argument til hvert verktøykall. Modellen kan ikke påvirke den — se
 * sikkerhetsnotatet i lib/ai-verktoy.ts.
 */
export const POST = orgRute({
  nivaa: "lesing",
  modul: "ai_radgiver",
  handler: async ({ db, orgId, bruker, req }) => {
    const nokkel = process.env.ANTHROPIC_API_KEY;
    if (!nokkel) throw new ApiFeil(503, "AI-rådgiveren er ikke konfigurert.");

    const { melding, samtaleId } = await lesKropp(req, sporsmalInn);
    const samtale = samtaleId
      ? await hentSamtale(db, orgId, bruker.id, samtaleId)
      : { ...(await opprettSamtale(db, orgId, bruker.id, melding)), meldinger: [] };

    await leggTilMelding(db, samtale.id, "bruker", melding);

    const klient = new Anthropic({ apiKey: nokkel });
    const historikk: Anthropic.MessageParam[] = [
      ...samtale.meldinger.map((m) => ({
        role: (m.role === "bruker" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: melding },
    ];

    const forbruk = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, apiKall: 0 };
    const kilder: string[] = [];
    let svar = "";

    for (let runde = 0; runde < MAKS_RUNDER; runde++) {
      const respons = await klient.messages.create({
        model: MODELL,
        max_tokens: 4096,
        system: await systemprompt(db, orgId),
        tools: verktoyskjemaer(),
        messages: historikk,
      });

      forbruk.apiKall += 1;
      forbruk.inputTokens += respons.usage.input_tokens;
      forbruk.outputTokens += respons.usage.output_tokens;
      forbruk.cacheReadTokens += respons.usage.cache_read_input_tokens ?? 0;
      forbruk.cacheWriteTokens += respons.usage.cache_creation_input_tokens ?? 0;

      svar = respons.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");

      const verktoykall = respons.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (verktoykall.length === 0) break;

      historikk.push({ role: "assistant", content: respons.content });
      historikk.push({
        role: "user",
        content: await Promise.all(
          verktoykall.map(async (kall) => {
            kilder.push(kall.name);
            return {
              type: "tool_result" as const,
              tool_use_id: kall.id,
              content: JSON.stringify(
                await kjorVerktoy(db, orgId, kall.name, kall.input as Record<string, unknown>),
              ),
            };
          }),
        ),
      });
    }

    const unikeKilder = [...new Set(kilder)];
    await leggTilMelding(db, samtale.id, "assistent", svar, { kilder: unikeKilder, modell: MODELL });
    await registrerForbruk(db, orgId, forbruk);

    return { svar, kilder: unikeKilder, modell: MODELL, samtaleId: samtale.id };
  },
});
