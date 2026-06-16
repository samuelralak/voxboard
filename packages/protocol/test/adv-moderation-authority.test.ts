/**
 * Adversarial: moderation authority + scope. Covers the privilege-escalation and scope-leak fixes:
 *   - a moderator cannot ban (silence) the board owner; the owner is unbannable.
 *   - only the owner may ban a fellow moderator (mods cannot depose each other).
 *   - bans and hides carry an off-state ("unbanned"/"unhidden") so they are reversible.
 *   - a curated approval issued for a DIFFERENT board's coordinate never leaks in here.
 */

import { describe, expect, it } from "vitest";
import {
  type Board,
  type NostrEvent,
  buildApproval,
  buildBan,
  buildUnban,
  buildBoard,
  buildHide,
  buildUnhide,
  parseApproval,
  parseBan,
  parseBoard,
  parseHide,
  approvedPostIds,
  bannedSubjects,
  hiddenTargets,
} from "../src/index";

const SIG = "00".repeat(64);
const OWNER = "a0".repeat(32);
const MOD = "b1".repeat(32);
const MOD2 = "b2".repeat(32);
const ALICE = "c3".repeat(32);
const SLUG = "voxboard";

let n = 1;
function sign(template: { kind: number; created_at: number; tags: string[][]; content: string }, pubkey: string): NostrEvent {
  return { ...template, pubkey, id: `id${(n++).toString(16).padStart(61, "0")}`, sig: SIG };
}

function board(mods: string[] = [], slug = SLUG): Board {
  const def = sign(
    buildBoard({ slug, name: "Vox", mode: "open", moderators: mods.map((pubkey) => ({ pubkey })), createdAt: 10 }),
    OWNER,
  );
  const parsed = parseBoard(def);
  if (!parsed) throw new Error("board did not parse");
  return parsed;
}

const REF = { pubkey: OWNER, slug: SLUG };

describe("moderation authority: owner precedence over moderators", () => {
  it("a moderator's ban of the owner is ignored (owner is unbannable)", () => {
    const b = board([MOD]);
    const ban = parseBan(sign(buildBan({ subject: OWNER, board: REF, createdAt: 100 }), MOD))!;
    expect(bannedSubjects([ban], b).has(OWNER)).toBe(false);
  });

  it("a moderator cannot ban a fellow moderator (only the owner can)", () => {
    const b = board([MOD, MOD2]);
    const modBansMod = parseBan(sign(buildBan({ subject: MOD2, board: REF, createdAt: 100 }), MOD))!;
    expect(bannedSubjects([modBansMod], b).has(MOD2)).toBe(false);

    const ownerBansMod = parseBan(sign(buildBan({ subject: MOD2, board: REF, createdAt: 100 }), OWNER))!;
    expect(bannedSubjects([ownerBansMod], b).has(MOD2)).toBe(true);
  });

  it("a moderator can still ban a regular author", () => {
    const b = board([MOD]);
    const ban = parseBan(sign(buildBan({ subject: ALICE, board: REF, createdAt: 100 }), MOD))!;
    expect(bannedSubjects([ban], b).has(ALICE)).toBe(true);
  });

  it("a moderator cannot nullify the owner's ban of a fellow moderator with a LATER label", () => {
    const b = board([MOD, MOD2]);
    const ownerBan = parseBan(sign(buildBan({ subject: MOD2, board: REF, createdAt: 100 }), OWNER))!;
    // The targeted mod (or another mod) tries to lift it by posting a newer label about MOD2.
    const modUnban = parseBan(sign(buildUnban({ subject: MOD2, board: REF, createdAt: 200 }), MOD))!;
    const modReban = parseBan(sign(buildBan({ subject: MOD2, board: REF, createdAt: 200 }), MOD))!;
    // Authority is resolved before the latest-wins collapse, so the ineligible mod label is dropped
    // first and the owner's ban survives in both orderings.
    expect(bannedSubjects([ownerBan, modUnban], b).has(MOD2)).toBe(true);
    expect(bannedSubjects([ownerBan, modReban], b).has(MOD2)).toBe(true);
  });

  it("the owner can still lift their own ban of a moderator with a later unban", () => {
    const b = board([MOD, MOD2]);
    const ownerBan = parseBan(sign(buildBan({ subject: MOD2, board: REF, createdAt: 100 }), OWNER))!;
    const ownerUnban = parseBan(sign(buildUnban({ subject: MOD2, board: REF, createdAt: 200 }), OWNER))!;
    expect(bannedSubjects([ownerBan, ownerUnban], b).has(MOD2)).toBe(false);
  });
});

