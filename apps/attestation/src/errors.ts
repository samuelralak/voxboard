/**
 * Thrown when a RELAY-side problem makes an attestation op unsafe to complete: a blind read (no reachable
 * relays) or a publish that reached no relay. The server maps this to 503 (retryable) and surfaces its
 * message; every OTHER thrown error is treated as an unexpected 500 with a generic body (no detail leaked).
 */
export class RelayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayUnavailableError";
  }
}
