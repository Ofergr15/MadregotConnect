'use client';

import { useState, useMemo } from 'react';
import { MessageSquare, AlertTriangle, MessageCircle, Bell } from 'lucide-react';
import { feelInfo, rpeHex, rpeLabel } from '@/lib/feedback-scales';
import { resolveGroup } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { SkeletonList, SegmentedControl, Card, EmptyState } from '@/components/ui';
import { FeedbackThread } from '@/components/FeedbackThread';

interface FeedbackItem {
  id: string;
  athleteId: string;
  name: string;
  avatarUrl: string | null;
  squad: string | null;
  activityId: number | null;
  activityName: string | null;
  activityType: string | null;
  distance: number | null;
  startTime: string | null;
  difficulty: number | null;
  feel: number | null;
  pain: boolean | null;
  painDetail: string | null;
  wantsFeedback: boolean | null;
  comment: string | null;
  coachReply: string | null;
  coachReplyAt: string | null;
  createdAt: string;
}

interface MissingEntry {
  athleteId: string;
  name: string;
  avatarUrl: string | null;
  squad: string | null;
  activityId: number | null;
  activityName: string | null;
  activityType: string | null;
  distance: number | null;
  startTime: string | null;
}

type Filter = 'all' | 'pain' | 'wants' | 'comment' | 'missing';

