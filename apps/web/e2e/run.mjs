#!/usr/bin/env node
/**
 * Voxboard end-to-end harness.
 *
 * Real relay fixtures (nak) + a real browser (puppeteer-core driving the system Chrome) + SSR assertions
 * (fetch). It exists because the bugs that kept recurring (reply form hidden, reply counts missing,
 * optimistic comment leaking across ideas, vote-score flicker) are all client/subscription behaviours
 * that typecheck + unit tests cannot see. Each spec maps to one of those regressions.
 *
 * Requirements: a running dev (or prod) server, `nak` on PATH, and a Chrome/Chromium binary.
 *   BASE_URL     default http://localhost:3000
 *   RELAY        default wss://nos.lol   (must be in the app's DEFAULT_RELAYS)
 *   CHROME_PATH  default the macOS Google Chrome path
 *   HEADLESS     "false" to watch it run
 *
 * Run:  npm run e2e -w apps/web      (start `npm run dev -w apps/web` first)
 *
 * Login is seeded deterministically by writing the NDK session into localStorage (the exact format NDK
 * restores from) — no dialog driving, so the harness never flakes on the login modal.
 */
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import puppeteer from "puppeteer-core";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const RELAY = process.env.RELAY ?? "wss://nos.lol";
const CHROME_PATH =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HEADLESS = process.env.HEADLESS !== "false";

// ---------------------------------------------------------------------------
// tiny assertion framework
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const lines = [];
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    lines.push(`  ✓ ${name}`);
  } else {
    failed++;
    lines.push(`  ✗ ${name}${detail ? `  — ${detail}` : ""}`);
  }
}
function section(title) {
  lines.push("", title);
}

// ---------------------------------------------------------------------------
// nak relay helpers
// ---------------------------------------------------------------------------
function nak(args) {
  // stdin = /dev/null ('ignore'): nak reads events from a piped stdin if it has one, so an empty pipe
  // (execFileSync's default) makes it emit nothing. /dev/null gives immediate EOF → it builds from flags.
  return execFileSync("nak", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}
function genKey() {
  const sec = nak(["key", "generate"]);
  const pub = nak(["key", "public", sec]);
  return { sec, pub };
}
function publishEvent(sec, kind, content, tags) {
  const args = ["event", "--sec", sec, "-k", String(kind), "-c", content];
  for (const [k, v] of tags) args.push("-t", `${k}=${v}`);
  args.push(RELAY);
  return JSON.parse(nak(args)).id;
}
function deleteEvent(sec, id) {
  try {
    publishEvent(sec, 5, "e2e cleanup", [["e", id]]);
  } catch {
    /* best effort */
  }
}
function encode(kind, args) {
  return nak(["encode", kind, ...args]);
}

// ---------------------------------------------------------------------------
// SSR helper
// ---------------------------------------------------------------------------
async function ssrText(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { "user-agent": "voxboard-e2e" } });
  const html = await res.text();
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
function publishFixtures() {
  const { sec, pub } = genKey();
  const slug = `vox-e2e-${pub.slice(0, 8)}`;
  const coord = `34550:${pub}:${slug}`;
  const T = (extra) => [["A", coord], ["K", "34550"], ["P", pub], ...extra];

  publishEvent(sec, 34550, "", [["d", slug], ["name", "E2E Test Board"], ["description", "harness fixture"]]);
  const ideaA = publishEvent(sec, 1111, "Idea A body — exportable roadmap", [
    ...T([["a", coord], ["k", "34550"], ["p", pub], ["subject", "E2E idea A"]]),
  ]);
  const ideaB = publishEvent(sec, 1111, "Idea B body — dark mode", [
    ...T([["a", coord], ["k", "34550"], ["p", pub], ["subject", "E2E idea B"]]),
  ]);
  const reply = publishEvent(sec, 1111, "E2E seeded reply to idea A", [
    ...T([["e", ideaA], ["k", "1111"], ["p", pub]]),
  ]);

  // a second, EMPTY board (no ideas) to assert the loading skeleton resolves to "No ideas yet" rather
  // than pulsing forever (a default profile-relay may never EOSE a kind-1111 filter).
  const emptySlug = `vox-e2e-empty-${pub.slice(0, 8)}`;
  publishEvent(sec, 34550, "", [["d", emptySlug], ["name", "E2E Empty Board"]]);

  // idea C + a reply to it from ANOTHER author that #p-tags the viewer (idea C's author = the seeded
  // session). Isolated on its own idea so it does not change idea A/B reply counts. The bell should count
  // it on idea C's page — verifying the `#p` sub isn't starved by the provider's #A sub (the ONLY_RELAY
  // fix).
  const ideaC = publishEvent(sec, 1111, "Idea C body — notifications target", [
    ...T([["a", coord], ["k", "34550"], ["p", pub], ["subject", "E2E idea C"]]),
  ]);
  const replier = genKey();
  const notifReply = publishEvent(replier.sec, 1111, "an external reply pinging the viewer", [
    ...T([["e", ideaC], ["k", "1111"], ["p", pub]]),
  ]);

  const naddr = encode("naddr", ["-d", slug, "--pubkey", pub, "-k", "34550"]);
  const emptyNaddr = encode("naddr", ["-d", emptySlug, "--pubkey", pub, "-k", "34550"]);
  const neventA = encode("nevent", [ideaA]);
  const neventB = encode("nevent", [ideaB]);
  const neventC = encode("nevent", [ideaC]);
  return { sec, pub, slug, coord, ideaA, ideaB, ideaC, reply, naddr, emptyNaddr, neventA, neventB, neventC, replierSec: replier.sec, notifReply };
}

