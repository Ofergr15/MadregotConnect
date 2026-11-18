import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import he from '../../messages/he.json';
import en from '../../messages/en.json';
import { GUIDE_V1, GUIDE_V2, type GuideLabel } from '@/lib/academy/guide';
import {
  ACADEMY_BOARD_ITEM, ACADEMY_ITEM, PROFILE_ITEM, PROGRESS_ITEM, ALL_NAV_ITEMS, athletePrimaryOrder,
} from '@/lib/nav-items';

// The guide must never name a label the real screen does not show (lib/academy/guide.ts).

const ROOT = path.resolve(__dirname, '../..');
const lookup = (dict: unknown, key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dict);
const ALL = [...GUIDE_V1, ...GUIDE_V2];
const labels: GuideLabel[] = ALL.flatMap((s) => s.path);

describe('academy guide labels', () => {
  it('every message label exists in he and en', () => {
    for (const l of labels) {
      if (!('msg' in l)) continue;
      expect(typeof lookup(he, l.msg), `he ${l.msg}`).toBe('string');
      expect(typeof lookup(en, l.msg), `en ${l.msg}`).toBe('string');
    }
  });

  it('every hardcoded label is still in the screen it came from', () => {
    for (const l of labels) {
      if ('msg' in l) continue;
      expect(readFileSync(path.join(ROOT, l.file), 'utf8'), `${l.file}: ${l.check}`).toContain(l.check);
    }
  });

  it('the tabs it names are the tabs a trainee gets', () => {
    const tabKey = (tab: string, v2 = false) => [v2 ? ACADEMY_BOARD_ITEM : ACADEMY_ITEM, PROGRESS_ITEM, PROFILE_ITEM, ...ALL_NAV_ITEMS].find((i) => i.tab === tab)!.labelKey;
    const base = ['feed', 'dashboard', 'program', 'profile'];
    // v2: the board and progress after home; the bar is four + "עוד", so profile is under More.
    const v2 = athletePrimaryOrder(base, true, true).slice(0, 4);
    expect(v2.map((tab) => tabKey(tab, true))).toEqual(expect.arrayContaining(['dashboard', 'board', 'progress']));
    expect(v2).not.toContain('profile');
    const v1 = athletePrimaryOrder(base, true, false);
    expect(v1.map((tab) => tabKey(tab))).toEqual(expect.arrayContaining(['dashboard', 'academy', 'profile']));
    expect(ACADEMY_BOARD_ITEM.labelKey).toBe('board');
    expect(PROGRESS_ITEM.labelKey).toBe('progress');
    // Each guide's nav labels are among its own bar's (or "more").
    const v1Keys = new Set([...v1.map((tab) => tabKey(tab)), 'more'].map((k) => `nav.${k}`));
    const v2Keys = new Set([...v2.map((tab) => tabKey(tab, true)), 'more', 'profile'].map((k) => `nav.${k}`));
    for (const [steps, keys] of [[GUIDE_V1, v1Keys], [GUIDE_V2, v2Keys]] as const) {
      for (const l of steps.flatMap((s) => s.path)) {
        if ('msg' in l && l.msg.startsWith('nav.')) expect(keys.has(l.msg), l.msg).toBe(true);
      }
    }
  });

  it('the profile rows it points at are on the profile screen', () => {
    const profile = readFileSync(path.join(ROOT, 'src/app/(app)/dashboard/profile/page.tsx'), 'utf8');
    for (const l of labels) {
      if (!('msg' in l) || !l.msg.startsWith('profile.')) continue;
      const src = l.msg === 'profile.tabSettings' ? readFileSync(path.join(ROOT, 'src/components/profile/AthleteProfileBody.tsx'), 'utf8') : profile;
      expect(src, l.msg).toContain(`t('${l.msg.slice(8)}')`);
    }
    expect(profile).toContain("get('install') === '1'");
  });

  it('every step has its title and body in both languages, and a route', () => {
    for (const s of ALL) {
      for (const dict of [he, en]) {
        expect(typeof lookup(dict, `academyGuide.steps.${s.id}.title`), s.id).toBe('string');
        expect(typeof lookup(dict, `academyGuide.steps.${s.id}.body`), s.id).toBe('string');
      }
      expect(s.href.startsWith('/dashboard')).toBe(true);
    }
    expect(GUIDE_V1).toHaveLength(6);
    expect(GUIDE_V2).toHaveLength(6);
  });
});
