import type { ShareCardLang } from './card-text';

/**
 * THE WATCH'S OWN NAME FOR A RUN, IN THE CARD'S LANGUAGE (feedback #93).
 *
 * An English card came out titled "Berlin ריצה": every label on it English, and the
 * one line at the top in Hebrew. Nobody typed that name. Garmin names a run after
 * where it started and in the language of the WATCH — "Berlin Running" on an
 * English watch, "Berlin ריצה" on a Hebrew one — and the card printed it verbatim
 * whatever language the athlete had picked for the card.
 *
 * So the automatic names are recognised and translated, and only those. A name the
 * athlete chose ("Intervals 6×1000", "ריצה עם יוסי") is theirs, and is never touched:
 * the patterns below match only the exact shapes Garmin and Strava generate, which
 * is why "<place> Running" is a suffix match and not a search for the word "Running".
 * The prod names these were read off are Garmin's "Running", "ריצה", "Treadmill
 * Running", "ריצה בהליכון", "Trail Running", "ריצה בשביל", "<city> Running",
 * "<city> ריצה", and Strava's "Morning Run" and friends.
 */

/** Whole-name pairs: [English, Hebrew]. */
const WHOLE: [string, string][] = [
  ['Running', 'ריצה'],
  ['Treadmill Running', 'ריצה בהליכון'],
  ['Trail Running', 'ריצה בשביל'],
  ['Track Running', 'ריצה במסלול'],
  ['Morning Run', 'ריצת בוקר'],
  ['Lunch Run', 'ריצת צהריים'],
  ['Afternoon Run', 'ריצת אחר הצהריים'],
  ['Evening Run', 'ריצת ערב'],
  ['Night Run', 'ריצת לילה'],
];

// Latin letters, spaces and the punctuation a place name carries ("St. Kilda",
// "Tel Aviv-Yafo"). A place in Hebrew letters is left alone: translating the word
// after it would leave half the line in the other language anyway.
const PLACE = "[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'\\- ]*?";
const EN_PLACE = new RegExp(`^(${PLACE}) Running$`);
const HE_PLACE = new RegExp(`^(${PLACE}) ריצה$`);

export function localizeDefaultName(name: string, lang: ShareCardLang): string {
  const trimmed = name.trim();
  for (const [en, he] of WHOLE) {
    if (trimmed === en || trimmed === he) return lang === 'en' ? en : he;
  }
  const place = EN_PLACE.exec(trimmed) ?? HE_PLACE.exec(trimmed);
  if (place) {
    return lang === 'en' ? `${place[1]} Running` : `${place[1]} ריצה`;
  }
  return name;
}
