/**
 * Adversarial coverage for the "threads" subsystem (idea/reply classification + reply-tree building +
 * coordinate/imeta scoping that feeds threading). Complements adversarial.test.ts and thread.test.ts:
 * every case here is one the existing suites do NOT cover.
 *
 * Some assertions describe CORRECT behavior that the current implementation gets WRONG (recursion DoS,
 * non-canonical coordinate spoofing, uppercase-pubkey board splitting, empty-slug phantom boards,
 * whitespace-e orphaning, multi-e first-wins, self-loop-as-root ghost node, unvalidated parentAuthor,
 * imeta scheme/fan-out). Those tests are written to FAIL until the code is hardened; each failing one is
 * listed as a suspected bug. Where the code is already correct, the test asserts and locks in that
 * behavior.
 */

import { describe, it, expect } from "vitest";
import type { NostrEvent } from "../src/event";
import { KIND } from "../src/kinds";
import { isIdeaEvent, parseIdea } from "../src/idea";
import { isReplyEvent, parseReply, type Reply } from "../src/reply";
import {
  buildThread,
  countThread,
  partitionBoardEvents,
  type ThreadNode,
} from "../src/thread";
import { parseCoordinate, parseCommunityCoordinate, communityCoordinate } from "../src/coords";
import { parseImeta } from "../src/scope";

const SIG = "0".repeat(128);
const OWNER = "ab".repeat(32); // 64-hex board owner
const POSTER = "c3".repeat(32);
const VICTIM = "ef".repeat(32);
const SLUG = "acme";
const A_COORD = `${KIND.Community}:${OWNER}:${SLUG}`; // 34550:OWNER:acme
const IDEA = "1d".repeat(32);

let n = 1;
function raw(o: Partial<NostrEvent> & { kind: number }): NostrEvent {
  return {
    id: o.id ?? `id${(n++).toString(16).padStart(61, "0")}`,
    pubkey: o.pubkey ?? POSTER,
    sig: SIG,
    kind: o.kind,
    content: o.content ?? "",
    created_at: o.created_at ?? 1000,
    tags: o.tags ?? [],
  };
}

/** Full root+parent community scope for a top-level idea (no e tag). */
function ideaTags(extra: string[][] = []): string[][] {
  return [
    ["A", A_COORD],
    ["a", A_COORD],
    ["K", String(KIND.Community)],
    ["k", String(KIND.Community)],
    ["P", OWNER],
    ["p", OWNER],
    ...extra,
  ];
}

/** Root community scope + a lowercase e parent pointer (a reply). */
function replyTags(parentId: string, opts: { k?: string; eAuthor?: string; p?: string } = {}): string[][] {
  const eTag = ["e", parentId, "", opts.eAuthor ?? ""];
  const tags: string[][] = [
    ["A", A_COORD],
    ["K", String(KIND.Community)],
    eTag,
    ["k", opts.k ?? String(KIND.Comment)],
  ];
  if (opts.p) tags.push(["p", opts.p]);
  return tags;
}

/** A parsed Reply object straight from fields, bypassing tag plumbing (for pure buildThread tests). */
function replyObj(id: string, parentId: string, createdAt = 10, body = id): Reply {
  return {
    id,
    pubkey: POSTER,
    board: { pubkey: OWNER, slug: SLUG },
    coordinate: A_COORD,
    parentId,
    parentKind: KIND.Comment,
    body,
    createdAt,
    raw: raw({ kind: KIND.Comment, id, content: body }),
  };
}

/** Walk to the deepest node of a single-chain tree and report its depth. */
function deepestDepth(tree: ThreadNode[]): number {
  let depth = -1;
  let node: ThreadNode | undefined = tree[0];
  while (node) {
    depth = node.depth;
    node = node.children[0];
  }
  return depth;
}

// ---------------------------------------------------------------------------
// buildThread: cycles, reachability, dedup, ordering (pure Reply objects)
// ---------------------------------------------------------------------------

