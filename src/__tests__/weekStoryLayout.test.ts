import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT, THEMES, THEME_KEYS, cleanLayout, contrastRatio, deriveStops, themeAccent, memberChoices, partShown, pickTheme, pickWorkout,
  slideShown, togglePart, toggleSlide, withMemberChoice,
} from '@/lib/week-story/layout';
import { alignKm, markKm, pairKm, planKmPaces } from '@/lib/week-story/long';
import { settingsPatch } from '@/lib/stories/admin';
import type { WorkoutStep } from '@/lib/ai/types';

describe('week story layout', () => {
  it('a missing column (null/undefined) or junk is the default: everything shown, blue', () => {
    for (const raw of [null, undefined, 'x', [], 7]) expect(cleanLayout(raw)).toEqual(DEFAULT_LAYOUT);
    const l = cleanLayout(null);
    for (const k of ['intro', 'km', 'plan', 'workout', 'pack', 'club', 'summary']) expect(slideShown(l, k)).toBe(true);
    expect(partShown(l, 'km', 'days')).toBe(true);
  });

  it('applies hidden slides and parts, and drops unknown keys', () => {
    const l = cleanLayout({ hiddenSlides: ['pack', 'summary', 'nope'], hiddenParts: { km: ['days', 'zzz'], bogus: ['x'] }, workout: 'long', theme: 'ocean' });
    expect(l.hiddenSlides).toEqual(['pack']);
    expect(slideShown(l, 'pack')).toBe(false);
    expect(slideShown(l, 'summary')).toBe(true);
    expect(l.hiddenParts).toEqual({ km: ['days'] });
    expect(partShown(l, 'km', 'days')).toBe(false);
    expect(partShown(l, 'km', 'hero')).toBe(true);
    expect([l.workout, l.theme]).toEqual(['long', 'ocean']);
  });

  it('toggles round-trip; intro and summary cannot be hidden', () => {
    let l = toggleSlide(DEFAULT_LAYOUT, 'club');
    expect(slideShown(l, 'club')).toBe(false);
    l = toggleSlide(l, 'club');
    expect(l.hiddenSlides).toEqual([]);
    expect(toggleSlide(DEFAULT_LAYOUT, 'intro')).toBe(DEFAULT_LAYOUT);
    l = togglePart(DEFAULT_LAYOUT, 'workout', 'verdict');
    expect(partShown(l, 'workout', 'verdict')).toBe(false);
    expect(togglePart(l, 'workout', 'verdict').hiddenParts).toEqual({});
  });

  it('the admin PUT accepts a layout and cleans it', () => {
    const r = settingsPatch({ layout: { hiddenSlides: ['km', 'x'], theme: 'night' } });
    expect(r.ok && r.patch.layout).toEqual({ hiddenSlides: ['km'], hiddenParts: {}, workout: null, theme: 'night' });
    expect(settingsPatch({ layout: 'x' }).ok).toBe(false);
  });
});

describe('which workout and background', () => {
  it('only offers the week\'s own workouts; quality by default', () => {
    expect(pickWorkout({ available: ['quality', 'long'], club: null, member: null })).toBe('quality');
    expect(pickWorkout({ available: ['long'], club: 'quality', member: 'quality' })).toBe('long');
    expect(pickWorkout({ available: [], club: 'long', member: 'long' })).toBeNull();
  });
  it('the member\'s choice beats the club\'s default', () => {
    expect(pickWorkout({ available: ['quality', 'long'], club: 'long', member: null })).toBe('long');
    expect(pickWorkout({ available: ['quality', 'long'], club: 'long', member: 'quality' })).toBe('quality');
    expect(pickTheme('ember', null)).toBe('ember');
    expect(pickTheme('ember', '#ff00aa')).toBe('#ff00aa');
  });
  it('keeps the member\'s picks per week and the theme, beside the other prefs', () => {
    let w = withMemberChoice({ hidePack: true }, { weekEnd: '2026-10-24', workout: 'long' });
    w = withMemberChoice(w, { theme: 'night' });
    expect(w.hidePack).toBe(true);
    expect(memberChoices(w, '2026-10-24')).toEqual({ workout: 'long', theme: 'night' });
    expect(memberChoices(w, '2026-10-31')).toEqual({ workout: null, theme: 'night' });
    expect(memberChoices({ theme: 'pink', workout: { '2026-10-24': 'tempo' } }, '2026-10-24')).toEqual({ workout: null, theme: null });
    for (let i = 0; i < 12; i++) w = withMemberChoice(w, { weekEnd: `2026-${String(i + 1).padStart(2, '0')}-01`, workout: 'quality' });
    expect(Object.keys(w.workout as object)).toHaveLength(8);
  });
});

