'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import {
  ArrowRight,
  MapPin,
  Calendar,
  Clock,
  Navigation,
  Users,
  ChevronDown,
  CheckCircle2,
  Circle,
  Package,
  HelpCircle,
  ListChecks,
  AlertCircle,
} from 'lucide-react';
import { useApi } from '@/lib/api';
import { authedFetch } from '@/lib/auth/authed-fetch';
import { Card, Button, EmptyState, LoadingBlock, Spinner, InsetSection, InsetRow } from '@/components/ui';
import { FeedAvatar } from '@/components/FeedAvatar';
import { BenchmarkLeaderboard } from '@/components/BenchmarkLeaderboard';
import { cn } from '@/lib/utils';
import type { EventKind } from '@/lib/events';

// ─── Types ──────────────────────────────────────────────────────────────────
// Mirrors the raw snake_case columns from GET /api/events/[id] (see
// supabase/migrations/055_events.sql) — the route returns the row as-is.

interface AgendaItem {
  time: string;
  title: string;
}

interface FaqItem {
  q: string;
  a: string;
}

interface EventRow {
  id: string;
  kind: EventKind;
  name: string;
  description: string | null;
  date: string;
  end_date: string | null;
  start_time: string | null;
  location: string;
  lat: number | null;
  lng: number | null;
  waze_url: string | null;
  distances: string[];
  race_class: string | null;
  website: string | null;
  agenda: AgendaItem[] | null;
  gear: string[] | null;
  faqs: FaqItem[] | null;
  capacity: number | null;
}

interface Participant {
  athleteId: string;
  name: string;
  avatarUrl: string | null;
  status: 'registered' | 'waitlisted';
  createdAt: string;
}

interface RegistrationsPayload {
  participants: Participant[];
  registeredCount: number;
  waitlistCount: number;
  capacity: number | null;
}

const KIND_STYLES: Record<EventKind, { bg: string; text: string }> = {
  race: { bg: 'bg-purple-500/15', text: 'text-purple-600' },
  camp: { bg: 'bg-band-2/15', text: 'text-band-2' },
  lecture: { bg: 'bg-band-3/15', text: 'text-band-3' },
  social: { bg: 'bg-pink-500/15', text: 'text-pink-600' },
  photo_shoot: { bg: 'bg-teal-500/15', text: 'text-teal-600' },
  sponsor: { bg: 'bg-indigo-500/15', text: 'text-indigo-600' },
  workout: { bg: 'bg-accent-600/15', text: 'text-accent-600' },
};

/**
 * Waze deep-link: an explicit `waze_url` always wins; otherwise derive one
 * from lat/lng. Returns null when neither exists, so the caller can omit the
 * button rather than render a broken link.
 */
