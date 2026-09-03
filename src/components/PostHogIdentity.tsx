'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import posthog from 'posthog-js';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';

function localIdentity() {
  const athleteId = localStorage.getItem('athlete_id');
  const athleteName = localStorage.getItem('athlete_name');
  const athleteEmail = localStorage.getItem('athlete_email');
  const coachEmail = localStorage.getItem('coach_email');

  return {
    athleteId,
    name: athleteName,
    email: athleteEmail || coachEmail,
    accountType: coachEmail ? 'staff' : athleteId ? 'athlete' : null,
  };
}

/** Attach replays to the signed-in person instead of an anonymous browser. */
export function PostHogIdentity() {
  const pathname = usePathname();
  const identifiedId = useRef<string | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) return;

    let active = true;
    const supabase = getSupabase();

    const identify = (user: User | null) => {
      if (!active) return;

      const local = localIdentity();
      const distinctId = user?.id || local.athleteId
        || (local.email ? `staff:${local.email.toLowerCase()}` : null);

      if (!distinctId) {
        if (identifiedId.current) {
          posthog.reset();
          identifiedId.current = null;
        }
        return;
      }

      const name = local.name || user?.user_metadata?.full_name;
      const email = local.email || user?.email;
      posthog.identify(distinctId, {
        ...(name ? { name } : {}),
        ...(email ? { email } : {}),
        ...(local.athleteId ? { athlete_id: local.athleteId } : {}),
        ...(local.accountType ? { account_type: local.accountType } : {}),
      });
      identifiedId.current = distinctId;
    };

    supabase.auth.getSession().then(({ data }) => identify(data.session?.user ?? null));

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        posthog.reset();
        identifiedId.current = null;
        return;
      }
      identify(session?.user ?? null);
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [pathname]);

  return null;
}