// ---------------------------------------------------------------------------
// browser helpers
// ---------------------------------------------------------------------------
async function seedSession(page, { sec, pub }) {
  // Land on the origin first so localStorage is writable for it, then inject the NDK session.
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    (pubkey, secHex) => {
      const signerPayload = JSON.stringify({ type: "private-key", payload: secHex });
      localStorage.setItem("ndk-saved-sessions", JSON.stringify([{ pubkey, signerPayload }]));
      localStorage.setItem("ndk-active-pubkey", pubkey);
    },
    pub,
    sec,
  );
}

/** Wait until `fn` (evaluated in the page, with `args`) is truthy, polling. Returns true on success. */
async function waitFor(page, fn, { timeout = 15000, interval = 250 } = {}, ...args) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn, ...args)) return true;
    await sleep(interval);
  }
  return false;
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

/** The seeded session restores asynchronously after each load; wait until the header shows "Log out"
 *  (only rendered when logged in) before any action that needs the signer, or requireLogin swallows it. */
async function waitForLoggedIn(page) {
  return waitFor(page, () => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Log out"));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  // dev server up?
  try {
    const res = await fetch(`${BASE_URL}/`);
    if (!res.ok) throw new Error(String(res.status));
  } catch (e) {
    console.error(`\nDev server not reachable at ${BASE_URL}. Start it with:\n  npm run dev -w apps/web\n`);
    process.exit(2);
  }

  console.log(`\nVoxboard e2e  (base=${BASE_URL}, relay=${RELAY})`);
  console.log("Publishing relay fixtures via nak…");
  const fx = publishFixtures();
  console.log(`  board ${fx.coord.slice(0, 28)}…  ideaA=${fx.ideaA.slice(0, 8)} ideaB=${fx.ideaB.slice(0, 8)}`);

  // Give relays a beat to index the new events before the SSR queries run.
  await sleep(2000);

  let browser;
  try {
    // ----- SSR read-path (no browser, no login) -----
    section("SSR read-path");
    const boardText = await ssrText(`/b/${fx.naddr}`);
    check("board page renders the board name", boardText.includes("E2E Test Board"));
    check("board page lists idea A", boardText.includes("E2E idea A"));
    check("board page lists idea B", boardText.includes("E2E idea B"));
    check(
      "feed shows idea A's reply count (1 replies)",
      /\b1 replies\b/.test(boardText),
      `board text had no "1 replies": …${boardText.slice(Math.max(0, boardText.indexOf("E2E idea A") - 10), boardText.indexOf("E2E idea A") + 120)}…`,
    );

    const ideaAText = await ssrText(`/d/${fx.neventA}`);
    check("idea A page header counts 1 reply", /\b1 reply\b/.test(ideaAText), "expected '1 reply' header");
    const ideaBText = await ssrText(`/d/${fx.neventB}`);
    check("idea B page header counts 0 replies", /\b0 replies\b/.test(ideaBText), "expected '0 replies' header");

    // ----- browser write-path (seeded login) -----
    section("Browser write-path (logged in)");
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: HEADLESS,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);

    await seedSession(page, fx);
    await page.goto(`${BASE_URL}/d/${fx.neventA}`, { waitUntil: "domcontentloaded" });
    const loggedIn = await waitForLoggedIn(page);
    check("seeded session restores (logged in)", loggedIn);

    // The reply form must be visible for a logged-in user (the "I can't even see the reply form" bug).
    const formVisible = await waitFor(page, () => !!document.querySelector('textarea[aria-label="Share your thoughts"]'));
    check("reply form is visible when logged in", formVisible);

    let postedOk = false;
    let countIncremented = false;
    const unique = `e2e-reply-${Date.now()}`;
    if (formVisible) {
      // header reply count before posting (innerText uppercases the header via CSS, so match /i)
      const before = (await bodyText(page)).match(/(\d+)\s+repl/i);
      await page.type('textarea[aria-label="Share your thoughts"]', unique);
      // click the submit button whose text is "Reply"
      await page.$$eval("button", (btns) => {
        const b = btns.find((x) => x.type === "submit" && /reply/i.test(x.textContent || ""));
        if (b) b.click();
      });
      // optimistic insert should show the reply text without a reload
      postedOk = await waitForText(page, unique, 15000);
      const after = (await bodyText(page)).match(/(\d+)\s+repl/i);
      countIncremented = Boolean(before && after && Number(after[1]) === Number(before[1]) + 1);
    }
    check("posting a reply shows it immediately (optimistic insert)", postedOk);
    check("reply header count increments by 1 after posting", countIncremented);

    // ----- cross-idea isolation: idea B must not show idea A's reply -----
    section("Cross-idea isolation");
    await page.goto(`${BASE_URL}/d/${fx.neventB}`, { waitUntil: "domcontentloaded" });
    await waitFor(page, () => document.body.innerText.includes("E2E idea B"));
    await waitFor(page, () => /\d+\s+repl/i.test(document.body.innerText)); // reply header rendered
    const bText = await bodyText(page);
    check("idea B does not render the optimistic reply posted on idea A", !bText.includes(unique));
    check(
      "idea B header still reads 0 replies",
      /\b0 replies\b/i.test(bText),
      `repl-match=${bText.match(/\d+\s+repl\w+/i)?.[0] ?? "none"}`,
    );

    // ----- vote stability: no +2 flicker frame -----
    // The feed sorts by score, so an upvoted idea jumps position; scope every read to ONE idea (by its
    // title) and re-query each poll so we track that idea's VotePill, not "whatever is first now".
    section("Vote stability");
    await page.goto(`${BASE_URL}/b/${fx.naddr}`, { waitUntil: "domcontentloaded" });
    await waitForLoggedIn(page); // or requireLogin swallows the cast and the score never moves
    const TITLE = "E2E idea B";
    const upReady = await waitFor(page, (t) => {
      const a = [...document.querySelectorAll("article")].find((el) => el.innerText.includes(t));
      return !!a && !!a.querySelector('button[aria-label="Upvote"]');
    }, {}, TITLE);
    let noOvershoot = false;
    let settledPlusOne = false;
    let diag = "upvote button not found";
    if (upReady) {
      const readScore = () =>
        page.evaluate((t) => {
          const a = [...document.querySelectorAll("article")].find((el) => el.innerText.includes(t));
          const el = a && a.querySelector('[aria-label^="Score "]');
          return el ? Number(el.getAttribute("aria-label").replace("Score ", "")) : null;
        }, TITLE);
      const base = (await readScore()) ?? 0;
      await page.evaluate((t) => {
        const a = [...document.querySelectorAll("article")].find((el) => el.innerText.includes(t));
        a?.querySelector('button[aria-label="Upvote"]')?.click();
      }, TITLE);
      let maxSeen = base;
      let final = base;
      const start = Date.now();
      while (Date.now() - start < 2500) {
        const s = await readScore();
        if (s != null) {
          final = s;
          if (s > maxSeen) maxSeen = s;
        }
        await sleep(60);
      }
      const dbg = await page.evaluate(() => ({
        articles: document.querySelectorAll("article").length,
        upvotes: document.querySelectorAll('button[aria-label="Upvote"]').length,
        scores: [...document.querySelectorAll('[aria-label^="Score "]')].map((e) => e.getAttribute("aria-label")),
        loginBtns: [...document.querySelectorAll("button,a")].filter((e) => /log in/i.test(e.textContent || "")).length,
      }));
      noOvershoot = maxSeen <= base + 1;
      settledPlusOne = final === base + 1;
      diag = `base=${base} maxSeen=${maxSeen} final=${final} | articles=${dbg.articles} upvotes=${dbg.upvotes} scores=${JSON.stringify(dbg.scores)} loginBtns=${dbg.loginBtns}`;
    }
    check("upvote never shows a +2 overshoot frame", noOvershoot, diag);
    check("upvote settles at base+1", settledPlusOne, diag);

    // ----- board loading: an EMPTY board must resolve to "No ideas yet", not pulse forever -----
    section("Board loading");
    await page.goto(`${BASE_URL}/b/${fx.emptyNaddr}`, { waitUntil: "domcontentloaded" });
    const resolvedEmpty = await waitFor(
      page,
      () => document.body.innerText.includes("No ideas yet"),
      { timeout: 12000 },
    );
    const skeletons = await page.evaluate(() => document.querySelectorAll(".animate-pulse").length);
    check("empty board resolves to its empty state (no perpetual skeleton)", resolvedEmpty);
    check("empty board shows no loading skeletons once settled", skeletons === 0, `skeletons=${skeletons}`);

    // ----- notifications: the bell counts a #p reply even on a page where the board provider's #A sub
    // is active (the ONLY_RELAY cache-bypass fix). idea A's author IS the seeded viewer. -----
    section("Notifications");
    await page.goto(`${BASE_URL}/d/${fx.neventC}`, { waitUntil: "domcontentloaded" });
    await waitForLoggedIn(page);
    const gotNotif = await waitFor(
      page,
      () => {
        const btn = document.querySelector('button[aria-label^="Notifications"]');
        const m = btn && (btn.getAttribute("aria-label") || "").match(/(\d+)\s+unread/);
        return m ? Number(m[1]) > 0 : false;
      },
      { timeout: 12000 },
    );
    check("notification bell counts a #p reply on the idea page (provider #A active)", gotNotif);
  } finally {
    if (browser) await browser.close();
    // cleanup fixtures (advisory NIP-09)
    for (const id of [fx.ideaA, fx.ideaB, fx.ideaC, fx.reply]) deleteEvent(fx.sec, id);
    deleteEvent(fx.replierSec, fx.notifReply); // authored by the replier key
  }

  console.log(lines.join("\n"));
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

/** Poll the page body for a substring (waitFor can't thread args cleanly). */
async function waitForText(page, text, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await page.evaluate(() => document.body.innerText)).includes(text)) return true;
    await sleep(250);
  }
  return false;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
