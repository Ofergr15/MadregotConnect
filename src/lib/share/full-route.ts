'use client';

// The share card's whole GPS track. The feed ships a 300-point route for the
// thumbnail; a 1080 px card drawn from it shows every 80 m as a corner, so the
// sheet asks for the stored track once it opens and redraws when it lands. Until
// then (and if it fails) the card draws what the feed gave it, the old way.

import { useEffect, useState } from 'react';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { useIsSuperUser } from '@/lib/impersonation';
import type { FeedItem } from '@/lib/feed/project';

export function useFullRoute(item: FeedItem | null): FeedItem | null {
  const [full, setFull] = useState<{ id: string; route: Array<{ lat: number; lng: number }> } | null>(null);
  const id = item?.id ?? null;
  // Super user only while it is tried: no track, no new style (FULL_TRACKS in share-image).
  const superUser = useIsSuperUser();
  const wants = superUser && !!item?.activity?.routePreview?.length && !item.activity.routeFull;

  useEffect(() => {
    if (!id || !wants) return;
    let live = true;
    (async () => {
      const res = await fetch(`/api/feed/items/${id}?route=full`, { headers: await bearerHeaders(false) });
      if (!res.ok) return;
      const route = (await res.json())?.item?.activity?.routeFull;
      if (live && Array.isArray(route) && route.length > 1) setFull({ id, route });
    })().catch(() => {});
    return () => { live = false; };
  }, [id, wants]);

  if (!item?.activity || !full || full.id !== item.id) return item;
  return { ...item, activity: { ...item.activity, routeFull: full.route } };
}
