import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared event model is consumed as TypeScript source from the monorepo.
  transpilePackages: ["@voxboard/protocol"],

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
