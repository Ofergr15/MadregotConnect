// ═════════════════════════════════════════════════════════════════════════════
// ONE BUILDER FOR PUSH PAYLOADS — title, body and url per notification kind.
//
// The wording already has one home (./copy.ts, per locale). The url did not: each
// call site typed its own, so the same kind of push opened different screens from
// different senders and nothing checked the route existed. `buildPushPayload` pairs
// the copy function with the one url for that kind, and every url it can produce
// is pinned to ./push-targets.ts by src/__tests__/pushPayloadBuilder.test.ts.
//
// Pure: no DB, no send. Callers keep choosing the audience and calling
// notifyAthlete / sendPush* — this only builds what they send.
// ═════════════════════════════════════════════════════════════════════════════

import type { NotificationLocale } from './locale';
import {
  followCopy, kudosCopy, feedInteractionCopy, meetupMessageCopy, shoeLimitCopy,
  approvalCopy, badgeEarnedCopy, storeOrderCopy, newEventCopy, weeklyRecapCopy,
  activitySyncedCopy, planPushedCopy, newRecordCopy,
} from './copy';
import { teammateHref } from '@/lib/athletes/profile-link';
import { toNativeTarget, type NativeTarget } from './push-targets';

export interface BuiltPush {
  kind: PushKind;
  title: string;
  body: string;
  url: string;
  /** The native screen for `url` (task 83), from the same PUSH_TARGETS row — null if unknown. */
  target: NativeTarget | null;
}

export type PushParams = {
  follow: { followerId: string | null; name: string | null };
  kudos: { feedItemId: string; name: string | null };
  like: { feedItemId: string; name: string | null };
  comment: { feedItemId: string; name: string | null; commentBody?: string };
  meetup_message: { meetupId: string; name: string | null; body: string };
  shoe_limit: { name: string; km: number; limit: number; reached: boolean };
  approval: { name: string | null };
  badge: { nameHe: string; nameEn: string };
  store_order: { athleteName: string | null; itemCount: number; total: number };
  event_new: { eventId: string; kind: string; name: string; date: string };
  weekly_recap: { km: number; runs: number; pace: string | null };
  activity_synced: { activityId: string };
  plan_pushed: { count: number };
  new_record: {
    athleteId: string; bucket: string; activityId: string;
    distancesHe: string[]; distancesEn: string[]; time: string; gainSec: number;
  };
};

export type PushKind = keyof PushParams;

const enc = encodeURIComponent;

type Builder<K extends PushKind> = (locale: NotificationLocale, p: PushParams[K]) => { title: string; body: string; url: string };

const BUILDERS: { [K in PushKind]: Builder<K> } = {
  follow: (l, p) => ({ ...followCopy(l, { name: p.name }), url: teammateHref(p.followerId) ?? '/dashboard/profile' }),
  kudos: (l, p) => ({ ...kudosCopy(l, { name: p.name }), url: `/feed?item=${enc(p.feedItemId)}` }),
  like: (l, p) => ({ ...feedInteractionCopy(l, { name: p.name, kind: 'like' }), url: `/feed?item=${enc(p.feedItemId)}` }),
  comment: (l, p) => ({ ...feedInteractionCopy(l, { name: p.name, kind: 'comment', commentBody: p.commentBody }), url: `/feed?item=${enc(p.feedItemId)}` }),
  meetup_message: (l, p) => ({ ...meetupMessageCopy(l, { name: p.name, body: p.body }), url: `/dashboard/run-together/${enc(p.meetupId)}` }),
  shoe_limit: (l, p) => ({ ...shoeLimitCopy(l, p), url: '/dashboard/profile' }),
  approval: (l, p) => ({ ...approvalCopy(l, { name: p.name }), url: '/dashboard' }),
  badge: (l, p) => ({ ...badgeEarnedCopy(l, p), url: '/dashboard/profile?tab=badges' }),
  store_order: (l, p) => ({ ...storeOrderCopy(l, p), url: '/dashboard/store' }),
  event_new: (l, p) => ({ ...newEventCopy(l, { kind: p.kind, name: p.name, date: p.date }), url: `/dashboard/calendar/${enc(p.eventId)}` }),
  weekly_recap: (l, p) => ({ ...weeklyRecapCopy(l, p), url: '/feed?weekStory=1' }),
  activity_synced: (l, p) => ({ ...activitySyncedCopy(l), url: `/feed?activity=${enc(p.activityId)}` }),
  plan_pushed: (l, p) => ({ ...planPushedCopy(l, p), url: '/dashboard' }),
  new_record: (l, p) => ({
    ...newRecordCopy(l, { distancesHe: p.distancesHe, distancesEn: p.distancesEn, time: p.time, gainSec: p.gainSec }),
    // No own-profile records page on the web, so an unusable id falls back to the profile itself.
    url: teammateHref(p.athleteId)
      ? `${teammateHref(p.athleteId)}/records/${enc(p.bucket)}?new=${enc(p.activityId)}`
      : '/dashboard/profile',
  }),
};

export const PUSH_KINDS = Object.keys(BUILDERS) as PushKind[];

export function buildPushPayload<K extends PushKind>(kind: K, locale: NotificationLocale, params: PushParams[K]): BuiltPush {
  const built = (BUILDERS[kind] as Builder<K>)(locale, params);
  return { kind, ...built, target: toNativeTarget(built.url) };
}
