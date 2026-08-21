'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FlaskConical, Loader2, MessageCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase/client';

const TEST_ACCOUNTS = [
  { label: 'Test Runner', email: 'test-runner@madregot.local' },
  { label: 'Test Coach',  email: 'test-coach@madregot.local' },
] as const;

/** Seeded in supabase/migrations/049_run_chat.sql */
const TEST_ACTIVITY_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

type StravaAthlete = {
  id: string;
  name: string;
  email: string;
  strava_athlete_id: number | null;
};

function DevBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stravaAthletes, setStravaAthletes] = useState<StravaAthlete[]>([]);
  const openRunChatActivityId = pathname.match(/^\/dashboard\/run-chat\/([^/]+)$/)?.[1] || null;

  const loadStravaAthletes = async () => {
    try {
      const res = await fetch('/api/dev/strava-athletes');
      if (!res.ok) return;
      const { athletes } = (await res.json()) as { athletes: StravaAthlete[] };
      setStravaAthletes(athletes ?? []);
    } catch {
      // Dev-only helper — ignore
    }
  };

  useEffect(() => {
    void loadStravaAthletes();
  }, []);

  const switchTo = async (body: { email?: string; athleteId?: string }, key: string) => {
    setLoading(key);
    setError(null);
    try {
      const res = await fetch('/api/dev/test-signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const { url, error: apiError } = await res.json();
      if (apiError) throw new Error(apiError);
      window.location.href = url;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(null);
    }
  };

  const stravaLogin = async () => {
    setLoading('strava-oauth');
    setError(null);
    try {
      // Clear Test Runner session first — otherwise /auth/resolve keeps the old athlete_id.
      const { clearLocalIdentity } = await import('@/lib/auth/clear-local-identity');
      await clearLocalIdentity();
      const res = await fetch('/api/strava?mode=login');
      const { authUrl, error: apiError } = await res.json();
      if (apiError || !authUrl) throw new Error(apiError || 'No authUrl');
      window.location.href = authUrl;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(null);
    }
  };

  const syncStrava = async () => {
    setLoading('strava-sync');
    setError(null);
    try {
      const athleteId = localStorage.getItem('athlete_id');
      if (!athleteId) throw new Error('No athlete_id in localStorage — sign in first');
      const res = await fetch('/api/strava/sync-activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sync failed');
      const first = Array.isArray(json.results) ? json.results[0] : null;
      const detail = first
        ? `fetched ${first.fetched ?? '?'} · runs ${first.runs ?? '?'} · new ${first.synced ?? 0}`
        : `new ${json.synced ?? 0}`;
      if (first?.error) throw new Error(`${detail} — ${first.error}`);
      setError(null);
      alert(`Strava sync OK: ${detail}`);
      await loadStravaAthletes();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-[9999] flex flex-col gap-1 items-start">
      <div className="flex flex-wrap items-center gap-2 bg-yellow-900/90 backdrop-blur border border-yellow-600/80 rounded-xl px-3 py-1.5 shadow-lg max-w-[min(100vw-2rem,42rem)]">
        <FlaskConical className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
        <span className="text-[10px] font-semibold text-yellow-400 uppercase tracking-wide">Dev</span>
        {TEST_ACCOUNTS.map(({ label, email }) => (
          <button
            key={email}
            onClick={() => switchTo({ email }, email)}
            disabled={!!loading}
            className={cn(
              'text-[11px] px-2 py-0.5 rounded-lg transition-all',
              'bg-yellow-800/60 text-yellow-200 hover:bg-yellow-700/60',
              loading === email && 'opacity-50',
            )}
          >
            {loading === email
              ? <Loader2 className="h-3 w-3 animate-spin inline" />
              : label}
          </button>
        ))}

        <span className="w-px h-4 bg-yellow-600/50" />

        <button
          onClick={stravaLogin}
          disabled={!!loading}
          className="text-[11px] px-2 py-0.5 rounded-lg bg-orange-800/70 text-orange-100 hover:bg-orange-700/70"
          title="Real Strava OAuth → upsert athlete + sync → /auth/resolve"
        >
          {loading === 'strava-oauth'
            ? <Loader2 className="h-3 w-3 animate-spin inline" />
            : 'Strava login'}
        </button>

        {stravaAthletes.map((a) => (
          <button
            key={a.id}
            onClick={() => switchTo({ athleteId: a.id }, a.id)}
            disabled={!!loading}
            className={cn(
              'text-[11px] px-2 py-0.5 rounded-lg transition-all',
              'bg-orange-900/60 text-orange-200 hover:bg-orange-800/60',
              loading === a.id && 'opacity-50',
            )}
            title={`${a.email}${a.strava_athlete_id ? ` · Strava #${a.strava_athlete_id}` : ''}`}
          >
            {loading === a.id
              ? <Loader2 className="h-3 w-3 animate-spin inline" />
              : (a.name || 'Strava user')}
          </button>
        ))}

        <button
          onClick={syncStrava}
          disabled={!!loading}
          className="text-[11px] px-2 py-0.5 rounded-lg bg-orange-900/60 text-orange-200 hover:bg-orange-800/60 flex items-center gap-1"
          title="Re-sync Strava activities for current athlete_id"
        >
          {loading === 'strava-sync'
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <><RefreshCw className="h-3 w-3" /> Sync</>}
        </button>

        <span className="w-px h-4 bg-yellow-600/50" />

        <button
          onClick={() => router.push(`/dashboard/run-chat/${TEST_ACTIVITY_ID}`)}
          className="text-[11px] px-2 py-0.5 rounded-lg bg-yellow-800/60 text-yellow-200 hover:bg-yellow-700/60 flex items-center gap-1"
          title="Open seeded test run chat"
        >
          <MessageCircle className="h-3 w-3" />
          Test chat
        </button>
        <button
          onClick={async () => {
            setLoading('reseed');
            setError(null);
            try {
              const activityId = openRunChatActivityId || TEST_ACTIVITY_ID;
              const { data } = await getSupabase().auth.getSession();
              const token = data.session?.access_token;
              if (!token) throw new Error('Not signed in');
              const res = await fetch(`/api/run-chat?activityId=${activityId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!res.ok) throw new Error((await res.json()).error || 'Reseed failed');
              const target = `/dashboard/run-chat/${activityId}`;
              if (pathname === target) {
                window.location.reload();
              } else {
                router.push(target);
              }
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setLoading(null);
            }
          }}
          disabled={!!loading}
          className="text-[11px] px-2 py-0.5 rounded-lg bg-yellow-800/60 text-yellow-200 hover:bg-yellow-700/60"
          title={
            openRunChatActivityId
              ? 'Delete every message in this chat and regenerate its initial state'
              : 'Reset the seeded test chat to its initial state'
          }
        >
          {loading === 'reseed' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reset chat'}
        </button>
      </div>
      {error && (
        <p className="text-[10px] text-red-400 bg-slate-900/90 rounded-lg px-2 py-1 max-w-xs">{error}</p>
      )}
    </div>
  );
}

// Wrapper keeps hooks unconditional — the guard is outside the hook-bearing component.
export function DevIdentitySwitcher() {
  if (process.env.NODE_ENV === 'production') return null;
  return <DevBar />;
}
