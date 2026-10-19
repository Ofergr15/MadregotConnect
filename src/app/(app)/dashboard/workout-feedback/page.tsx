'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Check, Send } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { WAITING_DAYS, groupByRunner, isWaiting, type RunnerGroup } from '@/lib/feedback/waiting';
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
type View = 'waiting' | 'answered' | 'all';

/**
 * "מחכים לך" first (mockup coach-feedback-mockup.html, Ofer 2026-10-19): one card per
 * runner with what waits for an answer, a reply in one tap, "ענית" after. The old list
 * is "הכל", as it was.
 */
export default function WorkoutFeedbackPage() {
  const [view, setView] = useState<View>('waiting');
  const { data, mutate } = useApi<{ items?: FeedbackItem[] }>(`/api/workout-feedback?list=1&days=${WAITING_DAYS}`);
  const items = useMemo(() => data?.items || [], [data]);
  const groups = useMemo(() => groupByRunner(items), [items]);
  const waiting = groups.filter((g) => g.waiting.length > 0);
  const answered = groups
    .filter((g) => g.waiting.length === 0 && g.lastAnsweredAt)
    .sort((a, b) => (b.lastAnsweredAt ?? '').localeCompare(a.lastAnsweredAt ?? ''));
  const [open, setOpen] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const openGroup = groups.find((g) => g.athleteId === open) ?? null;
  const byId = useMemo(() => new Map(items.map((i) => [i.athleteId, i])), [items]);

  if (openGroup) {
    return (
      <RunnerDetail
        group={openGroup}
        person={byId.get(openGroup.athleteId)!}
        onBack={() => setOpen(null)}
        onDone={async (sent) => {
          const name = byId.get(openGroup.athleteId)?.name.split(' ')[0] || '';
          setOpen(null);
          await mutate();
          setView('answered');
          setToast(sent ? `נשלח ל${name} — הוא יקבל התראה` : `סומן כטופל`);
          setTimeout(() => setToast(null), 3500);
        }}
      />
    );
  }

  return (
    <div className="max-w-4xl mx-auto" dir="rtl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-ink-700 flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-brand-600" /> משוב אימונים
        </h1>
        <p className="text-sm text-ink-400 mt-1">{view === 'all' ? 'איך הרגישו הרצים אחרי האימונים' : 'מי מחכה שתענה לו — הכי דחוף למעלה'}</p>
      </div>
      <SegmentedControl
        value={view}
        onChange={(v) => setView(v as View)}
        options={[
          { value: 'waiting', label: `מחכים לך · ${waiting.reduce((n, g) => n + g.waiting.length, 0)}` },
          { value: 'answered', label: `ענית · ${answered.length}` },
          { value: 'all', label: 'הכל' },
        ]}
        className="mb-4"
      />
      {toast && (
        <p role="status" className="mb-3 flex items-center gap-2 rounded-2xl bg-accent-600/10 px-3.5 py-3 text-sm font-extrabold text-accent-900">
          <Check className="h-4 w-4" strokeWidth={3} /> {toast}
        </p>
      )}
      {view === 'all' ? <AllFeedback /> : !data ? <SkeletonList count={4} /> : view === 'waiting' ? (
        waiting.length === 0
          ? <EmptyState icon={Check} title="אף אחד לא מחכה לתשובה" />
          : <div className="space-y-2.5">{waiting.map((g) => <RunnerCard key={g.athleteId} group={g} person={byId.get(g.athleteId)!} onOpen={() => setOpen(g.athleteId)} />)}</div>
      ) : (
        answered.length === 0
          ? <EmptyState icon={MessageSquare} title={`עוד לא ענית לאף אחד ב־${WAITING_DAYS} הימים האחרונים`} />
          : <div className="space-y-2.5">{answered.map((g) => <AnsweredCard key={g.athleteId} group={g} person={byId.get(g.athleteId)!} onOpen={() => setOpen(g.athleteId)} />)}</div>
      )}
    </div>
  );
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });
const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

function Avatar({ person, size = 44 }: { person: FeedbackItem; size?: number }) {
  return person.avatarUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={person.avatarUrl} alt="" style={{ width: size, height: size }} className="rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
    : <span style={{ width: size, height: size }} className="rounded-full bg-brand-600/15 flex items-center justify-center text-sm font-bold text-brand-600 shrink-0">{(person.name[0] || '?').toUpperCase()}</span>;
}

