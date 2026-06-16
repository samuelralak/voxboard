/**
 * Profile = NIP-01 kind 0 user metadata. content is a stringified JSON object. We surface the fields
 * Voxboard renders: name, picture, nip05 (verified handle), lud16 (lightning address for zaps). Note
 * `picture` is canonical; `image` is deprecated. See docs/PROTOCOL.md / DESIGN.md.
 */

import { z } from "zod";
import { KIND } from "./kinds";
import type { NostrEvent } from "./event";

const profileContentSchema = z
  .object({
    name: z.string().optional(),
    display_name: z.string().optional(),
    displayName: z.string().optional(),
    about: z.string().optional(),
    picture: z.string().optional(),
    image: z.string().optional(),
    banner: z.string().optional(),
    nip05: z.string().optional(),
    lud16: z.string().optional(),
    lud06: z.string().optional(),
    website: z.string().optional(),
  })
  .passthrough();

export interface Profile {
  pubkey: string;
  name?: string;
  displayName?: string;
  about?: string;
  picture?: string;
  banner?: string;
  nip05?: string;
  /** lightning address, enables zaps */
  lud16?: string;
  lud06?: string;
  website?: string;
  createdAt: number;
  raw: NostrEvent;
}

export function parseProfile(event: NostrEvent): Profile | null {
  if (event.kind !== KIND.Metadata) return null;
  let json: unknown;
  try {
    json = JSON.parse(event.content);
  } catch {
    return null;
  }
  const parsed = profileContentSchema.safeParse(json);
  if (!parsed.success) return null;
  const c = parsed.data;

  const profile: Profile = { pubkey: event.pubkey, createdAt: event.created_at, raw: event };
  if (c.name) profile.name = c.name;
  const display = c.display_name ?? c.displayName;
  if (display) profile.displayName = display;
  if (c.about) profile.about = c.about;
  const picture = c.picture ?? c.image; // image is deprecated, fall back to it
  if (picture) profile.picture = picture;
  if (c.banner) profile.banner = c.banner;
  if (c.nip05) profile.nip05 = c.nip05;
  if (c.lud16) profile.lud16 = c.lud16;
  if (c.lud06) profile.lud06 = c.lud06;
  if (c.website) profile.website = c.website;
  return profile;
}
