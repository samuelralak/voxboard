/**
 * Read-path helpers: split a board's kind-1111 events into ideas vs replies, and assemble replies
 * into a comment tree from their lowercase `e` parent pointers (see reply.ts / docs/PROTOCOL.md).
 * Pure functions, used by both the web client and the aggregator.
 */

import type { NostrEvent } from "./event";
import { parseIdea, type Idea } from "./idea";
import { parseReply, type Reply } from "./reply";

export interface BoardContent {
  ideas: Idea[];
  replies: Reply[];
}

/** Partition a mixed set of kind-1111 events (e.g. from one `#A` board subscription) into ideas and replies. */
export function partitionBoardEvents(events: NostrEvent[]): BoardContent {
  const ideas: Idea[] = [];
  const replies: Reply[] = [];
  for (const event of events) {
    const idea = parseIdea(event);
    if (idea) {
      ideas.push(idea);
      continue;
    }
    const reply = parseReply(event);
    if (reply) replies.push(reply);
  }
  return { ideas, replies };
}

export interface ThreadNode {
  reply: Reply;
  depth: number;
  children: ThreadNode[];
}

/**
 * Hard cap on reply nesting. A real feedback thread is never this deep; the cap turns an adversarial
 * self-reply chain (which would otherwise blow the recursion stack here AND in the recursive renderer)
 * into a bounded tree. Replies deeper than this are dropped from the tree.
 */
export const MAX_THREAD_DEPTH = 64;

/**
 * Build the reply tree rooted at `rootId` (an idea id, or any event id). Children are replies whose
 * `parentId` is their parent's id, ordered oldest-first (lowest id breaks ties). Replies whose parent
 * chain never reaches the root are dropped; cycles are guarded against; nesting is capped at
 * MAX_THREAD_DEPTH so a deep chain cannot exhaust the stack.
 */
export function buildThread(rootId: string, replies: Reply[]): ThreadNode[] {
  const byParent = new Map<string, Reply[]>();
  for (const reply of replies) {
    const siblings = byParent.get(reply.parentId);
    if (siblings) siblings.push(reply);
    else byParent.set(reply.parentId, [reply]);
  }

  const seen = new Set<string>();
  const build = (parentId: string, depth: number): ThreadNode[] => {
    if (depth >= MAX_THREAD_DEPTH) return []; // bound runaway nesting (DoS / stack guard)
    const children = (byParent.get(parentId) ?? [])
      .filter((r) => !seen.has(r.id))
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    const nodes: ThreadNode[] = [];
    for (const reply of children) {
      if (seen.has(reply.id)) continue; // cycle guard
      seen.add(reply.id);
      nodes.push({ reply, depth, children: build(reply.id, depth + 1) });
    }
    return nodes;
  };

  return build(rootId, 0);
}

/** Total replies in a thread (all descendants). */
export function countThread(nodes: ThreadNode[]): number {
  let total = 0;
  for (const node of nodes) total += 1 + countThread(node.children);
  return total;
}

/**
 * Descendant reply count for many roots in ONE pass: O(roots + replies) total, vs. O(roots * replies)
 * if you call buildThread/countThread per idea. Builds the parent->children index once, then does an
 * iterative (stack, not recursion -> no overflow on deep threads) DFS from every root sharing a single
 * `seen` set, so each reply is counted exactly once (under its nearest reachable root) and cycles
 * terminate.
 */
export function replyCountsByRoot(
  rootIds: string[],
  replies: Reply[],
  cutoffByRoot?: Map<string, number>,
): Map<string, number> {
  const childrenByParent = new Map<string, Reply[]>();
  for (const reply of replies) {
    const siblings = childrenByParent.get(reply.parentId);
    if (siblings) siblings.push(reply);
    else childrenByParent.set(reply.parentId, [reply]);
  }

  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const root of rootIds) {
    // A locked thread hides replies created after the lock cutoff (and, transitively, their subtrees).
    const cutoff = cutoffByRoot?.get(root);
    let count = 0;
    const stack: string[] = [root];
    while (stack.length > 0) {
      const parentId = stack.pop() as string;
      const children = childrenByParent.get(parentId);
      if (!children) continue;
      for (const child of children) {
        if (seen.has(child.id)) continue; // each reply belongs to one tree; also guards cycles/dupes
        if (cutoff !== undefined && child.createdAt > cutoff) continue; // locked out
        seen.add(child.id);
        count++;
        stack.push(child.id);
      }
    }
    counts.set(root, count);
  }
  return counts;
}
