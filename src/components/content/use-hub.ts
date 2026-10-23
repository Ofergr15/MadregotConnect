'use client';

import { useApi } from '@/lib/api';
import { TYPE_ORDER, type CheerSuggestion, type ContentType, type PhotosStatus, type PublishedPost } from '@/lib/content/hub';

// The hub's reads, shared by its home and the kinds' pages (Content v4). Each is the
// route that already answers it, with its own gate: a coach who may not see the photo
// folders gets an error there and the photos block simply has less in it.

export interface HubContent {
  today: string;
  recent?: PublishedPost[];
  members?: number;
  challenges: Array<{ id: string; name: string; startDate: string; endDate: string; phase: 'active' | 'scheduled' | 'ended'; earned: number }>;
  badges: { active: number; awardedThisWeek: number };
  events: Array<{ id: string; name: string; date: string }>;
  lastNotification: { title: string | null; sentAt: string; reached: number } | null;
  latestNote: { title: string; date: string } | null;
}

/** What is on air (api/admin/celebrations). */
export interface LiveRow {
  id: string; source: 'feed' | 'club' | 'survey' | 'scheduled'; emoji: string; label: string; title: string;
  day: string; until: string; active: boolean; likes: number; auto: boolean; answers?: number; at?: string;
}

export interface PhotosStatusFull extends PhotosStatus {
  workout: string | null; link: string; auto: boolean; checkedAt: string | null; nextAt: string | null; publishedId: string | null;
}

export function useHubContent() {
  return useApi<HubContent>('/api/admin/content');
}
export function useLive() {
  return useApi<{ today: string; items: LiveRow[] }>('/api/admin/celebrations');
}
export function usePhotosStatus() {
  return useApi<{ status: PhotosStatusFull | null }>('/api/quality-session/photos/status', { refreshInterval: 60_000 });
}
export function useCheerSuggestions() {
  return useApi<{ suggestions: CheerSuggestion[] }>('/api/admin/cheers/suggestions');
}

/**
 * This account's level per part of Content (lib/access/grants.ts, via /api/auth/me):
 * 0 not seen, 1 sees, 3 publishes. An answer without the field is an older or
 * athlete-less staff account: staff publish everything, as before.
 */
export function useContentLevels(): { levels: Record<ContentType, number> | null; full: boolean } {
  const { data } = useApi<{ role?: string; roles?: string[]; isSuper?: boolean; contentLevels?: Partial<Record<ContentType, number>> | null }>('/api/auth/me');
  if (!data) return { levels: null, full: false };
  const staff = !!data.isSuper || [data.role, ...(data.roles ?? [])].some((r) => r === 'admin' || r === 'coach' || r === 'academy_coach' || r === 'academy_manager');
  const levels = Object.fromEntries(TYPE_ORDER.map((k) => [k, data.contentLevels ? data.contentLevels[k] ?? 0 : staff ? 3 : 0])) as Record<ContentType, number>;
  return { levels, full: staff };
}