function resolveWazeUrl(event: EventRow): string | null {
  if (event.waze_url) return event.waze_url;
  if (event.lat != null && event.lng != null) {
    return `https://waze.com/ul?ll=${event.lat},${event.lng}&navigate=yes`;
  }
  return null;
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const locale = useLocale();
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';
  const t = useTranslations('eventDetail');
  const tc = useTranslations('common');

  // Public read — no auth required, same convention as GET /api/events.
  const { data, error, isLoading } = useApi<{ event: EventRow }>(id ? `/api/events/${id}` : null);
  const event = data?.event ?? null;

  // Only real athlete accounts (not bare staff logins) can RSVP — the app's
  // convention is that an athlete's own id lives in localStorage once signed
  // in as a club member (see AttendanceRSVP for the same read).
  const [athleteId, setAthleteId] = useState('');
  useEffect(() => {
    setAthleteId(localStorage.getItem('athlete_id') || '');
  }, []);

  const [registrations, setRegistrations] = useState<RegistrationsPayload | null>(null);
  const [registrationsLoading, setRegistrationsLoading] = useState(true);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState(false);

  // Requires a real Supabase session JWT (requireSession server-side), so this
  // uses authedFetch rather than the plain SWR fetcher used for the public
  // event GET above.
  const loadRegistrations = useCallback(async () => {
    if (!id) return;
    try {
      const res = await authedFetch(`/api/events/${id}/registrations`);
      if (!res.ok) throw new Error('Failed to load registrations');
      setRegistrations(await res.json());
    } catch {
      // Leave `registrations` as-is; the participants section just shows its
      // empty/loading state and the RSVP action stays hidden until it resolves.
    } finally {
      setRegistrationsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadRegistrations();
  }, [loadRegistrations]);

  const myStatus = registrations?.participants.find((p) => p.athleteId === athleteId)?.status ?? null;

  const handleRegister = async () => {
    setActionPending(true);
    setActionError(false);
    try {
      const res = await authedFetch(`/api/events/${id}/register`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to register');
      await loadRegistrations();
    } catch {
      setActionError(true);
    } finally {
      setActionPending(false);
    }
  };

  const handleCancel = async () => {
    setActionPending(true);
    setActionError(false);
    try {
      const res = await authedFetch(`/api/events/${id}/register`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to cancel registration');
      await loadRegistrations();
    } catch {
      setActionError(true);
    } finally {
      setActionPending(false);
    }
  };

  if (isLoading) return <LoadingBlock className="min-h-[60vh]" />;

  if (error || !event) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <EmptyState
          icon={AlertCircle}
          title={t('notFound')}
          description={t('notFoundHint')}
          action={
            <Button variant="secondary" onClick={() => router.back()}>
              {tc('back')}
            </Button>
          }
        />
      </div>
    );
  }

  const kindStyle = KIND_STYLES[event.kind] || KIND_STYLES.race;
  const waze = resolveWazeUrl(event);
  const dateLabel = new Date(`${event.date}T00:00:00`).toLocaleDateString(dateLocale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const endDateLabel =
    event.end_date && event.end_date !== event.date
      ? new Date(`${event.end_date}T00:00:00`).toLocaleDateString(dateLocale, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : null;
  const timeLabel = event.start_time ? event.start_time.slice(0, 5) : null;

  const registeredParticipants = registrations?.participants.filter((p) => p.status === 'registered') ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 sm:py-6 space-y-4">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 min-h-[44px] px-2 -ms-2 text-sm text-ink-400 hover:text-ink-900 transition-colors"
      >
        <ArrowRight className="h-4 w-4" />
        {tc('back')}
      </button>

      {/* Hero */}
      <Card>
        <span className={cn('inline-block text-2xs font-bold px-2 py-0.5 rounded-md mb-2', kindStyle.bg, kindStyle.text)}>
          {t(`kinds.${event.kind}`)}
        </span>
        <h1 className="text-xl font-black text-ink-700" dir="auto">
          {event.name}
        </h1>

        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2 text-sm text-ink-500 flex-wrap">
            <Calendar className="h-4 w-4 text-ink-400 shrink-0" />
            <span>
              {dateLabel}
              {endDateLabel ? ` – ${endDateLabel}` : ''}
            </span>
            {timeLabel && (
              <span className="flex items-center gap-1.5 ms-1">
                <Clock className="h-4 w-4 text-ink-400 shrink-0" />
                <span className="tabular-nums">{timeLabel}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <MapPin className="h-4 w-4 text-ink-400 shrink-0" />
            <span dir="auto">{event.location}</span>
          </div>
        </div>

        {event.description && (
          <p className="mt-4 text-sm text-ink-500 leading-relaxed" dir="auto">
            {event.description}
          </p>
        )}

        {waze && (
          <a
            href={waze}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-brand-600 hover:text-brand-700 transition-colors"
          >
            <Navigation className="h-4 w-4" />
            {t('openInWaze')}
          </a>
        )}
      </Card>

      {/* Time-trial leaderboard — race events only (hidden when there are no
          results). Was races/page.tsx-only before the races→Calendar merge. */}
      {event.kind === 'race' && <BenchmarkLeaderboard />}

      {/* Agenda */}
      {event.agenda && event.agenda.length > 0 && (
        <Card variant="muted">
          <div className="flex items-center gap-2 mb-3">
            <ListChecks className="h-4 w-4 text-brand-600" />
            <h2 className="text-sm font-bold text-ink-700">{t('agendaTitle')}</h2>
          </div>
          <ol className="space-y-2.5">
            {event.agenda.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="text-xs font-bold text-brand-600 tabular-nums shrink-0 w-12">{item.time}</span>
                <span className="text-sm text-ink-700 flex-1" dir="auto">
                  {item.title}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* Gear checklist */}
      {event.gear && event.gear.length > 0 && <GearChecklist items={event.gear} title={t('gearTitle')} />}

      {/* Participants + RSVP */}
      <Card variant="muted">
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-4 w-4 text-brand-600" />
          <h2 className="text-sm font-bold text-ink-700">{t('participantsTitle')}</h2>
        </div>

        {registrationsLoading ? (
          <div className="flex justify-center py-4">
            <Spinner size={20} />
          </div>
        ) : !registrations || registeredParticipants.length === 0 ? (
          <EmptyState title={t('noParticipants')} className="py-4" />
        ) : (
          <>
            <div className="flex items-center -space-x-2 rtl:space-x-reverse mb-2">
              {registeredParticipants.slice(0, 8).map((p) => (
                <div key={p.athleteId} title={p.name} className="ring-2 ring-page rounded-full">
                  <FeedAvatar name={p.name} url={p.avatarUrl} className="w-8 h-8" />
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-400">
              <span className="font-bold text-ink-700">{registrations.registeredCount}</span> {t('registeredLabel')}
              {registrations.waitlistCount > 0 && (
                <span className="text-band-3 font-semibold ms-2">
                  +{registrations.waitlistCount} {t('waitlistedLabel')}
                </span>
              )}
            </p>
          </>
        )}

        {/* Capacity bar — same visual convention as the dashboard's weekly-volume
            goal bar (thin track, rounded, brand-color fill). */}
        {registrations?.capacity != null && (
          <div className="mt-3">
            <div className="w-full h-1.5 bg-page/50 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  registrations.registeredCount >= registrations.capacity ? 'bg-band-3' : 'bg-brand-600',
                )}
                style={{ width: `${Math.min(100, (registrations.registeredCount / registrations.capacity) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-2xs text-ink-400">
              {registrations.registeredCount}/{registrations.capacity} {t('registeredLabel')}
            </p>
          </div>
        )}

        {/* RSVP action — only rendered for real athlete accounts (coaches with
            no athlete row have nothing to register as). */}
        {athleteId && !registrationsLoading && (
          <div className="mt-4 pt-3 border-t border-page/40">
            {myStatus === 'registered' && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-accent-600/30 bg-accent-600/10 px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-sm font-bold text-accent-600">
                  <CheckCircle2 className="h-4 w-4" /> {t('youAreRegistered')}
                </span>
                <Button variant="ghost" size="sm" onClick={handleCancel} disabled={actionPending}>
                  {actionPending ? <Spinner size={16} /> : t('cancelRegistration')}
                </Button>
              </div>
            )}
            {myStatus === 'waitlisted' && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-band-3/30 bg-band-3/10 px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-sm font-bold text-band-3">
                  <Clock className="h-4 w-4" /> {t('youAreWaitlisted')}
                </span>
                <Button variant="ghost" size="sm" onClick={handleCancel} disabled={actionPending}>
                  {actionPending ? <Spinner size={16} /> : t('cancelRegistration')}
                </Button>
              </div>
            )}
            {!myStatus && (
              <Button variant="primary" className="w-full" onClick={handleRegister} disabled={actionPending}>
                {actionPending ? <Spinner size={16} /> : t('registerCta')}
              </Button>
            )}
            {actionError && <p className="mt-2 text-xs text-accent-red text-center">{t('actionError')}</p>}
          </div>
        )}
      </Card>

      {/* FAQ */}
      {event.faqs && event.faqs.length > 0 && <FaqAccordion items={event.faqs} title={t('faqTitle')} />}
    </div>
  );
}

// ─── Gear checklist ─────────────────────────────────────────────────────────
// Tap-to-check is local-only (no persistence, no backend field for it) — a
// personal packing aid, not shared state, so it intentionally resets on
// revisit rather than inventing a new API/column for it.
function GearChecklist({ items, title }: { items: string[]; title: string }) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <Card variant="muted">
      <div className="flex items-center gap-2 mb-3">
        <Package className="h-4 w-4 text-brand-600" />
        <h2 className="text-sm font-bold text-ink-700">{title}</h2>
      </div>
      <InsetSection className="mb-0">
        {items.map((item, i) => {
          const isChecked = checked.has(i);
          return (
            <InsetRow
              key={i}
              label={item}
              onClick={() => toggle(i)}
              trailing={
                isChecked ? (
                  <CheckCircle2 className="h-4 w-4 text-accent-600 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-ink-400 shrink-0" />
                )
              }
            />
          );
        })}
      </InsetSection>
    </Card>
  );
}

// ─── FAQ accordion ──────────────────────────────────────────────────────────
// No accordion primitive exists elsewhere in the codebase (checked
// components/ and components/ui/) — this is a small local one, styled to
// match the app's other expand/collapse rows (e.g. the races list's
// tap-to-expand card in src/app/dashboard/races/page.tsx).
function FaqAccordion({ items, title }: { items: FaqItem[]; title: string }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <Card variant="muted">
      <div className="flex items-center gap-2 mb-3">
        <HelpCircle className="h-4 w-4 text-brand-600" />
        <h2 className="text-sm font-bold text-ink-700">{title}</h2>
      </div>
      <InsetSection className="mb-0">
        {items.map((item, i) => {
          const isOpen = open.has(i);
          return (
            <Fragment key={i}>
              <InsetRow
                label={item.q}
                onClick={() => toggle(i)}
                trailing={<ChevronDown className={cn('h-4 w-4 text-ink-400 shrink-0 transition-transform', isOpen && 'rotate-180')} />}
              />
              {isOpen && (
                <div className="px-4 py-3 text-sm text-ink-500 leading-relaxed" dir="auto">
                  {item.a}
                </div>
              )}
            </Fragment>
          );
        })}
      </InsetSection>
    </Card>
  );
}
