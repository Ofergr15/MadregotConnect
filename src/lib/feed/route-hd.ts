// Sharper route thumbnails, on trial (PR #12). Migration 047's `route_preview` is
// ~60 points, which turns a long run's curves into chords; migration 130 keeps a
// 300-point `route_preview_hd` beside it. Only the runners listed in app_settings
// `route_hd_testers` (a JSON list of athlete ids) and the super user get it, and
// their cards draw it with the new line (RouteMinimap `hd`). Everyone else's feed
// is byte-for-byte what it was.
//
// Server only. Before 130 is pasted the column is missing, and a missing column
// reads as "no HD routes": the trial simply hasn't started.

import type { createServerClient } from '@/lib/supabase/server';
import { toRoute, type FeedItem } from '@/lib/feed/project';

type Db = ReturnType<typeof createServerClient>;
type Route = Array<{ lat: number; lng: number }>;

export const ROUTE_HD_TESTERS_KEY = 'route_hd_testers';

export function parseTesterIds(value: string | null | undefined): string[] {
  try {
    const v = JSON.parse(value || '[]');
    return Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function isRouteHdTester(
  supabase: Db,
  viewer: { athleteId: string | null; isSuperUser: boolean },
): Promise<boolean> {
  if (viewer.isSuperUser) return true;
  if (!viewer.athleteId) return false;
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', ROUTE_HD_TESTERS_KEY).maybeSingle();
  if (error) return false;
  return parseTesterIds((data as { value?: string } | null)?.value).includes(viewer.athleteId);
}

/** activity id → its 300-point route; empty when 130 isn't there yet. */
export async function loadHdRoutes(supabase: Db, activityIds: string[]): Promise<Map<string, Route>> {
  const out = new Map<string, Route>();
  if (!activityIds.length) return out;
  const { data, error } = await supabase.from('athlete_activities').select('id, route_preview_hd').in('id', activityIds);
  if (error) return out;
  for (const r of (data || []) as Array<{ id: string; route_preview_hd: unknown }>) {
    const route = toRoute(r.route_preview_hd);
    if (route) out.set(r.id, route);
  }
  return out;
}

/** Swap in the HD route where there is one, and mark the card to draw it that way. */
export function withHdRoutes(items: FeedItem[], hd: Map<string, Route>): FeedItem[] {
  if (!hd.size) return items;
  return items.map((item) => {
    const route = item.activity && hd.get(item.activity.id);
    return route ? { ...item, activity: { ...item.activity!, routePreview: route, routeHd: true } } : item;
  });
}