describe("moderation off-states: ban/hide are reversible", () => {
  it("a later 'unbanned' label lifts an earlier ban", () => {
    const b = board([MOD]);
    const ban = parseBan(sign(buildBan({ subject: ALICE, board: REF, createdAt: 100 }), MOD))!;
    const unban = parseBan(sign(buildUnban({ subject: ALICE, board: REF, createdAt: 200 }), MOD))!;
    expect(bannedSubjects([ban, unban], b).has(ALICE)).toBe(false);
    // order independence: the latest created_at wins regardless of array order
    expect(bannedSubjects([unban, ban], b).has(ALICE)).toBe(false);
  });

  it("a re-ban after an unban wins again (latest label)", () => {
    const b = board([MOD]);
    const ban = parseBan(sign(buildBan({ subject: ALICE, board: REF, createdAt: 100 }), MOD))!;
    const unban = parseBan(sign(buildUnban({ subject: ALICE, board: REF, createdAt: 200 }), MOD))!;
    const reban = parseBan(sign(buildBan({ subject: ALICE, board: REF, createdAt: 300 }), MOD))!;
    expect(bannedSubjects([ban, unban, reban], b).has(ALICE)).toBe(true);
  });

  it("a ban whose p-tag pubkey is upper/mixed case still bans the lowercase author", () => {
    const b = board([MOD]);
    // The p tag is written with an upper/mixed-case pubkey; the author publishes lowercase.
    const ban = parseBan(sign(buildBan({ subject: ALICE.toUpperCase(), board: REF, createdAt: 100 }), MOD))!;
    expect(ban.subject).toBe(ALICE); // normalized at the parse boundary
    expect(bannedSubjects([ban], b).has(ALICE)).toBe(true);
  });

  it("a later 'unhidden' label un-hides an idea", () => {
    const b = board([MOD]);
    const idea = "1d".repeat(32);
    const hide = parseHide(sign(buildHide({ target: { id: idea }, board: REF, createdAt: 100 }), MOD))!;
    const unhide = parseHide(sign(buildUnhide({ target: { id: idea }, board: REF, createdAt: 200 }), MOD))!;
    expect(hiddenTargets([hide, unhide], b).has(idea)).toBe(false);
  });
});

describe("curated approval scope: an approval for a different board does not leak", () => {
  it("an approval whose `a` coordinate is another board is ignored here", () => {
    const here = board([MOD]); // 34550:OWNER:voxboard
    const idea = "2d".repeat(32);
    const post: NostrEvent = sign({ kind: 1111, created_at: 50, tags: [], content: "" }, ALICE);
    post.id = idea;

    // MOD approves the post, but scopes it to a DIFFERENT board they also run.
    const otherRef = { pubkey: OWNER, slug: "other-board" };
    const leaked = parseApproval(sign(buildApproval({ board: otherRef, post, createdAt: 100 }), MOD))!;
    expect(approvedPostIds([leaked], here).has(idea)).toBe(false);

    // The same approval scoped to THIS board is honored.
    const scoped = parseApproval(sign(buildApproval({ board: REF, post, createdAt: 100 }), MOD))!;
    expect(approvedPostIds([scoped], here).has(idea)).toBe(true);
  });
});
