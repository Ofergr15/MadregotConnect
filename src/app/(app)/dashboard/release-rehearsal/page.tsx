'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { useIsSuperUser } from '@/lib/impersonation';
import { APP_VERSION } from '@/lib/version';
import type { ShownNote, WhatsNewRelease } from '@/lib/release-notes';
import { composeWhatsNew } from '@/lib/whats-new/evening';
import { STAGE } from '@/lib/update-flow';
import { UpdateSheet } from '@/components/update/UpdateSheet';
import { UpdateSplash } from '@/components/update/UpdateSplash';
import { WhatsNewSheet } from '@/components/whats-new/WhatsNewSheet';
import { WhatsNewStory } from '@/components/whats-new/WhatsNewStory';

// ═════════════════════════════════════════════════════════════════════════════
// THE RELEASE REHEARSAL — the evening's release as a member will live it, before
// it is approved. Super user only.
//
// The real feed runs in a frame underneath (lib/framed.ts keeps its own update
// check and What's new from running in there), and the steps are the real
// components on top of it: the alert, the app opening, "New version · Update
// now", the update's splash, the "updated" toast, and What's new as the evening
// release composes it (lib/whats-new/evening.ts): the full-screen tour, with
// tonight's `pending` notes in it. A button tapped in it opens its page in the frame.
//
// Nothing is sent, applied or marked seen: the sheet's button only moves to the
// next step, and the ledger is never touched.
// ═════════════════════════════════════════════════════════════════════════════

const STEPS = ['alert', 'open', 'sheet', 'updating', 'toast', 'wn', 'after'] as const;
type Step = (typeof STEPS)[number];
/** What an app that was closed never sees: the tap already loads the new version. */
const ONLY_IF_OPEN: Step[] = ['sheet', 'updating', 'toast'];
const SPLASH_KEY = 'app_splash_shown';

/** The version the evening would announce: one patch above what runs now. */
function nextVersion(v: string): string {
  const p = v.split('.').map(Number);
  return p.length === 3 && p.every(Number.isFinite) ? `${p[0]}.${p[1]}.${p[2] + 1}` : v;
}

