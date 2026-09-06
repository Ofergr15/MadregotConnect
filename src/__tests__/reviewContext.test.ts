import { describe, it, expect } from 'vitest';
import pkg from '../../package.json';
import { APP_VERSION } from '@/lib/version';
import { describeDevice, reviewContextRows, dataUrlBytes, formatBytes } from '@/lib/review-context';

// The pure half of the review screen's diagnostics (see src/lib/review-context.ts).
// It's worth pinning because it's read by a human triaging a bug report and
// silently wrong output is indistinguishable from correct output: "Other" instead
// of "iPhone" doesn't look like a failure, it looks like an answer.

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
  // iPadOS lies: it reports itself as a Macintosh, with "Mobile" as the only tell.
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

describe('describeDevice', () => {
  it('names the phone, its OS version and its browser', () => {
    expect(describeDevice(UA.iphoneSafari)).toBe('iPhone · iOS 17.4 · Safari');
  });

  it('tells Chrome-on-iOS apart from Safari, even though both UAs say Safari', () => {
    expect(describeDevice(UA.iphoneChrome)).toBe('iPhone · iOS 16.6 · Chrome');
  });

  it('calls an iPad an iPad, and refuses to invent its OS version', () => {
    // The whole reason the iPad test runs before the Macintosh one. The UA carries
    // the MAC version and no iOS version, so the platform is named and the version
    // is left out rather than reported as macOS 10.15 (which isn't running).
    expect(describeDevice(UA.ipadOS)).toBe('iPad · iPadOS · Safari');
  });

  it('separates an Android phone from an Android tablet', () => {
    expect(describeDevice(UA.androidPhone)).toBe('Android phone · Android 14 · Chrome');
    expect(describeDevice(UA.androidTablet)).toBe('Android tablet · Android 13 · Chrome');
  });

  it('handles desktops', () => {
    expect(describeDevice(UA.mac)).toBe('Mac · macOS 10.15 · Chrome');
    expect(describeDevice(UA.windows)).toBe('Windows PC · Chrome');
  });

  it('never throws on a missing or unrecognised user agent', () => {
    expect(describeDevice('')).toBe('Unknown device');
    expect(describeDevice('curl/8.4.0')).toBe('Other');
  });
});

const LABELS = { page: 'Screen', version: 'Version', device: 'Device', screen: 'Viewport', mode: 'Running as' };

describe('reviewContextRows', () => {
  it('is empty for a report filed before migration 093 (context = null)', () => {
    // Every historical report has no context. The triage sheet renders nothing at
    // all in that case rather than a card full of blanks.
    expect(reviewContextRows(null, LABELS)).toEqual([]);
    expect(reviewContextRows(undefined, LABELS)).toEqual([]);
  });

  it('prefers the human screen name over the raw path', () => {
    const rows = reviewContextRows({ page: '/dashboard/benefits', pageLabel: 'שותפויות' }, LABELS);
    expect(rows[0]).toEqual({ label: 'Screen', value: 'שותפויות' });
  });

  it('falls back to the path when no label was resolved', () => {
    const rows = reviewContextRows({ page: '/dashboard/foo', pageLabel: null }, LABELS);
    expect(rows[0]).toEqual({ label: 'Screen', value: '/dashboard/foo' });
  });

  it('omits the screen row entirely when the report is not about a screen', () => {
    // Training feedback deliberately sends no page — see ASKS_WHERE on the page.
    const rows = reviewContextRows({ page: null, pageLabel: null, appVersion: '2.39.95' }, LABELS);
    expect(rows.map(r => r.label)).not.toContain('Screen');
    expect(rows).toContainEqual({ label: 'Version', value: '2.39.95' });
  });

  it('renders standalone as PWA vs Browser, including when it is false', () => {
    // `false` is a real reading ("they were in a Safari tab"), not a missing one,
    // so it must not be dropped the way an absent key is.
    expect(reviewContextRows({ standalone: true }, LABELS)).toContainEqual({ label: 'Running as', value: 'PWA' });
    expect(reviewContextRows({ standalone: false }, LABELS)).toContainEqual({ label: 'Running as', value: 'Browser' });
    expect(reviewContextRows({ device: 'iPhone' }, LABELS).map(r => r.label)).not.toContain('Running as');
  });
});

describe('dataUrlBytes / formatBytes', () => {
  it('decodes the real byte count from a data URL, padding included', () => {
    // "hello" -> aGVsbG8= : 8 base64 chars, one '=' of padding, 5 bytes.
    expect(dataUrlBytes('data:image/jpeg;base64,aGVsbG8=')).toBe(5);
    // A bare base64 string with no header still measures, since the size line
    // must never render NaN at the reporter.
    expect(dataUrlBytes('aGVsbG8=')).toBe(5);
  });

  it('formats sizes the way the attachment row reads them', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(184 * 1024)).toBe('184 KB');
    expect(formatBytes(Math.round(1.25 * 1024 * 1024))).toBe('1.3 MB');
  });
});

describe('APP_VERSION', () => {
  it('matches package.json', () => {
    // It had drifted four releases behind (2.39.87 vs 2.39.94), and it is what
    // the review screen reports as "the version this broke on" — a stale value
    // there sends triage looking at the wrong build. It also seeds the service
    // worker's cache bucket, so drift is not cosmetic.
    expect(APP_VERSION).toBe(pkg.version);
  });
});
