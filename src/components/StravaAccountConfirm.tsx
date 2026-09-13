'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Activity, AlertTriangle } from 'lucide-react';
import { apiHeaders } from '@/lib/api';
import { formatTime } from '@/lib/academy/benchmark';

/**
 * One-time "is this your Strava?" confirmation, shown once the first sync has landed.
 *
 * Strava's authorize page offers *signup* to anyone who is not already signed in, so
 * a member who taps "connect Strava" without an active Strava session can create a
 * brand-new empty account and link that instead of the one holding their running
 * history. It fails silently: the connect succeeds, the pill says "connected", and
 * the only symptom is that no runs ever arrive — which reads as a broken app rather
 * than a wrong account. That is exactly how one member spent weeks with an empty
 * shell account linked while his real 21 km PRs sat on another one.
 *
 * A warning card that infers "this account looks empty" can only ever guess, because
 * an empty account also describes a genuinely new runner. So this asks instead, and
 * shows the athlete their own numbers as the evidence: the account name, how many
 * runs we found, and their fastest distances. Nobody needs the concept of an OAuth
 * mislink explained to them to answer "are these your runs?".
 *
 * Deliberately NOT part of the /join onboarding flow, though that is where it belongs
 * conceptually. At the moment of connect there are zero activities: the callback
 * triggers no sync, and the backfill arrives with /api/cron/sync (every 5 min, and
 * not at all between 21:00 and 02:00 UTC). A confirm step inside onboarding would
 * therefore be blank for everyone — either a spinner that sometimes never resolves,
 * or a panel people learn to tap past. Waiting for real data costs one dashboard
 * visit and makes the question answerable.
 *
 * Garmin is not covered on purpose: Garmin members type their own credentials, so
 * there is no equivalent "you just made a new account" trap.
 */

const CONFIRMED_KEY = 'strava_account_confirmed';

interface AccountCheck {
  linked: boolean;
  checkable: boolean;
  stravaAthleteId?: number;
  stravaName?: string | null;
  placeholderName?: boolean;
  hasActivities?: boolean;
  reason?: string;
}

interface Best {
  key: string;
  label: string;
  seconds: number | null;
}