describe('themes are readable', () => {
  it('white text ≥ 4.5:1 on every stop; the peach accent ≥ 3:1 (large text), at every stop', () => {
    expect(THEME_KEYS).toEqual(['blue', 'night', 'ocean', 'graphite', 'royal', 'berry', 'ember', 'aurora']);
    for (const k of THEME_KEYS) {
      for (const c of THEMES[k].stops) {
        expect(contrastRatio('#ffffff', c), `${k} ${c}`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio('#FFB08F', c), `${k} peach ${c}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('a colour of one\'s own', () => {
  it('is stored as hex, in the layout and in the member\'s prefs', () => {
    expect(cleanLayout({ theme: '#fde68a' }).theme).toBe('#FDE68A');
    expect(cleanLayout({ theme: '#fde' }).theme).toBe('blue');
    expect(memberChoices(withMemberChoice({}, { theme: '#ec4899' }), 'x').theme).toBe('#EC4899');
  });
  it('any colour comes out ≥ 4.5:1 for white text at every stop, accent included', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const hex = () => '#' + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0');
    for (const c of ['#ffffff', '#000000', '#FDE68A', '#EC4899', '#808080', '#FFFF00', '#00FFFF', ...Array.from({ length: 500 }, hex)]) {
      const st = deriveStops(c);
      for (const x of [...st, themeAccent(c as `#${string}`)]) expect(contrastRatio('#ffffff', x), `${c} → ${x}`).toBeGreaterThanOrEqual(4.5);
      expect(st.every((x) => /^#[0-9A-F]{6}$/.test(x))).toBe(true);
    }
  });
  it('keeps the colour\'s hue: a pink stays pink, not a muddy dark', () => {
    const [a] = deriveStops('#EC4899');
    const n = parseInt(a.slice(1), 16);
    expect((n >> 16) & 255).toBeGreaterThan(n & 255);
    expect((n >> 16) & 255).toBeGreaterThan(150);
  });
});

describe('long run squares', () => {
  const step = (m: number, lo: number, hi = lo, type: WorkoutStep['type'] = 'active'): WorkoutStep =>
    ({ order: 0, type, durationType: 'distance', durationValue: m, targetType: 'pace', targetPaceMinPerKm: lo, targetPaceMaxPerKm: hi });
  // Pack 2's Friday 23.10: warm-up and strides, then 14 + 7 + 7 km, then 1 km easy.
  const steps: WorkoutStep[] = [
    step(3000, 280, 280, 'warmup'),
    { order: 0, type: 'interval', durationType: 'time', durationValue: 45, targetType: 'pace', targetPaceMinPerKm: 240 },
    step(14000, 240), step(7000, 230, 235), step(7000, 222, 225), step(1000, 300, 330),
  ];
  it('the plan\'s main block is 28 km, the easy km dropped', () => {
    const p = planKmPaces(steps);
    expect(p).toHaveLength(28);
    expect(p[0]).toEqual([240, 240]);
    expect(p[27]).toEqual([222, 225]);
  });
  it('finds the block in the whole run and marks each km', () => {
    const plan = planKmPaces(steps);
    const run = [320, 300, 290, ...plan.map(([a]) => a + 4), 310, 330];
    const got = alignKm(run, plan);
    expect(got).toHaveLength(28);
    expect(got[0]).toBe(244);
    expect(markKm(244, [240, 240])).toBe('slow');
    expect(markKm(242, [240, 240])).toBe('on');
    expect(markKm(229, [240, 240])).toBe('fast');
  });
  it('a cool-down jog caught at the end of the window is not a km of the block', () => {
    const plan = planKmPaces(steps);
    const run = [...plan.slice(1).map(([a]) => a), 330];
    const pairs = pairKm(run, plan);
    expect(pairs).toHaveLength(27);
    expect(pairs.every((k) => k.p < 300)).toBe(true);
  });
});
