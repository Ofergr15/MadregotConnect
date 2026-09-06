import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { isStaleBundleError, hardReload } from '@/lib/recover';

/**
 * Why these tests exist.
 *
 * Until 2026-09-05 this app had NO error boundary anywhere, so a single throw in
 * any component blanked the screen with no text and no way back — on iOS
 * standalone there is not even a URL bar to retype. The launch is days away, so
 * the failure mode is now a screen the user can act on.
 *
 * The half that a type check cannot cover is the classification: deciding a crash
 * is "your bundle is stale" and dropping the caches is destructive-ish and must not
 * fire on an ordinary data error, and it MUST fire on the chunk-load family,
 * because for those `reset()` provably cannot help.
 */

describe('isStaleBundleError', () => {
  // Every wording below is one a real browser produces for a chunk that the
  // service worker cached a URL for and the new deploy no longer serves.
  it.each([
    ['webpack ChunkLoadError by name', Object.assign(new Error('boom'), { name: 'ChunkLoadError' })],
    ['webpack message form', new Error('Loading chunk 472 failed. (missing: /_next/static/chunks/472.js)')],
    ['CSS chunk form', new Error('Loading CSS chunk 12 failed.')],
    ['Chrome dynamic import', new Error('Failed to fetch dynamically imported module: /_next/static/chunks/x.js')],
    ['Firefox dynamic import', new Error('error loading dynamically imported module')],
    ['Safari dynamic import', new Error('Importing a module script failed.')],
  ])('treats %s as stale', (_label, error) => {
    expect(isStaleBundleError(error)).toBe(true);
  });

  it.each([
    ['an API failure', new Error('Request failed: 500')],
    ['a dead session', new Error('Invalid or expired session')],
    ['an ordinary type error', new TypeError("Cannot read properties of undefined (reading 'name')")],
    ['a hydration mismatch', new Error('Hydration failed because the server rendered HTML did not match')],
  ])('does not treat %s as stale', (_label, error) => {
    expect(isStaleBundleError(error)).toBe(false);
  });

  it('survives the values React can actually hand a boundary', () => {
    // A boundary receives whatever was thrown. `throw 'x'` and `throw null` are
    // legal, and a crash screen that itself throws is the one bug with no floor.
    expect(isStaleBundleError(null)).toBe(false);
    expect(isStaleBundleError(undefined)).toBe(false);
    expect(isStaleBundleError('ChunkLoadError')).toBe(false);
    expect(isStaleBundleError({})).toBe(false);
  });
});

describe('hardReload', () => {
  const replace = vi.fn();
  const reload = vi.fn();
  let store: Record<string, string>;

  beforeEach(() => {
    replace.mockReset();
    reload.mockReset();
    store = { push_sub_healed_on: '2026-09-06' };
    vi.stubGlobal('window', { location: { href: 'https://www.madregot.app/feed', replace, reload } });
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops every cache and updates the worker, then reloads past the HTTP cache', async () => {
    const del = vi.fn().mockResolvedValue(true);
    const update = vi.fn().mockResolvedValue(undefined);
    const unregister = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', { keys: async () => ['html', 'assets'], delete: del });
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => [{ update, unregister }] } });

    await hardReload();

    expect(del.mock.calls.map((c) => c[0])).toEqual(['html', 'assets']);
    expect(update).toHaveBeenCalledTimes(1);
    // ⚠️ NOT unregister(), which this called until 2026-09-06. Unregistering the
    // worker destroys that device's PushManager subscription and nothing
    // re-subscribes it, so the phone goes silent while the dead endpoint stays
    // in push_subscriptions absorbing 201s. This function fires automatically on
    // the stale-bundle family — i.e. potentially for everyone after a deploy —
    // so it was manufacturing the exact ghosts the prune has to clean up.
    // Emptying the caches is what cures a stale bundle; the worker can stay.
    expect(unregister).not.toHaveBeenCalled();
    // ⚠️ Not location.reload(): on iOS Safari a reload is frequently served from
    // the HTTP cache, which hands back the very stale document being escaped.
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toMatch(/[?&]_r=\d+/);
    expect(reload).not.toHaveBeenCalled();
  });

  it('clears the heal stamp so the next load re-verifies the subscription', async () => {
    // The heal runs once a day and only stamps on success. Without this, a
    // device whose subscription broke after today's heal stays unreachable until
    // tomorrow — on the one path where the user has explicitly asked for a reset.
    vi.stubGlobal('caches', { keys: async () => [], delete: vi.fn() });
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => [] } });

    await hardReload();

    expect(store.push_sub_healed_on).toBeUndefined();
  });

  it('still reloads when clearing the caches throws', async () => {
    // The whole point: this runs on a browser already misbehaving. If a failure
    // here escaped, the user would be left on a dead screen having already spent
    // the one button that could have saved them.
    vi.stubGlobal('caches', { keys: async () => { throw new Error('SecurityError'); }, delete: vi.fn() });
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => { throw new Error('nope'); } } });

    await expect(hardReload()).resolves.toBeUndefined();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('still reloads when one registration refuses to update', async () => {
    // Guarded per registration: a single rejecting update must not skip the
    // others, and must not cost the reload that is the actual cure.
    const good = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('caches', { keys: async () => [], delete: vi.fn() });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistrations: async () => [
          { update: () => Promise.reject(new Error('InvalidStateError')) },
          { update: good },
        ],
      },
    });

    await expect(hardReload()).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('works on a browser with neither Cache Storage nor a service worker', async () => {
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal('navigator', {});

    await expect(hardReload()).resolves.toBeUndefined();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('reloads even when localStorage is blocked', async () => {
    vi.stubGlobal('caches', undefined);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('localStorage', {
      removeItem: () => { throw new Error('SecurityError'); },
    });

    await expect(hardReload()).resolves.toBeUndefined();
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe('the app has error boundaries at all', () => {
  const read = (rel: string) => {
    const path = fileURLToPath(new URL(`../app/${rel}`, import.meta.url));
    expect(existsSync(path), `${rel} is missing — a crash there blanks the screen`).toBe(true);
    return readFileSync(path, 'utf8');
  };

  // Next only treats these exact filenames as boundaries, so the coverage claim is
  // a claim about the file tree, not about any function.
  it.each([
    ['global-error.tsx', 'root layout and providers'],
    ['error.tsx', 'public routes like /register'],
    ['(app)/error.tsx', 'the signed-in app'],
  ])('%s covers %s', (file) => {
    const src = read(file);
    expect(src).toContain("'use client'");
    expect(src).toContain('CrashScreen');
  });

  it('gives global-error its own document, which Next requires', () => {
    const src = read('global-error.tsx');
    expect(src).toContain('<html');
    expect(src).toContain('<body>');
  });

  it('keeps the crash screen free of the providers that might be what broke', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../components/CrashScreen.tsx', import.meta.url)),
      'utf8',
    );
    // next-intl would have no messages above the provider, and a ui/ import drags
    // in the same module graph that just failed to load.
    expect(src).not.toMatch(/from 'next-intl'/);
    expect(src).not.toMatch(/from '@\/components\/ui'/);
    // Hebrew copy, inline, so it renders with zero dependencies.
    expect(src).toMatch(/[֐-׿]/);
  });
});
