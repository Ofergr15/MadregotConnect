'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { mutate as globalMutate } from 'swr';
import { User, Users, CheckCircle2, Loader2, Save, Dumbbell, Watch, Activity, WifiOff, Copy, Check, Share2, BellRing, Award, Trophy, Medal, BarChart3, Route, UserCheck, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders, useApi } from '@/lib/api';
import { useTranslations } from 'next-intl';
import { StatisticsScreen } from '@/components/StatisticsScreen';
import { BadgesGrid } from '@/components/BadgesGrid';
import { ChallengesGrid } from '@/components/ChallengesGrid';
import { LeaderboardsScreen } from '@/components/LeaderboardsScreen';
import { MemberDiscovery } from '@/components/MemberDiscovery';
import { NotificationPrefs } from '@/components/NotificationPrefs';
import { PersonalInfo } from '@/components/PersonalInfo';
import { ShoeManager } from '@/components/ShoeManager';
import { AthleteProfileBody } from '@/components/profile/AthleteProfileBody';
import { FeedAvatar } from '@/components/FeedAvatar';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { ProfileOverview } from '@/components/profile/ProfileOverview';
import { SetupChecklist } from '@/components/onboarding/SetupChecklist';
import { ONBOARDING_KEY } from '@/lib/onboarding/use-onboarding';
import { Sheet, SegmentedControl, BackNav } from '@/components/ui';
import { shareTextForDay } from '@/lib/workout-share';
import { getDisplayWeekStart, formatPlanWeekRange } from '@/lib/plans/workout-parsing';
import { fetchActivities } from '@/lib/activities-client';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { APP_VERSION } from '@/lib/version';
import type { GroupedWeeklyPlans } from '@/lib/ai/types';

interface FollowedAthlete {
  id: string;
  name: string;
  avatarUrl: string | null;
}

interface Group {
  id: string;
  name: string;
  level: 'fast' | 'medium' | 'slow';
  marathonGoal?: string;
}

// The five hardcoded WEEKS that used to live here are gone. They were a static
// list of June 2026 PDFs whose only surviving reader was the "This week's
// program" row's trailing value — so that row said "Week 5" forever, months
// after week 5 was over, and the number meant nothing to an athlete anyway.
// The row now shows the real date range of the week it opens; see programWeekLabel.

// iOS-Settings-style drill-down tabs. null = the Profile landing (avatar/name +
// row list); a value = a detail screen open. Mirrors the mechanism in
// dashboard/settings/page.tsx (SettingsTab / activeTab) so both "app-native
// settings-style" screens share one navigation pattern.
//
// `setup` is the odd one out: it's already built on the designer's light system,
// so it renders in its own block rather than inside the dark wrapper the other
// detail screens still need.
type ProfileTab = 'group' | 'datasource' | 'statistics' | 'badges' | 'challenges' | 'leaderboards' | 'discover' | 'share' | 'notifications' | 'personalInfo' | 'setup';

const PROFILE_TAB_KEYS: ProfileTab[] = ['group', 'datasource', 'statistics', 'badges', 'challenges', 'leaderboards', 'discover', 'share', 'notifications', 'personalInfo', 'setup'];

function tabFromParam(tab: string | null): ProfileTab | null {
  return PROFILE_TAB_KEYS.includes(tab as ProfileTab) ? (tab as ProfileTab) : null;
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 mx-auto mt-20"></div>}>
      <ProfileContent />
    </Suspense>
  );
}