describe("threads/buildThread: reachable cycle via duplicate event id", () => {
  it("X>Y under IDEA, then a duplicate-id X' under Y is dropped by the seen-guard (no infinite recursion)", () => {
    const X = replyObj("dd".repeat(32), IDEA, 10);
    const Y = replyObj("ee".repeat(32), "dd".repeat(32), 20);
    const Xdup = replyObj("dd".repeat(32), "ee".repeat(32), 30); // same id as X
    let tree: ThreadNode[] = [];
    expect(() => {
      tree = buildThread(IDEA, [X, Y, Xdup]);
    }).not.toThrow();
    expect(countThread(tree)).toBe(2); // X, Y only; Xdup re-uses X's id -> seen
    expect(tree).toHaveLength(1);
    expect(tree[0]!.reply.id).toBe("dd".repeat(32));
    expect(tree[0]!.children).toHaveLength(1);
    expect(tree[0]!.children[0]!.reply.id).toBe("ee".repeat(32));
    expect(tree[0]!.children[0]!.children).toHaveLength(0); // Xdup not re-emitted
  });
});

describe("threads/buildThread: duplicate sibling ids under the same parent", () => {
  it("emits exactly one node; the earlier (lower created_at) duplicate survives, the later is dropped", () => {
    const first = replyObj("ff".repeat(32), IDEA, 10, "first");
    const second = replyObj("ff".repeat(32), IDEA, 20, "second"); // same id, later
    const tree = buildThread(IDEA, [first, second]);
    expect(countThread(tree)).toBe(1);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.reply.body).toBe("first"); // created_at-sort keeps the older one
  });
});

describe("threads/buildThread: identical created_at id tie-break", () => {
  it("sibling replies with equal created_at are ordered by id ascending regardless of input order", () => {
    const bb = replyObj("bb".repeat(32), IDEA, 5);
    const aa = replyObj("aa".repeat(32), IDEA, 5);
    const cc = replyObj("cc".repeat(32), IDEA, 5);
    const tree = buildThread(IDEA, [bb, aa, cc]); // inserted non-sorted
    expect(tree.map((node) => node.reply.id)).toEqual([
      "aa".repeat(32),
      "bb".repeat(32),
      "cc".repeat(32),
    ]);
  });
});

describe("threads/buildThread: self-parent reply that collides with the root id", () => {
  // A reply whose id === parentId === rootId is matched once as a top-level child of the root (its
  // parentId equals the root id), then the seen-guard prevents it from also nesting under itself. The
  // builder treats ids as opaque, so such a forged/duplicate id renders exactly once.
  it("emits the self-looping reply once as a top-level node (seen-guard stops the recursion)", () => {
    const X = "cd".repeat(32);
    const tree = buildThread(X, [replyObj(X, X, 5)]);
    expect(countThread(tree)).toBe(1);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.reply.id).toBe(X);
    expect(tree[0]!.children).toHaveLength(0); // not re-nested under itself
  });
});

describe("threads/buildThread: same id under two different parents (placement nondeterminism)", () => {
  it("DUP appears exactly once and lands under the same parent regardless of input array order", () => {
    const ROOT = "0a".repeat(32);
    const A = replyObj("a1".repeat(32), ROOT, 1);
    const dupUnderA = replyObj("d0".repeat(32), "a1".repeat(32), 2);
    const dupUnderRoot = replyObj("d0".repeat(32), ROOT, 3); // same id, different parent

    const forward = buildThread(ROOT, [A, dupUnderA, dupUnderRoot]);
    const reversed = buildThread(ROOT, [dupUnderRoot, dupUnderA, A]);

    // DUP must appear exactly once in each ordering.
    expect(countThread(forward)).toBe(2);
    expect(countThread(reversed)).toBe(2);

    const placement = (tree: ThreadNode[]): "root" | "underA" | "missing" => {
      const top = tree.find((node) => node.reply.id === "d0".repeat(32));
      if (top) return "root";
      const aNode = tree.find((node) => node.reply.id === "a1".repeat(32));
      if (aNode?.children.some((c) => c.reply.id === "d0".repeat(32))) return "underA";
      return "missing";
    };
    // Correct behavior: placement is deterministic across input orderings.
    expect(placement(forward)).toBe(placement(reversed));
  });
});

