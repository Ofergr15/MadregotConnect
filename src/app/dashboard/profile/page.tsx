'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { User, Users, CheckCircle2, Loader2, Save, Dumbbell, Watch, Mail, Target, Activity, WifiOff, Copy, Check, Share2, Camera, BellRing, Award, Trophy, Medal, BarChart3, Route, UserCheck, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations, useLocale } from 'next-intl';
import { StatisticsScreen } from '@/components/StatisticsScreen';
import { BadgesGrid } from '@/components/BadgesGrid';
import { ChallengesGrid } from '@/components/ChallengesGrid';
import { LeaderboardsScreen } from '@/components/LeaderboardsScreen';
import { MemberDiscovery } from '@/components/MemberDiscovery';
import { NotificationPrefs } from '@/components/NotificationPrefs';
import { PersonalInfo } from '@/components/PersonalInfo';
import { ShoeManager } from '@/components/ShoeManager';
import { FeedAvatar } from '@/components/FeedAvatar';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { Sheet, SegmentedControl, BackNav } from '@/components/ui';
import { shareTextForDay } from '@/lib/workout-share';
import { fetchActivities } from '@/lib/activities-client';
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

interface WeekProgram {
  weekLabel: string;
  dateRange: string;
  training: string;
  nutrition: string;
}

const WEEKS: WeekProgram[] = [
  {
    weekLabel: 'Week 5',
    dateRange: '28.06 – 04.07',
    training: '/plans/training-program/week-28-06-04-07-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-28-06-04-07-2026.pdf',
  },
  {
    weekLabel: 'Week 4',
    dateRange: '21.06 – 27.06',
    training: '/plans/training-program/week-21-27-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-21-27-06-2026.pdf',
  },
  {
    weekLabel: 'Week 3',
    dateRange: '14.06 – 20.06',
    training: '/plans/training-program/week-14-20-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-14-20-06-2026.pdf',
  },
  {
    weekLabel: 'Week 2',
    dateRange: '07.06 – 13.06',
    training: '/plans/training-program/week-07-13-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-07-13-06-2026.pdf',
  },
  {
    weekLabel: 'Week 1',
    dateRange: '31.05 – 06.06',
    training: '/plans/training-program/week-31-05-06-06-2026.pdf',
    nutrition: '/plans/nutrition-plan/week-31-05-06-06-2026.pdf',
  },
];

// iOS-Settings-style drill-down tabs. null = the Profile landing (avatar/name +
// row list); a value = a detail screen open. Mirrors the mechanism in
// dashboard/settings/page.tsx (SettingsTab / activeTab) so both "app-native
// settings-style" screens share one navigation pattern.
type ProfileTab = 'group' | 'datasource' | 'statistics' | 'badges' | 'challenges' | 'leaderboards' | 'discover' | 'share' | 'notifications' | 'personalInfo';

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mt-20"></div>}>
      <ProfileContent />
    </Suspense>
  );
}

