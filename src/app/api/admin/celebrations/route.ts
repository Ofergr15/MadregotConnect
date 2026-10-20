import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireContentStaff } from '@/lib/auth/require-content-staff';
import { addDaysToDateStr, israelToday } from '@/lib/utils';
import { toCelebration, CELEBRATION_TYPES } from '@/lib/feed/celebration';
import { CLUB_STORIES_KEY, readClubStories } from '@/lib/feed/club-stories';
import { birthdayBodyAsOf } from '@/lib/feed/birthday';
import { BIRTHDAY_DAYS_KEY, readBirthdayDays } from '@/lib/feed/celebration-days';

export const dynamic = 'force-dynamic';

// The "חגיגות" screen (mockup celebrations-control, 3-4): what is on the circles at the
// top of the feed and until when, and the hand to change it.
//
// GET -> { today, items: Row[], birthdayDays }
// PATCH { id, source: 'feed'|'club', until } | { id, source, end: true } | { birthdayDays }
//   A feed celebration keeps its post either way: only payload.until moves.
type Db = ReturnType<typeof createServerClient>;
interface Row {
  id: string; source: 'feed' | 'club' | 'survey' | 'scheduled'; emoji: string; label: string; title: string;
  day: string; until: string; active: boolean; likes: number; auto: boolean;
  /** Survey answers so far, or the exact send time of a scheduled message. */
  answers?: number; at?: string;
}

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

async function settings(db: Db, key: string) {
  const { data } = await db.from('app_settings').select('value').eq('key', key).maybeSingle();
  return (data as { value?: string } | null)?.value ?? null;
}

