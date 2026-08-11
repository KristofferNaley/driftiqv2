import { redirect } from "next/navigation";

/**
 * Leverandørdetaljen er en fanemodal over lista nå, ikke en egen side. Ruta beholdes som
 * omdirigering så gamle lenker og bokmerker fortsatt lander på riktig leverandør.
 */
export default async function LeverandorOmdirigering({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/leverandorer?apen=${encodeURIComponent(id)}`);
}
