'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Calendar, MessageSquare, Flame, ClipboardList, Users, Megaphone, PartyPopper, BellRing, Send, RefreshCw, Globe, ShieldCheck, Share, ExternalLink, BellOff } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { Switch } from '@/components/ui';
import { isInAppBrowser, isIosDevice, isStandalone, subscribeToPush } from '@/lib/pwa';
import { pushEnvironment, type PushEnvironment } from '@/lib/push-environment';
import { logClient } from '@/lib/client-log';

type Category = 'workouts' | 'coach' | 'achievements' | 'program' | 'teammates' | 'news' | 'events' | 'management';
type Language = 'he' | 'en';
type Prefs = Record<Category, boolean> & { language?: Language };

// Each language named in itself, never translated — the same reason the section
// header below stays bilingual: someone stuck in a language they can't read has
// to be able to recognise their own.
const LANGUAGES: { key: Language; label: string }[] = [
  { key: 'he', label: 'עברית' },
  { key: 'en', label: 'English' },
];

// The UI's language is a cookie (NEXT_LOCALE, read by next-intl per request);
// the notification language is a saved athlete preference, because the crons and
// sync jobs that send almost every push have no request and therefore no cookie.
// One control has to write both, or picking English would translate the app and
// leave every notification in Hebrew.
function readLocaleCookie(): Language {
  return /NEXT_LOCALE=en/.test(document.cookie) ? 'en' : 'he';
}

// The toggleable categories, with a colored glyph, matching the push categories
// in src/lib/push.ts. Labels come from messages/{he,en}.json under
// notificationPrefs.categories — keyed by the same category name, so the two
// can't drift apart.
// `staffOnly` rows are hidden from an athlete: nothing sends them a management
// alert, so the toggle would be a control over nothing. `isStaff` comes from the
// prefs API (derived from the athlete's role server-side) rather than being
// guessed here, so this screen and the send path agree on who counts as staff.
const ROWS: { key: Category; icon: typeof Calendar; bg: string; staffOnly?: boolean }[] = [
  { key: 'workouts', icon: Calendar, bg: 'bg-brand-600' },
  { key: 'coach', icon: MessageSquare, bg: 'bg-band-2' },
  { key: 'achievements', icon: Flame, bg: 'bg-accent-600' },
  { key: 'program', icon: ClipboardList, bg: 'bg-band-3' },
  { key: 'teammates', icon: Users, bg: 'bg-band-3' },
  { key: 'news', icon: Megaphone, bg: 'bg-accent-red' },
  { key: 'events', icon: PartyPopper, bg: 'bg-violet-500' },
  { key: 'management', icon: ShieldCheck, bg: 'bg-ink-700', staffOnly: true },
];

