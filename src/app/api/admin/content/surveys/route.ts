import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireContentLevel } from '@/lib/access/require-content';
import { israelToday } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// GET /api/admin/content/surveys — the Content hub's "סקרים" (mockup content-v4, 4):
// the last 60 days of surveys, each with its options and the votes on each, when it
// closes, how many phones its push reached, and the feed post it lives on. Same
// gate as the hub (requireStaff).

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

export async function GET(request: Request) {
  // Staff as before, and whoever sees the surveys part (הרשאות).
  const { denied } = await requireContentLevel(request, 'surveys', 1, (u) => u.isSuperUser || u.isStaff);
  if (denied) return denied;
  const db = createServerClient();
  try {
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const { data, error } = await db.from('surveys').select('id, question_he, options_he, created_at, closes_at, created_by')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    const rows = (data || []) as Array<{ id: string; question_he: string; options_he: string[]; created_at: string; closes_at: string | null; created_by: string | null }>;
    const ids = rows.map((r) => r.id);
    const votes = new Map<string, number[]>();
    const delivered = new Map<string, number>();
    const posts = new Map<string, string>();
    // People, not rows: a survey with more than one answer has a row per answer (160).
    const voters = new Map<string, Set<string>>();
    if (ids.length) {
      const [{ data: resp }, { data: notes }, { data: feed }] = await Promise.all([
        db.from('survey_responses').select('survey_id, option_index, athlete_id').in('survey_id', ids),
        db.from('scheduled_notifications').select('survey_id, sent_count').in('survey_id', ids),
        db.from('feed_items').select('id, payload').eq('type', 'announcement').is('deleted_at', null).in('payload->>surveyId', ids),
      ]);
      for (const r of (resp || []) as Array<{ survey_id: string; option_index: number; athlete_id: string }>) {
        const list = votes.get(r.survey_id) ?? []; list.push(r.option_index); votes.set(r.survey_id, list);
        const who = voters.get(r.survey_id) ?? new Set<string>(); who.add(r.athlete_id); voters.set(r.survey_id, who);
      }
      for (const n of (notes || []) as Array<{ survey_id: string; sent_count: number | null }>) delivered.set(n.survey_id, (delivered.get(n.survey_id) ?? 0) + (n.sent_count ?? 0));
      for (const f of (feed || []) as Array<{ id: string; payload: { surveyId?: string } | null }>) if (f.payload?.surveyId) posts.set(f.payload.surveyId, f.id);
    }
    const now = Date.now();
    return NextResponse.json({
      today: israelToday(),
      surveys: rows.map((r) => {
        const v = votes.get(r.id) ?? [];
        return {
          id: r.id, question: r.question_he, createdAt: r.created_at,
          closesOn: r.closes_at ? dayOf(r.closes_at) : null,
          open: !r.closes_at || Date.parse(r.closes_at) > now,
          options: (r.options_he || []).map((o, i) => ({ option: o, count: v.filter((x) => x === i).length })),
          answers: voters.get(r.id)?.size ?? 0, delivered: delivered.get(r.id) ?? null, postId: posts.get(r.id) ?? null,
          // The retired weekly pack poll (cron/tick made them): history, labelled as gone.
          fixed: r.created_by === 'cron',
        };
      }),
    });
  } catch (err) {
    console.error('[admin/content/surveys] failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}
