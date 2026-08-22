import { NextResponse } from "next/server";
import { sjekkDatabase } from "@/db/client";

/**
 * Helsesjekk for den eksterne overvåkingen (Uptime Kuma pinger denne utenfra).
 *
 * Uautentisert og offentlig — med vilje utenfor `orgRute`: en overvåker har ingen sesjon,
 * og svaret sier minst mulig («ok» eller 503), aldri HVA som er galt. Årsaken står i
 * containerloggen og i Discord-varselet (se lib/driftsvarsel.ts). At appen svarer i det
 * hele tatt beviser at RLS-oppsettet gikk gjennom — uten det nekter v2 å starte.
 */

// Uten denne kan Next prerendre GET-ruten under bygget: byggesteget ville koblet til
// databasen (samme felle som instrumentation.ts verner mot), og svaret blitt en bakt kake.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await sjekkDatabase();
  } catch (e) {
    console.error("[health] Databasesjekk feilet:", e instanceof Error ? e.message : e);
    return NextResponse.json({ status: "feil" }, { status: 503 });
  }
  return NextResponse.json({ status: "ok" });
}