// Per-user notification preferences — each athlete chooses which categories of
// push they receive. Optimistic toggle; saves to /api/athletes/notification-prefs.
// Hidden until we know the athleteId. Degrades gracefully pre-migration (the API
// returns all-on defaults and PUT is a no-op 501, so toggles simply won't stick).
export function NotificationPrefs({ athleteId }: { athleteId: string }) {
  const t = useTranslations('notificationPrefs');
  const tInstall = useTranslations('install');
  const { data, mutate } = useApi<{ prefs: Prefs; isStaff?: boolean }>(
    athleteId ? `/api/athletes/notification-prefs?athleteId=${encodeURIComponent(athleteId)}` : null,
    // Disabled specifically here: this is what actually caused the "toggle it
    // off and it turns back on" bug — a revalidateOnFocus refetch racing a
    // slow PUT (e.g. backgrounding right after tapping) could land first and
    // silently overwrite the toggle with the pre-toggle value. This data
    // doesn't change from another device/session in a way that benefits from
    // focus-revalidation, so removing the race source entirely is simpler
    // and safer than trying to out-sequence it.
    { revalidateOnFocus: false },
  );
  const [saving, setSaving] = useState<Category | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const prefs = data?.prefs;

  // Push permission can be revoked (iOS Settings → Notifications → off) or
  // never granted in the first place — PushOptIn only ever offers to
  // subscribe opportunistically (right after workout feedback, or while
  // waiting for approval), so without this there is no way back in for
  // someone whose permission got reset outside those two moments.
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  // WHY push can't work here, when it can't — and it is never the permission.
  //
  // Reported 2026-09-08 from an iPhone on iOS 18.7, in a Safari TAB: "send a
  // test notification" answered "no push subscription on this device — try
  // 'Fix notifications on this device'", and the repair row it named was not on
  // her screen. Nothing on that screen could have helped her. iOS exposes
  // PushManager only to an app launched from the home screen, so in a tab
  // `Notification` does not exist at all — which left `permission` null, and
  // both the enable row (`permission && permission !== 'granted'`) and the
  // repair row (`permission === 'granted'`) render on a non-null permission.
  // The one instruction the screen gave pointed at the one row it had hidden.
  //
  // So the reason is computed once, up front, and the screen says it out loud.
  // Null until the effect runs: every probe reads window, so a server render has
  // no answer and must not claim one.
  const [pushEnv, setPushEnv] = useState<PushEnvironment | null>(null);
  useEffect(() => {
    setPushEnv(pushEnvironment({
      inAppBrowser: isInAppBrowser(),
      ios: isIosDevice(),
      standalone: isStandalone(),
      pushApiAvailable:
        typeof Notification !== 'undefined' &&
        'serviceWorker' in navigator &&
        'PushManager' in window,
    }));
  }, []);
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  useEffect(() => {
    if (typeof Notification === 'undefined') return;
    const refresh = () => setPermission(Notification.permission);
    refresh();
    // The iOS system permission prompt backgrounds this page while it's up —
    // re-check on return instead of trusting enablePush's own post-await read,
    // since that read can land before iOS has actually applied the decision.
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const enablePush = async () => {
    setEnabling(true);
    setEnableError(null);
    try {
      const result = await subscribeToPush(athleteId);
      if (typeof Notification !== 'undefined') setPermission(Notification.permission);
      // Visible on the device itself, not just in a console nobody's looking
      // at — a silent failure here previously meant no way to tell what
      // actually went wrong without production log access.
      if (!result.ok) setEnableError(result.error || 'unknown_error');
    } finally {
      setEnabling(false);
    }
  };

  // Force a genuinely NEW subscription for this device. Offered even when
  // permission is already 'granted', because that's exactly the state that used
  // to be unrecoverable: iOS can break a subscription while permission stays
  // granted, and every path here bailed out the moment it saw 'granted'.
  //
  // This deliberately uses subscribeToPush (unsubscribe, then subscribe) rather
  // than ensurePushSubscription's refresh-in-place. Measured on a real device:
  // four endpoints, three of them known-dead, all returned 201 to 52
  // consecutive sends and displayed nothing. Apple keeps accepting pushes for
  // an endpoint that is still registered but no longer reaches a live service
  // worker, and getSubscription() keeps handing that endpoint back — so
  // re-posting it repairs nothing. Only discarding it and minting a new one
  // guarantees a live endpoint. subscribeToPush also reports the endpoint it
  // discarded, so the dead row is deleted instead of lingering as a ghost.
  //
  // requestPermission() inside it resolves immediately (no prompt) when
  // permission is already granted.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);
  const refreshSub = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const result = await subscribeToPush(athleteId);
      logClient('push-resubscribe-manual', { ...result });
      setRefreshResult(
        result.ok
          ? t('repairOk')
          : t('repairFailed', { error: result.error || 'unknown' }),
      );
    } finally {
      setRefreshing(false);
    }
  };

  // Send a real push to this athlete's own devices and report the count. Two
  // taps to answer "are my notifications actually working?" — previously
  // unanswerable from the device, since the in-app history showed every
  // notification as delivered regardless of what the phone received.
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId }),
      });
      if (!res.ok) {
        setTestResult(t('serverError', { status: res.status }));
        return;
      }
      const { sent, total, confirmed } = (await res.json()) as {
        sent: number;
        total: number;
        confirmed?: number;
      };
      // `confirmed` is the only real evidence — see /api/push/receipt. A
      // confirmed 0 is reported as unconfirmed rather than failed on purpose: a
      // locked or offline phone can miss the receipt window and still show the
      // notification a moment later.
      // Every "try X" message names the repair row by passing its own label in,
      // so renaming that row can't leave these instructions pointing at a row
      // that no longer exists under that name.
      const repair = t('repair');
      // A zero total on a device that CANNOT hold a subscription is not the same
      // answer as a zero total on one that can. Pointing the first case at the
      // repair row is what made this report: the row is hidden there, and
      // re-subscribing is impossible anyway.
      setTestResult(
        total === 0 && pushEnv && pushEnv !== 'ready'
          ? t(`env.${pushEnv}Short`)
          : total === 0
          ? t('noSubscription', { repair })
          : sent === 0
            ? t('sentNone', { total, repair })
            : confirmed && confirmed > 0
              ? t('sentConfirmed', { confirmed, total })
              : t('sentUnconfirmed', { sent, total, repair }),
      );
    } catch (err) {
      setTestResult(t('requestFailed', { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setTesting(false);
    }
  };

  // Which language is shown as selected. An athlete who has never picked one has
  // no saved `language`, so fall back to the cookie the UI is already using —
  // showing 'he' there would claim a choice they never made, and would read as
  // wrong to anyone whose browser put them in English via Accept-Language.
  const [cookieLocale, setCookieLocale] = useState<Language | null>(null);
  useEffect(() => setCookieLocale(readLocaleCookie()), []);
  const language: Language | null = prefs?.language ?? cookieLocale;

  const [savingLanguage, setSavingLanguage] = useState<Language | null>(null);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const chooseLanguage = async (next: Language) => {
    if (next === language) return;
    setSavingLanguage(next);
    setLanguageError(null);
    try {
      const res = await fetch('/api/athletes/notification-prefs', {
        method: 'PUT',
        headers: await apiHeaders(true),
        body: JSON.stringify({ athleteId, language: next }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        setLanguageError(t('serverErrorBody', { status: res.status, body: body.slice(0, 200) }));
        return;
      }
      // Only now switch the UI: the cookie change forces a reload, which would
      // abandon the request above mid-flight and leave the app in English while
      // every notification stayed in Hebrew — the exact split this row exists to
      // prevent.
      document.cookie = `NEXT_LOCALE=${next};path=/;max-age=${60 * 60 * 24 * 365}`;
      window.location.reload();
    } catch (err) {
      setLanguageError(t('requestFailed', { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setSavingLanguage(null);
    }
  };

  const toggle = async (key: Category) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    const actionId = crypto.randomUUID();
    setSaving(key);
    setSaveError(null);
    mutate({ prefs: next }, false); // optimistic
    // Logged before the real request so we have server-side proof the tap
    // happened even if the PUT below never leaves the device (the exact
    // silent-drop failure mode we've been chasing all night on real iOS).
    logClient('notif-toggle-attempt', { actionId, category: key, enabled: next[key] });
    try {
      const res = await fetch('/api/athletes/notification-prefs', {
        method: 'PUT',
        // apiHeaders supplies the bearer token the route now requires. This PUT
        // used to send no credentials at all, which is precisely why the route
        // could only "enforce" ownership by trusting the athleteId in the body.
        headers: { ...(await apiHeaders(true)), 'x-action-id': actionId },
        body: JSON.stringify({ athleteId, category: key, enabled: next[key] }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        setSaveError(t('serverErrorBody', { status: res.status, body: body.slice(0, 200) }));
        logClient('notif-toggle-server-error', { actionId, status: res.status, body: body.slice(0, 200) });
        mutate(); // revalidate → roll back on failure/501
      } else {
        logClient('notif-toggle-ok', { actionId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(t('requestFailed', { message }));
      logClient('notif-toggle-client-throw', { actionId, message });
      mutate();
    } finally {
      setSaving(null);
    }
  };

  if (!athleteId || !prefs) return null;

  return (
    // No dir of its own: <html dir> already follows the locale (see
    // src/app/layout.tsx), and forcing rtl here left the English version of this
    // screen — the very screen where English is chosen — laid out right-to-left.
    <div>
      {pushEnv && pushEnv !== 'ready' && (
        <>
          <InsetSection header={t('pushHeader')}>
            <InsetRow
              icon={pushEnv === 'installFirst' ? Share : pushEnv === 'inAppBrowser' ? ExternalLink : BellOff}
              iconBg={pushEnv === 'unsupported' ? 'bg-ink-300' : 'bg-accent-red'}
              label={t(`env.${pushEnv}Title`)}
            />
          </InsetSection>
          {/* Below the row, not in its `sublabel`: InsetRow truncates both of its
              lines to one, and the explanation is the part that has to be read
              in full — this row exists precisely because the one-line version of
              it sent somebody chasing a control that wasn't there. */}
          <p className="px-4 pb-2 -mt-1 text-xs text-ink-400" dir="auto">{t(`env.${pushEnv}Body`)}</p>
          {/* The Share-sheet steps, spelled out, because iOS has no install
              prompt to offer and no way to report that the icon was added. Same
              three steps the first-run install screen gives — read from the
              `install` namespace rather than copied, so the two can't drift. */}
          {pushEnv === 'installFirst' && (
            <ol className="px-4 pb-3 -mt-1 space-y-1 text-xs text-ink-400 list-decimal list-inside" dir="auto">
              <li>{tInstall('iosStep1')}</li>
              <li>{tInstall('iosStep2')}</li>
              <li>{tInstall('iosStep3')}</li>
            </ol>
          )}
        </>
      )}
      {pushEnv === 'ready' && permission && permission !== 'granted' && (
        <InsetSection header={t('pushHeader')}>
          <InsetRow
            icon={BellRing}
            iconBg="bg-accent-red"
            label={enabling ? t('enabling') : t('enable')}
            sublabel={
              enableError ? t('enableError', { error: enableError })
                : permission === 'denied' ? t('permissionDenied')
                : t('notEnabledHere')
            }
            onClick={permission === 'denied' ? undefined : enablePush}
          />
        </InsetSection>
      )}
      {/* Bilingual header and labels on purpose: this is the one row someone who
          can't read the current language still has to be able to find. */}
      <InsetSection header={t('languageHeader')}>
        {LANGUAGES.map(({ key, label }) => (
          <InsetRow
            key={key}
            icon={Globe}
            iconBg={key === 'he' ? 'bg-indigo-500' : 'bg-teal-500'}
            label={label}
            sublabel={key === language ? t('languageActive') : undefined}
            value={savingLanguage === key ? '…' : key === language ? '✓' : undefined}
            valueSuccess={key === language}
            onClick={savingLanguage || key === language ? undefined : () => chooseLanguage(key)}
          />
        ))}
      </InsetSection>
      {languageError && (
        <p className="px-4 pb-2 text-xs text-accent-red" dir="auto">{languageError}</p>
      )}
      {/* Always available — a granted permission is no proof of a live
          subscription, so these two rows are the only self-service way to tell
          a working device from a silently dead one. */}
      <InsetSection header={t('testHeader')}>
        <InsetRow
          icon={Send}
          iconBg="bg-accent-600"
          label={testing ? t('sending') : t('sendTest')}
          sublabel={testResult || t('sendTestHint')}
          onClick={testing ? undefined : sendTest}
        />
        {permission === 'granted' && (
          <InsetRow
            icon={RefreshCw}
            iconBg="bg-band-2"
            label={refreshing ? t('repairing') : t('repair')}
            sublabel={refreshResult || t('repairHint')}
            onClick={refreshing ? undefined : refreshSub}
          />
        )}
      </InsetSection>
      <InsetSection header={t('categoriesHeader')}>
        {ROWS.filter((r) => !r.staffOnly || data?.isStaff).map(({ key, icon, bg, staffOnly }) => {
          const on = prefs[key];
          const label = t(`categories.${key}`);
          return (
            <InsetRow
              key={key}
              icon={icon}
              iconBg={bg}
              label={label}
              // Only the management row is explained: the others say what they
              // are in their own label, but "running the club" needs to name the
              // four things it actually covers before anyone will trust it enough
              // to leave it on.
              sublabel={staffOnly ? t('managementHint') : undefined}
              trailing={<Switch checked={on} onChange={() => toggle(key)} disabled={saving === key} activeColor="bg-accent-600" ariaLabel={label} />}
            />
          );
        })}
      </InsetSection>
      {/* A failed toggle was set into state and then never rendered, so the
          optimistic switch just flicked back with no explanation. */}
      {saveError && (
        <p className="px-4 pb-2 text-xs text-accent-red" dir="auto">{saveError}</p>
      )}
    </div>
  );
}
