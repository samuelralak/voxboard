/**
 * NIP-05 endpoint for handles Voxboard hosts on its own domain. Per NIP-05: respond to `?name=`,
 * return lowercase hex pubkeys in `names`, optional `relays`, set CORS `*`, and never redirect.
 *
 * The registry is empty until orgs/boards claim names; the shape is correct and ready to populate
 * (e.g. from a database or config in a later milestone).
 */

const NAMES: Record<string, string> = {};
const RELAYS: Record<string, string[]> = {};

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
} as const;

export async function GET(request: Request): Promise<Response> {
  const name = new URL(request.url).searchParams.get("name");

  if (name === null) {
    return Response.json({ names: NAMES, relays: RELAYS }, { headers: HEADERS });
  }

  const local = name.toLowerCase();
  const pubkey = NAMES[local];
  if (!pubkey) {
    return Response.json({ names: {} }, { headers: HEADERS });
  }

  const relays = RELAYS[pubkey];
  return Response.json(
    { names: { [local]: pubkey }, ...(relays ? { relays: { [pubkey]: relays } } : {}) },
    { headers: HEADERS },
  );
}
