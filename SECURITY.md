# Security

Rendi Hall is a static front-end prototype. Running it locally or opening the deployed page is low risk by design.

## What the app does and does not do

- **No backend, no network calls.** All content ships in `src/content/content.json`. The waitlist form only shows a "thanks" state; the email never leaves the browser. In the built site, the Content-Security-Policy sets `connect-src 'none'`, so the browser blocks any outgoing request.
- **No third-party scripts or CDNs.** three.js, GSAP and the fonts (`@fontsource`) are bundled from npm and served from the same origin.
- **No cookies, storage, tracking or analytics.**
- **No `eval`.** All dynamic text inserted into the DOM goes through `escapeHtml` (`src/ui/util.js`).

## Running it safely

```bash
npm ci        # exact versions from package-lock.json; install scripts are disabled (.npmrc)
npm run dev   # http://localhost:5173, bound to localhost only
```

- `.npmrc` sets `ignore-scripts=true`, so no dependency can run code at install time.
- Dependencies are pinned to exact versions in `package.json` and `package-lock.json`.
- The dev and preview servers bind to `localhost` only and are not reachable from the local network.
- `npm audit` reports 0 known vulnerabilities at the time of writing. Re-check with `npm audit` before running.

Prefer not to install anything at all? Open the GitHub Pages deployment instead. It is the same static build.

## Runtime dependencies

| Package | Why |
|---|---|
| `three` | 3D rendering |
| `gsap` | camera and UI animation |
| `@fontsource/montserrat`, `@fontsource/albert-sans` | brand fonts, self-hosted |

Dev only: `vite` (dev server and build), `vitest` + `jsdom` (tests).

## Reporting

Found something? Open an issue in this repository.
