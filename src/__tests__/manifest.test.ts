import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The web app manifest, as the thing two mobile launchers actually read.
 *
 * Worth a test because every failure here is invisible in the diff and only
 * appears on a phone. The one that shipped: `short_name` was set to a ZERO-WIDTH
 * SPACE (U+200B) in an August experiment, trying to shorten the "from <name>"
 * attribution iOS puts on web push. Chromium treats a whitespace-only short_name
 * as absent and falls back to the WebAPK's package id, so from then on every
 * Android member's home screen labelled the club's app `org.chromium....`
 * (reported 2026-09-08 with a screenshot, Android 10 / Chrome, v2.40.8).
 *
 * The experiment was aimed at a symptom whose real cause turned out to be
 * something else entirely — iOS was showing Safari-style attribution because the
 * icon was a plain bookmark, not an installed app, after the Next 14→16 upgrade
 * renamed the `apple-mobile-web-app-capable` meta tag out from under it (fixed in
 * v2.39.5). iOS also takes its home-screen title from `appleWebApp.title` in
 * layout.tsx, ahead of the manifest, so a real short_name costs iOS nothing.
 *
 * `id` is asserted for the opposite reason: changing it re-identifies the app to
 * Chromium and ORPHANS every existing Android install, leaving a dead icon
 * behind. It is the one field here that must never move.
 */
const manifest = JSON.parse(
  readFileSync(join(process.cwd(), 'public/manifest.json'), 'utf8'),
) as Record<string, unknown>;

describe('web app manifest', () => {
  it('has a short_name a launcher can actually render', () => {
    const shortName = manifest.short_name as string;
    expect(typeof shortName).toBe('string');
    // The bug, stated as the assertion: printable characters, not just space.
    expect(shortName.trim().length).toBeGreaterThan(0);
    // Zero-width space, ZWNJ, ZWJ, word joiner, BOM — all render as nothing and
    // all survive a `trim()`.
    expect(shortName).not.toMatch(/[​-‍⁠﻿]/);
    // Android launchers truncate past roughly a dozen characters, which is how a
    // long short_name becomes its own unreadable label.
    expect(shortName.length).toBeLessThanOrEqual(12);
  });

  it('keeps the install identity that existing Android icons are bound to', () => {
    expect(manifest.id).toBe('/dashboard');
  });

  it('declares the fields a standalone install needs', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/feed');
  });

  it('ships both a plain and a maskable icon', () => {
    const icons = manifest.icons as Array<{ sizes: string; purpose: string }>;
    expect(icons.some(i => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
    // Without one, Android crops the square icon inside its own mask.
    expect(icons.some(i => i.purpose === 'maskable')).toBe(true);
  });
});
