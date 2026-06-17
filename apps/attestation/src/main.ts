// Process entrypoint for the attestation service. Kept tiny + side-effect-only so server.ts stays
// import-safe for unit tests. Run locally with `tsx src/main.ts`; the deploy bundles this to dist/server.mjs.
import { start } from "./server";

start();