export default function ReleaseRehearsalPage() {
  const t = useTranslations('rehearsal');
  const tu = useTranslations('update');
  const locale = useLocale();
  const isSuper = useIsSuperUser();
  const { data } = useApi<{ pending: ShownNote[]; releases: WhatsNewRelease[] }>(isSuper ? '/api/whats-new' : null);
  const [closed, setClosed] = useState(false);
  const [i, setI] = useState(0);
  const [frameSrc, setFrameSrc] = useState('/feed');
  const [frameKey, setFrameKey] = useState(0);
  const [level, setLevel] = useState<number>(STAGE.tapped);
  const [splashOut, setSplashOut] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [mounted, setMounted] = useState(false);
  // A tap on the bar is outside the What's new drawer, which reads it as a close.
  const onBar = useRef(false);
  useEffect(() => {
    // Opened from a real push (?from=push): that push was the alert, so start at the open.
    if (new URLSearchParams(window.location.search).get('from') === 'push') setI(1);
    setMounted(true);
  }, []);

  const version = nextVersion(APP_VERSION);
  const steps = useMemo(() => STEPS.filter(s => !(closed && ONLY_IF_OPEN.includes(s))), [closed]);
  const step: Step = steps[Math.min(i, steps.length - 1)];

  // Tonight's What's new, as the evening composes it for a member: the two
  // headlines, then everything since the last one, tonight's pending notes on top.
  const { entries, more } = useMemo(() => composeWhatsNew(
    [
      { id: -1, released_at: new Date().toISOString(), app_version: version, notes: data?.pending ?? [] },
      ...(data?.releases ?? []),
    ],
    version,
    true,
  ), [data, version]);

  const go = (to: number) => setI(Math.max(0, Math.min(steps.length - 1, to)));
  const next = () => go(steps.indexOf(step) + 1);
  const back = () => go(steps.indexOf(step) - 1);

  // Each step sets its own scene, so going back into one replays it.
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const later = (ms: number, f: () => void) => { timers.current.push(setTimeout(f, ms)); };
    const ahead = () => setI(n => n + 1);
    // Only 'after' shows the page a row opened; stepping back returns to the feed.
    if (step !== 'after') setFrameSrc('/feed');
    if (step === 'open') {
      // The frame's own opening splash, replayed: it shows once per session.
      sessionStorage.removeItem(SPLASH_KEY);
      setFrameKey(k => k + 1);
      later(2600, ahead);
    }
    if (step === 'updating') {
      setSplashOut(false);
      setLevel(STAGE.tapped);
      later(350, () => setLevel(STAGE.asked));
      later(1200, () => setLevel(STAGE.handover));
      // The reload into the new version, under the splash.
      later(1700, () => setFrameKey(k => k + 1));
      later(2300, () => setLevel(STAGE.done));
      later(2900, () => setSplashOut(true));
      later(3400, ahead);
    }
    if (step === 'toast') later(3300, ahead);
    return () => timers.current.forEach(clearTimeout);
  }, [step]);

  // A row in What's new opens its page in the frame, not this one.
  useEffect(() => {
    if (step !== 'wn') return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('[role="dialog"] a[href]');
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      setFrameSrc(a.getAttribute('href') || '/feed');
      setFrameKey(k => k + 1);
      go(steps.indexOf('after'));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  });

  if (!isSuper) {
    return <p className="px-4 py-16 text-center text-13 text-ink-400">{t('superOnly')}</p>;
  }

  // On <body>, not in the page: the app's scroll container is a containing
  // block for `fixed`, and its header draws over anything inside it.
  if (!mounted) return null;
  const n = steps.indexOf(step);
  return createPortal(
    <>
      <iframe
        key={frameKey}
        src={frameSrc}
        title={t('frameTitle')}
        className="fixed inset-0 z-[250] h-[100dvh] w-full border-0 bg-page"
      />

      {step === 'alert' && (
        <div
          className="fixed inset-0 z-[440] text-center text-white"
          style={{ background: 'linear-gradient(160deg,#28305e,#6a3d8f 55%,#d9826b)' }}
        >
          <p dir="ltr" className="mt-[max(110px,calc(env(safe-area-inset-top)+80px))] text-[84px] font-semibold leading-none tracking-tight">20:00</p>
          <p className="mt-1.5 text-lg font-semibold opacity-90">{new Date().toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Jerusalem' })}</p>
          <button
            type="button"
            onClick={next}
            className="mx-3 mt-16 flex w-[calc(100%-24px)] items-center gap-2.5 rounded-[22px] bg-white/85 px-3.5 py-3 text-start text-ink-900 backdrop-blur-xl active:opacity-80"
          >
            <img src="/images/logo.png" alt="" width={38} height={38} className="h-[38px] w-[38px] shrink-0 rounded-[9px] bg-white" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold">{t('pushTitle')}</span>
              <span className="block text-sm">{t('pushBody')}</span>
            </span>
            <span className="self-start text-xs text-ink-500">{t('now')}</span>
          </button>
        </div>
      )}

      {step === 'sheet' && (
        <UpdateSheet content={{ version, starred: [], rest: [] }} busy={false} onUpdate={next} />
      )}
      {step === 'updating' && (
        <UpdateSplash phase={splashOut ? 'out' : 'on'} target={level} caption={tu('updatingTo', { version })} />
      )}
      {step === 'toast' && (
        <div
          role="status"
          className="mc-update-toast fixed inset-x-3.5 bottom-[calc(22px+env(safe-area-inset-bottom))] z-[430] flex items-center gap-2.5 rounded-2xl bg-ink-900 px-3.5 py-3 text-[13px] text-white shadow-lg"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#34c759] text-xs">✓</span>
          <span>{tu('updated', { version })}</span>
        </div>
      )}
      {step === 'wn' && entries.some(e => e.cards?.length) && (
        // Under the bar, which keeps the top 56px.
        <WhatsNewStory entries={entries} more={more} version={version} onClose={next} offsetTop={56} />
      )}
      {step === 'wn' && entries.length > 0 && !entries.some(e => e.cards?.length) && (
        <WhatsNewSheet
          open
          onOpenChange={(o) => { if (!o && !onBar.current) next(); }}
          entries={entries}
          newSlugs={entries.map(e => e.slug)}
          more={more}
        />
      )}
      {step === 'wn' && data && entries.length === 0 && (
        <div className="fixed inset-x-3 bottom-[calc(96px+env(safe-area-inset-bottom))] z-[440] rounded-card bg-card p-4 text-center shadow-lg">
          <p className="text-sm font-bold text-ink-900">{t('noStarsTitle')}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">{t('noStarsBody')}</p>
          <Link href="/dashboard/whats-new" className="mt-3 inline-block text-sm font-bold text-brand-600">{t('noStarsLink')}</Link>
        </div>
      )}

      <div
        // pointer-events-auto: the modal drawer turns them off on <body>.
        onPointerDownCapture={() => { onBar.current = true; setTimeout(() => { onBar.current = false; }, 400); }}
        className="pointer-events-auto fixed inset-x-2 top-[calc(env(safe-area-inset-top)+6px)] z-[470] flex items-center gap-1 rounded-2xl bg-ink-900/85 p-1 text-white shadow-lg backdrop-blur"
      >
        <button type="button" onClick={back} disabled={n === 0} aria-label={t('back')} className="flex h-10 w-10 items-center justify-center rounded-xl active:bg-white/10 disabled:opacity-30">
          <ChevronRight className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[13px] font-bold">{t(`step.${step}`)}</p>
          <p className="text-2xs tabular-nums text-white/60"><bdi dir="ltr">{n + 1}/{steps.length}</bdi></p>
        </div>
        <button type="button" onClick={next} disabled={n === steps.length - 1} aria-label={t('next')} className="flex h-10 w-10 items-center justify-center rounded-xl active:bg-white/10 disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => { setClosed(c => !c); setI(0); }}
          className={cn('h-10 shrink-0 rounded-xl px-2.5 text-2xs font-bold', closed ? 'bg-white text-ink-900' : 'bg-white/10')}
        >
          {closed ? t('modeClosed') : t('modeOpen')}
        </button>
        <Link href="/dashboard/whats-new" aria-label={t('exit')} className="flex h-10 w-10 items-center justify-center rounded-xl active:bg-white/10">
          <X className="h-5 w-5" />
        </Link>
      </div>
    </>,
    document.body,
  );
}
