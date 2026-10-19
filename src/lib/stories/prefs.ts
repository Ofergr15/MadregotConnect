import type { StoryFeature } from './gate';

/**
 * The athlete's own story opt-outs (athletes.story_prefs, migration 157). A missing key
 * is ON, so an untouched athlete (and a DB before 157) has no opt-outs. Only an explicit
 * `false` opts out.
 */
export type StoryPrefKey = StoryFeature | 'birthday_feed_post';
export const STORY_PREF_KEYS: StoryPrefKey[] = ['weekly', 'birthday', 'annual', 'birthday_feed_post'];
export type StoryPrefs = Partial<Record<StoryPrefKey, boolean>>;

export function parseStoryPrefs(v: unknown): StoryPrefs {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: StoryPrefs = {};
  for (const k of STORY_PREF_KEYS) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === 'boolean') out[k] = x;
  }
  return out;
}

export const optedOut = (prefs: StoryPrefs, key: StoryPrefKey): boolean => prefs[key] === false;

/** The column isn't there yet (157 not pasted): read as "no opt-outs", not as an error. */
export const isPrefsColumnMissing = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42703' || /story_prefs/.test(e.message || ''));
