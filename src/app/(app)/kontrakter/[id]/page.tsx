import { redirect } from "next/navigation";

/**
 * Kontraktdetaljen er en fanemodal over lista nå, ikke en egen side. Ruta beholdes som
 * omdirigering: lenker fra dashbordet, driftsloggen, e-poster og bokmerker fra før
 * omleggingen skal fortsatt lande på riktig avtale.
 */
export default async function KontraktOmdirigering({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/kontrakter?apen=${encodeURIComponent(id)}`);
}
