/**
 * BoardAggregator — one Durable Object per board (keyed by its 34550 coordinate via getByName).
 *
 * Holds outbound WebSocket connections to the board's relays, subscribes to the board's events
 * (community def, ideas/replies, labels, approvals, and votes keyed by idea ids), verifies them, and
 * stores raw events in DO SQLite. The read API derives scores/status/reply-counts/moderation via the
 * shared @voxboard/protocol `deriveBoardStats` (the same function the web client logic mirrors), so
 * the two can never disagree. Zaps are deferred to M4. See docs/INDEXER.md.
 *
 * Outbound WebSocket: fetch with `Upgrade: websocket` and take `response.webSocket` (URL must be
 * http/https, so wss:// is rewritten to https://). An open socket keeps the DO alive; an alarm
 * re-ensures connections and refreshes the vote subscription as ideas arrive.
 */

import { DurableObject } from "cloudflare:workers";
import { verifyEvent } from "nostr-tools/pure";
import {
  KIND,
  deriveBoardStats,
  partitionBoardEvents,
  parseCommunityCoordinate,
  validateNostrEvent,
  visibleIdeas,
  type IdeaSort,
  type IdeaStat,
  type NostrEvent,
} from "@voxboard/protocol";

export { type IdeaSort } from "@voxboard/protocol";

export interface Env {
  BOARD_AGGREGATOR: DurableObjectNamespace<BoardAggregator>;
}

export interface TrackInput {
  coordinate: string;
  relays: string[];
}

export interface BoardStats {
  coordinate: string | null;
  tracked: boolean;
  connectedRelays: number;
  configuredRelays: number;
  totalEvents: number;
  byKind: Record<number, number>;
  lastEventAt: number | null;
}

type EventRow = {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string;
};

const SUB_BOARD = "vox-board";
const SUB_VOTES = "vox-votes";
const KEEPALIVE_MS = 60_000;
// Events are verified at ingest; the reconstructed sig is a non-checked placeholder for parsing only.
const PLACEHOLDER_SIG = "0".repeat(128);

export class BoardAggregator extends DurableObject<Env> {
  private sockets = new Map<string, WebSocket>();
  /** stable key of the idea-id set the vote subscription currently covers, to avoid redundant re-subs */
  private voteSubKey = "";

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  // --- RPC -----------------------------------------------------------------