export function StravaAccountConfirm() {
  const t = useTranslations('stravaConfirm');
  const [view, setView] = useState<null | 'confirm' | 'empty'>(null);
  const [name, setName] = useState<string | null>(null);
  const [runs, setRuns] = useState(0);
  const [bests, setBests] = useState<Best[]>([]);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    // Same staff test as ConnectDataSourcePopup's — a coach looking at the app is
    // not the person whose account this is about.
    const isStaff =
      localStorage.getItem('admin_session') === 'true' || !!localStorage.getItem('coach_email');
    if (isStaff) return;
    if (localStorage.getItem(CONFIRMED_KEY) === '1') return;

    const id = localStorage.getItem('athlete_id');
    if (!id) return;

    let mounted = true;
    (async () => {
      const headers = await apiHeaders();
      const get = async (url: string) => {
        const res = await fetch(url, { headers });
        return res.ok ? res.json() : null;
      };

      // No Strava on file: nothing to confirm, and no flag written — if they
      // connect one later this still has a chance to ask.
      const me = await get(`/api/athletes/me?id=${encodeURIComponent(id)}`);
      if (!mounted || !me?.hasStrava) return;

      const check: AccountCheck | null = await get(
        `/api/strava/account-check?athleteId=${encodeURIComponent(id)}`,
      );
      // checkable === false means we could not reach Strava (expired refresh
      // token, API error). Staying silent is right: an unanswerable question
      // about someone's account is worse than no question.
      if (!mounted || !check?.linked || check.checkable !== true) return;

      setAthleteId(id);
      setName(check.placeholderName ? null : check.stravaName || null);

      if (check.hasActivities === false) {
        setView('empty');
        return;
      }

      const prs = await get(`/api/athletes/prs?athleteId=${encodeURIComponent(id)}`);
      if (!mounted) return;
      const total = prs?.totalRuns ?? 0;
      // Strava has runs but we hold none yet — the first sync simply hasn't run.
      // Ask on a later visit rather than showing an empty list as evidence.
      if (total === 0) return;

      setRuns(total);
      setBests((prs?.distanceBests || []).filter((b: Best) => b.seconds != null).slice(0, 3));
      setView('confirm');
    })().catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  // Keep the connect-a-data-source nudge out of the way for this session, so a
  // Strava-only member doesn't get two modals stacked. Session-scoped and not
  // `forever`, so suppressing it here can never lose that prompt permanently.
  useEffect(() => {
    if (view) sessionStorage.setItem('connect_data_source_dismissed_session', '1');
  }, [view]);

  const confirm = useCallback(() => {
    localStorage.setItem(CONFIRMED_KEY, '1');
    setView(null);
  }, []);

  const switchAccount = useCallback(async () => {
    if (!athleteId) return;
    setSwitching(true);
    try {
      const headers = await apiHeaders();
      // switch=1 → approval_prompt=force. Without it Strava skips its own screen
      // for an already-authorised app and drops them back into the same wrong
      // account, so the retry looks like it did nothing.
      const res = await fetch(
        `/api/strava?athleteId=${encodeURIComponent(athleteId)}&switch=1`,
        { headers },
      );
      const data = await res.json();
      if (data?.authUrl) window.location.href = data.authUrl;
      else setSwitching(false);
    } catch {
      setSwitching(false);
    }
  }, [athleteId]);

  if (!view) return null;

  const empty = view === 'empty';
  const account = name || t('unnamedAccount');

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-card rounded-card border border-page p-6 w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div
            className={`w-14 h-14 rounded-full flex items-center justify-center mb-4 ${
              empty ? 'bg-amber-500/20' : 'bg-brand-600/20'
            }`}
          >
            {empty ? (
              <AlertTriangle className="h-7 w-7 text-amber-600" />
            ) : (
              <Activity className="h-7 w-7 text-brand-600" />
            )}
          </div>

          <h2 className="text-lg font-bold text-ink-700">{t(empty ? 'emptyTitle' : 'title')}</h2>

          {empty ? (
            <p className="text-sm text-ink-400 mt-2 leading-relaxed">
              {t('emptyBody', { account })}
            </p>
          ) : (
            <>
              <p className="text-sm text-ink-400 mt-2 leading-relaxed">
                {t('body', { account, runs })}
              </p>
              {bests.length > 0 && (
                <div className="mt-4 w-full space-y-1.5">
                  {bests.map((b) => (
                    <div
                      key={b.key}
                      className="flex items-center justify-between bg-page/50 rounded-xl px-3 py-2"
                    >
                      <span className="text-sm font-semibold text-ink-700">{b.label}</span>
                      {/* Own <bdi> so the surrounding RTL run can't reorder the clock. */}
                      <bdi dir="ltr" className="text-sm font-black text-ink-700 tabular-nums">
                        {formatTime(b.seconds!)}
                      </bdi>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* The safe answer is the prominent one in each case: an account with runs
              in it is almost always the right account, an account with none almost
              never is. */}
          {empty ? (
            <>
              <button
                onClick={switchAccount}
                disabled={switching}
                className="w-full mt-5 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white font-medium px-4 py-3 rounded-lg transition-colors"
              >
                {t('wrongAccount')}
              </button>
              <button
                onClick={confirm}
                className="w-full mt-2 text-ink-400 hover:text-ink-900 text-sm py-2 transition-colors"
              >
                {t('imNew')}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={confirm}
                className="w-full mt-5 bg-brand-600 hover:bg-brand-700 text-white font-medium px-4 py-3 rounded-lg transition-colors"
              >
                {t('yes')}
              </button>
              <button
                onClick={switchAccount}
                disabled={switching}
                className="w-full mt-2 text-ink-400 hover:text-ink-900 disabled:opacity-60 text-sm py-2 transition-colors"
              >
                {t('wrongAccount')}
              </button>
            </>
          )}

          <p className="mt-3 text-2xs text-ink-400 leading-relaxed">{t('keepsHistory')}</p>
        </div>
      </div>
    </div>
  );
}
