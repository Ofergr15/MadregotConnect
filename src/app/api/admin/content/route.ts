import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { israelDateAnchor, israelToday, weekStartOn } from '@/lib/utils';
import { challengePhase } from '@/lib/admin/content';
import notesJson from '@/content/release-notes.json';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/admin/content — the admin's Content hub (#71 phase 2).
//
// Everything the club is shown was five separate rows deep inside Settings
// (challenges, badges, notifications, events, what's new). This is one read of
// where each stands, so the hub can say "running, 9 days left, 4 earned it"
// before anybody opens the manager behind it. The managers themselves are
// unchanged; the hub links to them.
//
// "Earned" is the challenge badge's award count, not a live progress figure:
// the badge is what finishing a challenge produces (lib/challenges/engine), and
// counting it costs one read instead of every member's runs.
// ═════════════════════════════════════════════════════════════════════════════

/** The notifications a person composed or scheduled, not the automatic checks. */
const SENT_BY_STAFF = ['custom', 'training_before', 'survey'];

interface ChallengeRow {
  id: string;
  name_he: string;
  metric: string;
  target_value: number;
  start_date: string;
  end_date: string;
  active: boolean | null;
  badge_id: string | null;
}

export async function GET(request: Request) {
  try {
    const denied = await requireStaff(request);
    if (denied) return denied;

    const supabase = createServerClient();
    const today = israelToday();
    const weekStart = weekStartOn(israelDateAnchor(), 0);

    const [challenges, badgesActive, awardedThisWeek, events, sent] = await Promise.all([
      supabase
        .from('challenges')
        .select('id, name_he, metric, target_value, start_date, end_date, active, badge_id')
        .order('start_date', { ascending: false })
        .limit(30),
      supabase.from('badges').select('id', { count: 'exact', head: true }).eq('active', true),
      // Eight days back covers the Sunday week in any timezone; the exact cut is
      // made on the Israel calendar day below.
      supabase
        .from('athlete_badges')
        .select('awarded_at')
        .gte('awarded_at', new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()),
      supabase
        .from('events')
        .select('id, name, date, kind')
        .gte('date', today)
        .order('date', { ascending: true })
        .limit(3),
      supabase
        .from('scheduled_notifications')
        .select('title_he, last_sent_at, sent_count')
        .in('kind', SENT_BY_STAFF)
        .eq('status', 'sent')
        .not('last_sent_at', 'is', null)
        .order('last_sent_at', { ascending: false })
        .limit(1),
    ]);

    const rows = (challenges.data || []) as ChallengeRow[];
    const badgeIds = rows.map(c => c.badge_id).filter((id): id is string => !!id);
    const earned = new Map<string, number>();
    if (badgeIds.length) {
      const { data } = await supabase.from('athlete_badges').select('badge_id').in('badge_id', badgeIds);
      for (const r of (data || []) as { badge_id: string }[]) earned.set(r.badge_id, (earned.get(r.badge_id) ?? 0) + 1);
    }

    const latestNote = (notesJson as { title: string; date: string }[])[0] ?? null;
    const lastSent = ((sent.data || []) as { title_he: string | null; last_sent_at: string; sent_count: number | null }[])[0] ?? null;

    return NextResponse.json({
      today,
      challenges: rows.map(c => ({
        id: c.id,
        name: c.name_he,
        metric: c.metric,
        target: c.target_value,
        startDate: c.start_date,
        endDate: c.end_date,
        phase: challengePhase(c, today),
        earned: c.badge_id ? earned.get(c.badge_id) ?? 0 : 0,
      })),
      badges: {
        active: badgesActive.count ?? 0,
        awardedThisWeek: ((awardedThisWeek.data || []) as { awarded_at: string }[])
          .filter(r => israelToday(new Date(r.awarded_at)) >= weekStart).length,
      },
      events: (events.data || []) as { id: string; name: string; date: string; kind: string }[],
      lastNotification: lastSent
        ? { title: lastSent.title_he, sentAt: lastSent.last_sent_at, reached: lastSent.sent_count ?? 0 }
        : null,
      latestNote: latestNote ? { title: latestNote.title, date: latestNote.date } : null,
    });
  } catch (error) {
    console.error('Failed to build content summary:', error);
    return NextResponse.json({ error: 'Failed to build content summary' }, { status: 500 });
  }
}
