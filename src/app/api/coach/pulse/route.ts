import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { COACH_ID } from '@/lib/constants';
import { resolveGroup } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// GET /api/coach/pulse?days=14
// Coach-facing radar: two prioritized lists built from existing data —
//  attention: pain flags (repeat pain ranked highest), wants-feedback, very hard
//             (difficulty ≥9) from post-workout feedback in the window.
//  celebrate: athletes who set a PR (5K/10K/HM/FM) or ran a standout week in the
//             window.
// Staff-only (coach/admin/academy_coach via x-user-email against the DB).
const RUN_TYPES = ['running', 'trail_running', 'treadmill_running', 'track_running', 'virtual_run'];
const BUCKETS = [
  { key: '5k', label: '5K', meters: 5000, tol: 0.06 },
  { key: '10k', label: '10K', meters: 10000, tol: 0.05 },
  { key: 'hm', label: 'HM', meters: 21097, tol: 0.04 },
  { key: 'fm', label: 'Marathon', meters: 42195, tol: 0.03 },
];

export async function GET(request: Request) {
  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const days = Math.min(Math.max(Number(searchParams.get('days')) || 14, 1), 60);
    const since = new Date(Date.now() - days * 86400_000);
    const sinceISO = since.toISOString();

    // Staff auth.
    const email = (request.headers.get('x-user-email') || '').toLowerCase().trim();
    if (!email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const { data: caller } = await supabase.from('athletes').select('role').eq('email', email)
      .in('role', ['coach', 'admin', 'academy_coach']).maybeSingle();
    if (!caller) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    // Active athletes (name/squad).
    const { data: athletes } = await supabase
      .from('athletes')
      .select('id, name, avatar_url, group_id, groups(name)')
      .eq('coach_id', COACH_ID)
      .eq('status', 'active');
    const meta = new Map<string, { name: string; avatar: string | null; squad: string | null }>();
    (athletes || []).forEach((a: any) =>
      meta.set(a.id, { name: a.name || '', avatar: a.avatar_url || null, squad: a.groups?.name || null }));
    const athleteIds = [...meta.keys()];

    // ── ATTENTION: recent feedback ──────────────────────────────────────────
    const { data: fb } = await supabase
      .from('workout_feedback')
      .select('athlete_id, difficulty, pain, pain_detail, wants_feedback, created_at')
      .gte('created_at', sinceISO)
      .order('created_at', { ascending: false });

    const painCount = new Map<string, number>();
    const attentionByAthlete = new Map<string, { reasons: Set<string>; detail: string | null; when: string; painTimes: number }>();
    for (const r of (fb || []) as any[]) {
      if (!meta.has(r.athlete_id)) continue;
      const cur = attentionByAthlete.get(r.athlete_id) || { reasons: new Set<string>(), detail: null, when: r.created_at, painTimes: 0 };
      if (r.pain) { cur.reasons.add('pain'); cur.painTimes += 1; if (r.pain_detail && !cur.detail) cur.detail = r.pain_detail; painCount.set(r.athlete_id, (painCount.get(r.athlete_id) || 0) + 1); }
      if (r.wants_feedback) cur.reasons.add('wants');
      if (r.difficulty != null && r.difficulty >= 9) cur.reasons.add('hard');
      attentionByAthlete.set(r.athlete_id, cur);
    }
    const attention = [...attentionByAthlete.entries()]
      .map(([id, v]) => {
        const m = meta.get(id)!;
        const rg = m.squad ? resolveGroup(m.squad) : null;
        // Priority: repeat pain > pain > wants-feedback > very hard.
        const priority = v.painTimes >= 2 ? 4 : v.reasons.has('pain') ? 3 : v.reasons.has('wants') ? 2 : 1;
        return {
          athleteId: id, name: m.name, avatarUrl: m.avatar, squad: m.squad, squadColor: rg?.hex || null,
          reasons: [...v.reasons], painTimes: v.painTimes, painDetail: v.detail, when: v.when, priority,
        };
      })
      .sort((a, b) => b.priority - a.priority || (b.when || '').localeCompare(a.when || ''));

    // ── CELEBRATE: PRs + big weeks (from full-vs-recent activity comparison) ──
    // Fetch full run history for active athletes; a PR "just set" = the all-time
    // best effort for a bucket falls within the window.
    const celebrate: any[] = [];
    if (athleteIds.length > 0) {
      const { data: acts } = await supabase
        .from('athlete_activities')
        .select('athlete_id, activity_type, distance, duration, start_time')
        .in('athlete_id', athleteIds);
      const byAthlete = new Map<string, any[]>();
      for (const r of (acts || []) as any[]) {
        if (!(r.distance > 0) || !(r.duration > 0) || (r.activity_type && !RUN_TYPES.includes(r.activity_type))) continue;
        const arr = byAthlete.get(r.athlete_id) || [];
        arr.push(r);
        byAthlete.set(r.athlete_id, arr);
      }
      for (const [id, runs] of byAthlete.entries()) {
        const m = meta.get(id); if (!m) continue;
        const rg = m.squad ? resolveGroup(m.squad) : null;
        // PR per bucket: best normalized time all-time; celebrate if its date is in-window.
        for (const b of BUCKETS) {
          const lo = b.meters * (1 - b.tol), hi = b.meters * (1 + b.tol);
          let best: any = null;
          for (const r of runs) {
            if (r.distance < lo || r.distance > hi) continue;
            const norm = r.duration * (b.meters / r.distance);
            if (!best || norm < best.norm) best = { norm, date: r.start_time };
          }
          if (best && new Date(best.date) >= since) {
            celebrate.push({
              athleteId: id, name: m.name, avatarUrl: m.avatar, squad: m.squad, squadColor: rg?.hex || null,
              kind: 'pr', label: b.label, seconds: Math.round(best.norm), when: best.date,
            });
          }
        }
      }
    }
    celebrate.sort((a, b) => (b.when || '').localeCompare(a.when || ''));

    return NextResponse.json({
      attention,
      celebrate,
      counts: { attention: attention.length, celebrate: celebrate.length, pain: [...painCount.keys()].length },
    });
  } catch (err: any) {
    console.error('pulse error:', err);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}
