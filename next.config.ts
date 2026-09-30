import type { NextConfig } from "next";

const config: NextConfig = {
  // Docker-imaget kopierer bare .next/standalone — se Dockerfile.
  output: "standalone",
  // `pg` er en native-ish avhengighet og skal ikke bundles inn i serverkoden.
  serverExternalPackages: ["pg"],
  experimental: {
    // Med middleware leser Next forespørselskroppen inn i minnet og kutter den ved 10 MB som
    // standard. Oppslagstavla tar imot filer på inntil 20 MB (PDF, HEIC fra iPhone).
    proxyClientMaxBodySize: "25mb",
  },
};

export default config;
