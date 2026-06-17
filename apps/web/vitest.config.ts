import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests for the server-side SSR helpers (attestation discover gate + badge). Node environment; the
// `@/` path alias is mapped to the app root, and `server-only` is stubbed so the module graph imports.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "test/**/*.test.ts"],
  },
  resolve: {
    alias: [
      { find: "server-only", replacement: fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)) },
      { find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) },
    ],
  },
});
