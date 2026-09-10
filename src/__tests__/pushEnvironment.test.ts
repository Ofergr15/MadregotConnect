import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pushEnvironment, type PushEnvironmentFacts } from '@/lib/push-environment';

/**
 * Why a device can't hold a push subscription — the reason the notifications
 * screen shows instead of pointing at a repair it has hidden.
 *
 * The reported failure (iPhone, iOS 18.7, Safari tab, 2026-09-08): "send a test
 * notification" replied "no push subscription on this device — try 'Fix
 * notifications on this device'", and that row was not on her screen. It renders
 * on `permission === 'granted'`, and iOS gives a browser tab no Notification
 * object at all, so the permission was null and every actionable row was hidden.
 */
const facts = (over: Partial<PushEnvironmentFacts> = {}): PushEnvironmentFacts => ({
  inAppBrowser: false,
  ios: false,
  standalone: false,
  pushApiAvailable: true,
  ...over,
});

describe('pushEnvironment', () => {
  it('is ready in a browser that has the push API', () => {
    expect(pushEnvironment(facts())).toBe('ready');
    // An installed app on any platform.
    expect(pushEnvironment(facts({ ios: true, standalone: true }))).toBe('ready');
  });

  // Sahar's case, exactly: iOS Safari tab, so no Notification object either.
  it('tells an iPhone in a browser tab to install first', () => {
    expect(pushEnvironment(facts({ ios: true, pushApiAvailable: false }))).toBe('installFirst');
  });

  // installFirst outranks unsupported: on iOS the missing API is a CONSEQUENCE
  // of not being installed, and "your browser can't do this" is a dead end where
  // a thirty-second fix exists.
  it('does not call an uninstalled iPhone unsupported', () => {
    expect(pushEnvironment(facts({ ios: true, pushApiAvailable: false }))).not.toBe('unsupported');
  });

  // The ordering that makes this a function. A WhatsApp webview on iOS is also
  // not standalone, and its share sheet has no Add to Home Screen in it — so
  // "add it to your home screen" would be instructions for a menu that isn't
  // there. Leave the webview first.
  it('sends an in-app browser out before offering install steps', () => {
    expect(pushEnvironment(facts({ inAppBrowser: true, ios: true }))).toBe('inAppBrowser');
    expect(pushEnvironment(facts({ inAppBrowser: true, ios: false }))).toBe('inAppBrowser');
    expect(pushEnvironment(facts({ inAppBrowser: true, standalone: true }))).toBe('inAppBrowser');
  });

  it('reports an unsupported browser only when nothing else explains it', () => {
    expect(pushEnvironment(facts({ pushApiAvailable: false }))).toBe('unsupported');
  });
});

/**
 * Every reason needs copy, in both languages, or the screen renders a raw
 * message key at exactly the moment somebody is already confused.
 */
describe('push environment copy', () => {
  const REASONS = ['installFirst', 'inAppBrowser', 'unsupported'] as const;
  const SUFFIXES = ['Title', 'Body', 'Short'] as const;

  for (const locale of ['he', 'en'] as const) {
    it(`has a title, body and short form for every reason in ${locale}`, () => {
      const messages = JSON.parse(
        readFileSync(join(process.cwd(), `messages/${locale}.json`), 'utf8'),
      ) as { notificationPrefs: { env: Record<string, string> } };
      const env = messages.notificationPrefs.env;
      for (const reason of REASONS) {
        for (const suffix of SUFFIXES) {
          expect(env[`${reason}${suffix}`], `${locale}: ${reason}${suffix}`).toBeTruthy();
        }
      }
    });
  }

  // The `Short` strings replace the test-send result, which used to interpolate
  // {repair} — a placeholder there would now render literally, since nothing
  // passes it.
  it('takes no placeholders in the short forms', () => {
    for (const locale of ['he', 'en'] as const) {
      const messages = JSON.parse(
        readFileSync(join(process.cwd(), `messages/${locale}.json`), 'utf8'),
      ) as { notificationPrefs: { env: Record<string, string> } };
      for (const reason of REASONS) {
        expect(messages.notificationPrefs.env[`${reason}Short`]).not.toMatch(/\{/);
      }
    }
  });
});
