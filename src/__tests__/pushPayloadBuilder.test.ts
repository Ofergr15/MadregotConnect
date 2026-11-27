import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildPushPayload, PUSH_KINDS, type PushKind, type PushParams } from '@/lib/notifications/payload';
import { PUSH_TARGETS, matchPushTarget, isValidPushUrl } from '@/lib/notifications/push-targets';
import { NOTIFICATION_LOCALES } from '@/lib/notifications/locale';

const ID = '11111111-2222-3333-4444-555555555555';

const FIXTURES: { [K in PushKind]: PushParams[K] } = {
  follow: { followerId: ID, name: 'דנה' },
  kudos: { feedItemId: ID, name: 'Yoni' },
  like: { feedItemId: ID, name: null },
  comment: { feedItemId: ID, name: 'Avi', commentBody: 'כל הכבוד!' },
  meetup_message: { meetupId: ID, name: 'Noa Levi', body: 'יוצאים ב-6' },
  shoe_limit: { name: 'Pegasus', km: 702, limit: 700, reached: true },
  approval: { name: 'Tal' },
  badge: { nameHe: 'מרתוניסט', nameEn: 'Marathoner' },
  store_order: { athleteName: 'Gil', itemCount: 2, total: 240 },
  event_new: { eventId: ID, kind: 'race', name: 'מרתון תל אביב', date: '2027-02-26' },
  weekly_recap: { km: 52.3, runs: 5, pace: '5:01' },
  activity_synced: { activityId: ID },
  plan_pushed: { count: 4 },
  new_record: { athleteId: ID, bucket: '10k', activityId: ID, distancesHe: ['10 ק״מ'], distancesEn: ['10K'], time: '41:20', gainSec: 35 },
};

describe('buildPushPayload — one builder per kind', () => {
  for (const kind of PUSH_KINDS) {
    for (const locale of NOTIFICATION_LOCALES) {
      it(`${kind} (${locale}) has title, body and a known url`, () => {
        const p = buildPushPayload(kind, locale, FIXTURES[kind] as never);
        expect(p.kind).toBe(kind);
        expect(p.title.trim().length).toBeGreaterThan(0);
        expect(typeof p.body).toBe('string');
        expect(`${p.title} ${p.body}`).not.toMatch(/undefined|null|NaN/);
        expect(isValidPushUrl(p.url), p.url).toBe(true);
      });
    }
  }

  it('a missing follower id still opens a real screen', () => {
    expect(buildPushPayload('follow', 'he', { followerId: null, name: null }).url).toBe('/dashboard/profile');
  });

  it('ids are url-encoded into the path', () => {
    const p = buildPushPayload('meetup_message', 'en', { meetupId: 'a/b', name: 'x', body: 'y' });
    expect(p.url).toBe('/dashboard/run-together/a%2Fb');
  });
});

describe('push targets', () => {
  it('matches dynamic segments and ignores query strings', () => {
    expect(matchPushTarget(`/dashboard/teammate/${ID}/records/10k?new=1`)?.pattern).toBe('/dashboard/teammate/:id/records/:bucket');
    expect(matchPushTarget('/feed?item=x')?.pattern).toBe('/feed');
    expect(matchPushTarget('/nope')).toBeNull();
    expect(matchPushTarget('https://evil.example/feed')).toBeNull();
    expect(isValidPushUrl('#ledger:abc')).toBe(true);
  });

  it('every web target has a page in src/app (native-only ones excepted)', () => {
    const pages: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (n === 'page.tsx') pages.push(p);
      }
    };
    walk('src/app');
    const routes = new Set(pages.map((p) => p.replace(/^src\/app/, '').replace(/\/\([^)]*\)/g, '').replace(/\/page\.tsx$/, '').replace(/\[[^\]]+\]/g, ':id') || '/'));
    const missing = PUSH_TARGETS.filter((t) => !t.nativeOnly).map((t) => t.pattern.replace(/:[a-z]+/g, ':id')).filter((p) => !routes.has(p));
    expect(missing).toEqual([]);
  });
});
