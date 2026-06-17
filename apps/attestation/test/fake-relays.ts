import { matchFilter } from "nostr-tools/filter";
import type { NostrEvent } from "@voxboard/protocol";
import type { RelayClient } from "../src/relays.js";

export interface FakeRelays {
  client: RelayClient;
  /** every event currently in the in-memory store (seed + published) */
  store: NostrEvent[];
  /** only the events published through this client */
  published: NostrEvent[];
}

export interface FakeOptions {
  /** reachable-relay count reported by query(); 0 simulates a blind/total-failure read. Default 1. */
  responded?: number;
  /** relays that accept a publish; 0 simulates a total publish failure (nothing lands). Default 1. */
  publishOk?: number;
}

/**
 * An in-memory RelayClient for unit tests: query is matchFilter-backed (real Nostr filter semantics) and
 * reports a reachability count; publish appends (only when it "lands"). No signature verification (seeds
 * are real-signed events from the test signer).
 */
export function fakeRelays(seed: NostrEvent[] = [], opts: FakeOptions = {}): FakeRelays {
  const responded = opts.responded ?? 1;
  const publishOk = opts.publishOk ?? 1;
  const store: NostrEvent[] = [...seed];
  const published: NostrEvent[] = [];
  const client: RelayClient = {
    async query(filter) {
      return { events: store.filter((e) => matchFilter(filter as never, e as never)), responded };
    },
    async publish(event) {
      published.push(event); // record the attempt regardless of outcome
      if (publishOk > 0) store.push(event); // only persist if it actually landed
      return { ok: publishOk, failed: publishOk > 0 ? 0 : 1 };
    },
    close() {},
  };
  return { client, store, published };
}