// Admin view: recent post-workout feedback across all athletes. Priority order
// (pain → hardest felt → wants-feedback → has-comment → rest) mirrors what a
// coach needs first. Feel/RPE use the shared verified scales.
export default function WorkoutFeedbackPage() {
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<Filter>('all');

  const { data } = useApi<{
    items?: FeedbackItem[];
    missing?: MissingEntry[];
    counts?: { total: number; pain: number; wantsFeedback: number; withComment: number; missing: number };
  }>(`/api/workout-feedback?list=1&days=${days}`);
  const items = useMemo(() => data?.items || [], [data]);
  const missing = useMemo(() => data?.missing || [], [data]);
  const counts = data?.counts || { total: 0, pain: 0, wantsFeedback: 0, withComment: 0, missing: 0 };
  const loading = !data;

  const filtered = useMemo(() => {
    let list = items;
    if (filter === 'pain') list = items.filter((i) => i.pain === true);
    else if (filter === 'wants') list = items.filter((i) => i.wantsFeedback === true);
    else if (filter === 'comment') list = items.filter((i) => !!i.comment);
    // Priority sort: pain first, then hardest (RPE desc), then wants-feedback,
    // then has-comment, newest as tiebreak.
    return [...list].sort((a, b) => {
      const score = (i: FeedbackItem) =>
        (i.pain ? 1000 : 0) + (i.difficulty ?? 0) * 10 + (i.wantsFeedback ? 5 : 0) + (i.comment ? 1 : 0);
      const s = score(b) - score(a);
      if (s !== 0) return s;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }, [items, filter]);

  return (
    <div className="max-w-4xl mx-auto" dir="rtl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-primary-400" /> משוב אימונים
        </h1>
        <p className="text-sm text-slate-400 mt-1">איך הרגישו הרצים אחרי האימונים</p>
      </div>

      {/* Range selector */}
      <SegmentedControl
        value={String(days)}
        onChange={(v) => setDays(Number(v))}
        options={[7, 30, 90].map((d) => ({ value: String(d), label: `${d} ימים` }))}
        className="mb-4 w-fit"
      />

      {loading ? (
        <SkeletonList count={5} />
      ) : (
        <>
          {/* Filter — exclusive choice (all/pain/wants/comment), same
              SegmentedControl pattern as the days range selector above. */}
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `הכל (${counts.total})` },
              { value: 'pain', label: `⚠️ כאב (${counts.pain})` },
              { value: 'wants', label: `ביקשו משוב (${counts.wantsFeedback})` },
              { value: 'comment', label: `עם הערה (${counts.withComment})` },
              { value: 'missing', label: `לא הגיבו (${counts.missing})` },
            ]}
            className="mb-4"
          />

          {filter === 'missing' ? (
            missing.length === 0 ? (
              <EmptyState icon={Bell} title="כולם הגיבו לאימון האחרון שלהם" />
            ) : (
              <div className="space-y-2.5">
                {missing.map((m) => <MissingCard key={m.athleteId} m={m} />)}
              </div>
            )
          ) : filtered.length === 0 ? (
            <EmptyState icon={MessageSquare} title="אין משוב בטווח הזה" />
          ) : (
            <div className="space-y-2.5">
              {filtered.map((it) => <FeedbackCard key={it.id} it={it} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MissingCard({ m }: { m: MissingEntry }) {
  const rg = m.squad ? resolveGroup(m.squad) : null;
  const dateStr = m.startTime ? new Date(m.startTime).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }) : '';
  const km = m.distance != null ? (m.distance / 1000).toFixed(1) : null;

  return (
    <Card variant="solid">
      <div className="flex items-center gap-3">
        {m.avatarUrl
          ? <img src={m.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
          : <span className="w-9 h-9 rounded-full bg-primary-600/25 flex items-center justify-center text-xs font-bold text-primary-200 shrink-0">{(m.name[0] || '?').toUpperCase()}</span>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white truncate" dir="auto">{m.name}</span>
            {rg && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: rg.hex, backgroundColor: `${rg.hex}20` }}>{m.squad}</span>}
          </div>
          <div className="text-xs text-slate-400 truncate">
            {m.activityName || 'אימון'}{km ? ` · ${km} ק״מ` : ''}{dateStr ? ` · ${dateStr}` : ''}
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-2xs font-bold px-2 py-1 rounded-lg bg-slate-700/50 text-slate-400 shrink-0">
          <Bell className="h-3 w-3" /> ללא תגובה
        </span>
      </div>
    </Card>
  );
}

function FeedbackCard({ it }: { it: FeedbackItem }) {
  const feel = feelInfo(it.feel);
  const rg = it.squad ? resolveGroup(it.squad) : null;
  const when = it.startTime || it.createdAt;
  const dateStr = when ? new Date(when).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }) : '';
  const km = it.distance != null ? (it.distance / 1000).toFixed(1) : null;

  const viewerEmail = typeof window !== 'undefined'
    ? (localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '')
    : '';

  return (
    <Card variant="solid" className={it.pain ? 'border-amber-500/40' : undefined}>
      <div className="flex items-center gap-3">
        {it.avatarUrl
          ? <img src={it.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
          : <span className="w-9 h-9 rounded-full bg-primary-600/25 flex items-center justify-center text-xs font-bold text-primary-200 shrink-0">{(it.name[0] || '?').toUpperCase()}</span>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white truncate" dir="auto">{it.name}</span>
            {rg && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: rg.hex, backgroundColor: `${rg.hex}20` }}>{it.squad}</span>}
          </div>
          <div className="text-xs text-slate-400 truncate">
            {it.activityName || 'אימון'}{km ? ` · ${km} ק״מ` : ''}{dateStr ? ` · ${dateStr}` : ''}
          </div>
        </div>

        {/* Feel emoji */}
        {feel && (
          <span className="flex flex-col items-center shrink-0" title={feel.label}>
            <span className="text-xl leading-none">{feel.emoji}</span>
          </span>
        )}
      </div>

      {/* RPE bar */}
      {it.difficulty != null && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-2xs font-semibold text-slate-400 w-16 shrink-0">קושי {it.difficulty}/10</span>
          <div className="flex-1 h-2 rounded-full bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${it.difficulty * 10}%`, backgroundColor: rpeHex(it.difficulty) }} />
          </div>
          <span className="text-2xs text-slate-500 w-16 text-start shrink-0">{rpeLabel(it.difficulty)}</span>
        </div>
      )}

      {/* Flags */}
      {(it.pain || it.wantsFeedback) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {it.pain && (
            <span className="inline-flex items-center gap-1 text-2xs font-bold px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40">
              <AlertTriangle className="h-3 w-3" /> כאב{it.painDetail ? `: ${it.painDetail}` : ''}
            </span>
          )}
          {it.wantsFeedback && (
            <span className="inline-flex items-center gap-1 text-2xs font-bold px-2 py-1 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30">
              <Bell className="h-3 w-3" /> ביקש/ה משוב
            </span>
          )}
        </div>
      )}

      {/* Comment */}
      {it.comment && (
        <div className="mt-2.5 flex items-start gap-2 text-sm text-slate-300 bg-slate-900/40 rounded-lg px-3 py-2">
          <MessageCircle className="h-3.5 w-3.5 text-slate-500 mt-0.5 shrink-0" />
          <span dir="auto">{it.comment}</span>
        </div>
      )}

      <FeedbackThread feedbackId={it.id} viewerEmail={viewerEmail} />
    </Card>
  );
}
