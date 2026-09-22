'use client';

import { useState, useMemo } from 'react';
import { MessageSquare, AlertTriangle, MessageCircle, Bell } from 'lucide-react';
import { feelInfo, rpeHex, rpeLabel } from '@/lib/feedback-scales';
import { cn, resolveGroup } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { SkeletonList, SegmentedControl, Card, EmptyState } from '@/components/ui';
import { FeedbackThread, type ThreadMessage } from '@/components/FeedbackThread';
import { AthleteLink } from '@/components/AthleteLink';

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
  // The reply thread, sent with the list so each card doesn't fetch its own.
  messages: ThreadMessage[];
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
        <h1 className="text-2xl font-bold text-ink-700 flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-brand-600" /> משוב אימונים
        </h1>
        <p className="text-sm text-ink-400 mt-1">איך הרגישו הרצים אחרי האימונים</p>
      </div>

      {/* Range selector.

          Full width and not `w-fit`. `w-fit` sizes the track to the content the
          segments ASK for, but each segment is `flex-1 min-w-0 truncate`, so the
          asking and the fitting cancel out: the track came out at 145px and every
          label was clipped ("30 ימים" needed 48px inside a 45px segment). Given
          the whole column each segment gets ~113px, and the control now lines up
          with the category filter directly below it. */}
      <SegmentedControl
        value={String(days)}
        onChange={(v) => setDays(Number(v))}
        options={[7, 30, 90].map((d) => ({ value: String(d), label: `${d} ימים` }))}
        className="mb-4"
      />

      {loading ? (
        <SkeletonList count={5} />
      ) : (
        <>
          {/* Filter — exclusive choice (all/pain/wants/comment/missing), same
              SegmentedControl pattern as the days range selector above.

              Five segments of Hebrew words do not fit a phone: the widest,
              "⚠️ כאב (1)", measured 53px shown against 69px needed at 393px and
              49 against 69 at 375px, so every category was clipped mid-word. The
              four narrow ones therefore go icon + count (`iconOnly` + `badge`),
              and each icon is the one this page already uses for that same pile
              elsewhere — AlertTriangle for pain, MessageCircle for "asked for
              feedback", MessageSquare for a comment, Bell for the ones who ran
              and said nothing (the MissingCard's own badge). `label` stays the
              full phrase, which is what `aria-label` and the tooltip announce. */}
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `הכל (${counts.total})` },
              { value: 'pain', label: `כאב (${counts.pain})`, icon: AlertTriangle, iconOnly: true, badge: String(counts.pain) },
              { value: 'wants', label: `ביקשו משוב (${counts.wantsFeedback})`, icon: MessageCircle, iconOnly: true, badge: String(counts.wantsFeedback) },
              { value: 'comment', label: `עם הערה (${counts.withComment})`, icon: MessageSquare, iconOnly: true, badge: String(counts.withComment) },
              { value: 'missing', label: `לא הגיבו (${counts.missing})`, icon: Bell, iconOnly: true, badge: String(counts.missing) },
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
        {/* "Ran and said nothing" is a card about a person the coach is about to
            chase, so the face and the name go to that person. The squad tag and the
            run line ride inside the link because they are labels, not controls. */}
        <AthleteLink
          athleteId={m.athleteId}
          name={m.name}
          // 36px tall, because that is exactly the avatar. It is the card's main
          // control — it opens the athlete the coach is about to chase — so it
          // grows into the card's own padding with `-my-1`: 44px of thumb, and the
          // row's height is still set by the avatar, so nothing moves.
          className="flex min-w-0 flex-1 items-center gap-3 min-h-[44px] -my-1"
        >
          {m.avatarUrl
            ? <img src={m.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
            : <span className="w-9 h-9 rounded-full bg-brand-600/25 flex items-center justify-center text-xs font-bold text-brand-600 shrink-0">{(m.name[0] || '?').toUpperCase()}</span>}
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-sm font-bold text-ink-700 truncate" dir="auto">{m.name}</span>
              {/* The squad chip takes `resolveGroup(...).colors.chip`, not the raw
                  `hex`. `hex` is the squad's IDENTITY colour — right for a dot, a
                  bar or a chart series, and that is all GROUP_HEX was written for.
                  Printing it as 10px TEXT on its own 12%-alpha wash measured
                  2.96:1 for squad 1 (#16a34a) and worse for squad 3, i.e. it
                  failed AA at the smallest type on the screen. `colors.chip` is
                  the same three hues with the ink companions the palette already
                  ships for exactly this (`accent-900` / `band-2-ink` /
                  `band-3-ink`), so the squad still reads as its own colour. Same
                  change in FeedbackCard below — the two cards are twins. */}
              {rg && <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', rg.colors.chip.bg, rg.colors.chip.text)}>{m.squad}</span>}
            </span>
            <span className="block text-xs text-ink-400 truncate">
              {m.activityName || 'אימון'}{km ? ` · ${km} ק״מ` : ''}{dateStr ? ` · ${dateStr}` : ''}
            </span>
          </span>
        </AthleteLink>
        <span className="inline-flex items-center gap-1 text-2xs font-bold px-2 py-1 rounded-lg bg-page/50 text-ink-400 shrink-0">
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
    <Card variant="solid" className={it.pain ? 'border-band-3/40' : undefined}>
      <div className="flex items-center gap-3">
        {/* Same identity block as the MissingCard above, same link. The feel emoji
            on the far end stays outside it — it is the summary the coach is
            scanning for, and it carries its own title tooltip. */}
        <AthleteLink
          athleteId={it.athleteId}
          name={it.name}
          // Same 36→44 grow as MissingCard's link above.
          className="flex min-w-0 flex-1 items-center gap-3 min-h-[44px] -my-1"
        >
          {it.avatarUrl
            ? <img src={it.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
            : <span className="w-9 h-9 rounded-full bg-brand-600/25 flex items-center justify-center text-xs font-bold text-brand-600 shrink-0">{(it.name[0] || '?').toUpperCase()}</span>}
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-sm font-bold text-ink-700 truncate" dir="auto">{it.name}</span>
              {/* Same chip, same reason as MissingCard's — see the note there. */}
              {rg && <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', rg.colors.chip.bg, rg.colors.chip.text)}>{it.squad}</span>}
            </span>
            <span className="block text-xs text-ink-400 truncate">
              {it.activityName || 'אימון'}{km ? ` · ${km} ק״מ` : ''}{dateStr ? ` · ${dateStr}` : ''}
            </span>
          </span>
        </AthleteLink>

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
          <span className="text-2xs font-semibold text-ink-400 w-16 shrink-0">קושי {it.difficulty}/10</span>
          <div className="flex-1 h-2 rounded-full bg-page overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${it.difficulty * 10}%`, backgroundColor: rpeHex(it.difficulty) }} />
          </div>
          <span className="text-2xs text-ink-400 w-16 text-start shrink-0">{rpeLabel(it.difficulty)}</span>
        </div>
      )}

      {/* Flags */}
      {(it.pain || it.wantsFeedback) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {it.pain && (
            <span className="inline-flex items-center gap-1 text-2xs font-bold px-2 py-1 rounded-lg bg-band-3/20 text-band-3-ink border border-band-3/40">
              <AlertTriangle className="h-3 w-3" /> כאב{it.painDetail ? `: ${it.painDetail}` : ''}
            </span>
          )}
          {it.wantsFeedback && (
            <span className="inline-flex items-center gap-1 text-2xs font-bold px-2 py-1 rounded-lg bg-band-2/15 text-band-2-ink border border-band-2/30">
              <Bell className="h-3 w-3" /> ביקש/ה משוב
            </span>
          )}
        </div>
      )}

      {/* Comment */}
      {it.comment && (
        <div className="mt-2.5 flex items-start gap-2 text-sm text-ink-500 bg-page/40 rounded-lg px-3 py-2">
          <MessageCircle className="h-3.5 w-3.5 text-ink-400 mt-0.5 shrink-0" />
          <span dir="auto">{it.comment}</span>
        </div>
      )}

      <FeedbackThread feedbackId={it.id} viewerEmail={viewerEmail} seed={it.messages || []} />
    </Card>
  );
}