/** One thing a runner wrote, as one line: when, and what. */
function Line({ it }: { it: FeedbackItem }) {
  // A plain answer (nothing asked) is how the run felt: the effort and the face.
  const felt = [it.difficulty != null && `קושי ${it.difficulty}/10`, feelInfo(it.feel)?.emoji].filter(Boolean).join(' ') || 'מילא משוב';
  const text = it.pain ? `כאב${it.painDetail ? `: ${it.painDetail}` : ''}`
    : it.wantsFeedback ? `ביקש משוב${it.comment ? `: ${it.comment}` : ''}`
    : it.comment?.trim() ? `"${it.comment.trim()}"` : felt;
  const Icon = it.pain ? AlertTriangle : it.wantsFeedback ? MessageCircle : MessageSquare;
  return (
    <p className="flex items-start gap-1.5 py-1 text-[13.5px] leading-snug text-ink-700">
      <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', it.pain ? 'text-accent-red' : 'text-brand-600')} />
      <span className="min-w-0"><bdi className="font-bold">{shortDate(it.createdAt)}</bdi> · <span dir="auto">{text}</span></span>
    </p>
  );
}

function RunnerCard({ group, person, onOpen }: { group: RunnerGroup<FeedbackItem>; person: FeedbackItem; onOpen: () => void }) {
  const parts = [
    group.pain > 0 && count(group.pain, 'דיווח כאב', 'דיווחי כאב'),
    group.asks > 0 && count(group.asks, 'בקשת משוב', 'בקשות משוב'),
    group.since && `מחכה מ־${shortDate(group.since)}`,
  ].filter(Boolean);
  return (
    <Card variant="solid">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 text-start">
        <Avatar person={person} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15.5px] font-extrabold text-ink-900" dir="auto">{person.name}</span>
          <span className="block text-xs text-ink-400">{parts.join(' · ')}</span>
        </span>
        <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
      </button>
      {group.recurring && (
        <span className="mt-2 inline-block rounded-full bg-accent-red/10 px-2.5 py-1 text-xs font-extrabold text-accent-red-ink">
          {group.recurring.label} — {group.recurring.count} פעמים
        </span>
      )}
      <div className="mt-1.5">{group.waiting.slice(0, 2).map((it) => <Line key={it.id} it={it} />)}</div>
      <button type="button" onClick={onOpen} className="mt-2 h-11 w-full rounded-xl bg-brand-600 text-[15px] font-extrabold text-white active:opacity-85">לענות</button>
    </Card>
  );
}

function AnsweredCard({ group, person, onOpen }: { group: RunnerGroup<FeedbackItem>; person: FeedbackItem; onOpen: () => void }) {
  const last = group.items.flatMap((i) => i.messages).filter((m) => m.fromStaff).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return (
    <Card variant="solid">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 text-start">
        <Avatar person={person} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15.5px] font-extrabold text-ink-900" dir="auto">{person.name}</span>
          <span className="block text-xs text-ink-400">ענית · <bdi>{group.lastAnsweredAt ? shortDate(group.lastAnsweredAt) : ''}</bdi></span>
        </span>
        <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
      </button>
      {last
        ? <p className="mt-2 rounded-2xl rounded-es-md bg-brand-600/[0.08] px-3 py-2 text-[13.5px] leading-relaxed text-ink-900" dir="auto">{last.body}</p>
        : <p className="mt-2 flex items-center gap-1.5 text-[13px] font-bold text-accent-900"><Check className="h-3.5 w-3.5" strokeWidth={3} /> סומן כטופל</p>}
    </Card>
  );
}

const QUICK_REPLIES = ['בוא נדבר היום 📞', 'קח יום מנוחה מחר', 'כל הכבוד על השבוע 💪', 'ספר לי עוד — איפה בדיוק כואב?'];

