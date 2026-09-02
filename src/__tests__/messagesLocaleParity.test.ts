import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import he from '../../messages/he.json';
import en from '../../messages/en.json';
import { CATEGORIES } from '@/lib/notifications/prefs';

/**
 * The two message files are edited by hand, one screen at a time, and next-intl
 * fails soft: a key that exists in he.json but not en.json renders as the raw
 * key path ("notificationPrefs.sendTest") to an English reader, and a dropped
 * `{total}` renders a sentence with a hole in it. Neither shows up in a
 * typecheck or a build — this is the only place that catches it.
 */

type Tree = { [k: string]: string | string[] | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(tree)) {
    // An array (common.dayNames) is a leaf, not a namespace.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value as Tree, `${prefix}${key}.`));
    } else {
      out[`${prefix}${key}`] = value as string | string[];
    }
  }
  return out;
}

const HE = flatten(he as unknown as Tree);
const EN = flatten(en as unknown as Tree);

/** The ICU argument names in a message, e.g. 'Sent to {sent} of {total}' → sent, total. */
function placeholders(message: string | string[]): string[] {
  const text = Array.isArray(message) ? message.join(' ') : message;
  return [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
}

describe('messages/he.json ↔ messages/en.json', () => {
  it('defines exactly the same keys in both locales', () => {
    expect(Object.keys(HE).filter((k) => !(k in EN))).toEqual([]);
    expect(Object.keys(EN).filter((k) => !(k in HE))).toEqual([]);
  });

  it('uses the same ICU placeholders on both sides of every key', () => {
    const mismatched = Object.keys(HE)
      .filter((k) => k in EN)
      .filter((k) => placeholders(HE[k]).join(',') !== placeholders(EN[k]).join(','))
      .map((k) => `${k}: he=[${placeholders(HE[k])}] en=[${placeholders(EN[k])}]`);
    expect(mismatched).toEqual([]);
  });

  it('keeps the same shape (string vs array) for every key', () => {
    const mismatched = Object.keys(HE)
      .filter((k) => k in EN)
      .filter((k) => Array.isArray(HE[k]) !== Array.isArray(EN[k]));
    expect(mismatched).toEqual([]);
  });

  it('never leaves a message empty in one locale only', () => {
    const blank = Object.keys(HE).filter((k) => {
      const val = (v: string | string[]) => (Array.isArray(v) ? v.join('') : v).trim();
      return k in EN && (val(HE[k]) === '') !== (val(EN[k]) === '');
    });
    expect(blank).toEqual([]);
  });
});

describe('notificationPrefs', () => {
  it('labels every category the toggles actually render', () => {
    // NotificationPrefs.tsx looks these up by category name (t(`categories.${key}`)),
    // so a missing one renders the literal key next to a live switch.
    for (const category of CATEGORIES) {
      for (const [name, messages] of [['he', HE], ['en', EN]] as const) {
        expect(messages[`notificationPrefs.categories.${category}`], `${name}: ${category}`)
          .toBeTruthy();
      }
    }
  });

  it('has no category label the toggles never show', () => {
    const labelled = Object.keys(HE)
      .filter((k) => k.startsWith('notificationPrefs.categories.'))
      .map((k) => k.split('.').pop());
    expect(labelled.sort()).toEqual([...CATEGORIES].sort());
  });

  it('keeps the language row bilingual in BOTH locales', () => {
    // Deliberate, and the reason the row is findable at all: someone who set the
    // app to a language they can't read has to recognise this one row to get
    // back out. Translating either side of the slash away breaks that.
    for (const key of ['notificationPrefs.languageHeader', 'notificationPrefs.languageActive']) {
      for (const messages of [HE, EN]) {
        const text = messages[key] as string;
        expect(text, key).toMatch(/[֐-׿]/); // Hebrew
        expect(text, key).toMatch(/[A-Za-z]/); // Latin
      }
    }
  });

  it('renders the Hebrew status messages exactly as the old inline strings did', () => {
    // These sentences were template literals in the component until this
    // change; a reader on Hebrew must not be able to tell the difference.
    const t = createTranslator({ locale: 'he', messages: he, namespace: 'notificationPrefs' });
    const repair = t('repair');
    expect(repair).toBe('תיקון התראות במכשיר');
    expect(t('noSubscription', { repair })).toBe('אין מנוי פוש במכשיר — נסו "תיקון התראות במכשיר"');
    expect(t('sentNone', { total: 3, repair })).toBe('נשלחו 0 מתוך 3 — נסו "תיקון התראות במכשיר"');
    expect(t('sentConfirmed', { confirmed: 2, total: 3 })).toBe('✅ הגיעה ואושרה ב-2 מתוך 3 מכשירים');
    expect(t('sentUnconfirmed', { sent: 3, total: 3, repair }))
      .toBe('נשלחו 3 מתוך 3 — אך אף מכשיר לא אישר קבלה. אם לא הגיעה, נסו "תיקון התראות במכשיר"');
    expect(t('serverError', { status: 500 })).toBe('שגיאת שרת (500)');
    expect(t('serverErrorBody', { status: 403, body: 'forbidden' })).toBe('שגיאת שרת (403): forbidden');
    expect(t('requestFailed', { message: 'network' })).toBe('הבקשה נכשלה: network');
    expect(t('repairFailed', { error: 'unknown' })).toBe('לא הצליח: unknown');
    expect(t('enableError', { error: 'denied' })).toBe('שגיאה: denied');
  });

  it('renders every parameterised message in both locales without an ICU error', () => {
    // A stray apostrophe or brace in a translation throws at render time, on the
    // device, inside an error boundary — never at build time.
    const args: Record<string, Record<string, string | number>> = {
      enableError: { error: 'denied' },
      repairFailed: { error: 'unknown' },
      noSubscription: { repair: 'x' },
      sentNone: { total: 3, repair: 'x' },
      sentConfirmed: { confirmed: 1, total: 2 },
      sentUnconfirmed: { sent: 2, total: 2, repair: 'x' },
      serverError: { status: 500 },
      serverErrorBody: { status: 500, body: 'boom' },
      requestFailed: { message: 'network' },
    };
    for (const [locale, messages] of [['he', he], ['en', en]] as const) {
      const t = createTranslator({ locale, messages, namespace: 'notificationPrefs' });
      for (const key of Object.keys(HE).filter((k) => k.startsWith('notificationPrefs.'))) {
        const short = key.replace('notificationPrefs.', '');
        const rendered = t(short as never, args[short] as never) as unknown as string;
        // next-intl returns the key path itself when a message fails to render.
        expect(rendered, `${locale}: ${short}`).not.toBe(`notificationPrefs.${short}`);
        expect(rendered.trim(), `${locale}: ${short}`).not.toBe('');
        expect(rendered, `${locale}: ${short}`).not.toMatch(/[{}]/);
      }
    }
  });

  it('names each language in its own language, not the reader\'s', () => {
    // Mirrors the LANGUAGES table in NotificationPrefs.tsx — 'עברית'/'English'
    // are hardcoded there for the same reason, so nothing here should translate
    // them into a section either.
    expect(HE['notificationPrefs.languageHeader']).toBe('שפה / Language');
    expect(EN['notificationPrefs.languageHeader']).toBe('Language / שפה');
  });
});
