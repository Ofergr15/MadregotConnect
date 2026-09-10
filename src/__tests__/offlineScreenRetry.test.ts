import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The offline screen's escape hatch, tested against the real file.
 *
 * `public/offline.html` is served by the service worker's `fallbacks`, so it ships
 * as a standalone document with an inline script — no bundler, no imports, nothing
 * this suite can require. Rather than keep a second copy of the logic in a module
 * and test that instead (which would pass forever while the shipped file rotted),
 * this reads the actual HTML, pulls the inline script out and runs it against
 * stubbed globals and a hand-driven clock. If somebody edits the page, these tests
 * are looking at the edit.
 *
 * What is worth pinning down: this screen is shown to people who are NOT offline
 * (two reports, 2026-09-08/09), so its retry chain is the entire recovery path. It
 * has to fire soon, keep firing, and never fan out into parallel chains that probe
 * a struggling server several times a second.
 */

type Listener = () => void;

interface Screen {
  /** Elapsed ms at which each /api/ping probe went out. */
  probes: number[];
  /** Move the clock forward, firing timers due in that window. */
  advance: (ms: number) => Promise<void>;
  click: () => Promise<void>;
  goOnline: () => Promise<void>;
  reloads: () => number;
  pending: () => number;
  diag: () => string;
}

/** Let queued promise callbacks (the fetch .then/.catch chain) run. */
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

function loadOfflineScreen(respond: () => Promise<{ ok: boolean; status: number }>): Screen {
  const html = readFileSync(path.join(process.cwd(), 'public', 'offline.html'), 'utf8');
  const source = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!source) throw new Error('offline.html has no inline script — did it move?');

  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: Listener }>();
  const probes: number[] = [];
  const listeners = new Map<string, Listener[]>();
  const text: Record<string, string> = { msg: '', diag: '' };
  let reloads = 0;

  const el = (id: string) => ({
    get textContent() {
      return text[id] ?? '';
    },
    set textContent(v: string) {
      text[id] = v;
    },
    disabled: false,
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(`${id}:${type}`, [...(listeners.get(`${id}:${type}`) ?? []), fn]);
    },
  });

  const fire = async (key: string) => {
    for (const fn of listeners.get(key) ?? []) fn();
    await flush();
  };

  const scope = {
    document: { getElementById: (id: string) => el(id) },
    navigator: { onLine: true },
    location: {
      reload: () => {
        reloads++;
      },
    },
    window: {
      addEventListener: (type: string, fn: Listener) => {
        listeners.set(`window:${type}`, [...(listeners.get(`window:${type}`) ?? []), fn]);
      },
    },
    fetch: () => {
      probes.push(now);
      return respond();
    },
    setTimeout: (fn: Listener, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
  };

  // The script is an IIFE over `var`s, so naming the globals as parameters shadows
  // them cleanly without a DOM.
  const keys = Object.keys(scope) as (keyof typeof scope)[];
  new Function(...keys, source)(...keys.map((k) => scope[k]));

  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
      await flush();
    }
    now = target;
  };

  return {
    probes,
    advance,
    click: () => fire('retry:click'),
    goOnline: () => fire('window:online'),
    reloads: () => reloads,
    pending: () => timers.size,
    diag: () => text.diag ?? '',
  };
}

const down = () => Promise.reject(new TypeError('Failed to fetch'));
const up = () => Promise.resolve({ ok: true, status: 204 });

describe('the offline screen probes its way back', () => {
  beforeEach(() => vi.clearAllMocks());

  it('makes its first check two seconds in, not immediately', async () => {
    const s = loadOfflineScreen(down);
    // Immediately would be pointless: this page only exists because a request just
    // failed. But four seconds of a blank stare is what the reports complained of.
    await s.advance(1999);
    expect(s.probes).toEqual([]);
    await s.advance(1);
    expect(s.probes).toEqual([2000]);
  });

  it('backs off 2s, 5s, 10s then every 20s, exactly as documented', async () => {
    const s = loadOfflineScreen(down);
    await s.advance(60_000);
    expect(s.probes).toEqual([2000, 7000, 17_000, 37_000, 57_000]);
  });

  it('reloads as soon as a probe answers, and stops probing', async () => {
    let live = false;
    const s = loadOfflineScreen(() => (live ? up() : down()));
    await s.advance(10_000);
    const before = s.probes.length;
    live = true;
    await s.advance(30_000);
    expect(s.reloads()).toBe(1);
    // One probe more than we had, then silence: no timer left running behind the
    // reload, and no second reload.
    expect(s.probes.length).toBe(before + 1);
    expect(s.pending()).toBe(0);
  });

  // The bug this file is here to prevent. Every trigger used to start its OWN
  // chain, so a phone that flapped twice while the user tapped the button probed
  // several times a second — at exactly the moment the server was already struggling.
  it('keeps a single chain when the button and the OS both fire', async () => {
    const s = loadOfflineScreen(down);
    await s.click();
    await s.goOnline();
    await s.goOnline();
    const afterTriggers = s.probes.length;
    // Three explicit triggers, three immediate probes — and then ONE chain.
    expect(afterTriggers).toBe(3);
    await s.advance(2000);
    expect(s.probes.length).toBe(afterTriggers + 1);
    await s.advance(5000);
    expect(s.probes.length).toBe(afterTriggers + 2);
  });

  // `attempts` used to drive both the diagnostic count and the backoff index, so
  // pressing "try again" made the app WAIT LONGER. Tapping means the opposite.
  it('does not let a manual press push the backoff further out', async () => {
    const s = loadOfflineScreen(down);
    await s.click();
    await s.advance(60_000);
    // Measured from the press: the full documented rhythm, from the top. Before the
    // fix the press counted as an attempt, so the next check was 5s out instead of
    // 2s — and the timer it did not cancel probed alongside it.
    const gaps = s.probes.slice(1).map((t, i) => t - s.probes[i]);
    expect(gaps).toEqual([2000, 5000, 10_000, 20_000, 20_000]);
  });

  it('restarts the backoff when the network itself comes back', async () => {
    const s = loadOfflineScreen(down);
    await s.advance(60_000); // drifted out to the 20s rung
    const before = s.probes.length;
    await s.goOnline();
    // Coming out of a tunnel must not mean waiting 20s to find out you have signal:
    // check now, and if that fails check again in 2s.
    expect(s.probes.length).toBe(before + 1);
    await s.advance(2000);
    expect(s.probes.length).toBe(before + 2);
  });

  it('counts every check in the diagnostic line, including manual ones', async () => {
    const s = loadOfflineScreen(down);
    await s.advance(2000);
    await s.click();
    // The line is the evidence in the screenshot somebody sends us, so a press has
    // to show up in it even though it does not move the backoff.
    expect(s.diag()).toContain('בדיקות: 2');
    expect(s.diag()).toContain('מחובר');
  });
});
