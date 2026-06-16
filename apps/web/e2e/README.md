# Voxboard e2e harness

Real-relay, real-browser regression tests for the behaviours that unit tests and typecheck cannot see:
the reply form's visibility, posting a reply (optimistic insert + count), cross-idea isolation, the feed
reply count, and vote-score stability (no `+2` flicker frame).

## How it works

- **Fixtures** are published to a relay with [`nak`](https://github.com/fiatjaf/nak): a board (kind 34550),
  two ideas and one reply (kind 1111). They are deleted (NIP-09) at the end.
- **SSR assertions** use `fetch` against the running server and inspect the rendered HTML.
- **Browser assertions** drive the system Chrome via `puppeteer-core`. Login is seeded deterministically
  by writing the NDK session into `localStorage` (`ndk-saved-sessions` + `ndk-active-pubkey`), so the
  harness never touches the login dialog.

## Run

```sh
npm run dev -w apps/web         # in one terminal
npm run e2e -w apps/web         # in another
```

Exit code is `0` when every spec passes, `1` on any failure, `2` if the dev server isn't reachable.

## Config (env)

| var | default | notes |
|-----|---------|-------|
| `BASE_URL` | `http://localhost:3000` | the running server |
| `RELAY` | `wss://nos.lol` | must be in the app's `DEFAULT_RELAYS` |
| `CHROME_PATH` | macOS Google Chrome | any Chrome/Chromium binary |
| `HEADLESS` | `true` | set `false` to watch it run |

## Requirements

`nak` on `PATH`, a Chrome/Chromium binary, and a running dev/prod server. `puppeteer-core` is a dev
dependency (it does **not** download Chromium; it uses the binary at `CHROME_PATH`).
