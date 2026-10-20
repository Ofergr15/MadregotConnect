'use client';

import { useApi } from '@/lib/api';
import type { CheerSuggestion, PhotosStatus, PublishedPost } from '@/lib/content/hub';

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
