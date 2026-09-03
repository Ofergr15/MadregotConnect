'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Calendar, MessageSquare, Flame, ClipboardList, Users, Megaphone, PartyPopper, BellRing, Send, RefreshCw, Globe } from 'lucide-react';
import { useApi, apiHeaders } from '@/lib/api';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { Switch } from '@/components/ui';
import { subscribeToPush } from '@/lib/pwa';
import { logClient } from '@/lib/client-log';

type Category = 'workouts' | 'coach' | 'achievements' | 'program' | 'teammates' | 'news' | 'events';
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
const ROWS: { key: Category; icon: typeof Calendar; bg: string }[] = [
  { key: 'workouts', icon: Calendar, bg: 'bg-brand-600' },
  { key: 'coach', icon: MessageSquare, bg: 'bg-band-2' },
  { key: 'achievements', icon: Flame, bg: 'bg-accent-600' },
  { key: 'program', icon: ClipboardList, bg: 'bg-band-3' },
  { key: 'teammates', icon: Users, bg: 'bg-band-3' },
  { key: 'news', icon: Megaphone, bg: 'bg-accent-red' },
  { key: 'events', icon: PartyPopper, bg: 'bg-violet-500' },
];

// Per-user notification preferences — each athlete chooses which categories of
// push they receive. Optimistic toggle; saves to /api/athletes/notification-prefs.
// Hidden until we know the athleteId. Degrades gracefully pre-migration (the API
// returns all-on defaults and PUT is a no-op 501, so toggles simply won't stick).
export function NotificationPrefs({ athleteId }: { athleteId: string }) {
  const t = useTranslations('notificationPrefs');
  const { data, mutate } = useApi<{ prefs: Prefs }>(
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
      setTestResult(
        total === 0
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
      {permission && permission !== 'granted' && (
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
        {ROWS.map(({ key, icon, bg }) => {
          const on = prefs[key];
          const label = t(`categories.${key}`);
          return (
            <InsetRow
              key={key}
              icon={icon}
              iconBg={bg}
              label={label}
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
