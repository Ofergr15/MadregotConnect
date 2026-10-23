import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/self-or-staff';
import { requireContentLevel } from '@/lib/access/require-content';
import { requireApprover } from '@/lib/auth/require-approver';
import { cancelSurveyReminders, notifySurveyNonResponders, surveyAudienceIds } from '@/lib/surveys';
import { REMINDER_KIND } from '@/lib/survey-reminders';

export const dynamic = 'force-dynamic';

// One poll for the staff (mockup ~/.cache/madregot/polls-proposal.html, "תוצאות חיות, מי לא
// ענה, ותזכורות"): who chose what by name, who hasn't answered by pack (and which of them have
// no push, for the WhatsApp list), its push and every reminder with what it did.
//   GET  — staff (as the hub).
//   POST { action: 'remind' } — a reminder now, to whoever hasn't answered; approvers.
//   POST { action: 'close' }  — closes it now and drops the reminders still to come.

type Db = ReturnType<typeof createServerClient>;
type Survey = {
  id: string; question_he: string; options_he: string[]; closes_at: string | null; created_at: string;
  audience_type: string; audience_id: string | null; multi_answer?: boolean | null; anonymous?: boolean | null; created_by: string | null;
};

async function load(db: Db, id: string) {
  const { data } = await db.from('surveys').select('*').eq('id', id).maybeSingle();
  return data as Survey | null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied } = await requireContentLevel(request, 'surveys', 1, (u) => u.isSuperUser || u.isStaff);
  if (denied) return denied;
  const { id } = await params;
  const db = createServerClient();
  try {
    const s = await load(db, id);
    if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const asked = await surveyAudienceIds(db, s.audience_type, s.audience_id);
    const [{ data: resp }, { data: people }, { data: groups }, { data: subs }, { data: notes }, { data: post }] = await Promise.all([
      db.from('survey_responses').select('athlete_id, option_index, created_at').eq('survey_id', id).order('created_at'),
      db.from('athletes').select('id, name, group_id').in('id', asked.length ? asked : ['00000000-0000-0000-0000-000000000000']),
      db.from('groups').select('id, name'),
      db.from('push_subscriptions').select('athlete_id').in('athlete_id', asked.length ? asked : ['00000000-0000-0000-0000-000000000000']),
      db.from('scheduled_notifications').select('id, kind, status, next_run_at, scheduled_at, last_sent_at, sent_count').eq('survey_id', id).order('next_run_at'),
      db.from('feed_items').select('id').eq('type', 'announcement').is('deleted_at', null).eq('payload->>surveyId', id).limit(1),
    ]);
    const person = new Map(((people || []) as Array<{ id: string; name: string | null; group_id: string | null }>).map((p) => [p.id, p]));
    const groupName = new Map(((groups || []) as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]));
    const pushed = new Set(((subs || []) as Array<{ athlete_id: string }>).map((x) => x.athlete_id));
    const rows = (resp || []) as Array<{ athlete_id: string; option_index: number }>;
    const answered = new Set(rows.map((r) => r.athlete_id));
    const nameOf = async (ids: string[]) => {
      // Someone who answered but is outside the audience now (moved pack): still named.
      const missing = ids.filter((x) => !person.has(x));
      if (missing.length) {
        const { data } = await db.from('athletes').select('id, name, group_id').in('id', missing);
        for (const p of (data || []) as Array<{ id: string; name: string | null; group_id: string | null }>) person.set(p.id, p);
      }
    };
    await nameOf([...answered]);
    const options = (s.options_he || []).map((option, i) => ({
      option,
      people: rows.filter((r) => r.option_index === i).map((r) => ({ id: r.athlete_id, name: person.get(r.athlete_id)?.name || '' })),
    }));
    // Not answered, by pack, in the packs' own order; no pack last.
    const waiting = asked.filter((x) => !answered.has(x)).map((x) => person.get(x)).filter(Boolean) as Array<{ id: string; name: string | null; group_id: string | null }>;
    const packs = [...new Set(waiting.map((p) => p.group_id))]
      .sort((a, b) => (a === null ? 1 : b === null ? -1 : (groupName.get(a) || '').localeCompare(groupName.get(b) || '', 'he', { numeric: true })))
      .map((g) => ({
        pack: g ? groupName.get(g) || null : null,
        people: waiting.filter((p) => p.group_id === g).map((p) => ({ id: p.id, name: p.name || '', push: pushed.has(p.id) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
    const n = (notes || []) as Array<{ id: string; kind: string; status: string; next_run_at: string | null; scheduled_at: string | null; last_sent_at: string | null; sent_count: number | null }>;
    const announce = n.find((r) => r.kind === 'survey');
    return NextResponse.json({
      survey: {
        id: s.id, question: s.question_he, closesAt: s.closes_at, createdAt: s.created_at,
        open: !s.closes_at || Date.parse(s.closes_at) > Date.now(),
        audience: s.audience_type, pack: s.audience_type === 'group' && s.audience_id ? groupName.get(s.audience_id) || null : null,
        multi: s.multi_answer === true, anonymous: s.anonymous === true, postId: ((post || []) as Array<{ id: string }>)[0]?.id ?? null,
      },
      asked: asked.length,
      answered: answered.size,
      options,
      waiting: packs,
      push: announce ? { status: announce.status, sent: announce.sent_count ?? 0, at: announce.last_sent_at ?? announce.next_run_at } : null,
      reminders: n.filter((r) => r.kind === REMINDER_KIND).map((r) => ({
        id: r.id,
        at: r.scheduled_at ?? r.next_run_at ?? r.last_sent_at,
        // 'silent' is how a reminder ends once sent (it is not an inbox item).
        state: r.status === 'scheduled' ? 'scheduled' : r.status === 'cancelled' ? 'cancelled' : 'sent',
        sent: r.sent_count ?? 0,
        // Answers that came in after it went: what the reminder bought.
        after: r.last_sent_at && r.status !== 'scheduled' ? new Set((resp || []).filter((x: { created_at: string }) => x.created_at > r.last_sent_at!).map((x: { athlete_id: string }) => x.athlete_id)).size : null,
      })),
    });
  } catch (err) {
    console.error('[admin/content/surveys/id] failed:', err);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied, email } = await requireApprover(request);
  if (denied) return denied;
  const { id } = await params;
  const db = createServerClient();
  try {
    const s = await load(db, id);
    if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { action } = (await request.json().catch(() => ({}))) as { action?: string };
    const nowIso = new Date().toISOString();
    if (action === 'close') {
      await db.from('surveys').update({ closes_at: nowIso }).eq('id', id);
      await cancelSurveyReminders(db, id);
      return NextResponse.json({ ok: true });
    }
    if (action === 'remind') {
      if (s.closes_at && Date.parse(s.closes_at) <= Date.now()) return NextResponse.json({ error: 'closed' }, { status: 400 });
      const sent = await notifySurveyNonResponders({
        surveyId: id, audienceType: s.audience_type, audienceId: s.audience_id,
        copy: () => ({ title: s.question_he, body: 'עוד לא ענית — לחצו לענות' }),
        tag: `survey-remind-${id}-${Date.now()}`,
      });
      // Kept as a reminder row, so the results screen lists it with the scheduled ones.
      await db.from('scheduled_notifications').insert({
        kind: REMINDER_KIND, survey_id: id, title_he: s.question_he, body_he: 'עוד לא ענית — לחצו לענות',
        url: `/dashboard/surveys/${id}`, audience_type: s.audience_type, audience_id: s.audience_id,
        schedule_type: 'now', scheduled_at: nowIso, next_run_at: nowIso, status: 'silent', last_sent_at: nowIso, sent_count: sent, created_by: email || null,
      });
      return NextResponse.json({ ok: true, sent });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[admin/content/surveys/id] action failed:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