  async track(input: TrackInput): Promise<{ ok: true }> {
    const ref = parseCommunityCoordinate(input.coordinate);
    if (!ref) throw new Error(`invalid board coordinate: ${input.coordinate}`);
    if (input.relays.length === 0) throw new Error("at least one relay is required");

    this.setMeta("coordinate", input.coordinate);
    this.setMeta("owner", ref.pubkey);
    this.setMeta("slug", ref.slug);
    this.setMeta("relays", JSON.stringify(input.relays));

    await this.ensureConnections();
    await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_MS);
    return { ok: true };
  }

  /** Aggregated, sorted, filtered ideas with scores/status/reply-counts (visible items only). */
  async getIdeas(opts: { sort?: IdeaSort; status?: string; tag?: string } = {}): Promise<{ ideas: IdeaStat[] }> {
    const aggregate = deriveBoardStats(this.allEvents());
    return { ideas: visibleIdeas(aggregate, opts) };
  }

  async getIdeaStats(id: string): Promise<IdeaStat | null> {
    return deriveBoardStats(this.allEvents()).ideas.find((idea) => idea.id === id) ?? null;
  }

  /** Visible ideas grouped into roadmap columns by current status. */
  async getRoadmap(): Promise<{ columns: Record<string, IdeaStat[]> }> {
    const aggregate = deriveBoardStats(this.allEvents());
    const columns: Record<string, IdeaStat[]> = {};
    for (const idea of visibleIdeas(aggregate)) {
      if (!idea.status) continue;
      (columns[idea.status] ??= []).push(idea);
    }
    return { columns };
  }

  async getModeration(): Promise<{
    owner: string | null;
    moderators: string[];
    mode: string;
    banned: string[];
    hidden: string[];
  }> {
    const { board, banned, hidden } = deriveBoardStats(this.allEvents());
    return {
      owner: board?.pubkey ?? null,
      moderators: board?.moderators.map((m) => m.pubkey) ?? [],
      mode: board?.mode ?? "open",
      banned: [...banned],
      hidden: [...hidden],
    };
  }

  async stats(): Promise<BoardStats> {
    const total = this.ctx.storage.sql.exec<{ c: number }>("SELECT COUNT(*) AS c FROM events").one().c;
    const byKindRows = this.ctx.storage.sql
      .exec<{ kind: number; c: number }>("SELECT kind, COUNT(*) AS c FROM events GROUP BY kind")
      .toArray();
    const lastRow = this.ctx.storage.sql
      .exec<{ last: number | null }>("SELECT MAX(created_at) AS last FROM events")
      .one();

    const byKind: Record<number, number> = {};
    for (const row of byKindRows) byKind[row.kind] = row.c;

    return {
      coordinate: this.getMeta("coordinate") ?? null,
      tracked: this.getMeta("coordinate") !== undefined,
      connectedRelays: this.sockets.size,
      configuredRelays: this.relays().length,
      totalEvents: total,
      byKind,
      lastEventAt: lastRow.last,
    };
  }

  // --- Relay connections --------------------------------------------------

  override async alarm(): Promise<void> {
    if (this.getMeta("coordinate") === undefined) return;
    await this.ensureConnections();
    this.ensureVoteSub();
    await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_MS);
  }

  private async ensureConnections(): Promise<void> {
    const coordinate = this.getMeta("coordinate");
    if (!coordinate) return;
    for (const relay of this.relays()) {
      if (this.sockets.has(relay)) continue;
      try {
        await this.connectRelay(relay);
      } catch (error) {
        console.error(JSON.stringify({ level: "error", msg: "relay connect failed", relay, error: String(error) }));
      }
    }
  }

  private async connectRelay(relayUrl: string): Promise<void> {
    const httpUrl = relayUrl.replace(/^ws/, "http"); // wss:// -> https://, ws:// -> http://
    const resp = await fetch(httpUrl, { headers: { Upgrade: "websocket" } });
    const ws = resp.webSocket;
    if (!ws) throw new Error(`relay did not upgrade: ${relayUrl} (status ${resp.status})`);

    ws.accept();
    ws.addEventListener("message", (event) => this.onMessage(event));
    const drop = () => {
      if (this.sockets.get(relayUrl) === ws) this.sockets.delete(relayUrl);
    };
    ws.addEventListener("close", drop);
    ws.addEventListener("error", drop);

    this.sockets.set(relayUrl, ws);
    ws.send(JSON.stringify(["REQ", SUB_BOARD, ...this.boardFilters()]));
    this.openVoteSub(ws);
  }

  private boardFilters(): Array<Record<string, unknown>> {
    const coordinate = this.getMeta("coordinate") ?? "";
    const owner = this.getMeta("owner") ?? "";
    const slug = this.getMeta("slug") ?? "";
    return [
      { kinds: [KIND.Community], authors: [owner], "#d": [slug] },
      { kinds: [KIND.Comment], "#A": [coordinate] }, // ideas + replies
      { kinds: [KIND.Label, KIND.PostApproval], "#a": [coordinate] }, // status/mod + approvals
    ];
  }

  /** The ids of the board's top-level ideas, used to scope the vote subscription. */
  private ideaIds(): string[] {
    const { ideas } = partitionBoardEvents(this.eventsByKind(KIND.Comment));
    return ideas.map((idea) => idea.id);
  }

  private openVoteSub(ws: WebSocket): void {
    const ids = this.ideaIds();
    if (ids.length === 0) return;
    try {
      ws.send(JSON.stringify(["REQ", SUB_VOTES, { kinds: [KIND.Reaction], "#e": ids }]));
    } catch {
      // socket may be closing; the alarm will retry
    }
  }

  /** Refresh the vote subscription on all sockets when the idea set has changed. */
  private ensureVoteSub(): void {
    const ids = this.ideaIds();
    if (ids.length === 0) return;
    const key = [...ids].sort().join(",");
    if (key === this.voteSubKey) return;
    this.voteSubKey = key;
    for (const ws of this.sockets.values()) {
      try {
        ws.send(JSON.stringify(["CLOSE", SUB_VOTES]));
        ws.send(JSON.stringify(["REQ", SUB_VOTES, { kinds: [KIND.Reaction], "#e": ids }]));
      } catch {
        // ignore; alarm will retry
      }
    }
  }

  private onMessage(event: MessageEvent): void {
    const data =
      typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(msg) || msg.length === 0) return;

    if (msg[0] === "EVENT") {
      const isNewIdea = this.ingest(msg[2]);
      if (isNewIdea) this.ensureVoteSub();
    } else if (msg[0] === "EOSE" && msg[1] === SUB_BOARD) {
      this.ensureVoteSub();
    }
  }

  /** Validate, verify, and store a raw event. Returns true if it was a not-seen-before idea. */
  private ingest(raw: unknown): boolean {
    const event = validateNostrEvent(raw);
    if (!event) return false;
    if (!verifyEvent(event as NostrEvent & { sig: string })) return false;

    const existed = this.ctx.storage.sql
      .exec<{ c: number }>("SELECT COUNT(*) AS c FROM events WHERE id = ?", event.id)
      .one().c;
    this.store(event);
    return existed === 0 && event.kind === KIND.Comment;
  }

  private store(event: NostrEvent): void {
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO events (id, kind, pubkey, created_at, content, tags, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.id,
      event.kind,
      event.pubkey,
      event.created_at,
      event.content,
      JSON.stringify(event.tags),
      Math.floor(Date.now() / 1000),
    );
  }

  // --- Storage helpers ----------------------------------------------------

  private allEvents(): NostrEvent[] {
    return this.ctx.storage.sql
      .exec<EventRow>("SELECT id, kind, pubkey, created_at, content, tags FROM events")
      .toArray()
      .map((row) => this.toEvent(row));
  }

  private eventsByKind(...kinds: number[]): NostrEvent[] {
    const placeholders = kinds.map(() => "?").join(",");
    return this.ctx.storage.sql
      .exec<EventRow>(`SELECT id, kind, pubkey, created_at, content, tags FROM events WHERE kind IN (${placeholders})`, ...kinds)
      .toArray()
      .map((row) => this.toEvent(row));
  }

  private toEvent(row: EventRow): NostrEvent {
    return {
      id: row.id,
      pubkey: row.pubkey,
      created_at: row.created_at,
      kind: row.kind,
      content: row.content,
      tags: JSON.parse(row.tags) as string[][],
      sig: PLACEHOLDER_SIG,
    };
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    );
    const version = this.ctx.storage.sql
      .exec<{ v: number }>("SELECT COALESCE(MAX(id), 0) AS v FROM _migrations")
      .one().v;

    if (version < 1) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          kind INTEGER NOT NULL,
          pubkey TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          content TEXT NOT NULL,
          tags TEXT NOT NULL,
          received_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);
        CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
        INSERT INTO _migrations (id) VALUES (1);
      `);
    }
  }

  private setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  private getMeta(key: string): string | undefined {
    return this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)
      .toArray()[0]?.value;
  }

  private relays(): string[] {
    const raw = this.getMeta("relays");
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : [];
    } catch {
      return [];
    }
  }
}
