import type { MetadataRoute } from "next";
import { MARKED_URL } from "@/lib/urler";

/**
 * Kun de offentlige sidene. Appen og plattformpanelet står bevisst utenfor: de krever
 * innlogging, og å liste dem ville bare fortalt omverdenen hvilke stier som finnes.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = MARKED_URL;
  return [
    { url: base, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/personvern`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