export async function GET(request: Request) {
  const { denied } = await requireContentStaff(request);
  if (denied) return denied;
  const db = createServerClient();
  try {
    const today = israelToday();
    const since = new Date(Date.now() - 21 * 86_400_000).toISOString();
    const { data, error } = await db.from('feed_items').select('id, body, payload, occurred_at')
      .eq('type', 'announcement').is('deleted_at', null).gte('occurred_at', since)
      .order('occurred_at', { ascending: false }).limit(200);
    if (error) throw error;
    const feed = (data || []).flatMap((r) => {
      const row = r as { id: string; body: string | null; payload: Record<string, unknown> | null; occurred_at: string };
      const c = toCelebration(row.payload);
      if (!c) return [];
      const day = typeof row.payload!.date === 'string' ? row.payload!.date : dayOf(row.occurred_at);
      const until = typeof row.payload!.until === 'string' && row.payload!.until >= day ? row.payload!.until : day;
      const kind = CELEBRATION_TYPES[c.type];
      const title = (birthdayBodyAsOf(row.body, row.payload!.date, today) || '').replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/gi, '$1').trim();
      return [{ id: row.id, source: 'feed' as const, emoji: kind.emoji, label: kind.label, title, day, until,
        active: day <= today && today <= until, likes: 0, auto: typeof row.payload!.birthdayOf === 'string' }];
    });
    if (feed.length) {
      const { data: likes } = await db.from('feed_likes').select('feed_item_id').in('feed_item_id', feed.map((f) => f.id));
      const n = new Map<string, number>();
      for (const l of (likes || []) as Array<{ feed_item_id: string }>) n.set(l.feed_item_id, (n.get(l.feed_item_id) ?? 0) + 1);
      for (const f of feed) f.likes = n.get(f.id) ?? 0;
    }
    const club: Row[] = readClubStories(await settings(db, CLUB_STORIES_KEY)).map((s) => ({
      id: s.id, source: 'club', emoji: '🔵', label: 'הודעה ממדרגות', title: s.title + (s.text ? ` · ${s.text}` : ''),
      day: s.from, until: s.until, active: s.from <= today && today <= s.until, likes: 0, auto: false,
    }));
    // Also on air (mockup content-hub, 1): a survey still open, and messages waiting to go out.
    // Read-only here: they are edited where they were made.
    const nowIso = new Date().toISOString();
    const [{ data: openSurveys }, { data: queued }] = await Promise.all([
      db.from('surveys').select('id, question_he, created_at, closes_at').or(`closes_at.is.null,closes_at.gt.${nowIso}`)
        .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(5),
      db.from('scheduled_notifications').select('id, title_he, body_he, next_run_at').eq('kind', 'custom').eq('status', 'scheduled')
        .gt('next_run_at', nowIso).order('next_run_at').limit(5),
    ]);
    const surveyRows = (openSurveys || []) as Array<{ id: string; question_he: string; created_at: string; closes_at: string | null }>;
    const answers = new Map<string, number>();
    if (surveyRows.length) {
      const { data: resp } = await db.from('survey_responses').select('survey_id, athlete_id').in('survey_id', surveyRows.map((x) => x.id));
      // People, not rows: a survey with more than one answer has a row per answer (160).
      const who = new Map<string, Set<string>>();
      for (const r of (resp || []) as Array<{ survey_id: string; athlete_id: string }>) { const s = who.get(r.survey_id) ?? new Set<string>(); s.add(r.athlete_id); who.set(r.survey_id, s); }
      for (const [k, v] of who) answers.set(k, v.size);
    }
    const surveys: Row[] = surveyRows.map((x) => ({
      id: x.id, source: 'survey', emoji: '📊', label: 'סקר', title: x.question_he, day: dayOf(x.created_at),
      until: x.closes_at ? dayOf(x.closes_at) : '', active: true, likes: 0, auto: false, answers: answers.get(x.id) ?? 0,
    }));
    const scheduled: Row[] = ((queued || []) as Array<{ id: string; title_he: string | null; body_he: string | null; next_run_at: string }>).map((x) => ({
      id: x.id, source: 'scheduled', emoji: '⏰', label: 'הודעה מתוזמנת', title: x.title_he || x.body_he || '',
      day: dayOf(x.next_run_at), until: dayOf(x.next_run_at), active: true, likes: 0, auto: false, at: x.next_run_at,
    }));
    const items = [...club, ...feed, ...surveys, ...scheduled].sort((a, b) => Number(b.active) - Number(a.active) || b.day.localeCompare(a.day));
    return NextResponse.json({ today, items, birthdayDays: readBirthdayDays(await settings(db, BIRTHDAY_DAYS_KEY)) });
  } catch (err) {
    console.error('[admin/celebrations] GET failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const { denied } = await requireContentStaff(request);
  if (denied) return denied;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const db = createServerClient();
  try {
    if (b && 'birthdayDays' in b) {
      const days = readBirthdayDays(String(b.birthdayDays));
      await db.from('app_settings').upsert({ key: BIRTHDAY_DAYS_KEY, value: String(days) }, { onConflict: 'key' });
      return NextResponse.json({ ok: true, birthdayDays: days });
    }
    const id = typeof b?.id === 'string' ? b.id : '';
    const today = israelToday();
    const until = b?.end === true ? addDaysToDateStr(today, -1)
      : typeof b?.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.until) ? b.until : '';
    if (!id || !until) return NextResponse.json({ error: 'id and until required' }, { status: 400 });
    if (b?.source === 'club') {
      const list = readClubStories(await settings(db, CLUB_STORIES_KEY)).map((s) => (s.id === id ? { ...s, until } : s));
      await db.from('app_settings').upsert({ key: CLUB_STORIES_KEY, value: JSON.stringify(list) }, { onConflict: 'key' });
      return NextResponse.json({ ok: true, until });
    }
    const { data: row } = await db.from('feed_items').select('payload').eq('id', id).maybeSingle();
    const payload = (row as { payload?: Record<string, unknown> } | null)?.payload;
    if (!payload || !toCelebration(payload)) return NextResponse.json({ error: 'not a celebration' }, { status: 404 });
    const { error } = await db.from('feed_items').update({ payload: { ...payload, until } }).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true, until });
  } catch (err) {
    console.error('[admin/celebrations] PATCH failed:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
