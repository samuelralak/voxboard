import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The shared event model is consumed as TypeScript source from the monorepo.
  transpilePackages: ["@voxboard/protocol"],

  // Standalone output for a lean Docker image: a minimal server.js that runs with no node_modules
  // install. It does NOT copy public/ or .next/static — the Dockerfile does that explicitly.
  output: "standalone",

  // REQUIRED in this monorepo: the trace defaults to apps/web and would drop files outside it (the
  // root-hoisted node_modules, e.g. nostr-tools used by the SSR SimplePool). Point it at the repo root
  // so the standalone bundle is complete. (import.meta.dirname = apps/web; "../../" = repo root.)
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),

  async headers() {
    return [
      {
        // NIP-05 well-known must be CORS-open and must not redirect.
        source: "/.well-known/nostr.json",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },

  // NOTE: enable Cache Components (PPR) in M1 once routes + generateStaticParams exist.
  // cacheComponents: true,
};

export default nextConfig;