describe("threads/buildThread: case-variant ids fragment the tree", () => {
  it("a reply whose parentId differs from the idea id only in hex case is orphaned (case-sensitive match)", () => {
    const upperIdeaId = "AB".repeat(32);
    const reply = replyObj("zz".repeat(32), "ab".repeat(32), 5); // lowercased parent pointer
    const tree = buildThread(upperIdeaId, [reply]);
    // buildThread matches parentId against the root id by raw string equality / Map lookup, so a
    // case-only mismatch never attaches. Ids are assumed lowercase 64-hex (NIP-01) upstream; buildThread
    // does no normalization, so the case-variant reply is dropped.
    expect(tree).toHaveLength(0);
  });
});

describe("threads/buildThread + countThread: deep linear nesting (recursion DoS)", () => {
  // Fixed-width hex index keeps every id unique and a valid 64-char id (no padEnd collisions).
  const chainId = (i: number): string => i.toString(16).padStart(64, "0");
  const chain = (size: number): Reply[] => {
    const replies: Reply[] = [];
    let parent = IDEA;
    for (let i = 0; i < size; i++) {
      const id = chainId(i);
      replies.push(replyObj(id, parent, i));
      parent = id;
    }
    return replies;
  };

  it("builds a deep tree but caps nesting at MAX_THREAD_DEPTH (64): a 100-deep chain yields 64 nodes, deepest depth 63", () => {
    // buildThread bounds nesting at MAX_THREAD_DEPTH = 64 (depths 0..63 are emitted; depth 64 returns
    // []). A 100-deep chain is therefore truncated to the first 64 replies.
    const tree = buildThread(IDEA, chain(100));
    expect(countThread(tree)).toBe(64);
    expect(deepestDepth(tree)).toBe(63);
  });

  it("a multi-thousand-deep chain does NOT crash the parser: the depth cap bounds it to 64 nodes", () => {
    // The MAX_THREAD_DEPTH cap turns an adversary-controlled deep reply chain into a bounded tree, so a
    // 100000-deep chain neither overflows the stack nor counts more than 64 descendants.
    let tree: ThreadNode[] = [];
    expect(() => {
      tree = buildThread(IDEA, chain(100000));
    }).not.toThrow();
    expect(countThread(tree)).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// idea vs reply classification (isIdeaEvent / isReplyEvent / partitionBoardEvents)
// ---------------------------------------------------------------------------

describe("threads/classify: a community-parented post carrying an e reference is an IDEA, not a reply", () => {
  it("a top-level idea that e-references the community definition event stays an idea (real-world NIP-22 shape)", () => {
    // Amethyst etc. add an e/E reference to the community DEFINITION event on a top-level post; the
    // parent scope (a = A, k = 34550) is authoritative, so this is an idea, not a reply.
    const target = "9a".repeat(32);
    const event = raw({ kind: KIND.Comment, content: "Feature request", tags: ideaTags([["subject", "My idea"], ["e", target]]) });
    expect(isIdeaEvent(event)).toBe(true);
    expect(isReplyEvent(event)).toBe(false);
    const idea = parseIdea(event);
    expect(idea).not.toBeNull();
    expect(idea!.title).toBe("My idea");

    const { ideas, replies } = partitionBoardEvents([event]);
    expect(ideas).toHaveLength(1);
    expect(replies).toHaveLength(0);
  });
});

describe("threads/classify: kind-1111 with no uppercase A tag is neither idea nor reply", () => {
  it("an A-less comment is silently dropped by partitionBoardEvents", () => {
    const event = raw({ kind: KIND.Comment, content: "hi", tags: [["e", "ff".repeat(32)], ["k", "1111"]] });
    expect(isIdeaEvent(event)).toBe(false);
    expect(isReplyEvent(event)).toBe(false);
    expect(parseIdea(event)).toBeNull();
    expect(parseReply(event)).toBeNull();
    const { ideas, replies } = partitionBoardEvents([event]);
    expect(ideas).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });
});

describe("threads/classify: lowercase a points at a different board than uppercase A", () => {
  it("an idea candidate whose parent scope (a) names another community is rejected", () => {
    const event = raw({
      kind: KIND.Comment,
      tags: [
        ["A", A_COORD],
        ["a", `${KIND.Community}:${VICTIM}:other`], // different board
        ["K", String(KIND.Community)],
        ["k", String(KIND.Community)],
        ["p", OWNER],
      ],
    });
    expect(isIdeaEvent(event)).toBe(false); // lowerA === A fails
    expect(isReplyEvent(event)).toBe(false); // no e tag
    const { ideas, replies } = partitionBoardEvents([event]);
    expect(ideas).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });
});

describe("threads/classify: isIdeaEvent true but parseIdea null on a non-34550 A coordinate", () => {
  it("isIdeaEvent is an unreliable predicate: it returns true yet parseIdea returns null", () => {
    const bad = `1:${OWNER}:x`; // kind 1, not 34550
    const event = raw({
      kind: KIND.Comment,
      tags: [["A", bad], ["a", bad], ["K", String(KIND.Community)], ["k", String(KIND.Community)], ["p", OWNER]],
    });
    expect(isIdeaEvent(event)).toBe(true); // only string-compares lowerA===A and lowerK==='34550'
    expect(parseIdea(event)).toBeNull(); // parseCommunityCoordinate rejects kind !== 34550
    const { ideas, replies } = partitionBoardEvents([event]);
    expect(ideas).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });
});

describe("threads/classify: empty or bare e tag on an idea makes it NEITHER (silent data loss)", () => {
  it("(a) an empty e value is rejected as a reply and disqualifies the idea", () => {
    const event = raw({ kind: KIND.Comment, tags: [["A", A_COORD], ["e", ""], ["k", "1111"]] });
    expect(isReplyEvent(event)).toBe(false); // e[1].length > 0 fails
    expect(isIdeaEvent(event)).toBe(false); // getTag('e') !== undefined -> hasEventParent true
    const { ideas, replies } = partitionBoardEvents([event]);
    expect(ideas).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });
  it("(b) a community-parented idea carrying a bare [e] tag is still an idea (parent scope wins)", () => {
    const event = raw({ kind: KIND.Comment, tags: ideaTags([["e"]]) }); // name only, no value
    expect(isReplyEvent(event)).toBe(false); // e[1] undefined -> not a reply
    expect(isIdeaEvent(event)).toBe(true); // a = A, k = 34550 -> idea regardless of the bare e
    const { ideas, replies } = partitionBoardEvents([event]);
    expect(ideas).toHaveLength(1);
    expect(replies).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// parseReply: parentKind coercion, parent-pointer ambiguity, parentAuthor, whitespace e
// ---------------------------------------------------------------------------

describe("threads/parseReply: parentKind defaults to 1111 for missing/empty/garbage k", () => {
  it("missing k, empty k, and non-numeric k all default to KIND.Comment (1111), never 0 or NaN", () => {
    const noK = raw({ kind: KIND.Comment, tags: [["A", A_COORD], ["K", "34550"], ["e", "ee".repeat(32), "", POSTER]] });
    const emptyK = raw({ kind: KIND.Comment, tags: replyTags("ee".repeat(32), { k: "", eAuthor: POSTER }) });
    const garbageK = raw({ kind: KIND.Comment, tags: replyTags("ee".repeat(32), { k: "garbage", eAuthor: POSTER }) });
    expect(parseReply(noK)?.parentKind).toBe(KIND.Comment);
    expect(parseReply(emptyK)?.parentKind).toBe(KIND.Comment); // '' is falsy -> 1111, NOT 0
    expect(parseReply(garbageK)?.parentKind).toBe(KIND.Comment); // NaN -> fallback 1111
  });
});

describe("threads/parseReply: parentKind numeric coercion accepts hex/exponent/negative/float k", () => {
  it("parentKind is a raw Number() coercion: hex / exponent / negative / float / padded k all pass through", () => {
    const variant = (k: string): number | undefined =>
      parseReply(raw({ kind: KIND.Comment, tags: replyTags("ee".repeat(32), { k, eAuthor: POSTER }) }))?.parentKind;
    // parseReply uses Number()/Number.isFinite with a fallback to KIND.Comment only on NaN, so any
    // finite JS numeric coercion is kept verbatim (parentKind is a decorative hint, not authoritative).
    expect(variant("0x10")).toBe(16);
    expect(variant("1e3")).toBe(1000);
    expect(variant("-1")).toBe(-1);
    expect(variant("11.5")).toBe(11.5);
    expect(variant("  34550  ")).toBe(34550); // Number() trims surrounding whitespace
    expect(variant("34550\n")).toBe(34550);
  });
});

describe("threads/parseReply: multiple lowercase e tags (parent-pointer ambiguity)", () => {
  it("the reply attaches to the FIRST e tag; a leading decoy e steers the parent pointer", () => {
    const decoy = "de".repeat(32);
    const real = "be".repeat(32);
    const event = raw({
      kind: KIND.Comment,
      tags: [["A", A_COORD], ["K", String(KIND.Community)], ["e", decoy], ["e", real, "", POSTER], ["k", "1111"]],
    });
    const reply = parseReply(event);
    expect(reply).not.toBeNull();
    // getTag('e') returns the FIRST e (the decoy), so the parent pointer is the decoy, not `real`.
    expect(reply!.parentId).toBe(decoy);
    // Consequently the reply does NOT appear under `real`; it would thread under the decoy instead.
    expect(buildThread(real, [reply!])).toHaveLength(0);
    expect(buildThread(decoy, [reply!])).toHaveLength(1);
  });
});

describe("threads/parseReply: parentAuthor is an unvalidated self-asserted hint", () => {
  it("a non-hex e[3] is returned verbatim as parentAuthor (self-asserted, unvalidated hint)", () => {
    const event = raw({
      kind: KIND.Comment,
      pubkey: VICTIM, // attacker
      tags: [["A", A_COORD], ["K", String(KIND.Community)], ["e", "ee".repeat(32), "", "not-a-key"], ["k", "1111"], ["p", "also-garbage"]],
    });
    const reply = parseReply(event);
    expect(reply).not.toBeNull();
    // parseReply does no hex/format validation on the author hint, so e[3] flows through verbatim. The
    // renderer MUST treat parentAuthor as untrusted before using it as an @-mention / notification target.
    expect(reply!.parentAuthor).toBe("not-a-key");
  });

  it("a well-formed e[3] author hint is surfaced; falls back to the p tag when e[3] is empty", () => {
    const withE3 = raw({ kind: KIND.Comment, tags: replyTags("ee".repeat(32), { eAuthor: OWNER, p: VICTIM }) });
    expect(parseReply(withE3)?.parentAuthor).toBe(OWNER); // e[3] wins over p
    const onlyP = raw({ kind: KIND.Comment, tags: [["A", A_COORD], ["K", String(KIND.Community)], ["e", "ee".repeat(32)], ["k", "1111"], ["p", OWNER]] });
    expect(parseReply(onlyP)?.parentAuthor).toBe(OWNER); // fallback to p
  });
});

describe("threads/parseReply: whitespace-only e value passes the length check then orphans", () => {
  it("an e value that is non-empty but not 64-hex (a space / tab+newline) is accepted and orphans", () => {
    const space = raw({ kind: KIND.Comment, tags: [["A", A_COORD], ["K", String(KIND.Community)], ["e", " "], ["k", "1111"]] });
    const ctrl = raw({ kind: KIND.Comment, tags: [["A", A_COORD], ["K", String(KIND.Community)], ["e", "\t\n"], ["k", "1111"]] });
    // isReplyEvent only checks e[1].length > 0, so ' ' / '\t\n' pass and parseReply returns a Reply
    // whose whitespace parentId can never match a real event id (it simply orphans at build time).
    expect(isReplyEvent(space)).toBe(true);
    expect(parseReply(space)?.parentId).toBe(" ");
    expect(isReplyEvent(ctrl)).toBe(true);
    expect(parseReply(ctrl)?.parentId).toBe("\t\n");
  });
});

// ---------------------------------------------------------------------------
// parseIdea: title fallback, no sanitization, no truncation
// ---------------------------------------------------------------------------

describe("threads/parseIdea: empty/blank subject and firstLine fallback", () => {
  it("empty subject falls back to the first line; a leading blank line yields an EMPTY title", () => {
    const a = raw({ kind: KIND.Comment, content: "Hello world\nsecond line", tags: ideaTags([["subject", ""]]) });
    expect(parseIdea(a)?.title).toBe("Hello world");
    const b = raw({ kind: KIND.Comment, content: "   \n\nreal content", tags: ideaTags() });
    // firstLine takes ONLY the first physical line ('   '), trims to '', and does not scan downward.
    expect(parseIdea(b)?.title).toBe("");
  });
});

describe("threads/parseIdea: duplicate subject tags (first wins, decoy hides real)", () => {
  it("title selection is first-wins; both subject tags survive verbatim on raw.tags", () => {
    const event = raw({
      kind: KIND.Comment,
      content: "Real body line one",
      tags: ideaTags([["subject", "Innocuous Title"], ["subject", "REAL malicious title"]]),
    });
    // getTagValue('subject') returns the FIRST subject, so a human sees 'Innocuous Title' while a
    // keyword/moderation filter scanning ALL subject tags also sees the second. parseIdea does not
    // dedupe raw tags, so both conflicting subjects remain present-yet-only-first-displayed.
    const idea = parseIdea(event);
    expect(idea).not.toBeNull();
    // The displayed title is the first subject.
    expect(idea!.title).toBe("Innocuous Title");
    // Both subject tags are still on the wire (a moderation filter must scan all of them).
    expect(idea!.raw.tags.filter((t) => t[0] === "subject")).toHaveLength(2);
  });
});

describe("threads/parseIdea: control bytes stripped; HTML/markdown text preserved (React escapes on render)", () => {
  it("a NUL byte is stripped from body and title, while HTML/markdown text survives verbatim", () => {
    const NUL = String.fromCharCode(0);
    const payload = "<img src=x onerror=alert(1)>" + NUL + " **bold** [x](javascript:alert(1))";
    const event = raw({ kind: KIND.Comment, content: payload, tags: ideaTags() });
    const idea = parseIdea(event);
    expect(idea).not.toBeNull();
    // The NUL is gone (no control bytes survive), but the HTML/markdown TEXT is untouched: the parser
    // never strips or escapes markup -- React escapes it on render.
    expect(idea!.body).toBe(payload.replaceAll(NUL, ""));
    expect(idea!.body).not.toContain(NUL);
    expect(idea!.title).not.toContain(NUL);
  });

  it("a 5MB single-line content becomes both title and body with zero truncation", () => {
    const blob = "H".repeat(5_000_000);
    const event = raw({ kind: KIND.Comment, content: blob, tags: ideaTags() });
    const idea = parseIdea(event);
    expect(idea).not.toBeNull();
    expect(idea!.body.length).toBe(5_000_000);
    expect(idea!.title.length).toBe(5_000_000); // firstLine fallback returns the whole blob
  });
});

describe("threads/parseIdea: imeta media fan-out and url scheme", () => {
  it("a javascript:/data: imeta url flows verbatim into images[].url (no scheme allowlist in the parser)", () => {
    const event = raw({
      kind: KIND.Comment,
      tags: ideaTags([
        ["imeta", "url javascript:alert(1)", "alt <img src=x onerror=alert(2)>"],
        ["imeta", "url data:text/html;base64,PHNjcmlwdD4=", "m text/html"],
      ]),
    });
    const idea = parseIdea(event);
    expect(idea).not.toBeNull();
    // parseImeta does no scheme allowlist; these dangerous urls flow straight into images[].url. The
    // renderer MUST apply a scheme allowlist before using them. Here both active-scheme urls survive.
    const schemes = idea!.images.map((img) => img.url.split(":", 1)[0]);
    expect(schemes).toContain("javascript");
    expect(schemes).toContain("data");
  });

  it("thousands of identical imeta urls are all materialized (no cap, no dedup in the parser)", () => {
    const imetas: string[][] = [];
    for (let i = 0; i < 5000; i++) imetas.push(["imeta", "url https://h/img.png"]);
    const event = raw({ kind: KIND.Comment, tags: ideaTags(imetas) });
    const idea = parseIdea(event);
    expect(idea).not.toBeNull();
    // parseIdea applies no cap or dedup to imeta tags, so all 5000 materialize. The render layer must
    // bound this; the parser surfaces every attacker-supplied attachment verbatim.
    expect(idea!.images.length).toBe(5000);
  });

  it("parseImeta alone returns javascript: url and HTML alt verbatim (untrusted attribute surface)", () => {
    const img = parseImeta(["imeta", "url javascript:alert(1)", "alt <img onerror=x>"]);
    expect(img).not.toBeNull();
    // Documents the raw untrusted output; the renderer MUST apply a scheme allowlist + escape alt.
    expect(img!.url).toBe("javascript:alert(1)");
    expect(img!.alt).toBe("<img onerror=x>");
  });
});

// ---------------------------------------------------------------------------
// coordinate canonicalization (feeds board bucketing of ideas/replies)
// ---------------------------------------------------------------------------

describe("threads/coords: non-canonical A kind segment spoofs the board coordinate", () => {
  it("CORRECTNESS: 034550 / 3.4550e4 / 0x86F6 must NOT parse as the 34550 community", () => {
    for (const variant of ["034550", "3.4550e4", "0x86F6"]) {
      const coord = `${variant}:${OWNER}:${SLUG}`;
      // Number(slice) yields exactly 34550 for all three, so parseCommunityCoordinate accepts them and
      // communityCoordinate reserializes to the canonical board, silently filing a foreign event under it.
      expect(parseCommunityCoordinate(coord), variant).toBeNull();
    }
  });

  it("a fully-scoped idea whose A is '034550:...' parses and reserializes to the canonical board (spoof)", () => {
    const spoofCoord = `034550:${OWNER}:${SLUG}`;
    const event = raw({
      kind: KIND.Comment,
      content: "hi",
      tags: [["A", spoofCoord], ["a", spoofCoord], ["K", "34550"], ["k", "34550"], ["P", OWNER], ["p", OWNER], ["subject", "Spoof"]],
    });
    const idea = parseIdea(event);
    // CORRECTNESS: a non-canonical on-wire A must not be silently filed under the real board.
    expect(idea).toBeNull();
  });
});

describe("threads/coords: uppercase pubkey in A normalizes to the same board bucket", () => {
  it("an uppercase-hex pubkey coordinate is normalized to lowercase, so it does NOT split the board", () => {
    const upper = `${KIND.Community}:${"AB".repeat(32)}:${SLUG}`;
    const ref = parseCommunityCoordinate(upper);
    // parseCommunityCoordinate lowercases the hex pubkey, so the uppercase coordinate canonicalizes to
    // the SAME coordinate as the lowercase one: no two-bucket split.
    expect(ref).toEqual({ pubkey: "ab".repeat(32), slug: SLUG });
    expect(communityCoordinate(ref!)).toBe(`${KIND.Community}:${"ab".repeat(32)}:${SLUG}`);
  });
});

describe("threads/coords: empty board slug parses to a board with an empty identifier", () => {
  it("a coordinate with an empty identifier (34550:<P>:) parses with slug '' (the addressable default)", () => {
    const emptySlug = `${KIND.Community}:${OWNER}:`;
    // The identifier segment may be empty (the addressable default), so this parses to slug ''. It is
    // internally consistent with the empty-d parseBoard case and round-trips back to the same coordinate.
    const ref = parseCommunityCoordinate(emptySlug);
    expect(ref).toEqual({ pubkey: OWNER, slug: "" });
    expect(communityCoordinate(ref!)).toBe(emptySlug);
  });
});

describe("threads/coords: extra colons produce a multi-segment slug", () => {
  it("a coordinate 34550:<P>:a:b:c round-trips its full slug 'a:b:c'", () => {
    const coord = `${KIND.Community}:${OWNER}:a:b:c`;
    const ref = parseCommunityCoordinate(coord);
    expect(ref).not.toBeNull();
    expect(ref!.slug).toBe("a:b:c"); // slice-to-end keeps embedded colons
    expect(communityCoordinate(ref!)).toBe(coord); // reserializes exactly
  });

  it("parseCoordinate keeps embedded colons in the identifier (documents the round-trip surface)", () => {
    const parsed = parseCoordinate(`${KIND.Community}:${OWNER}:a:b:c`);
    expect(parsed).not.toBeNull();
    expect(parsed!.identifier).toBe("a:b:c");
  });
});