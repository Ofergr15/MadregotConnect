'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Clock, MapPin, Plus, Users, X, Gauge, Route as RouteIcon } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button, EmptyState, Sheet, SkeletonList } from '@/components/ui';
import { AthleteLink } from '@/components/AthleteLink';
import { FeedAvatar } from '@/components/FeedAvatar';
import { paceMatch, type RunMeetup } from '@/lib/runs/meetups';

// "שידוכי ריצות" — the run-meetup board (398963c7: "say when and where you're
// going out and what the planned pace is; anyone with a similar session can ask
// to join").
//
// One screen and not a feed section, because the two halves of this need opposite
// treatment: the offers are a short list that must be readable at a glance, and
// answering a request is a small piece of admin nobody should meet while
// scrolling past their teammates' runs. The feed is where you read; this is where
// you arrange.
//
// The "matchmaking" is the pace on the card, compared against the pace the viewer
// themselves last posted — see lib/runs/meetups.ts for why the app does not try
// to read anybody's training plan to do it automatically.

interface MeetupsResponse {
  meetups: RunMeetup[];
  today: string;
}

export default function RunTogetherPage() {
  const t = useTranslations('runTogether');
  const tc = useTranslations('common');
  const locale = useLocale();
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';

  const { data, isLoading, mutate } = useApi<MeetupsResponse>('/api/runs/meetups');
  const [composerOpen, setComposerOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const meetups = data?.meetups || [];
  // The viewer's own most recent offer is the only pace the app can honestly say
  // is theirs — it is the one they typed. No offer of their own means no match
  // labels anywhere on the board, which is the correct amount to claim.
  const myPace = meetups.find(m => m.isHost)?.plannedPace ?? null;

  async function send(url: string, init: RequestInit) {
    setPending(url);
    try {
      const res = await fetch(url, { ...init, headers: await apiHeaders(true) });
      // Revalidate rather than patch locally: a request changes two things on the
      // card (the viewer's own state and the host's pending list) and the server
      // already computes both.
      if (res.ok) await mutate();
      return res.ok;
    } catch {
      return false;
    } finally {
      setPending(null);
    }
  }

  const when = (m: RunMeetup) => {
    const day = new Date(`${m.date}T12:00:00`).toLocaleDateString(dateLocale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    return `${day} · ${m.startTime}`;
  };

  return (
    <div className="max-w-2xl mx-auto pb-8">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink-700 flex items-center gap-2">
            <Users className="h-6 w-6 text-brand-600" /> {t('title')}
          </h1>
          <p className="mt-1 text-xs text-ink-400">{t('subtitle')}</p>
        </div>
        <Button onClick={() => setComposerOpen(true)} className="shrink-0">
          <Plus className="h-4 w-4" />
          {t('post')}
        </Button>
      </div>

      {isLoading && !data && <SkeletonList count={3} />}

      {!isLoading && meetups.length === 0 && (
        <EmptyState icon={Users} title={t('emptyTitle')} description={t('emptyBody')} />
      )}

      {meetups.length > 0 && (
        <div className="space-y-3">
          {meetups.map(m => {
            const match = m.isHost ? null : paceMatch(m.plannedPace, myPace);
            return (
              <div key={m.id} className="rounded-2xl border border-page bg-card p-4">
                <div className="flex items-start gap-3">
                  <FeedAvatar name={m.hostName} url={null} className="h-10 w-10" textClassName="text-sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <AthleteLink
                        athleteId={m.hostAthleteId}
                        name={m.hostName}
                        className="truncate text-sm font-bold text-ink-700"
                      >
                        <span dir="auto">{m.hostName}</span>
                      </AthleteLink>
                      {m.isHost && (
                        <span className="shrink-0 rounded-full bg-page px-2 py-0.5 text-2xs font-semibold text-ink-400">
                          {t('yours')}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-ink-700">
                      <Clock className="h-3 w-3 text-ink-400" />
                      {when(m)}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-400" dir="auto">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{m.location}</span>
                    </p>
                  </div>
                </div>

                {/* Pace and distance, the two numbers that decide whether this is
                    your run. The pace is wrapped in <bdi> because a Hebrew label
                    next to "5:10" otherwise reorders the two around the colon. */}
                {(m.plannedPace || m.distanceKm !== null) && (
                  <div className="mt-3 flex items-center gap-2">
                    {m.plannedPace && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-page px-2 py-1 text-2xs font-semibold text-ink-700">
                        <Gauge className="h-3 w-3 text-ink-400" />
                        <bdi dir="ltr">{m.plannedPace}</bdi> {t('perKm')}
                      </span>
                    )}
                    {m.distanceKm !== null && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-page px-2 py-1 text-2xs font-semibold text-ink-700">
                        <RouteIcon className="h-3 w-3 text-ink-400" />
                        <bdi dir="ltr">{m.distanceKm}</bdi> {t('km')}
                      </span>
                    )}
                    {match && match !== 'far' && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-2xs font-semibold',
                          match === 'close' ? 'bg-brand-600/10 text-brand-600' : 'bg-page text-ink-400',
                        )}
                      >
                        {match === 'close' ? t('matchClose') : t('matchNear')}
                      </span>
                    )}
                  </div>
                )}

                {m.notes && (
                  <p className="mt-2 text-xs text-ink-400" dir="auto">
                    {m.notes}
                  </p>
                )}

                {m.accepted.length > 0 && (
                  <p className="mt-2 flex flex-wrap items-center gap-1 text-2xs text-ink-400">
                    <Users className="h-3 w-3" />
                    {t('going')}:{' '}
                    {m.accepted.map(a => (
                      <AthleteLink key={a.athleteId} athleteId={a.athleteId} name={a.name} className="font-semibold text-ink-700">
                        <span dir="auto">{a.name}</span>
                      </AthleteLink>
                    ))}
                  </p>
                )}

                {/* ── The host's side: answer, or call the run off ── */}
                {m.isHost ? (
                  <div className="mt-3 space-y-2">
                    {m.pending.map(p => (
                      <div key={p.requestId} className="flex items-center gap-2 rounded-xl bg-page/60 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-700" dir="auto">
                          {t('asksToJoin', { name: p.name })}
                        </span>
                        <button
                          type="button"
                          aria-label={t('accept')}
                          disabled={!!pending}
                          onClick={() =>
                            send('/api/runs/meetups/requests', {
                              method: 'PATCH',
                              body: JSON.stringify({ requestId: p.requestId, status: 'accepted' }),
                            })
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-card disabled:opacity-50"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={t('decline')}
                          disabled={!!pending}
                          onClick={() =>
                            send('/api/runs/meetups/requests', {
                              method: 'PATCH',
                              body: JSON.stringify({ requestId: p.requestId, status: 'declined' }),
                            })
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-page text-ink-400 disabled:opacity-50"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      disabled={!!pending}
                      onClick={() => send(`/api/runs/meetups?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' })}
                      className="text-2xs font-semibold text-accent-red-ink disabled:opacity-50"
                    >
                      {t('cancelRun')}
                    </button>
                  </div>
                ) : (
                  /* ── Everybody else's side: ask, or withdraw ── */
                  <div className="mt-3">
                    {m.myRequest === 'accepted' ? (
                      <p className="flex items-center gap-1 text-xs font-semibold text-brand-600">
                        <Check className="h-3.5 w-3.5" /> {t('youAreIn')}
                      </p>
                    ) : m.myRequest === 'declined' ? (
                      <p className="text-xs text-ink-400">{t('wasDeclined')}</p>
                    ) : m.myRequest === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <p className="flex-1 text-xs text-ink-400">{t('requestSent')}</p>
                        <button
                          type="button"
                          disabled={!!pending}
                          onClick={() =>
                            send(`/api/runs/meetups/requests?meetupId=${encodeURIComponent(m.id)}`, { method: 'DELETE' })
                          }
                          className="text-2xs font-semibold text-ink-400 disabled:opacity-50"
                        >
                          {t('withdraw')}
                        </button>
                      </div>
                    ) : (
                      <Button
                        variant="secondary"
                        className="w-full"
                        disabled={!!pending}
                        onClick={() =>
                          send('/api/runs/meetups/requests', {
                            method: 'POST',
                            body: JSON.stringify({ meetupId: m.id }),
                          })
                        }
                      >
                        {t('askToJoin')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <MeetupComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        onCreated={() => {
          setComposerOpen(false);
          mutate();
        }}
        today={data?.today}
        labels={{ cancel: tc('cancel') }}
      />
    </div>
  );
}

/**
 * The "I'm going out" sheet.
 *
 * The server validates all of this again (lib/runs/meetups.ts is the one
 * implementation of the rules), so the inputs here are about making the valid
 * thing easy to type — a date picker, a time picker — rather than about being the
 * gate. The one server error it renders is the FIELD the server named, which is
 * why the API returns it.
 */
function MeetupComposer({
  open,
  onOpenChange,
  onCreated,
  today,
  labels,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
  today?: string;
  labels: { cancel: string };
}) {
  const t = useTranslations('runTogether');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('06:30');
  const [location, setLocation] = useState('');
  const [plannedPace, setPlannedPace] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [notes, setNotes] = useState('');
  const [badField, setBadField] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setBadField(null);
    try {
      const res = await fetch('/api/runs/meetups', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({ date, startTime, location, plannedPace, distanceKm, notes }),
      });
      if (res.ok) {
        setLocation('');
        setNotes('');
        setDistanceKm('');
        onCreated();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setBadField(typeof body.field === 'string' ? body.field : 'date');
    } catch {
      setBadField('date');
    } finally {
      setSaving(false);
    }
  }

  const field = (name: string) =>
    cn(
      'w-full rounded-xl border bg-card px-3 py-2.5 text-sm text-ink-700',
      badField === name ? 'border-accent-red' : 'border-page',
    );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('post')}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-2xs font-bold uppercase tracking-wider text-ink-400">{t('fieldDate')}</span>
          <input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} className={field('date')} />
        </label>
        <label className="block">
          <span className="mb-1 block text-2xs font-bold uppercase tracking-wider text-ink-400">{t('fieldTime')}</span>
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className={field('startTime')} />
        </label>
        <label className="block">
          <span className="mb-1 block text-2xs font-bold uppercase tracking-wider text-ink-400">{t('fieldLocation')}</span>
          <input
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder={t('locationPlaceholder')}
            dir="auto"
            className={field('location')}
          />
        </label>
        <div className="flex gap-3">
          <label className="block flex-1">
            <span className="mb-1 block text-2xs font-bold uppercase tracking-wider text-ink-400">{t('fieldPace')}</span>
            {/* inputMode text, not numeric: the value is "5:10" and a numeric
                keypad on iOS has no colon. */}
            <input
              value={plannedPace}
              onChange={e => setPlannedPace(e.target.value)}
              placeholder="5:10"
              dir="ltr"
              className={field('plannedPace')}
            />
          </label>
          <label className="block flex-1">
            <span className="mb-1 block text-2xs font-bold uppercase tracking-wider text-ink-400">{t('fieldDistance')}</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={distanceKm}
              onChange={e => setDistanceKm(e.target.value)}
              placeholder="14"
              dir="ltr"
              className={field('distanceKm')}
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-2xs font-bold uppercase tracking-wider text-ink-400">{t('fieldNotes')}</span>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            dir="auto"
            className={field('notes')}
          />
        </label>

        {badField && <p className="text-xs text-accent-red-ink">{t('invalidField')}</p>}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button className="flex-1" disabled={saving || !date || !location.trim()} onClick={submit}>
            {t('post')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