/** Everything one runner wrote, and one answer for all of it. */
function RunnerDetail({ group, person, onBack, onDone }: {
  group: RunnerGroup<FeedbackItem>; person: FeedbackItem; onBack: () => void; onDone: (sent: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? group.items : group.items.slice(0, 7);
  const first = person.name.split(' ')[0];

  const close = async (message: string | null) => {
    setBusy(true); setError(null);
    try {
      const headers = await apiHeaders(true);
      // One message, on the newest thing waiting (its thread pushes the runner) — then
      // everything waiting is answered by it.
      const target = group.waiting[0] ?? group.items[0];
      if (message && target) {
        const res = await fetch(`/api/workout-feedback/${target.id}/messages`, { method: 'POST', headers, body: JSON.stringify({ body: message }) });
        if (!res.ok) throw new Error('send');
      }
      if (group.waiting.length) {
        const res = await fetch('/api/workout-feedback/handled', { method: 'POST', headers, body: JSON.stringify({ ids: group.waiting.map((i) => i.id) }) });
        if (!res.ok) throw new Error('handled');
      }
      onDone(!!message);
    } catch {
      setError('לא הצלחנו לשמור. נסו שוב.');
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto" dir="rtl">
      <button type="button" onClick={onBack} className="mb-2 flex min-h-[44px] items-center gap-1 text-[15px] font-extrabold text-brand-600">
        <ChevronRight className="h-5 w-5" /> משוב אימונים
      </button>
      <div className="mb-3 flex items-center gap-3">
        <Avatar person={person} size={56} />
        <div className="min-w-0">
          <p className="truncate text-xl font-black text-ink-900" dir="auto">{person.name}</p>
          <p className="text-[13px] text-ink-400">
            {group.waiting.length ? <>{count(group.waiting.length, 'דבר אחד מחכה לתשובה', 'דברים מחכים לתשובה')}{group.since ? <> · מ־<bdi>{shortDate(group.since)}</bdi></> : null}</> : 'אין משהו שמחכה'}
          </p>
        </div>
      </div>
      {group.recurring && (
        <p className="mb-2 inline-block rounded-full bg-accent-red/10 px-2.5 py-1 text-xs font-extrabold text-accent-red-ink">{group.recurring.label} — {group.recurring.count} פעמים ב־45 יום</p>
      )}
      <Card variant="solid" className="divide-y divide-page">
        {shown.map((it) => (
          <div key={it.id} className={cn(!isWaiting(it) && 'opacity-55')}><Line it={it} /></div>
        ))}
        {!all && group.items.length > 7 && (
          <button type="button" onClick={() => setAll(true)} className="min-h-[44px] w-full text-start text-[13px] font-extrabold text-brand-600">ועוד {group.items.length - 7}</button>
        )}
      </Card>
      <p className="mb-2 mt-4 px-1 text-xs font-extrabold text-ink-400">תשובה מהירה</p>
      <div className="flex flex-wrap gap-2">
        {QUICK_REPLIES.map((q) => (
          <button key={q} type="button" onClick={() => setText((t) => (t ? `${t} ${q}` : q))}
            className="min-h-[44px] rounded-pill border-[1.5px] border-brand-600/25 bg-card px-3.5 text-[13.5px] font-extrabold text-brand-600 active:bg-brand-600/10">{q}</button>
        ))}
      </div>
      <div className="mt-3 flex items-end gap-2 rounded-2xl bg-card p-1.5 ps-3.5">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1000}
          placeholder={`הודעה ל${first}…`} aria-label={`הודעה ל${first}`}
          className="min-h-[44px] flex-1 resize-none bg-transparent py-2 text-base text-ink-900 placeholder:text-ink-400 focus:outline-none" />
        <button type="button" disabled={busy || !text.trim()} onClick={() => void close(text.trim())} aria-label="שליחה"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white disabled:opacity-40">
          <Send className="h-[18px] w-[18px]" />
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-accent-red" role="alert">{error}</p>}
      {group.waiting.length > 0 && (
        <button type="button" disabled={busy} onClick={() => void close(null)}
          className="mt-2 flex min-h-[44px] w-full items-center justify-center gap-1.5 text-[14px] font-extrabold text-ink-500 disabled:opacity-50">
          <Check className="h-4 w-4" strokeWidth={3} /> טופל — בלי הודעה
        </button>
      )}
    </div>
  );
}

/** The full list, every feedback with its thread — the screen as it was before 2026-10-19. */
function AllFeedback() {
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
    <div>

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
              {rg && <span className={cn('text-2xs font-bold px-1.5 py-0.5 rounded', rg.colors.chip.bg, rg.colors.chip.text)}>{m.squad}</span>}
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
              {rg && <span className={cn('text-2xs font-bold px-1.5 py-0.5 rounded', rg.colors.chip.bg, rg.colors.chip.text)}>{it.squad}</span>}
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
