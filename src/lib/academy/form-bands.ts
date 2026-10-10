/**
 * Form and ramp → one Hebrew word (spec §3.3/§3.4, TP's Training Readiness bounds).
 *
 * Returns i18n keys only (`trainee.bands.*`, `trainee.ramp.*`, `trainee.formSentence.*`
 * in messages/), never text: the components translate, with the trainee's gender.
 * Colours are the mockup's `--b1..--b5`.
 */

export type FormBandKey = 'veryTired' | 'working' | 'maintain' | 'fresh' | 'detraining';

export interface FormBand {
  key: FormBandKey;
  /** The short word on the 5-band slider: "שומר". */
  wordKey: string;
  /** The word next to the number: "שומר על הכושר". */
  longKey: string;
  /** What the band means, for 7ב: "כדאי יום קל או מנוחה". */
  meaningKey: string;
  /** Mockup CSS `--b1..--b5`. */
  color: string;
  /** Inclusive integer bounds; null is open-ended. */
  min: number | null;
  max: number | null;
}

const band = (key: FormBandKey, color: string, min: number | null, max: number | null): FormBand => ({
  key,
  wordKey: `trainee.bands.${key}.word`,
  longKey: `trainee.bands.${key}.long`,
  meaningKey: `trainee.bands.${key}.meaning`,
  color,
  min,
  max,
});

/** Most tired first — the slider's order (mockup 1: עייף מאוד … מתאמן מעט). */
export const FORM_BANDS: readonly FormBand[] = [
  band('veryTired', '#E5484D', null, -30),
  band('working', '#1FA55B', -29, -11),
  band('maintain', '#9AD5B0', -10, 4),
  band('fresh', '#5B9BF0', 5, 29),
  band('detraining', '#C9CBD6', 30, null),
];

/** The band of a form value, judged on the integer the screen prints. */
export function formBand(form: number): FormBand {
  const f = Math.round(form);
  return FORM_BANDS.find(b => (b.min == null || f >= b.min) && (b.max == null || f <= b.max)) ?? FORM_BANDS[2];
}

export type RampWordKey = 'tooFast' | 'building' | 'maintaining' | 'recovering' | 'easyWeek';

export interface RampWord {
  key: RampWordKey;
  wordKey: string;
  /** Amber only for "מהר מדי". */
  warn: boolean;
}

/**
 * The build rate in words: ≥9 "מהר מדי", 5…8 "בונה", 0…4 "שומר על כושר", ≤−1 "מתאושש" —
 * or "שבוע קל" when the coach planned this week easy.
 */
export function rampWord(ramp: number, opts: { easyWeek?: boolean } = {}): RampWord {
  const r = Math.round(ramp);
  const key: RampWordKey = r >= 9 ? 'tooFast' : r >= 5 ? 'building' : r >= 0 ? 'maintaining' : opts.easyWeek ? 'easyWeek' : 'recovering';
  return { key, wordKey: `trainee.ramp.${key}`, warn: key === 'tooFast' };
}

/** Last week heavier than this share of the 4-week mean reads as "אחרי שבוע עמוס". */
export const HEAVY_WEEK_SHARE = 1.15;

export function isHeavyWeek(lastWeek: number, prev4: number[]): boolean {
  const last = prev4.slice(-4);
  if (!last.length) return false;
  const mean = last.reduce((a, b) => a + b, 0) / last.length;
  return mean > 0 && lastWeek > HEAVY_WEEK_SHARE * mean;
}

export type DayKind = 'quality' | 'easy' | 'rest';

/**
 * The one sentence under the number on the home (mockup 1/1ב). Keyed by band and by what
 * today is; the "after a heavy week" variant exists only where it changes the advice
 * (working/maintain on a running day). A very tired trainee is never cheered.
 */
export function formSentenceKey(input: { band: FormBandKey; heavyLastWeek: boolean; day: DayKind }): string {
  const heavy = input.heavyLastWeek && input.day !== 'rest' && (input.band === 'working' || input.band === 'maintain');
  return `trainee.formSentence.${input.band}_${input.day}${heavy ? '_heavy' : ''}`;
}

/** Every key `formSentenceKey` can return — the messages test walks it. */
export function allFormSentenceKeys(): string[] {
  const out = new Set<string>();
  for (const b of FORM_BANDS) {
    for (const day of ['quality', 'easy', 'rest'] as DayKind[]) {
      for (const heavyLastWeek of [false, true]) out.add(formSentenceKey({ band: b.key, heavyLastWeek, day }));
    }
  }
  return [...out];
}

/** "−9" / "+11" / "0", with a real minus sign (U+2212), for `<bdi dir="ltr">`. */
export function signed(n: number): string {
  const r = Math.round(n);
  if (r === 0) return '0';
  return r < 0 ? `−${Math.abs(r)}` : `+${r}`;
}
