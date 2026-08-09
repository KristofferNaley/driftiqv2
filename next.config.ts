import type { NextConfig } from "next";

const config: NextConfig = {
  // Docker-imaget kopierer bare .next/standalone — se Dockerfile.
  output: "standalone",
  // `pg` er en native-ish avhengighet og skal ikke bundles inn i serverkoden.
  serverExternalPackages: ["pg"],
};

export default config;
