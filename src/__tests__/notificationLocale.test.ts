import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_LOCALE,
  localeFromPrefs,
  normalizeNotificationLocale,
} from '@/lib/notifications/locale';
import { teammateActivityCopy } from '@/lib/notifications/copy';
import { isKindMuted, mergeWithDefaults } from '@/lib/notifications/prefs';

describe('notification locale — resolving an athlete\'s language server-side', () => {
  it('defaults to Hebrew when the athlete never chose', () => {
    // Almost every push is sent from a cron or a Garmin sync, where there is no
    // request and so no NEXT_LOCALE cookie to fall back on. "No choice saved"
    // has to resolve to something, and it has to be the club's language.
    expect(localeFromPrefs(null)).toBe('he');
    expect(localeFromPrefs({})).toBe('he');
    expect(DEFAULT_NOTIFICATION_LOCALE).toBe('he');
  });

  it('reads a saved choice', () => {
    expect(localeFromPrefs({ language: 'en' })).toBe('en');
    expect(localeFromPrefs({ language: 'he' })).toBe('he');
  });

  it('falls back rather than throwing on anything unsupported', () => {
    // A bad value must not be able to stop a notification: wrong language is an
    // annoyance, no notification is the failure this whole subsystem exists to
    // avoid. Includes the shapes a stale client could realistically write.
    for (const bad of ['fr', '', 'HE-IL', null, undefined, 42, {}, ['en']]) {
      expect(normalizeNotificationLocale(bad)).toBe('he');
    }
  });

  it('accepts the locale forms a browser would hand us', () => {
    // proxy.ts seeds NEXT_LOCALE from Accept-Language, so 'en-US' is a real
    // value a client could echo back into the preference.
    expect(normalizeNotificationLocale('en-US')).toBe('en');
    expect(normalizeNotificationLocale('EN')).toBe('en');
  });

  it('sharing notification_prefs with the category toggles breaks neither', () => {
    // `language` deliberately lives in the same JSONB as the booleans (no
    // migration, and it is already loaded on the send path). The risk that buys
    // is a string where the mute rules expect a boolean.
    const prefs = { teammates: false, language: 'en' };
    expect(isKindMuted('kudos_activity', prefs)).toBe(true);
    expect(isKindMuted('feedback_reply', prefs)).toBe(false);
    // And it survives the round trip the API does on read.
    const merged = mergeWithDefaults(prefs);
    expect(merged.language).toBe('en');
    expect(merged.teammates).toBe(false);
    expect(merged.coach).toBe(true);
  });

  it('leaves language undefined when never set, so "unset" stays distinguishable', () => {
    // The settings row needs to tell "never chose" from "chose Hebrew" — it
    // shows the cookie's language in the first case rather than claiming a
    // choice the athlete never made.
    expect(mergeWithDefaults({ coach: false }).language).toBeUndefined();
  });
});

describe('teammate-activity copy in both languages', () => {
  const params = { name: 'Itai Spiegel', gender: 'male', km: '20.1' };

  it('is what Ofer asked for in English', () => {
    const copy = teammateActivityCopy('en', params);
    expect(copy.pushTitle).toBe('🏃 New Activity');
    expect(copy.pushBody).toBe('Itai Spiegel completed a run • 20.1 km');
  });

  it('keeps the same two-surface split in every language', () => {
    // The push leads with a fixed header (a lock screen stacks these, so a
    // repeated header reads as one channel); the history names the runner in the
    // title, because that screen renders title as a row label and would
    // otherwise show twenty identical labels.
    for (const locale of ['he', 'en'] as const) {
      const copy = teammateActivityCopy(locale, params);
      expect(copy.historyTitle).not.toBe(copy.pushTitle);
      expect(copy.historyTitle).toContain('Itai Spiegel');
      expect(copy.pushBody).toContain('Itai Spiegel');
      expect(copy.pushBody).toContain('20.1');
      expect(copy.historyBody).toContain('20.1');
    }
  });

  it('agrees with the runner\'s gender in Hebrew, and needs no such thing in English', () => {
    expect(teammateActivityCopy('he', { ...params, gender: 'female' }).pushBody).toContain('סיימה');
    expect(teammateActivityCopy('he', { ...params, gender: 'male' }).pushBody).toContain('סיים ');
    // gender is optional (migration 057) and null on most rows — the common path.
    expect(teammateActivityCopy('he', { ...params, gender: null }).pushBody).toContain('סיים/ה');
    expect(teammateActivityCopy('en', { ...params, gender: null }).pushBody).toBe(
      'Itai Spiegel completed a run • 20.1 km',
    );
  });

  it('never leaks a Hebrew placeholder into an English notification', () => {
    // The no-name fallback used to be a Hebrew literal at the call site, which
    // would have shown up mid-sentence in an otherwise-English push.
    for (const name of [null, '', '   ']) {
      expect(teammateActivityCopy('en', { ...params, name }).pushBody).toBe(
        'A teammate completed a run • 20.1 km',
      );
      expect(teammateActivityCopy('he', { ...params, name }).pushBody).toContain('חבר/ה לקבוצה');
    }
  });
});
