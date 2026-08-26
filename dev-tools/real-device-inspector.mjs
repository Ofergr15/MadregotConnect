#!/usr/bin/env node
// Drives the REAL, physically-connected iPhone via Apple's remote-debugging
// protocol (through appium-remote-debugger, which stays in sync with new iOS
// versions — unlike the abandoned google/ios-webkit-debug-proxy). This is not
// an emulator: it attaches directly to the installed home-screen PWA's actual
// WKWebView context on the real device, so it sees exactly what a real user's
// tap does — including bugs (client-side blocks, silent fetch failures,
// paint glitches) that no Playwright/WebKit emulation can reproduce, because
// they depend on real localStorage state, the real iOS network stack, or the
// real rendering pipeline.
//
// One-time setup on the Mac (see the "Live device debugging" section in
// CLAUDE.md if present, or just redo this once per Mac):
//   1. iPhone: Settings > Safari > Advanced > Web Inspector: ON,
//      Remote Automation: ON.
//   2. Connect the iPhone via cable, tap "Trust This Computer".
//   3. Open the app once on the phone (Safari tab OR the installed
//      home-screen PWA) so it registers as an inspectable target.
//   4. `idevice_id -l` should print the device's UDID (requires
//      `brew install libimobiledevice` — NOT ios-webkit-debug-proxy, which is
//      incompatible with modern iOS: it can list pages but never forwards
//      responses back over its WebSocket bridge for iOS 16+).
//
// Usage:
//   node dev-tools/real-device-inspector.mjs status
//     -> prints the connected page's title/URL, confirms the pipe works.
//
//   node dev-tools/real-device-inspector.mjs eval "document.title"
//     -> runs one JS expression in the real page, prints the result.
//     Multi-statement code works too — end with the value you want returned.
//     For anything async, don't await inline (Runtime.evaluate wants a
//     synchronous result): kick off the async work, stash the result on
//     `window`, then read it back in a second `eval` call — see `watch` mode
//     below for the working pattern (fire-and-poll, not fire-and-await).
//
//   node dev-tools/real-device-inspector.mjs watch <seconds> [urlSubstring]
//     -> monkey-patches window.fetch + console.error (idempotent — safe to
//     call repeatedly across a session) to record every request's method,
//     url, status, and timing into window.__claudeLog, then polls and prints
//     that log for <seconds>. Use this BEFORE the action you want to observe
//     (e.g. before asking the user to tap something), not after — instrumentation
//     has to be in place before the fetch happens to see it.
//
// Known rough edges (all worked around below, kept here so you don't
// re-discover them the hard way):
//   - selectPage() can hang for its full targetCreationTimeoutMs default (3
//     MINUTES) if the page-ready notification never arrives — pass a short
//     override and treat "continuing anyway" as success, not failure.
//   - Only ONE remote-debugger client can really own a page at a time — if
//     you (or the user) also has Safari's manual Develop-menu Web Inspector
//     open on the same page, this script's selectPage() will hang. Close
//     that window first.
//   - rd.execute() needs the app in the FOREGROUND and the phone UNLOCKED —
//     if it's locked/backgrounded, selectApp() fails with "Could not connect
//     to a valid webapp," not a timeout.
//   - rd.execute()'s result converter chokes on non-string/undefined return
//     values ("Result has unexpected type" or "UnknownError: undefined") —
//     always wrap expressions in an IIFE that explicitly returns a string
//     (JSON.stringify(...) if you need structured data).
//   - rd.execute() sometimes auto-parses a JSON.stringify()'d result back
//     into a real object, sometimes returns it as a literal string —
//     inconsistent across calls for reasons not fully understood. Always
//     handle both: `typeof result === 'string' ? JSON.parse(result) : result`.
//     Also, JSON.stringify()-ing a bare ARRAY at the top level breaks the
//     converter — wrap it in an object (`{ log: [...] }`) first.

import { createRemoteDebugger } from 'appium-remote-debugger';

const DEFAULT_UDID = process.env.CLAUDE_DEVICE_UDID || '00008150-001A19580202401C';
const [, , mode, ...rest] = process.argv;

