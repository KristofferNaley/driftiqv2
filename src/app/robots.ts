import type { MetadataRoute } from "next";
import { MARKED_URL } from "@/lib/urler";

/**
 * Alt bak innlogging holdes ute av indeksen.
 *
 * QR-sidene (`/kvittering`, `/rutine`) er teknisk offentlige, men tokenet er
 * tilgangskontrollen — de skal ikke ligge søkbare. `robots.txt` er ingen sikkerhetsmekanisme,
 * bare et hint til søkemotorer; det ekte forsvaret er at tokenet må gjettes.
 */
export default function robots(): MetadataRoute.Robots {
  const base = MARKED_URL;
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/plattform", "/dashboard", "/logg-inn", "/kvittering", "/rutine", "/nytt-passord", "/glemt-passord"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
