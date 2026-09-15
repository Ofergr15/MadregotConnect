import { describe, expect, it } from 'vitest';
import {
  BUILD_ID_MESSAGE,
  askBuildId,
  isNewerBuild,
  type BuildIdTarget,
} from '@/lib/sw-build-id';

/**
 * The gate that stops the update banner from reappearing on every launch.
 *
 * What it is guarding against is invisible in a screenshot: a service worker
 * re-installing the SAME build (which iOS does by itself for an installed PWA)
 * produces byte-for-byte the same signals as a real deploy. The only difference
 * between "a new version is ready" and "your phone re-registered the version you
 * are already running" is the build id these functions compare — so the case that
 * must never regress is the one asserted first: two workers from the same deploy
 * are SILENT.
 */

/** A worker that answers with `buildId`; `null` for one that stays silent. */
const worker = (buildId: string | null): BuildIdTarget => ({
  postMessage: (_message, transfer) => {
    const port = transfer[0] as { postMessage: (m: unknown) => void };
    if (buildId === null) return;
    port.postMessage({ type: BUILD_ID_MESSAGE, buildId });
  },
});

describe('service worker build id', () => {
  it('reads the build a worker reports', async () => {
    await expect(askBuildId(worker('5ef30272'))).resolves.toBe('5ef30272');
  });

  it('resolves null for a worker that never answers, without hanging', async () => {
    // A worker built before sw.ts grew the handler. The wait is capped, and the
    // null it returns is what makes the caller fall back to showing the banner.
    await expect(askBuildId(worker(null), 10)).resolves.toBeNull();
  });

  it('resolves null for a redundant worker whose postMessage throws', async () => {
    const dead: BuildIdTarget = {
      postMessage: () => { throw new Error('InvalidStateError'); },
    };
    await expect(askBuildId(dead, 10)).resolves.toBeNull();
  });

  it('resolves null when there is no worker at all', async () => {
    await expect(askBuildId(null)).resolves.toBeNull();
    await expect(askBuildId(undefined)).resolves.toBeNull();
  });

  it('ignores a reply with no usable build id', async () => {
    const chatty: BuildIdTarget = {
      postMessage: (_m, transfer) => {
        const port = transfer[0] as { postMessage: (m: unknown) => void };
        port.postMessage({ type: BUILD_ID_MESSAGE, buildId: '' });
      },
    };
    await expect(askBuildId(chatty, 10)).resolves.toBeNull();
  });

  it('stays silent when the candidate is the build already running', () => {
    // THE bug: an iOS re-install of the running build reaches `installed` with a
    // controller present, which is exactly the signal the banner used to trust.
    expect(isNewerBuild('5ef30272', '5ef30272')).toBe(false);
  });

  it('shows the banner for a different build', () => {
    expect(isNewerBuild('5ef30272', '6370f44a')).toBe(true);
  });

  it('shows the banner whenever either side is unknown', () => {
    // Inconclusive has to fall on the side of showing it: leaving somebody on a
    // build with a fixed bug in it costs more than one extra tap.
    expect(isNewerBuild(null, '6370f44a')).toBe(true);
    expect(isNewerBuild('5ef30272', null)).toBe(true);
    expect(isNewerBuild(null, null)).toBe(true);
  });
});