if (!mode || !['status', 'eval', 'watch'].includes(mode)) {
  console.error('Usage: real-device-inspector.mjs <status|eval "<js>"|watch <seconds> [urlSubstring]>');
  process.exit(1);
}

// Hard watchdog — a hung selectPage()/execute() call would otherwise block
// forever; better to fail loudly than sit there silently.
const watchdogMs = mode === 'watch' ? (Number(rest[0]) || 5) * 1000 + 20000 : 25000;
setTimeout(() => {
  console.error('WATCHDOG: forcing exit after', watchdogMs, 'ms — device may be locked, backgrounded, or another Web Inspector session is attached to the same page.');
  process.exit(1);
}, watchdogMs);

const rd = createRemoteDebugger(
  { udid: DEFAULT_UDID, isSafari: false, includeSafari: true, targetCreationTimeoutMs: 5000 },
  true,
);

async function connectAndSelect(urlSubstring) {
  await rd.connect();
  await new Promise((r) => setTimeout(r, 800));
  const pages = Object.values(rd.appDict || {});
  let target;
  for (let i = 0; i < 5 && !target; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500));
    const [page] = await rd.selectApp();
    if (page && (!urlSubstring || (page.url || '').includes(urlSubstring))) target = page;
  }
  if (!target) throw new Error('No matching inspectable page found — is the app open and in the foreground?');
  const [pidPart, pageIdPart] = target.id.split('.');
  await rd.selectPage(pidPart, Number(pageIdPart), true);
  return target;
}

try {
  if (mode === 'status') {
    const page = await connectAndSelect();
    console.log('Connected to:', page.title, '|', page.url);
  } else if (mode === 'eval') {
    const expr = rest.join(' ');
    if (!expr) throw new Error('eval needs a JS expression argument');
    await connectAndSelect();
    const result = await rd.execute(expr);
    console.log('RESULT:', result);
  } else if (mode === 'watch') {
    const seconds = Number(rest[0]) || 5;
    const urlSubstring = rest[1];
    const page = await connectAndSelect(urlSubstring);
    console.log('Watching:', page.url);
    await rd.execute(`
      (function() {
        if (window.__claudeInstrumented) return 'already-instrumented';
        window.__claudeInstrumented = true;
        window.__claudeLog = [];
        const origFetch = window.fetch;
        window.fetch = function(...args) {
          const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || String(args[0]);
          const method = (args[1] && args[1].method) || (args[0] && args[0].method) || 'GET';
          window.__claudeLog.push({ t: Date.now(), type: 'fetch-start', method, url });
          return origFetch.apply(this, args).then((res) => {
            window.__claudeLog.push({ t: Date.now(), type: 'fetch-ok', method, url, status: res.status });
            return res;
          }).catch((err) => {
            window.__claudeLog.push({ t: Date.now(), type: 'fetch-error', method, url, message: String(err && err.message || err) });
            throw err;
          });
        };
        const origError = console.error;
        console.error = function(...a) {
          window.__claudeLog.push({ t: Date.now(), type: 'console-error', message: a.map(String).join(' ') });
          return origError.apply(this, a);
        };
        window.addEventListener('error', (e) => window.__claudeLog.push({ t: Date.now(), type: 'window-error', message: e.message }));
        window.addEventListener('unhandledrejection', (e) => window.__claudeLog.push({ t: Date.now(), type: 'unhandled-rejection', message: String(e.reason) }));
        return 'instrumented';
      })();
    `);
    console.log(`Instrumented. Polling for ${seconds}s — go do the action on the device now.`);
    const seen = new Set();
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      // rd.execute() already parses JSON-stringified results into real
      // objects — do NOT JSON.parse() the return value again (double-parse
      // throws "[object Object]" is not valid JSON).
      const result = await rd.execute('(function(){ return JSON.stringify({ log: window.__claudeLog || [] }); })()');
      const entries = (typeof result === 'string' ? JSON.parse(result) : result).log;
      for (const entry of entries) {
        const key = JSON.stringify(entry);
        if (!seen.has(key)) {
          seen.add(key);
          console.log(JSON.stringify(entry));
        }
      }
    }
  }
} catch (err) {
  console.error('ERROR:', err.message);
  process.exit(1);
}
process.exit(0);
