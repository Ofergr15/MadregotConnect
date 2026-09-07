'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { israelNow } from '@/lib/utils';
import { teamDayTarget } from '@/lib/plans/team-day';
import { AdminControlRoom } from '@/components/admin/AdminControlRoom';

// ═════════════════════════════════════════════════════════════════════════════
// THE CONTROL ROOM, WITH ITS OWN INPUTS.
//
// `AdminControlRoom` is a presentational screen: it takes a greeting, a name and
// which session the roster is about. Those used to be computed by /dashboard and
// handed down, which was fine while /dashboard was the only way in — and stopped
// being fine the moment there were two (see /dashboard/control-room). A screen
// whose roster depends on which door you came through is a screen that disagrees
// with itself.
//
// So the inputs live here, next to the screen that needs them, and both doors
// render this. Cheap on purpose: one greeting off the clock, one name out of
// localStorage, and `/api/reminder-config` — which every dashboard already reads,
// so SWR answers it from cache.
// ═════════════════════════════════════════════════════════════════════════════

export function ControlRoomScreen() {
  const t = useTranslations('dashboard');
  const { data: reminderConfig } = useApi<{ config?: { teamDays?: number[] } }>('/api/reminder-config');
  // Same default as the athlete home's RSVP card: Tuesday and Friday.
  const teamDays = reminderConfig?.config?.teamDays ?? [2, 5];
  const roster = teamDayTarget(teamDays);

  // localStorage, so it cannot be read during render on the server pass.
  const [firstName, setFirstName] = useState('');
  useEffect(() => {
    setFirstName((localStorage.getItem('athlete_name') || '').split(' ')[0]);
  }, []);

  // Israel's clock, not the device's — the club is one city, and an admin abroad
  // being wished good evening at 9am is the kind of thing that reads as a bug.
  const hour = israelNow().hour;
  const greeting = hour < 12 ? t('goodMorning') : hour < 18 ? t('goodAfternoon') : t('goodEvening');

  return (
    <AdminControlRoom
      greeting={greeting}
      firstName={firstName}
      rosterWeekStart={roster?.weekStart}
      rosterDay={roster?.dow}
    />
  );
}
