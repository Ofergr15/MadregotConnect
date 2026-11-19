import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import he from '../../messages/he.json';
import en from '../../messages/en.json';

/**
 * The inbox fold (lib/notifications/history foldInbox) counts separate notifications with the
 * same title inside REPEAT_WINDOW_MIN, not devices. A second phone or a second account on the
 * same phone is a delivery row, never an inbox row, so the label must not say "devices".
 */
describe('notifications.repeated', () => {
  it('says the same notice arrived N times, in Hebrew', () => {
    const t = createTranslator({ locale: 'he', messages: he, namespace: 'notifications' });
    expect(t('repeated', { n: 2 })).toBe('אותה התראה התקבלה 2 פעמים — מוצגת פעם אחת');
    expect(t('repeated', { n: 2 })).not.toMatch(/מכשיר/);
  });
  it('says the same in English', () => {
    const t = createTranslator({ locale: 'en', messages: en, namespace: 'notifications' });
    expect(t('repeated', { n: 3 })).toBe('the same notice arrived 3 times — shown once');
  });
});
