'use client';

import { useState, useEffect, useMemo } from 'react';
import { MessageSquare, Loader2, AlertTriangle, MessageCircle, Bell } from 'lucide-react';
import { feelInfo, rpeHex, rpeLabel } from '@/lib/feedback-scales';
import { resolveGroup } from '@/lib/utils';

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
  createdAt: string;
}

type Filter = 'all' | 'pain' | 'wants' | 'comment';

// Admin view: recent post-workout feedback across all athletes. Priority order
// (pain → hardest felt → wants-feedback → has-comment → rest) mirrors what a
// coach needs first. Feel/RPE use the shared verified scales.
export default function WorkoutFeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [counts, setCounts] = useState({ total: 0, pain: 0, wantsFeedback: 0, withComment: 0 });
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/workout-feedback?list=1&days=${days}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setItems(data?.items || []);
        if (data?.counts) setCounts(data.counts);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [days]);

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
      <div className="flex items-center gap-1.5 mb-4">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${days === d ? 'bg-primary-600/25 text-primary-200 border-primary-500/50' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}
          >
            {d} ימים
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 text-primary-500 animate-spin" /></div>
      ) : (
        <>
          {/* Filter pills with counts */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} label="הכל" count={counts.total} />
            <FilterPill active={filter === 'pain'} onClick={() => setFilter('pain')} label="⚠️ כאב" count={counts.pain} tone="amber" />
            <FilterPill active={filter === 'wants'} onClick={() => setFilter('wants')} label="ביקשו משוב" count={counts.wantsFeedback} />
            <FilterPill active={filter === 'comment'} onClick={() => setFilter('comment')} label="עם הערה" count={counts.withComment} />
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-10">אין משוב בטווח הזה</p>
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

function FilterPill({ label, count, active, onClick, tone }: { label: string; count: number; active: boolean; onClick: () => void; tone?: 'amber' }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
        active
          ? tone === 'amber' ? 'bg-amber-500/25 text-amber-200 border-amber-500/50' : 'bg-primary-600/25 text-primary-200 border-primary-500/50'
          : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
      }`}
    >
      {label} <span className="opacity-70 tabular-nums">{count}</span>
    </button>
  );
}

function FeedbackCard({ it }: { it: FeedbackItem }) {
  const feel = feelInfo(it.feel);
  const rg = it.squad ? resolveGroup(it.squad) : null;
  const when = it.startTime || it.createdAt;
  const dateStr = when ? new Date(when).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }) : '';
  const km = it.distance != null ? (it.distance / 1000).toFixed(1) : null;

  return (
    <div className={`rounded-xl border bg-slate-800/60 p-3.5 ${it.pain ? 'border-amber-500/40' : 'border-slate-700'}`}>
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
          <span className="text-[11px] font-semibold text-slate-400 w-16 shrink-0">קושי {it.difficulty}/10</span>
          <div className="flex-1 h-2 rounded-full bg-slate-700 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${it.difficulty * 10}%`, backgroundColor: rpeHex(it.difficulty) }} />
          </div>
          <span className="text-[11px] text-slate-500 w-16 text-start shrink-0">{rpeLabel(it.difficulty)}</span>
        </div>
      )}

      {/* Flags */}
      {(it.pain || it.wantsFeedback) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {it.pain && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40">
              <AlertTriangle className="h-3 w-3" /> כאב{it.painDetail ? `: ${it.painDetail}` : ''}
            </span>
          )}
          {it.wantsFeedback && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30">
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
    </div>
  );
}
