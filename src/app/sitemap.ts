import type { MetadataRoute } from "next";

/**
 * Kun de offentlige sidene. Appen og plattformpanelet står bevisst utenfor: de krever
 * innlogging, og å liste dem ville bare fortalt omverdenen hvilke stier som finnes.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.BASE_URL ?? "https://driftiq.no";
  return [
    { url: base, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/personvern`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
