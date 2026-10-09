import { defineConfig } from 'vite';

// Content-Security-Policy for the built site: everything is bundled and served from the same origin,
// the app makes no network requests (connect-src 'none'), no third-party scripts, no eval.
// Dev server is left without it (Vite's HMR client needs a websocket and inline styles).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const csp = {
  name: 'rendi-csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head' },
  ],
};

export default defineConfig({
  // Relative base so the build works on GitHub Pages under any repo name.
  base: './',
  plugins: [csp],
  // Dev and preview servers listen on this machine only (never exposed to the local network).
  server: { host: 'localhost', strictPort: true },
  preview: { host: 'localhost', strictPort: true },
});