function ProfileContent() {
  const t = useTranslations('profile');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  // null = landing (iOS-style list); a value = a detail screen open. Reads
  // ?tab= on mount and keeps the URL in sync on every change — without this,
  // refreshing while inside any detail screen (e.g. Notification Prefs)
  // silently dropped back to the landing list instead of staying put.
  const [activeTab, setActiveTabState] = useState<ProfileTab | null>(() =>
    tabFromParam(searchParams.get('tab')),
  );
  const setActiveTab = useCallback((tab: ProfileTab | null) => {
    setActiveTabState(tab);
    router.replace(tab ? `/dashboard/profile?tab=${tab}` : '/dashboard/profile');
  }, [router]);
  const [athleteId, setAthleteId] = useState('');
  const [athleteName, setAthleteName] = useState('');
  const [athleteEmail, setAthleteEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [currentGroupId, setCurrentGroupId] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  // Club-global and read-only here, so it's derived straight from the cache
  // rather than copied into state — see the useApi call below.
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dataSource, setDataSource] = useState<'garmin' | 'strava' | null>(null);
  const [hasGarmin, setHasGarmin] = useState(false);
  const [hasStrava, setHasStrava] = useState(false);
  const [stravaEnabled, setStravaEnabled] = useState(false);
  const [connectingStrava, setConnectingStrava] = useState(false);
  const [connectingGarmin, setConnectingGarmin] = useState(false);
  const [garminLoading, setGarminLoading] = useState(false);
  const [garminEmail, setGarminEmail] = useState('');
  const [garminPassword, setGarminPassword] = useState('');
  const [garminError, setGarminError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSessionId, setMfaSessionId] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [hasActivities, setHasActivities] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncModalStatus, setSyncModalStatus] = useState<'syncing' | 'done'>('syncing');
  const [syncModalCount, setSyncModalCount] = useState(0);
  const [hasSynced, setHasSynced] = useState(false);
  const garminSectionRef = useRef<HTMLDivElement>(null);

  // --- Following (Strava-style follow graph — GET /api/athletes/[id]/connections) ---
  const [followingCount, setFollowingCount] = useState(0);
  const [followingList, setFollowingList] = useState<FollowedAthlete[]>([]);
  const [showFollowingSheet, setShowFollowingSheet] = useState(false);
  const [unfollowingId, setUnfollowingId] = useState<string | null>(null);

  // --- Copyable workout (current week's plan) ---
  const [planWorkouts, setPlanWorkouts] = useState<GroupedWeeklyPlans | null>(null);
  const [planWeekStart, setPlanWeekStart] = useState<string | null>(null);
  const [planIsCurrent, setPlanIsCurrent] = useState(true);
  const [shareDay, setShareDay] = useState<number>(() => new Date().getDay());
  const [copied, setCopied] = useState(false);

  // useApi, not a raw fetch: this is the screen an athlete opens most, and SWR
  // renders the previous answer instantly on a revisit instead of blanking the
  // Share Workout row while five requests go out again. The plan is club-global
  // and unkeyed, so every screen that asks shares one cache entry.
  const { data: planData } = useApi<{ plan?: { parsed_workouts?: GroupedWeeklyPlans; week_start_date?: string; is_current?: boolean } }>(
    '/api/public/current-plan',
  );
  // Same key the Header already uses on every screen, so this is normally a
  // cache read rather than a second copy of a 4KB groups+athletes join.
  const { data: groupsData } = useApi<{ groups?: Group[] }>('/api/groups');
  const groups = groupsData?.groups || [];
  useEffect(() => {
    const plan = planData?.plan;
    if (!plan?.parsed_workouts) return;
    const pw = plan.parsed_workouts;
    // Only the grouped shape (group1/2/3) can produce the ❶ (❷) ((❸)) copy.
    if (pw.group1 && pw.group2 && pw.group3) {
      setPlanWorkouts(pw as GroupedWeeklyPlans);
      setPlanWeekStart(plan.week_start_date || null);
      setPlanIsCurrent(!!plan.is_current);
    }
  }, [planData]);

  // ?tab= is a deep-link target, not just a bookmark: the first-run tour ends by
  // pushing ?tab=setup. The initial state above only reads the param on mount, so
  // arriving at a new tab while this screen is already mounted changed the URL
  // and nothing else. Guarded on equality so setActiveTab's own router.replace
  // can't bounce back through here.
  useEffect(() => {
    const next = tabFromParam(searchParams.get('tab'));
    setActiveTabState((current) => (current === next ? current : next));
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get('connectGarmin') === '1') {
      // Deep-link (from onboarding / the Garmin reminder popup / the incoming
      // Google-sign-in link) — jump straight into the Data Source sub-screen so
      // the connect form is visible, then scroll it into view as before.
      setActiveTab('datasource');
      setConnectingGarmin(true);
      setTimeout(() => {
        garminSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [searchParams, setActiveTab]);

  useEffect(() => {
    const id = localStorage.getItem('athlete_id') || '';
    const name = localStorage.getItem('athlete_name') || '';
    const email = localStorage.getItem('athlete_email') || '';
    const groupId = localStorage.getItem('athlete_group_id') || '';
    setAthleteId(id);
    setAthleteName(name);
    setAthleteEmail(email);
    setCurrentGroupId(groupId);
    setSelectedGroupId(groupId);

    if (id) {
      // All this needs is "does this athlete have ANY activity", so one row is
      // enough. It used to ask for the default page of 200, each carrying its
      // per-km `splits` and per-lap `laps` JSONB — hundreds of KB over a phone
      // connection to set a boolean.
      //
      // `selfOnly` is what makes `limit: 1` correct: without it the server hands
      // staff the club-wide list, so for a coach who also runs the single newest
      // row would be somebody else's and this would read as "no activities".
      fetchActivities({ limit: 1, selfOnly: true })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const acts = data?.activities || [];
          // Endpoint is already scoped to this athlete; keep the filter as a
          // belt-and-suspenders guard.
          if (acts.some((a: any) => a.athlete_id === id)) setHasActivities(true);
        })
        .catch(() => {});
    }
  }, []);

  // One call for everything this screen needs about the signed-in athlete. The
  // four connection fields used to come from a SECOND request to GET
  // /api/admin/athlete-source, which returns a row for every athlete in the club
  // so the client could `.find()` its own — a whole-roster download, on every
  // open of the screen an athlete visits most, to read four booleans about
  // themselves. /api/athletes/me is scoped to one row.
  //
  // The answers land in state rather than being read straight off `data` because
  // this screen also writes them locally: connecting Garmin sets hasGarmin,
  // uploading a photo sets avatarUrl, the Strava toggle sets stravaEnabled. SWR
  // seeds them and a revalidation refreshes them; the local writes still win
  // until then.
  const { data: meData, error: meError, mutate: mutateMe } = useApi<{
    athlete?: { avatarUrl?: string | null; data_source?: 'garmin' | 'strava' | null; hasGarmin?: boolean; hasStrava?: boolean; stravaEnabled?: boolean };
  }>(athleteId ? `/api/athletes/me?id=${encodeURIComponent(athleteId)}` : null);

  useEffect(() => {
    const me = meData?.athlete;
    if (!me) return;
    setAvatarUrl(me.avatarUrl || null);
    setDataSource(me.data_source || 'garmin');
    setHasGarmin(!!me.hasGarmin);
    setHasStrava(!!me.hasStrava);
    setStravaEnabled(!!me.stravaEnabled);
  }, [meData]);

  useEffect(() => {
    // Assume the legacy default rather than rendering "no connection" over a
    // network blip — same fallback this screen has always used.
    if (!meError) return;
    setHasGarmin(true);
    setDataSource('garmin');
  }, [meError]);

  // Following list — also state, because unfollowing edits it in place.
  const { data: connectionsData } = useApi<{ followingCount?: number; following?: FollowedAthlete[] }>(
    athleteId ? `/api/athletes/${encodeURIComponent(athleteId)}/connections` : null,
  );

  useEffect(() => {
    if (!connectionsData) return;
    setFollowingCount(connectionsData.followingCount || 0);
    setFollowingList(connectionsData.following || []);
  }, [connectionsData]);

  const hasChanges = selectedGroupId !== currentGroupId;

  const saveGroup = async () => {
    if (!athleteId || !hasChanges) return;
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch('/api/athletes', {
        method: 'PUT',
        headers: await bearerHeaders(),
        body: JSON.stringify({ id: athleteId, groupId: selectedGroupId }),
      });

      if (res.ok) {
        setCurrentGroupId(selectedGroupId);
        localStorage.setItem('athlete_group_id', selectedGroupId);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
    } finally {
      setSaving(false);
    }
  };

  // Unfollow from the Following sheet — optimistic (drop the row + decrement
  // the count locally), matching the toggle on the peer teammate profile page.
  const handleUnfollow = async (followeeId: string) => {
    if (!athleteId || unfollowingId) return;
    setUnfollowingId(followeeId);
    try {
      const res = await fetch('/api/athletes/follow', {
        method: 'DELETE',
        // The route checks that the caller IS followerId, from the verified
        // session — so this needs the bearer token, not just a content type.
        headers: await apiHeaders(true),
        body: JSON.stringify({ followerId: athleteId, followeeId }),
      });
      if (res.ok) {
        setFollowingList(prev => prev.filter(a => a.id !== followeeId));
        setFollowingCount(prev => Math.max(0, prev - 1));
      }
    } catch {
      // Network error — nothing changed locally, so nothing to roll back.
    } finally {
      setUnfollowingId(null);
    }
  };

  if (!athleteId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <User className="h-12 w-12 text-ink-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">{t('noProfileFound')}</h2>
          <p className="text-ink-400 text-sm">
            {t('joinViaInvite')}
          </p>
        </div>
      </div>
    );
  }

  const initials = athleteName
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !athleteId) return;
    setUploadingPhoto(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('athleteId', athleteId);
      // apiHeaders(false) on purpose: no Content-Type, so fetch sets the
      // multipart boundary itself. The route gates athleteId on the session.
      const res = await fetch('/api/athletes/avatar', {
        method: 'POST',
        headers: await apiHeaders(false),
        body: form,
      });
      const data = await res.json();
      if (res.ok && data.avatarUrl) {
        setAvatarUrl(data.avatarUrl);
        // The cached /api/athletes/me still carries the OLD avatar, and picking a
        // file can blur and refocus the page — which is exactly when SWR
        // revalidates. Without this, that stale response could land after the
        // upload and put the previous photo back until the next refresh.
        mutateMe();
        // Flips the setup checklist's "add a photo" task straight away — this is
        // the only setup task you can complete without leaving the screen, so
        // it's the only one that needs a nudge rather than the checklist's own
        // revalidate-on-open.
        globalMutate(ONBOARDING_KEY);
      }
    } catch { /* ignore — keep existing photo */ }
    finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  const currentGroup = groups.find(g => g.id === currentGroupId);
  // The date range of the week this row opens. Prefer the week the loaded plan is
  // actually for — an athlete whose latest published plan is last week's should
  // read that week, not today's — and fall back to `getDisplayWeekStart`, the same
  // "current week" the Program page lands on (Saturday-20:00 rollover included),
  // so before the plan loads the row still can't name a week the Program page
  // wouldn't open.
  const programWeekLabel = formatPlanWeekRange(planWeekStart || getDisplayWeekStart(new Date()));

  // Days (0=Sun..6=Sat) that actually have a workout in the loaded plan.
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const workoutDays = planWorkouts
    ? DAY_SHORT.map((_, d) => d).filter(d => shareTextForDay(planWorkouts, d) !== null)
    : [];
  const shareText = planWorkouts ? shareTextForDay(planWorkouts, shareDay) : null;

  const copyShareText = async () => {
    if (!shareText) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked — the text is selectable in the box as a fallback
    }
  };

  // Trailing value preview for the Data Source landing row (which source is
  // actually active right now, in one word).
  const dataSourceLabel = !hasGarmin && !hasStrava
    ? t('noConnection')
    : hasGarmin && hasStrava
      ? (dataSource === 'strava' ? t('strava') : t('garminConnect'))
      : hasGarmin ? t('garminConnect') : t('strava');

  return (
    <div className="max-w-lg mx-auto space-y-5 pb-8">
      <Sheet
        open={showSyncModal}
        onOpenChange={(o) => { if (!o && syncModalStatus === 'syncing') return; setShowSyncModal(o); }}
        title={syncModalStatus === 'syncing' ? t('syncingActivities') : t('garminConnected')}
      >
        <div className="text-center py-2">
          {syncModalStatus === 'syncing' ? (
            <>
              <div className="bg-brand-600/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Loader2 className="h-8 w-8 text-brand-600 animate-spin" />
              </div>
              <p className="text-sm text-ink-400">{t('fetchingActivities')}</p>
            </>
          ) : (
            <>
              <div className="bg-accent-600/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-8 w-8 text-accent-600" />
              </div>
              <p className="text-sm text-ink-400">
                {syncModalCount > 0
                  ? t('syncedActivities', { count: syncModalCount })
                  : t('connectedSuccessfully')}
              </p>
              <button
                onClick={() => setShowSyncModal(false)}
                className="mt-5 w-full min-h-[48px] rounded-xl font-bold text-base bg-brand-600 hover:bg-brand-700 text-white transition-colors active:scale-[0.98]"
              >
                {t('letsGo')}
              </button>
            </>
          )}
        </div>
      </Sheet>

      {/* ═══ Following sheet — the athletes this profile follows, tap-through
          to their teammate profile, with an unfollow action per row ═══ */}
      <Sheet
        open={showFollowingSheet}
        onOpenChange={setShowFollowingSheet}
        title={
          <span className="flex items-center gap-2">
            {t('following')}
            {followingCount > 0 && (
              <span className="text-sm font-medium text-ink-400 tabular-nums">{followingCount}</span>
            )}
          </span>
        }
        trailingAction={
          <button
            onClick={() => setShowFollowingSheet(false)}
            className="p-1.5 rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
            aria-label={tCommon('close')}
          >
            <X className="h-5 w-5" />
          </button>
        }
        className="max-h-[80vh]"
        bodyClassName="px-4 py-2"
      >
        {followingList.length === 0 ? (
          <p className="text-center text-sm text-ink-400 py-8">{t('noFollowingYet')}</p>
        ) : (
          followingList.map(a => (
            <div key={a.id} className="flex items-center gap-3 py-2">
              <Link
                href={`/dashboard/teammate/${a.id}`}
                onClick={() => setShowFollowingSheet(false)}
                className="flex items-center gap-3 flex-1 min-w-0"
              >
                <FeedAvatar name={a.name} url={a.avatarUrl} />
                <span className="text-sm text-ink-700 truncate" dir="auto">{a.name}</span>
              </Link>
              <button
                onClick={() => handleUnfollow(a.id)}
                disabled={unfollowingId === a.id}
                className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-ink-300 text-ink-500 hover:text-ink-900 hover:border-ink-300 transition-colors disabled:opacity-50"
              >
                {unfollowingId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('unfollow')}
              </button>
            </div>
          ))
        )}
      </Sheet>

      {/* ═══ LANDING — the designer's frame (ProfileOverview: greeting, weekly
          km, updates, race, next workout + RSVP, week strip) over the
          iOS-Settings inset list of rows that drill into detail screens. ═══ */}
      {/* Outside both blocks below: the setup checklist's "add a photo" row opens
          this same picker, so it has to exist while the landing is unmounted. */}
      <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />

      {activeTab === null && (
        <>
          <ProfileOverview
            athleteId={athleteId}
            athleteName={athleteName}
            avatarUrl={avatarUrl}
            initials={initials}
            uploadingPhoto={uploadingPhoto}
            onPhotoClick={() => photoInputRef.current?.click()}
            onOpenSetup={() => setActiveTab('setup')}
          />

          {/* ═══ THE PROFILE PROPER — the SAME component a teammate sees ═══
              Stat trio, the דבוקה card, this week against the plan's target, the
              last ten weeks as bars, the runs list, the km table and the PRs.

              This replaced WeeklyVolumeCard, which drew the week + the ten bars
              for the owner only (it read the activities endpoint with
              `selfOnly`, so it could never serve a peer). Everything it showed
              is here, and the same code now renders on
              /dashboard/teammate/[id] — which is the point: your profile and the
              profile someone else sees of you are one implementation, so the
              peer view cannot fall behind the way it had. */}
          <AthleteProfileBody
            athleteId={athleteId}
            variant="owner"
            // No viewerId: on your OWN profile there is no follow state to
            // resolve, and omitting it keeps the SWR key byte-identical to the
            // one this page already fetches above, so the trio is free.
            onFollowingClick={() => setShowFollowingSheet(true)}
          />

          {/* Email, join date, pace-group goal and the Garmin/Strava chips are
              no longer on the landing — the frame's header is greeting + name +
              avatar only. None of it was lost: email/join date live in Personal
              info, the goal in Pace group, and the connection state is the
              Activity data source row's own trailing value below. */}

          {/* Everything else lives one tap away, iOS-Settings style. InsetRow
              already renders its own RTL-safe chevron whenever href/onClick is
              set and no `trailing` override is passed — no need to repeat it.
              Grouped into "my numbers" (performance/history) vs "account"
              (settings-ish config) instead of one long flat list — the single
              biggest usability finding from the earlier nav/menu research pass
              (Strava's own profile tab uses the same split). Program stays
              ungrouped at the top since it's the most frequently tapped row. */}
          <InsetSection>
            <InsetRow
              icon={Dumbbell}
              iconBg="bg-brand-600"
              label={t('thisWeeksProgram')}
              value={programWeekLabel}
              // The plan on file isn't for this week — say which, rather than
              // letting the row imply the athlete is looking at the current one.
              sublabel={!planIsCurrent && planWeekStart ? t('latestPublishedWeek') : undefined}
              href="/dashboard/program"
            />
          </InsetSection>

          <InsetSection header={t('myNumbers')}>
            <InsetRow
              icon={BarChart3}
              iconBg="bg-band-3"
              label={t('statistics')}
              onClick={() => setActiveTab('statistics')}
            />
            <InsetRow
              icon={Award}
              iconBg="bg-band-3"
              label={t('badges')}
              onClick={() => setActiveTab('badges')}
            />
            <InsetRow
              icon={Trophy}
              iconBg="bg-band-3"
              label={t('challenges')}
              onClick={() => setActiveTab('challenges')}
            />
            <InsetRow
              icon={Medal}
              iconBg="bg-band-3"
              label={t('leaderboards')}
              onClick={() => setActiveTab('leaderboards')}
            />
            <InsetRow
              icon={Route}
              iconBg="bg-band-2"
              label={t('myActivities')}
              href="/dashboard/activities"
            />
          </InsetSection>

          <InsetSection header={t('account')}>
            <InsetRow
              icon={User}
              iconBg="bg-violet-500"
              label={t('personalInfo')}
              onClick={() => setActiveTab('personalInfo')}
            />
            <InsetRow
              icon={Users}
              iconBg="bg-band-2"
              label={t('paceGroup')}
              value={currentGroup?.name}
              onClick={() => setActiveTab('group')}
            />
            <InsetRow
              icon={UserCheck}
              iconBg="bg-indigo-500"
              label={t('following')}
              value={String(followingCount)}
              onClick={() => setShowFollowingSheet(true)}
            />
            <InsetRow
              icon={Search}
              iconBg="bg-band-2"
              label={t('discoverMembers')}
              onClick={() => setActiveTab('discover')}
            />
            <InsetRow
              icon={Activity}
              iconBg="bg-accent-600"
              label={t('activityDataSource')}
              value={dataSourceLabel}
              onClick={() => setActiveTab('datasource')}
            />
            {planWorkouts && workoutDays.length > 0 && (
              <InsetRow
                icon={Share2}
                iconBg="bg-teal-500"
                label={t('shareWorkout')}
                onClick={() => setActiveTab('share')}
              />
            )}
            <InsetRow
              icon={BellRing}
              iconBg="bg-accent-red"
              label={t('notificationPrefs')}
              onClick={() => setActiveTab('notifications')}
            />
          </InsetSection>

          <ShoeManager athleteId={athleteId} />
        </>
      )}

      {/* ═══ DETAIL: Setup checklist — already on the light system, so it sits
          outside the dark wrapper below and needs no back-nav of its own here
          (SetupChecklist renders a light one). ═══ */}
      {activeTab === 'setup' && (
        <SetupChecklist
          onBack={() => setActiveTab(null)}
          onNavigate={(tab) => setActiveTab(tab)}
          onPickPhoto={() => photoInputRef.current?.click()}
        />
      )}

      {/* ═══ DETAIL SCREENS — still on the original dark palette; only the
          landing above has been rebuilt on the designer's light system. This
          panel paints the main area dark for them, bleeding past main's own
          px-4/pt-5 so there's no light gutter, because (app)/layout.tsx now
          lists /dashboard/profile as a light route and a `text-ink-700` heading
          would otherwise be invisible on #DFDFDF. The back-nav lives inside it
          for the same reason. Delete the wrapper once these screens have
          frames of their own. ═══ */}
      {activeTab !== null && activeTab !== 'setup' && (
        <div className="-mx-4 -mt-5 min-h-[100dvh] bg-page px-4 pt-5 space-y-5">
          <BackNav label={t('title')} onBack={() => setActiveTab(null)} />

      {/* ═══ DETAIL: Pace Group Selection ═══ */}
      {activeTab === 'group' && (
        <div className="rounded-card bg-card/80 border border-page/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-brand-600/15 flex items-center justify-center">
                <Users className="h-4.5 w-4.5 text-brand-600" />
              </div>
              <h2 className="font-semibold text-ink-700">{t('paceGroup')}</h2>
            </div>
            {saved && (
              <div className="flex items-center gap-1.5 text-accent-600">
                <CheckCircle2 className="h-4 w-4" />
                <span className="text-xs font-medium">{t('saved')}</span>
              </div>
            )}
          </div>

          {/* iOS Settings-style single-select list — checkmark on the selected
              row, matching the InsetRow list one screen earlier instead of a
              differently-styled stack of card buttons. */}
          <InsetSection className={cn((saving || hasActivities) && 'opacity-60 pointer-events-none')}>
            {groups.map(g => {
              const isSelected = selectedGroupId === g.id;
              return (
                <InsetRow
                  key={g.id}
                  icon={Users}
                  iconBg={isSelected ? 'bg-brand-600' : 'bg-ink-300'}
                  label={g.name}
                  value={g.marathonGoal}
                  onClick={() => setSelectedGroupId(g.id)}
                  trailing={isSelected ? <CheckCircle2 className="h-5 w-5 text-brand-600" /> : undefined}
                />
              );
            })}
          </InsetSection>

          {hasActivities && (
            <p className="text-xs text-ink-400 mt-3 text-center">{t('groupLocked')}</p>
          )}

          {hasChanges && !hasActivities && (
            <button
              onClick={saveGroup}
              disabled={saving}
              className="mt-4 w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold px-4 py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  {t('saveGroupChange')}
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* ═══ DETAIL: Data Source - Connect Strava/Garmin ═══ */}
      {activeTab === 'datasource' && (
        <div ref={garminSectionRef} className="rounded-card bg-card/80 border border-page/50 p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-lg bg-brand-600/15 flex items-center justify-center">
              <Activity className="h-4.5 w-4.5 text-brand-600" />
            </div>
            <h2 className="font-semibold text-ink-700">{t('activityDataSource')}</h2>
          </div>

          <div className="space-y-3">
            {/* Garmin status */}
            <div className={cn(
              'rounded-xl border overflow-hidden',
              hasGarmin ? 'border-accent-600/30 bg-accent-600/5' : 'border-page/50 bg-page/30'
            )}>
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <Watch className={cn('h-5 w-5', hasGarmin ? 'text-accent-600' : 'text-ink-400')} />
                  <div>
                    <p className={cn('text-sm font-medium', hasGarmin ? 'text-ink-700' : 'text-ink-400')}>{t('garminConnect')}</p>
                    <p className="text-2xs text-ink-400">{hasGarmin ? t('connected') : t('notConnected')}</p>
                  </div>
                </div>
                {hasGarmin ? (
                  <span className="text-3xs font-bold px-2 py-0.5 rounded-full bg-accent-600/15 text-accent-900">{t('connected')}</span>
                ) : (
                  <button
                    onClick={() => setConnectingGarmin(!connectingGarmin)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-brand-600/10 text-brand-600 hover:bg-brand-600/20 transition-colors"
                  >
                    {t('connect')}
                  </button>
                )}
              </div>
              {connectingGarmin && !hasGarmin && (
                <div className="px-4 pb-4 space-y-3 border-t border-page/30 pt-3">
                  <input
                    type="email"
                    placeholder={t('garminEmail')}
                    value={garminEmail}
                    onChange={e => setGarminEmail(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-page/50 border border-page/50 text-sm text-ink-700 placeholder-ink-400 focus:outline-none focus:border-brand-600/50"
                  />
                  {!mfaRequired && (
                    <input
                      type="password"
                      placeholder={t('garminPassword')}
                      value={garminPassword}
                      onChange={e => setGarminPassword(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg bg-page/50 border border-page/50 text-sm text-ink-700 placeholder-ink-400 focus:outline-none focus:border-brand-600/50"
                    />
                  )}
                  {mfaRequired && (
                    <div className="space-y-2">
                      <p className="text-xs text-band-3">{t('verificationCodeSent')}</p>
                      <input
                        type="text"
                        placeholder={t('sixDigitCode')}
                        value={mfaCode}
                        onChange={e => setMfaCode(e.target.value)}
                        maxLength={6}
                        className="w-full px-3 py-2.5 rounded-lg bg-page/50 border border-band-3/50 text-sm text-ink-700 placeholder-ink-400 focus:outline-none focus:border-band-3 text-center text-lg tracking-widest"
                      />
                    </div>
                  )}
                  {garminError && (
                    <p className="text-xs text-accent-red">{garminError}</p>
                  )}
                  <button
                    onClick={async () => {
                      setGarminError(null);
                      setGarminLoading(true);
                      try {
                        let authRes;
                        if (mfaRequired && mfaCode) {
                          authRes = await fetch('/api/garmin/authenticate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: garminEmail, mfaCode, sessionId: mfaSessionId }),
                          });
                        } else {
                          if (!garminEmail || !garminPassword) { setGarminLoading(false); return; }
                          authRes = await fetch('/api/garmin/authenticate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: garminEmail, password: garminPassword }),
                          });
                        }
                        const authData = await authRes.json();
                        if (authData.mfaRequired) {
                          setMfaRequired(true);
                          setMfaSessionId(authData.sessionId);
                          setGarminLoading(false);
                          return;
                        }
                        if (!authRes.ok) {
                          setGarminError(authData.message || authData.error || 'Authentication failed');
                          setGarminLoading(false);
                          return;
                        }
                        const connectRes = await fetch('/api/athletes/connect', {
                          method: 'POST',
                          // This is the token-less update path on an already-
                          // active row, which now needs the session: it writes
                          // garmin_auth, and the route can't otherwise tell this
                          // athlete from anyone naming their email address.
                          headers: await apiHeaders(true),
                          body: JSON.stringify({ garminAuth: authData.auth, name: athleteName, email: athleteEmail }),
                        });
                        if (connectRes.ok) {
                          setHasGarmin(true);
                          setConnectingGarmin(false);
                          setMfaRequired(false);
                          setMfaCode('');
                          setGarminEmail('');
                          setGarminPassword('');
                          setShowSyncModal(true);
                          setSyncModalStatus('syncing');
                          try {
                            const syncRes = await fetch('/api/garmin/sync-activities', {
                              method: 'POST',
                              headers: await bearerHeaders(),
                              body: JSON.stringify({ athleteId }),
                            });
                            if (syncRes.ok) {
                              const syncData = await syncRes.json();
                              setSyncModalCount(syncData.synced || 0);
                              if (syncData.synced > 0) setHasActivities(true);
                            }
                          } catch {}
                          setSyncModalStatus('done');
                          setHasSynced(true);
                        } else {
                          setGarminError('Failed to save connection');
                        }
                      } catch {
                        setGarminError('Connection failed. Try again.');
                      } finally {
                        setGarminLoading(false);
                      }
                    }}
                    disabled={garminLoading || (mfaRequired ? !mfaCode : (!garminEmail || !garminPassword))}
                    className="w-full bg-accent-600 hover:opacity-90 text-white font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                  >
                    {garminLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Watch className="h-4 w-4" />
                    )}
                    {garminLoading ? t('connecting') : mfaRequired ? t('verifyCode') : t('connectGarmin')}
                  </button>
                </div>
              )}
            </div>

            {/* Strava status - only show if admin enabled or already connected */}
            {(stravaEnabled || hasStrava) && (
              <div className={cn(
                'flex items-center justify-between px-4 py-3 rounded-xl border',
                hasStrava ? 'border-band-3/30 bg-band-3/5' : 'border-page/50 bg-page/30'
              )}>
                <div className="flex items-center gap-3">
                  <Activity className={cn('h-5 w-5', hasStrava ? 'text-band-3' : 'text-ink-400')} />
                  <div>
                    <p className={cn('text-sm font-medium', hasStrava ? 'text-ink-700' : 'text-ink-400')}>{t('strava')}</p>
                    <p className="text-2xs text-ink-400">{hasStrava ? t('connected') : t('notConnected')}</p>
                  </div>
                </div>
                {hasStrava ? (
                  <span className="text-3xs font-bold px-2 py-0.5 rounded-full bg-band-3/15 text-band-3-ink">{t('connected')}</span>
                ) : (
                  <button
                    onClick={async () => {
                      setConnectingStrava(true);
                      try {
                        // Authenticated: the link branch of /api/strava is
                        // self-or-staff gated, because its `state` decides
                        // whose row the returning Strava tokens land on.
                        const res = await fetch(`/api/strava?athleteId=${athleteId}`, {
                          headers: await apiHeaders(),
                        });
                        const data = await res.json();
                        if (data.authUrl) {
                          window.location.href = data.authUrl;
                        }
                      } catch {
                        setConnectingStrava(false);
                      }
                    }}
                    disabled={connectingStrava}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[#fc5200]/10 text-[#fc5200] hover:bg-[#fc5200]/20 transition-colors disabled:opacity-50"
                  >
                    {connectingStrava ? t('connecting') : t('connect')}
                  </button>
                )}
              </div>
            )}
          </div>


          {/* Switch source (shown if both connected) */}
          {hasStrava && hasGarmin && (
            <button
              onClick={async () => {
                const newSource = dataSource === 'strava' ? 'garmin' : 'strava';
                await fetch('/api/admin/athlete-source', {
                  method: 'PATCH',
                  headers: await bearerHeaders(),
                  body: JSON.stringify({ athleteId, dataSource: newSource }),
                });
                setDataSource(newSource);
              }}
              className="mt-4 w-full border border-ink-300 hover:border-ink-300 text-ink-500 hover:text-ink-900 font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Activity className="h-4 w-4" />
              {dataSource === 'strava' ? t('switchToGarmin') : t('switchToStrava')}
            </button>
          )}

          {!hasGarmin && !hasStrava && (
            <div className="mt-4 flex items-center gap-2 text-sm text-band-3-ink bg-band-3/10 border border-band-3/20 rounded-xl px-4 py-3">
              <WifiOff className="h-4 w-4 shrink-0" />
              <span>{t('noDataSource')}</span>
            </div>
          )}

          {/* Manual Sync button — always shown for Strava; for Garmin only
              while they have zero activities yet (Garmin already auto-syncs
              via the connect flow + cron, this is just the first kick).
              Fires whichever connected source(s) apply. */}
          {!hasSynced && (hasStrava || (hasGarmin && !hasActivities)) && (
            <div className="mt-4 pt-4 border-t border-page/30">
              <button
                onClick={async () => {
                  setSyncing(true);
                  setSyncResult(null);
                  try {
                    const calls = [];
                    const syncHeaders = await bearerHeaders();
                    if (hasStrava) {
                      calls.push(fetch('/api/strava/sync-activities', {
                        method: 'POST',
                        headers: syncHeaders,
                        body: JSON.stringify({ athleteId }),
                      }));
                    }
                    if (hasGarmin) {
                      calls.push(fetch('/api/garmin/sync-activities', {
                        method: 'POST',
                        headers: syncHeaders,
                        body: JSON.stringify({ athleteId }),
                      }));
                    }
                    const results = await Promise.allSettled(calls);
                    let totalSynced = 0;
                    for (const r of results) {
                      if (r.status === 'fulfilled' && r.value.ok) {
                        const d = await r.value.json();
                        totalSynced += d.synced || 0;
                      }
                    }
                    setSyncResult(t('syncedNewActivities', { count: totalSynced }));
                  } catch {
                    setSyncResult(t('syncFailed'));
                  } finally {
                    setSyncing(false);
                    setTimeout(() => setSyncResult(null), 4000);
                  }
                }}
                disabled={syncing}
                className="w-full border border-ink-300 hover:border-brand-600/50 hover:bg-brand-600/5 text-ink-500 hover:text-ink-900 font-medium px-4 py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {syncing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('syncing')}
                  </>
                ) : (
                  <>
                    <Activity className="h-4 w-4" />
                    {hasStrava && hasActivities ? t('syncStravaActivities') : t('syncActivitiesNow')}
                  </>
                )}
              </button>
              {syncResult && (
                <p className={cn('text-xs mt-2 text-center', syncResult.includes(t('syncFailed')) ? 'text-accent-red' : 'text-accent-600')}>
                  {syncResult}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ DETAIL: Statistics — all-time numbers, PRs, volume, races, streaks ═══ */}
      {activeTab === 'statistics' && (
        <StatisticsScreen athleteId={athleteId} athleteName={athleteName} />
      )}

      {/* ═══ DETAIL: Badges & Achievements ═══ */}
      {activeTab === 'badges' && (
        <BadgesGrid athleteId={athleteId} />
      )}

      {/* ═══ DETAIL: Challenges (roadmap #13, Phase 4) ═══ */}
      {activeTab === 'challenges' && (
        <ChallengesGrid athleteId={athleteId} />
      )}

      {/* ═══ DETAIL: Leaderboards (roadmap #12) ═══ */}
      {activeTab === 'leaderboards' && (
        <LeaderboardsScreen athleteId={athleteId} groupId={currentGroupId || null} />
      )}

      {/* ═══ DETAIL: Member Discovery (roadmap #21, Phase 6) ═══ */}
      {activeTab === 'discover' && (
        <MemberDiscovery viewerId={athleteId} />
      )}

      {/* ═══ DETAIL: Share a workout — shareable text for WhatsApp / social ═══ */}
      {activeTab === 'share' && planWorkouts && workoutDays.length > 0 && (
        <div className="rounded-card bg-card/80 border border-page/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-brand-600/15 flex items-center justify-center">
                <Share2 className="h-4.5 w-4.5 text-brand-600" />
              </div>
              <div>
                <h2 className="font-semibold text-ink-700">Share a workout</h2>
                {!planIsCurrent && planWeekStart && (
                  <p className="text-xs text-ink-400">Latest plan · week of {planWeekStart}</p>
                )}
              </div>
            </div>
          </div>

          {/* Day picker — only days that have a workout. Shared SegmentedControl
              (40px-min-height segments) instead of a row of ~28px pill buttons. */}
          <SegmentedControl
            value={String(shareDay)}
            onChange={(v) => setShareDay(Number(v))}
            options={workoutDays.map(d => ({ value: String(d), label: DAY_SHORT[d] }))}
            className="mb-3"
          />

          {shareText ? (
            <>
              <pre className="bg-page/60 border border-page/50 rounded-xl p-4 text-sm text-ink-700 whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto">
{shareText}
              </pre>
              <button
                onClick={copyShareText}
                className="mt-3 w-full bg-brand-600 hover:bg-brand-700 text-white font-semibold px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    {tCommon('copied')}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    {t('copyWorkout')}
                  </>
                )}
              </button>
              <p className="text-2xs text-ink-400 mt-2 text-center">
                Paces shown as ❶ (❷) ((❸)) for the three groups.
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-400 text-center py-4">Rest day — no workout to share.</p>
          )}
        </div>
      )}

      {/* ═══ DETAIL: Notification preferences (per-user category toggles) ═══ */}
      {activeTab === 'notifications' && (
        <NotificationPrefs athleteId={athleteId} />
      )}

      {/* ═══ DETAIL: Personal info (name / birth date / gender / shoe+shirt
          size / phone) — was only reachable via Settings, which is gated to
          admin on mobile (role_mobile_tab_permissions), so every non-admin
          athlete had no way to reach it at all. Profile is always one of the
          4 primary tabs, so this is the actual reachable home for it. ═══ */}
      {activeTab === 'personalInfo' && (
        <PersonalInfo athleteId={athleteId} />
      )}
        </div>
      )}

      <p className="text-center text-xs text-ink-400 mt-6 mb-2">מדרגות · גרסה {APP_VERSION}</p>
    </div>
  );
}