function ProfileContent() {
  const t = useTranslations('profile');
  const tHeader = useTranslations('header');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const PROFILE_TAB_KEYS: ProfileTab[] = ['group', 'datasource', 'statistics', 'badges', 'challenges', 'leaderboards', 'discover', 'share', 'notifications', 'personalInfo'];
  // null = landing (iOS-style list); a value = a detail screen open. Reads
  // ?tab= on mount and keeps the URL in sync on every change — without this,
  // refreshing while inside any detail screen (e.g. Notification Prefs)
  // silently dropped back to the landing list instead of staying put.
  const [activeTab, setActiveTabState] = useState<ProfileTab | null>(() => {
    const tab = searchParams.get('tab');
    return PROFILE_TAB_KEYS.includes(tab as ProfileTab) ? (tab as ProfileTab) : null;
  });
  const setActiveTab = useCallback((tab: ProfileTab | null) => {
    setActiveTabState(tab);
    router.replace(tab ? `/dashboard/profile?tab=${tab}` : '/dashboard/profile');
  }, [router]);
  const [athleteId, setAthleteId] = useState('');
  const [athleteName, setAthleteName] = useState('');
  const [athleteEmail, setAthleteEmail] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [currentGroupId, setCurrentGroupId] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
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

  useEffect(() => {
    fetch('/api/public/current-plan')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const plan = data?.plan;
        if (!plan?.parsed_workouts) return;
        const pw = plan.parsed_workouts;
        // Only the grouped shape (group1/2/3) can produce the ❶ (❷) ((❸)) copy.
        if (pw.group1 && pw.group2 && pw.group3) {
          setPlanWorkouts(pw as GroupedWeeklyPlans);
          setPlanWeekStart(plan.week_start_date);
          setPlanIsCurrent(!!plan.is_current);
        }
      })
      .catch(() => {});
  }, []);

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

    fetch('/api/groups')
      .then(res => res.json())
      .then(data => setGroups(data.groups || []))
      .catch(() => {});

    if (id) {
      fetch(`/api/athletes/me?id=${id}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.athlete) {
            setAvatarUrl(data.athlete.avatarUrl || null);
            setMemberSince(data.athlete.memberSince || null);
          }
        })
        .catch(() => {});
    }

    if (id) {
      fetch(`/api/athletes/${id}/connections`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) {
            setFollowingCount(data.followingCount || 0);
            setFollowingList(data.following || []);
          }
        })
        .catch(() => {});
    }

    if (id) {
      fetchActivities()
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const acts = data?.activities || [];
          // Endpoint is already scoped to this athlete; keep the filter as a
          // belt-and-suspenders guard.
          const myActs = acts.filter((a: any) => a.athlete_id === id);
          if (myActs.length > 0) setHasActivities(true);
        })
        .catch(() => {});

      fetch('/api/admin/athlete-source')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const me = data?.athletes?.find((a: any) => a.id === id);
          if (me) {
            setDataSource(me.dataSource || 'garmin');
            setHasGarmin(me.hasGarmin);
            setHasStrava(me.hasStrava);
            setStravaEnabled(me.stravaEnabled);
          } else {
            setHasGarmin(true);
            setDataSource('garmin');
          }
        })
        .catch(() => {
          setHasGarmin(true);
          setDataSource('garmin');
        });
    }
  }, []);

  const hasChanges = selectedGroupId !== currentGroupId;

  const saveGroup = async () => {
    if (!athleteId || !hasChanges) return;
    setSaving(true);
    setSaved(false);

    try {
      const res = await fetch('/api/athletes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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
          <User className="h-12 w-12 text-slate-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">{t('noProfileFound')}</h2>
          <p className="text-slate-400 text-sm">
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
      const res = await fetch('/api/athletes/avatar', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok && data.avatarUrl) setAvatarUrl(data.avatarUrl);
    } catch { /* ignore — keep existing photo */ }
    finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  const currentGroup = groups.find(g => g.id === currentGroupId);
  const currentWeek = WEEKS[0];

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
              <div className="bg-primary-600/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Loader2 className="h-8 w-8 text-primary-600 animate-spin" />
              </div>
              <p className="text-sm text-slate-400">{t('fetchingActivities')}</p>
            </>
          ) : (
            <>
              <div className="bg-green-500/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="h-8 w-8 text-green-400" />
              </div>
              <p className="text-sm text-slate-400">
                {syncModalCount > 0
                  ? t('syncedActivities', { count: syncModalCount })
                  : t('connectedSuccessfully')}
              </p>
              <button
                onClick={() => setShowSyncModal(false)}
                className="mt-5 w-full min-h-[48px] rounded-xl font-bold text-base bg-primary-600 hover:bg-primary-700 text-white transition-colors active:scale-[0.98]"
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
              <span className="text-sm font-medium text-slate-400 tabular-nums">{followingCount}</span>
            )}
          </span>
        }
        trailingAction={
          <button
            onClick={() => setShowFollowingSheet(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            aria-label={tCommon('close')}
          >
            <X className="h-5 w-5" />
          </button>
        }
        className="max-h-[80vh]"
        bodyClassName="px-4 py-2"
      >
        {followingList.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-8">{t('noFollowingYet')}</p>
        ) : (
          followingList.map(a => (
            <div key={a.id} className="flex items-center gap-3 py-2">
              <Link
                href={`/dashboard/teammate/${a.id}`}
                onClick={() => setShowFollowingSheet(false)}
                className="flex items-center gap-3 flex-1 min-w-0"
              >
                <FeedAvatar name={a.name} url={a.avatarUrl} />
                <span className="text-sm text-slate-200 truncate" dir="auto">{a.name}</span>
              </Link>
              <button
                onClick={() => handleUnfollow(a.id)}
                disabled={unfollowingId === a.id}
                className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:text-white hover:border-slate-500 transition-colors disabled:opacity-50"
              >
                {unfollowingId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('unfollow')}
              </button>
            </div>
          ))
        )}
      </Sheet>

      {/* ═══ HEADER — back-nav on a detail screen only (the Hero below already
          anchors the landing, like the reference Settings screen's h1) ═══ */}
      {activeTab !== null && (
        <BackNav label={t('title')} onBack={() => setActiveTab(null)} />
      )}

      {/* ═══ LANDING — hero (most-important info at a glance) + iOS-Settings
          inset list of rows that drill into detail screens ═══ */}
      {activeTab === null && (
        <>
          {/* Profile Hero */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600/15 via-slate-800/90 to-slate-800 border border-slate-700/50 p-6">
            <div className="absolute top-0 end-0 w-32 h-32 bg-primary-600/8 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl" />
            <div className="relative flex items-center gap-4">
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="relative w-16 h-16 rounded-full shrink-0 shadow-lg shadow-primary-600/20"
                aria-label={t('changePhoto')}
              >
                <span className="block w-full h-full rounded-full overflow-hidden">
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={athleteName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary-600 to-primary-700 text-xl font-bold text-white">{initials}</span>
                  )}
                </span>
                {/* Always-on corner badge — a hover-only overlay is invisible on touch */}
                <span className="absolute bottom-0 end-0 w-6 h-6 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center">
                  {uploadingPhoto ? <Loader2 className="h-3 w-3 text-white animate-spin" /> : <Camera className="h-3 w-3 text-white" />}
                </span>
              </button>
              <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-white truncate">{athleteName}</h1>
                {/* Strava/Garmin-only accounts get a synthetic placeholder address
                    (e.g. strava_123@strava.madregot.local) — never a real email,
                    so it's hidden rather than shown. */}
                {athleteEmail && !athleteEmail.endsWith('.madregot.local') && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="text-sm text-slate-400 truncate">{athleteEmail}</span>
                  </div>
                )}
                {memberSince && (
                  <p className="text-xs text-slate-500 mt-1">
                    {t('memberSince')} {new Date(memberSince).toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
                  </p>
                )}
                {currentGroup && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Target className="h-3.5 w-3.5 text-primary-600 shrink-0" />
                    <span className="text-sm font-medium text-primary-600">{currentGroup.marathonGoal || currentGroup.name}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              {hasGarmin && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
                  <Watch className="h-3.5 w-3.5 text-green-400" />
                  <span className="text-xs font-medium text-green-400">{tHeader('garminConnected')}</span>
                </div>
              )}
              {hasStrava && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20">
                  <Activity className="h-3.5 w-3.5 text-orange-400" />
                  <span className="text-xs font-medium text-orange-400">{t('connected')}</span>
                </div>
              )}
              {!hasGarmin && !hasStrava && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                  <WifiOff className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs font-medium text-amber-400">{t('noConnection')}</span>
                </div>
              )}
            </div>
          </div>

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
              iconBg="bg-primary-600"
              label={t('thisWeeksProgram')}
              value={currentWeek.weekLabel}
              href="/dashboard/program"
            />
          </InsetSection>

          <InsetSection header={t('myNumbers')}>
            <InsetRow
              icon={BarChart3}
              iconBg="bg-amber-500"
              label={t('statistics')}
              onClick={() => setActiveTab('statistics')}
            />
            <InsetRow
              icon={Award}
              iconBg="bg-yellow-500"
              label={t('badges')}
              onClick={() => setActiveTab('badges')}
            />
            <InsetRow
              icon={Trophy}
              iconBg="bg-orange-500"
              label={t('challenges')}
              onClick={() => setActiveTab('challenges')}
            />
            <InsetRow
              icon={Medal}
              iconBg="bg-yellow-600"
              label={t('leaderboards')}
              onClick={() => setActiveTab('leaderboards')}
            />
            <InsetRow
              icon={Route}
              iconBg="bg-cyan-500"
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
              iconBg="bg-blue-500"
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
              iconBg="bg-sky-500"
              label={t('discoverMembers')}
              onClick={() => setActiveTab('discover')}
            />
            <InsetRow
              icon={Activity}
              iconBg="bg-green-500"
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
              iconBg="bg-rose-500"
              label={t('notificationPrefs')}
              onClick={() => setActiveTab('notifications')}
            />
          </InsetSection>

          <ShoeManager athleteId={athleteId} />
        </>
      )}

      {/* ═══ DETAIL: Pace Group Selection ═══ */}
      {activeTab === 'group' && (
        <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-primary-600/15 flex items-center justify-center">
                <Users className="h-4.5 w-4.5 text-primary-600" />
              </div>
              <h2 className="font-semibold text-white">{t('paceGroup')}</h2>
            </div>
            {saved && (
              <div className="flex items-center gap-1.5 text-green-400">
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
                  iconBg={isSelected ? 'bg-primary-600' : 'bg-slate-600'}
                  label={g.name}
                  value={g.marathonGoal}
                  onClick={() => setSelectedGroupId(g.id)}
                  trailing={isSelected ? <CheckCircle2 className="h-5 w-5 text-primary-500" /> : undefined}
                />
              );
            })}
          </InsetSection>

          {hasActivities && (
            <p className="text-xs text-slate-500 mt-3 text-center">{t('groupLocked')}</p>
          )}

          {hasChanges && !hasActivities && (
            <button
              onClick={saveGroup}
              disabled={saving}
              className="mt-4 w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold px-4 py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
        <div ref={garminSectionRef} className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-9 h-9 rounded-lg bg-primary-600/15 flex items-center justify-center">
              <Activity className="h-4.5 w-4.5 text-primary-600" />
            </div>
            <h2 className="font-semibold text-white">{t('activityDataSource')}</h2>
          </div>

          <div className="space-y-3">
            {/* Garmin status */}
            <div className={cn(
              'rounded-xl border overflow-hidden',
              hasGarmin ? 'border-green-500/30 bg-green-500/5' : 'border-slate-700/50 bg-slate-900/30'
            )}>
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <Watch className={cn('h-5 w-5', hasGarmin ? 'text-green-400' : 'text-slate-500')} />
                  <div>
                    <p className={cn('text-sm font-medium', hasGarmin ? 'text-white' : 'text-slate-400')}>{t('garminConnect')}</p>
                    <p className="text-2xs text-slate-500">{hasGarmin ? t('connected') : t('notConnected')}</p>
                  </div>
                </div>
                {hasGarmin ? (
                  <span className="text-3xs font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">{t('connected')}</span>
                ) : (
                  <button
                    onClick={() => setConnectingGarmin(!connectingGarmin)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary-600/10 text-primary-600 hover:bg-primary-600/20 transition-colors"
                  >
                    {t('connect')}
                  </button>
                )}
              </div>
              {connectingGarmin && !hasGarmin && (
                <div className="px-4 pb-4 space-y-3 border-t border-slate-700/30 pt-3">
                  <input
                    type="email"
                    placeholder={t('garminEmail')}
                    value={garminEmail}
                    onChange={e => setGarminEmail(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
                  />
                  {!mfaRequired && (
                    <input
                      type="password"
                      placeholder={t('garminPassword')}
                      value={garminPassword}
                      onChange={e => setGarminPassword(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
                    />
                  )}
                  {mfaRequired && (
                    <div className="space-y-2">
                      <p className="text-xs text-amber-400">{t('verificationCodeSent')}</p>
                      <input
                        type="text"
                        placeholder={t('sixDigitCode')}
                        value={mfaCode}
                        onChange={e => setMfaCode(e.target.value)}
                        maxLength={6}
                        className="w-full px-3 py-2.5 rounded-lg bg-slate-900/50 border border-amber-500/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 text-center text-lg tracking-widest"
                      />
                    </div>
                  )}
                  {garminError && (
                    <p className="text-xs text-red-400">{garminError}</p>
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
                          headers: { 'Content-Type': 'application/json' },
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
                              headers: { 'Content-Type': 'application/json' },
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
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
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
                hasStrava ? 'border-orange-500/30 bg-orange-500/5' : 'border-slate-700/50 bg-slate-900/30'
              )}>
                <div className="flex items-center gap-3">
                  <Activity className={cn('h-5 w-5', hasStrava ? 'text-orange-400' : 'text-slate-500')} />
                  <div>
                    <p className={cn('text-sm font-medium', hasStrava ? 'text-white' : 'text-slate-400')}>{t('strava')}</p>
                    <p className="text-2xs text-slate-500">{hasStrava ? t('connected') : t('notConnected')}</p>
                  </div>
                </div>
                {hasStrava ? (
                  <span className="text-3xs font-bold px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400">{t('connected')}</span>
                ) : (
                  <button
                    onClick={async () => {
                      setConnectingStrava(true);
                      try {
                        const res = await fetch(`/api/strava?athleteId=${athleteId}`);
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
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ athleteId, dataSource: newSource }),
                });
                setDataSource(newSource);
              }}
              className="mt-4 w-full border border-slate-600 hover:border-slate-500 text-slate-300 hover:text-white font-medium px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Activity className="h-4 w-4" />
              {dataSource === 'strava' ? t('switchToGarmin') : t('switchToStrava')}
            </button>
          )}

          {!hasGarmin && !hasStrava && (
            <div className="mt-4 flex items-center gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3">
              <WifiOff className="h-4 w-4 shrink-0" />
              <span>{t('noDataSource')}</span>
            </div>
          )}

          {/* Manual Sync button - only for Strava if Garmin already has activities */}
          {!hasSynced && (hasStrava || (hasGarmin && !hasActivities)) && (
            <div className="mt-4 pt-4 border-t border-slate-700/30">
              <button
                onClick={async () => {
                  setSyncing(true);
                  setSyncResult(null);
                  try {
                    const results = await Promise.allSettled([
                      fetch('/api/strava/sync-activities', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ athleteId }),
                      }),
                    ]);
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
                className="w-full border border-slate-600 hover:border-primary-600/50 hover:bg-primary-600/5 text-slate-300 hover:text-white font-medium px-4 py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
                <p className={cn('text-xs mt-2 text-center', syncResult.includes(t('syncFailed')) ? 'text-red-400' : 'text-green-400')}>
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
        <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-primary-600/15 flex items-center justify-center">
                <Share2 className="h-4.5 w-4.5 text-primary-600" />
              </div>
              <div>
                <h2 className="font-semibold text-white">Share a workout</h2>
                {!planIsCurrent && planWeekStart && (
                  <p className="text-xs text-slate-500">Latest plan · week of {planWeekStart}</p>
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
              <pre className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-4 text-sm text-slate-200 whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto">
{shareText}
              </pre>
              <button
                onClick={copyShareText}
                className="mt-3 w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold px-4 py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy workout
                  </>
                )}
              </button>
              <p className="text-2xs text-slate-500 mt-2 text-center">
                Paces shown as ❶ (❷) ((❸)) for the three groups.
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-400 text-center py-4">Rest day — no workout to share.</p>
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

      <p className="text-center text-xs text-slate-500 mt-6 mb-2">מדרגות · גרסה {APP_VERSION}</p>
    </div>
  );
}
