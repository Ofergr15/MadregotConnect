'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Settings, Users, Loader2, CheckCircle2, ChevronDown, ChevronRight, AlertTriangle, X, Layout, Trash2, Shield, Watch, Mail, Clock, MessageSquare, Filter, Bug, Lightbulb, Dumbbell, MessageCircle, Smartphone, Bell, BellRing, User as UserIcon, Award, Trophy, ShoppingBag, Gift, UserPlus, Sprout } from 'lucide-react';
import { cn, resolveGroup } from '@/lib/utils';
import { NotificationCenter } from '@/components/NotificationCenter';
import { NotificationPrefs } from '@/components/NotificationPrefs';
import { PersonalInfo } from '@/components/PersonalInfo';
import { BadgeManager } from '@/components/BadgeManager';
import { ChallengeManager } from '@/components/ChallengeManager';
import { StoreManager } from '@/components/StoreManager';
import { PerksManager } from '@/components/PerksManager';
import CoreRunnersManager from '@/components/CoreRunnersManager';
import { MaintenanceRow, MaintenanceAllowlist } from '@/components/MaintenanceToggle';
import { WatchAlertsCard } from '@/components/WatchAlertsCard';
import { ReminderConfig } from '@/components/ReminderConfig';
import { MapPrefsRow } from '@/components/MapPrefsRow';
import RegistrationsQueue, { usePendingRegistrationsCount } from '@/components/RegistrationsQueue';
import { canGrantAdmin } from '@/lib/constants';
import { FeedbackAdmin } from '@/components/FeedbackAdmin';
import { apiHeaders, useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { useTranslations } from 'next-intl';
import { Sheet, ConfirmSheet, SegmentedControl, EmptyState, LoadingBlock, BackNav } from '@/components/ui';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';

type TFunc = ReturnType<typeof useTranslations>;

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'coach' | 'academy_coach' | 'runner' | 'core_runner' | 'academy_user' | 'viewer';
  groupId?: string;
  onboardingStatus?: string;
  approved?: boolean;
  approvedAt?: string | null;
  lastSeenAt?: string | null;
}

type Role = 'admin' | 'coach' | 'academy_coach' | 'runner' | 'core_runner' | 'academy_user' | 'viewer';

// Single source of truth for a role's display label — 'core_runner' has its
// own settings-namespace key; 'academy_coach'/'academy_user' have none (they
// only ever had a roleConfig label), so both must be special-cased here.
// Duplicating this per-component is exactly how it drifted before: the
// RoleDropdown picker had this special-casing, ConfirmDialog didn't, so
// confirming a change TO or FROM an academy role showed the raw
// "settings.academy_user" translation key instead of "Academy".
function getRoleLabel(role: Role, t: TFunc): string {
  if (role === 'core_runner') return t('coreRunner');
  if (role === 'academy_coach' || role === 'academy_user') return roleConfig[role].label;
  return t(role);
}

const roleConfig = {
  admin: { label: 'Admin', bg: 'bg-purple-500/15', text: 'text-purple-800', border: 'border-purple-500/30', dot: 'bg-purple-400' },
  coach: { label: 'Coach', bg: 'bg-band-2/15', text: 'text-band-2-ink', border: 'border-band-2/30', dot: 'bg-band-2' },
  academy_coach: { label: 'Academy Coach', bg: 'bg-band-2/15', text: 'text-band-2-ink', border: 'border-band-2/30', dot: 'bg-band-2' },
  runner: { label: 'Runner', bg: 'bg-accent-600/15', text: 'text-accent-900', border: 'border-accent-600/30', dot: 'bg-accent-600' },
  core_runner: { label: 'Core Runner', bg: 'bg-accent-600/15', text: 'text-accent-900', border: 'border-accent-600/30', dot: 'bg-accent-600' },
  academy_user: { label: 'Academy', bg: 'bg-brand-600/15', text: 'text-brand-600', border: 'border-brand-600/30', dot: 'bg-brand-600' },
  viewer: { label: 'Viewer', bg: 'bg-ink-300/15', text: 'text-ink-400', border: 'border-ink-300/30', dot: 'bg-ink-300' },
};

function RoleDropdown({ value, onChange, disabled, canGrantAdmin, t }: { value: Role; onChange: (role: Role) => void; disabled: boolean; canGrantAdmin: boolean; t: TFunc }) {
  const [open, setOpen] = useState(false);
  const config = roleConfig[value];

  return (
    <>
      <button
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors',
          config.bg, config.text, config.border,
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-125 cursor-pointer'
        )}
      >
        <span className={cn('w-1.5 h-1.5 rounded-full', config.dot)}></span>
        {getRoleLabel(value, t)}
        <ChevronDown className="h-3 w-3" />
      </button>

      {/* Native-style bottom sheet role picker — replaces the hand-rolled
          absolutely-positioned floating menu (no iOS equivalent for that). */}
      <Sheet open={open} onOpenChange={setOpen} title={t('changeRole')}>
        <div className="rounded-2xl bg-page/40 overflow-hidden divide-y divide-page/50">
          {allRoles
            // Only the club admin account may assign the Admin role; hide it for
            // everyone else. The server (PUT /api/admin/users) enforces this too.
            .filter(role => role !== 'admin' || canGrantAdmin)
            .map(role => {
              const isSelected = role === value;
              return (
                <InsetRow
                  key={role}
                  label={getRoleLabel(role, t)}
                  onClick={() => { onChange(role); setOpen(false); }}
                  trailing={isSelected ? <CheckCircle2 className="h-4 w-4 text-brand-600" /> : <span className="w-4 h-4" />}
                />
              );
            })}
        </div>
      </Sheet>
    </>
  );
}

// A filter-bar chip that opens a bottom sheet of tappable InsetRows — the
// mobile-native replacement for a raw `<select>` used for closed-but-longer
// option sets (role, group) where a SegmentedControl wouldn't fit a row.
function FilterPickerButton<T extends string>({ value, onChange, options, title, label }: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  title: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find(o => o.value === value);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-page border border-page text-sm text-ink-700 hover:border-ink-300 transition-colors"
      >
        <span className="truncate max-w-[110px]">{current?.label ?? label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-ink-400 shrink-0" />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={title}>
        <div className="rounded-2xl bg-page/40 overflow-hidden divide-y divide-page/50">
          {options.map(opt => (
            <InsetRow
              key={opt.value}
              label={opt.label}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              trailing={opt.value === value ? <CheckCircle2 className="h-4 w-4 text-brand-600" /> : <span className="w-4 h-4" />}
            />
          ))}
        </div>
      </Sheet>
    </>
  );
}

interface ConfirmDialogProps {
  user: User;
  newRole: Role;
  onConfirm: () => void;
  onCancel: () => void;
  t: TFunc;
  tc: TFunc;
}

function ConfirmDialog({ user, newRole, onConfirm, onCancel, t, tc }: ConfirmDialogProps) {
  const warning =
    (newRole === 'admin' || newRole === 'coach') && user.role !== 'admin' && user.role !== 'coach'
      ? t('roleChangeWarnToCoach')
      : (newRole === 'runner' || newRole === 'core_runner' || newRole === 'viewer') && (user.role === 'admin' || user.role === 'coach')
        ? t('roleChangeWarnToAthlete')
        : '';

  const description = [
    t('changeRoleConfirm', { name: user.name, oldRole: getRoleLabel(user.role, t), newRole: getRoleLabel(newRole, t) }),
    warning,
  ].filter(Boolean).join(' ');

  return (
    <ConfirmSheet
      open
      onOpenChange={(o) => { if (!o) onCancel(); }}
      title={t('changeRole')}
      description={description}
      confirmLabel={t('confirmChange')}
      cancelLabel={tc('cancel')}
      danger={false}
      onConfirm={onConfirm}
    />
  );
}

interface TabPermission {
  role: string;
  tab: string;
  enabled: boolean;
}

const allTabs = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'plan/new', label: 'Weekly Planner' },
  { key: 'athletes', label: 'Athletes' },
  { key: 'academy', label: 'Academy' },
  { key: 'groups', label: 'Groups' },
  { key: 'practice-attendance', label: 'Practice Attendance' },
  { key: 'workout-feedback', label: 'Workout Feedback' },
  { key: 'team-volume', label: 'Team Volume' },
  { key: 'activities', label: 'Activities' },
  { key: 'program', label: 'Program' },
  { key: 'review', label: 'Review' },
  { key: 'history', label: 'History' },
  { key: 'photos', label: 'Photos' },
  { key: 'settings', label: 'Settings' },
];

const allMobileTabs = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'athletes', label: 'Athletes' },
  { key: 'academy', label: 'Academy' },
  { key: 'activities', label: 'Activities' },
  { key: 'program', label: 'Program' },
  { key: 'practice', label: 'Practice' },
  { key: 'photos', label: 'Photos' },
  { key: 'settings', label: 'Settings' },
];

const allRoles: Role[] = ['admin', 'coach', 'academy_coach', 'runner', 'core_runner', 'academy_user', 'viewer'];

type SettingsTab = 'users' | 'tabs' | 'feedback' | 'notifications' | 'reminders' | 'notifprefs' | 'personalInfo' | 'badges' | 'challenges' | 'store' | 'perks' | 'registrations' | 'coreRunners';

const settingsTabs = [
  // iconBg = the colored glyph tile (panel-18 iOS-Settings look).
  { key: 'registrations' as SettingsTab, label: 'Registrations', icon: UserPlus, iconBg: 'bg-accent-600' },
  { key: 'users' as SettingsTab, label: 'User Manager', icon: Users, iconBg: 'bg-indigo-500' },
  // Directly under User Manager, because that is where somebody looking to tag a
  // person goes first — and the גרעין is no longer something the role dropdown there
  // can express (migration 091).
  { key: 'coreRunners' as SettingsTab, label: 'הגרעין', icon: Sprout, iconBg: 'bg-lime-600' },
  { key: 'tabs' as SettingsTab, label: 'Tab Manager', icon: Layout, iconBg: 'bg-band-3' },
  { key: 'feedback' as SettingsTab, label: 'Feedback', icon: MessageSquare, iconBg: 'bg-teal-500' },
  { key: 'notifications' as SettingsTab, label: 'Notifications', icon: Bell, iconBg: 'bg-accent-red' },
  { key: 'badges' as SettingsTab, label: 'Badge Manager', icon: Award, iconBg: 'bg-fuchsia-500' },
  { key: 'challenges' as SettingsTab, label: 'Challenge Manager', icon: Trophy, iconBg: 'bg-band-3' },
  { key: 'store' as SettingsTab, label: 'Store Manager', icon: ShoppingBag, iconBg: 'bg-band-2' },
  { key: 'perks' as SettingsTab, label: 'Perks Manager', icon: Gift, iconBg: 'bg-pink-600' },
];

function getOnboardingStep(status: string | undefined, approved: boolean | undefined): { step: number; label: string; color: string } {
  if (approved === true) return { step: 3, label: 'Active', color: 'text-accent-600' };
  if (status === 'garmin_authed') return { step: 2, label: 'Awaiting approval', color: 'text-band-3' };
  if (status === 'google_authed') return { step: 1, label: 'Needs Garmin', color: 'text-band-3' };
  return { step: 0, label: 'Pending', color: 'text-ink-400' };
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');

  // null = the Settings landing (iOS-style list); a value = a detail screen
  // open. The 8 "ניהול" rows now live in Coach Tools and link here with
  // ?tab=<key> so their detail screens still open directly, no duplication.
  // personalInfo/notifprefs aren't in that grid (they're their own always-
  // visible rows above it) but are still real, refreshable deep-link targets.
  const router = useRouter();
  const searchParams = useSearchParams();
  // 'reminders' is listed by hand because it has a detail screen (ReminderConfig)
  // but no entry in `settingsTabs` — so Coach Tools' ?tab=reminders link was
  // being rejected here and silently dropped the reader on the landing list.
  const ALL_TAB_KEYS: SettingsTab[] = [...settingsTabs.map(st => st.key), 'personalInfo', 'notifprefs', 'reminders'];
  const [activeTab, setActiveTabState] = useState<SettingsTab | null>(() => {
    const tab = searchParams.get('tab');
    return ALL_TAB_KEYS.includes(tab as SettingsTab) ? (tab as SettingsTab) : null;
  });
  // Keeps the URL in sync with whichever detail screen is open — without
  // this, opening a tab via setActiveTab (as opposed to a real ?tab= link)
  // left the URL at bare /dashboard/settings, so refreshing while inside any
  // such screen silently dropped back to the landing grid instead of staying
  // put. replace (not push) so tab switches don't pile up browser history.
  const setActiveTab = (tab: SettingsTab | null) => {
    setActiveTabState(tab);
    router.replace(tab ? `/dashboard/settings?tab=${tab}` : '/dashboard/settings');
  };
  // The signed-in athlete's own id — powers the personal notification-prefs
  // detail (coaches are athletes too; null if this account has no athlete row).
  const [notifPrefsAthleteId, setNotifPrefsAthleteId] = useState('');
  useEffect(() => { setNotifPrefsAthleteId(localStorage.getItem('athlete_id') || ''); }, []);
  const [users, setUsers] = useState<User[]>([]);
  // These three start true meaning "not fetched yet" — the fetches are lazy now
  // (see the activeTab effect below), so the flag has to already be set when the
  // screen that reads it first renders, or it flashes an empty roster / "no
  // feedback yet" for a frame before its request has even started. Each is only
  // ever read inside its own detail screen, so one staying true forever because
  // that screen was never opened costs nothing.
  const [loading, setLoading] = useState(true);
  // Whether the signed-in account may grant the admin role. Still computed from
  // the address, because ADMIN_GRANTER_EMAIL is the club account and not affected
  // by the synthetic-email problem below. The server re-checks it anyway.
  const [canGrantAdminHere, setCanGrantAdminHere] = useState(false);
  const [updatingUsers, setUpdatingUsers] = useState<Set<string>>(new Set());
  const [savedUsers, setSavedUsers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<{ user: User; newRole: Role } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<TabPermission[]>([]);
  const [savedPermissions, setSavedPermissions] = useState<TabPermission[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [mobilePermissions, setMobilePermissions] = useState<TabPermission[]>([]);
  const [savedMobilePermissions, setSavedMobilePermissions] = useState<TabPermission[]>([]);
  const [mobilePermissionsLoading, setMobilePermissionsLoading] = useState(true);
  const [savingMobilePermissions, setSavingMobilePermissions] = useState(false);
  // Group names, to label the group sub-sections in User Manager. Same SWR key
  // the Header holds on every screen, so this is a cache read; keyed on the tab
  // so the landing still doesn't ask for it.
  const { data: groupsData } = useApi<{ groups?: Array<{ id: string; name: string }> }>(
    activeTab === 'users' ? '/api/groups' : null,
  );
  const groupsById: Record<string, string> = {};
  (groupsData?.groups || []).forEach(g => { groupsById[g.id] = g.name; });
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [uSearch, setUSearch] = useState('');
  const [uRole, setURole] = useState<'all' | Role>('all');
  const [uGroup, setUGroup] = useState<'all' | '0' | '1' | '2' | 'none'>('all');
  const [uGarmin, setUGarmin] = useState<'all' | 'with' | 'without'>('all');

  useEffect(() => {
    const me = localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
    setCanGrantAdminHere(canGrantAdmin(me));
  }, []);

  // Approver rights come from the server, not from the address in localStorage.
  // Two reasons the old way was wrong: localStorage is not identity, and an
  // account signed in through Strava carries a synthetic address that can never
  // match APPROVER_EMAILS — so the Approve button vanished for a genuine
  // approver. /api/auth/me resolves it from the athlete row (migration 084) or
  // the literal, whichever says yes. The Header holds this same SWR key on every
  // screen, so this is a cache read rather than another request.
  const { data: meData } = useApi<{ canApprove?: boolean }>('/api/auth/me');
  const canApproveHere = !!meData?.canApprove;

  // Drives the badge on the "הרשמות" row. Same SWR key the queue itself reads,
  // so opening it is a cache hit and the count on the landing can't disagree
  // with the list inside.
  const pendingRegistrations = usePendingRegistrationsCount(canApproveHere);

  // Which datasets have already been requested, so re-opening a detail screen
  // (or bouncing back to the landing and in again) doesn't refetch. The mutation
  // handlers below call their fetcher directly and deliberately bypass this.
  const requested = useRef(new Set<string>());
  const loadOnce = (key: string, load: () => void) => {
    if (requested.current.has(key)) return;
    requested.current.add(key);
    load();
  };

  // Load per detail screen, not on mount. This page is a landing list of rows
  // that drill into detail screens, and it used to open five requests before
  // rendering any of it — the whole roster, both permission matrices and every
  // feedback item — for a screen showing three rows, none of which use any of
  // it. Worse, the render was gated on `if (loading)`, so the landing sat behind
  // a full-page spinner waiting for /api/admin/users to deliver data it never
  // displayed. Landing is now zero requests, and each screen pays only for
  // itself. `activeTab` is already set from ?tab= on the first render, so a
  // deep link straight into a screen still fetches immediately.
  useEffect(() => {
    if (activeTab === 'users') {
      loadOnce('users', fetchUsers);
    } else if (activeTab === 'tabs') {
      loadOnce('permissions', fetchPermissions);
      loadOnce('mobilePermissions', fetchMobilePermissions);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const toggleSection = (key: string) =>
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // One member row (used inside the role/group sections of User Manager).
  const renderUserRow = (user: User) => {
    const isAdmin = user.role === 'admin';
    let lastSeenLabel = t('never');
    let lastSeenColor = 'text-ink-400';
    if (user.lastSeenAt) {
      const hoursAgo = (Date.now() - new Date(user.lastSeenAt).getTime()) / 3600000;
      if (hoursAgo < 1) { lastSeenLabel = t('online'); lastSeenColor = 'text-accent-600'; }
      else if (hoursAgo < 24) { lastSeenLabel = t('hoursAgo', { hours: Math.floor(hoursAgo) }); lastSeenColor = 'text-accent-600'; }
      else { lastSeenLabel = t('daysAgo', { days: Math.floor(hoursAgo / 24) }); lastSeenColor = hoursAgo < 72 ? 'text-ink-400' : 'text-ink-400'; }
    }
    return (
      <div
        key={user.id}
        className={cn(
          'flex items-center gap-3 p-3.5 rounded-xl transition-all',
          isAdmin
            ? 'bg-purple-500/5 border border-purple-500/20'
            : 'bg-page/40 border border-transparent hover:border-page/50 hover:bg-page/60'
        )}
      >
        <div className={cn('w-10 h-10 rounded-full flex items-center justify-center shrink-0', isAdmin ? 'bg-purple-500/20' : 'bg-page/50')}>
          {isAdmin ? (
            <Shield className="w-4.5 h-4.5 text-purple-600" />
          ) : (
            <span className="text-xs font-bold text-ink-500">{user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-ink-700 truncate">{user.name}</p>
            {isAdmin && <span className="text-3xs font-bold text-purple-800 bg-purple-500/15 px-1.5 py-0.5 rounded">{t('admin').toUpperCase()}</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-ink-400 truncate">{user.email}</span>
            <span className={cn('text-3xs font-medium', lastSeenColor)}>{lastSeenLabel}</span>
            {user.onboardingStatus === 'garmin_authed' && (
              <span className="text-3xs font-bold px-1.5 py-0.5 rounded bg-accent-600/15 text-accent-900 border border-accent-600/20 flex items-center gap-1">
                <Watch className="w-2.5 h-2.5" />{t('garmin')}
              </span>
            )}
            {user.onboardingStatus === 'google_authed' && (
              <span className="text-3xs font-bold px-1.5 py-0.5 rounded bg-band-3/15 text-band-3-ink border border-band-3/20">{t('googleOnly')}</span>
            )}
            {user.approved === false && (
              <span className="text-3xs font-bold px-1.5 py-0.5 rounded bg-accent-red/15 text-accent-red-ink border border-accent-red/20">{t('pending')}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {savedUsers.has(user.id) && <CheckCircle2 className="w-4 h-4 text-accent-600" />}
          {updatingUsers.has(user.id) && <Loader2 className="w-4 h-4 text-ink-400 animate-spin" />}
          {!isAdmin && (
            <>
              <RoleDropdown value={user.role} onChange={(role) => handleRoleSelect(user, role)} disabled={updatingUsers.has(user.id)} canGrantAdmin={canGrantAdminHere} t={t} />
              <button
                onClick={() => setPendingDelete(user)}
                disabled={updatingUsers.has(user.id)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-400 hover:text-accent-red active:text-accent-red hover:bg-accent-red/10 active:bg-accent-red/10 rounded-lg transition-colors disabled:opacity-50"
                title={t('deleteUser')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const fetchPermissions = async () => {
    try {
      setPermissionsLoading(true);
      const response = await fetch('/api/admin/tab-permissions');
      if (!response.ok) throw new Error('Failed to fetch permissions');
      const data = await response.json();
      setPermissions(data.permissions || []);
      setSavedPermissions(data.permissions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load permissions');
    } finally {
      setPermissionsLoading(false);
    }
  };

  const fetchMobilePermissions = async () => {
    try {
      setMobilePermissionsLoading(true);
      const response = await fetch('/api/admin/mobile-tab-permissions');
      if (!response.ok) {
        setMobilePermissions([]);
        setSavedMobilePermissions([]);
        return;
      }
      const data = await response.json();
      setMobilePermissions(data.permissions || []);
      setSavedMobilePermissions(data.permissions || []);
    } catch {
      setMobilePermissions([]);
      setSavedMobilePermissions([]);
    } finally {
      setMobilePermissionsLoading(false);
    }
  };

  const toggleMobilePermission = (role: string, tab: string, currentEnabled: boolean) => {
    setMobilePermissions(prev =>
      prev.map(p => p.role === role && p.tab === tab ? { ...p, enabled: !currentEnabled } : p)
    );
  };

  const hasMobilePermissionChanges = mobilePermissions.some(p => {
    const saved = savedMobilePermissions.find(s => s.role === p.role && s.tab === p.tab);
    return saved?.enabled !== p.enabled;
  });

  const saveMobilePermissions = async () => {
    setSavingMobilePermissions(true);
    try {
      const changed = mobilePermissions.filter(p => {
        const saved = savedMobilePermissions.find(s => s.role === p.role && s.tab === p.tab);
        return saved?.enabled !== p.enabled;
      });
      // One token read for the whole batch, not one per changed row.
      const headers = await bearerHeaders();
      await Promise.all(
        changed.map(p =>
          fetch('/api/admin/mobile-tab-permissions', {
            method: 'PUT',
            headers,
            body: JSON.stringify({ role: p.role, tab: p.tab, enabled: p.enabled }),
          })
        )
      );
      setSavedMobilePermissions([...mobilePermissions]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save mobile permissions');
    } finally {
      setSavingMobilePermissions(false);
    }
  };

  const discardMobilePermissionChanges = () => {
    setMobilePermissions([...savedMobilePermissions]);
  };

  const isMobileTabEnabled = (role: string, tab: string) => {
    const perm = mobilePermissions.find(p => p.role === role && p.tab === tab);
    return perm?.enabled ?? false;
  };

  const togglePermission = (role: string, tab: string, currentEnabled: boolean) => {
    setPermissions(prev =>
      prev.map(p => p.role === role && p.tab === tab ? { ...p, enabled: !currentEnabled } : p)
    );
  };

  const hasPermissionChanges = permissions.some(p => {
    const saved = savedPermissions.find(s => s.role === p.role && s.tab === p.tab);
    return saved?.enabled !== p.enabled;
  });

  const savePermissions = async () => {
    setSavingPermissions(true);
    try {
      const changed = permissions.filter(p => {
        const saved = savedPermissions.find(s => s.role === p.role && s.tab === p.tab);
        return saved?.enabled !== p.enabled;
      });
      const headers = await bearerHeaders();
      await Promise.all(
        changed.map(p =>
          fetch('/api/admin/tab-permissions', {
            method: 'PUT',
            headers,
            body: JSON.stringify({ role: p.role, tab: p.tab, enabled: p.enabled }),
          })
        )
      );
      setSavedPermissions([...permissions]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save permissions');
    } finally {
      setSavingPermissions(false);
    }
  };

  const discardPermissionChanges = () => {
    setPermissions([...savedPermissions]);
  };

  const isTabEnabled = (role: string, tab: string) => {
    const perm = permissions.find(p => p.role === role && p.tab === tab);
    return perm?.enabled ?? false;
  };

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/admin/users', { headers: await apiHeaders() });
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(data.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (user: User) => {
    setUpdatingUsers(prev => new Set(prev).add(user.id));
    try {
      // The approver is taken from the verified session server-side — sending it
      // from here would only be advisory.
      const response = await fetch('/api/admin/approve', {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({ athleteId: user.id }),
      });
      if (!response.ok) throw new Error('Failed to approve');
      await fetchUsers();
      setSavedUsers(prev => new Set(prev).add(user.id));
      setTimeout(() => {
        setSavedUsers(prev => { const s = new Set(prev); s.delete(user.id); return s; });
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve user');
    } finally {
      setUpdatingUsers(prev => { const s = new Set(prev); s.delete(user.id); return s; });
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const user = pendingDelete;
    setPendingDelete(null);
    setUpdatingUsers(prev => new Set(prev).add(user.id));
    try {
      const response = await fetch(`/api/admin/users?id=${user.id}`, { method: 'DELETE', headers: await apiHeaders() });
      if (!response.ok) throw new Error('Failed to delete');
      await fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    } finally {
      setUpdatingUsers(prev => { const s = new Set(prev); s.delete(user.id); return s; });
    }
  };

  const handleRoleSelect = (user: User, newRole: Role) => {
    if (newRole === user.role) return;
    setPendingChange({ user, newRole });
  };

  const confirmRoleChange = async () => {
    if (!pendingChange) return;
    const { user, newRole } = pendingChange;
    setPendingChange(null);

    setUpdatingUsers(prev => new Set(prev).add(user.id));
    setSavedUsers(prev => { const s = new Set(prev); s.delete(user.id); return s; });

    try {
      // No actorEmail — who may grant a role (and specifically who may grant
      // 'admin') is decided from the verified session server-side.
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: await apiHeaders(true),
        body: JSON.stringify({ email: user.email, role: newRole }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || data.error || 'Failed to update user role');
      }

      await fetchUsers();
      setSavedUsers(prev => new Set(prev).add(user.id));
      setTimeout(() => {
        setSavedUsers(prev => { const s = new Set(prev); s.delete(user.id); return s; });
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
      fetchUsers();
    } finally {
      setUpdatingUsers(prev => { const s = new Set(prev); s.delete(user.id); return s; });
    }
  };

  const pendingUsers = users.filter(u => u.approved === false);
  const allActiveUsers = users.filter(u => u.approved !== false);
  // Apply the User Manager filter bar (name / role / group / garmin).
  const activeUsers = allActiveUsers.filter(u => {
    if (uSearch.trim()) {
      const q = uSearch.trim().toLowerCase();
      if (!(`${u.name} ${u.email}`.toLowerCase().includes(q))) return false;
    }
    if (uRole !== 'all' && u.role !== uRole) return false;
    if (uGroup !== 'all') {
      const idx = u.groupId ? resolveGroup(groupsById[u.groupId]).index : -1;
      if (uGroup === 'none' ? idx >= 0 : idx !== Number(uGroup)) return false;
    }
    if (uGarmin !== 'all') {
      const hasGarmin = u.onboardingStatus === 'garmin_authed';
      if (uGarmin === 'with' ? !hasGarmin : hasGarmin) return false;
    }
    return true;
  });
  const uFiltersActive = uSearch.trim() !== '' || uRole !== 'all' || uGroup !== 'all' || uGarmin !== 'all';

  return (
    <div className="max-w-4xl mx-auto">
      {pendingChange && (
        <ConfirmDialog
          user={pendingChange.user}
          newRole={pendingChange.newRole}
          onConfirm={confirmRoleChange}
          onCancel={() => setPendingChange(null)}
          t={t}
          tc={tc}
        />
      )}

      <ConfirmSheet
        open={!!pendingDelete}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        title={t('deleteUser')}
        description={pendingDelete ? t('deleteUserConfirm', { name: pendingDelete.name, email: pendingDelete.email }) : undefined}
        confirmLabel={t('deleteUser')}
        cancelLabel={tc('cancel')}
        onConfirm={handleDelete}
      />

      {/* ═══ HEADER — large title on the landing; back-nav on a detail screen ═══ */}
      {activeTab === null ? (
        <div className="mb-5">
          <h1 className="text-3xl font-extrabold text-ink-700 tracking-tight" dir="rtl">{t('title')}</h1>
        </div>
      ) : (
        <BackNav label={t('title')} onBack={() => setActiveTab(null)} className="mb-4" />
      )}

      {/* ═══ LANDING — iOS-Settings inset lists (drill into detail screens) ═══ */}
      {activeTab === null && (
        <>
          {/* People waiting to be let into the club — first thing an approver
              sees, with the count on the row so the answer to "is anyone
              waiting?" costs no taps at all. Hidden entirely for everyone else:
              this screen is a list of strangers' email addresses. */}
          {canApproveHere && (
            <InsetSection>
              <InsetRow
                icon={UserPlus}
                iconBg="bg-accent-600"
                label={t('registrations')}
                sublabel={
                  pendingRegistrations === null
                    ? undefined
                    : pendingRegistrations === 0
                      ? t('registrationsNoneWaiting')
                      : t('registrationsWaiting', { count: pendingRegistrations })
                }
                onClick={() => setActiveTab('registrations')}
                trailing={
                  <span className="flex items-center gap-2 shrink-0">
                    {!!pendingRegistrations && (
                      <span className="min-w-[22px] px-1.5 py-0.5 rounded-pill bg-accent-red text-white text-3xs font-bold text-center tabular-nums">
                        {pendingRegistrations}
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-ink-400 shrink-0 rotate-180" />
                  </span>
                }
              />
            </InsetSection>
          )}

          {/* Challenge Manager, back on the Settings landing.
              The other 9 management rows live only in Coach Tools (see the
              comment above ALL_TAB_KEYS) and that stays true — but "create a
              challenge" is the one of them an admin goes looking for *in
              Settings*, and until now the only way in was Coach Tools or a
              hand-typed ?tab=challenges. Same detail screen either way. */}
          {canApproveHere && (
            <InsetSection header={t('management')}>
              <InsetRow
                icon={Trophy}
                iconBg="bg-band-3"
                label={t('challengeManager')}
                onClick={() => setActiveTab('challenges')}
                trailing={<ChevronRight className="h-4 w-4 text-ink-400 shrink-0 rotate-180" />}
              />
            </InsetSection>
          )}

          {/* First card: maintenance toggle + reminders, grouped like the reference. */}
          <InsetSection>
            <MaintenanceRow />
            <InsetRow
              icon={UserIcon}
              iconBg="bg-violet-500"
              label={t('personalInfo')}
              onClick={() => setActiveTab('personalInfo')}
              trailing={<ChevronRight className="h-4 w-4 text-ink-400 shrink-0 rotate-180" />}
            />
            <InsetRow
              icon={BellRing}
              iconBg="bg-accent-red"
              label={t('notificationPrefs')}
              onClick={() => setActiveTab('notifprefs')}
              trailing={<ChevronRight className="h-4 w-4 text-ink-400 shrink-0 rotate-180" />}
            />
            <MapPrefsRow />
          </InsetSection>

          {/* Allowlist editor — only appears while maintenance is on. */}
          <MaintenanceAllowlist />

          {/* Moved here from the (now hero-only) home page — a settings-style
              tip, self-dismissible, doesn't belong on a "what do I do today" screen. */}
          <div className="mb-5">
            <WatchAlertsCard />
          </div>
        </>
      )}

      {/* Registrations detail — the /register approval queue. The component
          re-checks canApprove against /api/auth/me itself, so a hand-typed
          ?tab=registrations doesn't get a list. */}
      {activeTab === 'registrations' && <RegistrationsQueue />}

      {/* Reminders detail */}
      {activeTab === 'reminders' && <ReminderConfig />}

      {/* Notification preferences detail (per-user category toggles) */}
      {activeTab === 'notifprefs' && notifPrefsAthleteId && <NotificationPrefs athleteId={notifPrefsAthleteId} />}
      {activeTab === 'notifprefs' && !notifPrefsAthleteId && (
        <p className="text-sm text-ink-400 text-center py-10" dir="auto">{t('notifPrefsSignIn')}</p>
      )}

      {/* Personal info detail (birth date / gender / shoe size) */}
      {activeTab === 'personalInfo' && notifPrefsAthleteId && <PersonalInfo athleteId={notifPrefsAthleteId} />}
      {activeTab === 'personalInfo' && !notifPrefsAthleteId && (
        <p className="text-sm text-ink-400 text-center py-10" dir="auto">{t('personalInfoSignIn')}</p>
      )}

      {error && (
        <div className="mb-6 p-4 bg-accent-red/10 border border-accent-red/20 rounded-xl flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-accent-red shrink-0" />
          <p className="text-accent-red text-sm">{error}</p>
          <button onClick={() => setError(null)} className="ms-auto min-h-[44px] min-w-[44px] flex items-center justify-center text-accent-red hover:text-accent-red -my-2 -me-2">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* User Manager Tab — the roster spinner belongs HERE, not around the whole
          page: the landing and every other detail screen render without it. */}
      {activeTab === 'users' && loading && <LoadingBlock className="min-h-[60vh]" size={32} />}
      {activeTab === 'users' && !loading && (
        <div className="space-y-4">
          {/* Pending Approval Section (collapsible) */}
          {pendingUsers.length > 0 && (() => {
            const pendOpen = !collapsedSections.has('pending');
            return (
            <div className="rounded-2xl border border-band-3/20 bg-band-3/5 p-4">
              <button
                onClick={() => toggleSection('pending')}
                className="w-full flex items-center gap-2 mb-3"
              >
                {pendOpen ? <ChevronDown className="w-4 h-4 text-band-3" /> : <ChevronRight className="w-4 h-4 text-band-3" />}
                <Clock className="w-4 h-4 text-band-3" />
                <h3 className="text-sm font-semibold text-band-3">{t('pendingApproval')} ({pendingUsers.length})</h3>
              </button>
              {pendOpen && (
              <div className="space-y-2">
                {pendingUsers.map(user => {
                  const onboarding = getOnboardingStep(user.onboardingStatus, user.approved);
                  return (
                    <div key={user.id} className="flex items-center gap-3 p-3 rounded-xl bg-card/80 border border-page/50">
                      <div className="w-9 h-9 rounded-full bg-band-3/15 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-band-3">
                          {user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink-700 truncate">{user.name}</p>
                        <p className="text-xs text-ink-400 truncate">{user.email}</p>
                      </div>

                      {/* Status chips */}
                      <div className="hidden sm:flex items-center gap-1.5">
                        <span className={cn(
                          'text-3xs font-semibold px-2 py-0.5 rounded-full',
                          onboarding.step >= 1 ? 'bg-accent-600/15 text-accent-900' : 'bg-page text-ink-400'
                        )}>{t('google')}</span>
                        <span className={cn(
                          'text-3xs font-semibold px-2 py-0.5 rounded-full',
                          onboarding.step >= 2 ? 'bg-accent-600/15 text-accent-900' : 'bg-page text-ink-400'
                        )}>{t('garmin')}</span>
                      </div>

                      {canApproveHere ? (
                        <button
                          onClick={() => handleApprove(user)}
                          disabled={updatingUsers.has(user.id)}
                          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-accent-600 hover:opacity-90 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                        >
                          {updatingUsers.has(user.id) ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          {t('approve')}
                        </button>
                      ) : (
                        <span className="text-3xs font-medium text-ink-400 shrink-0 px-2 py-1 rounded bg-page/40">
                          {t('awaitingApproval')}
                        </span>
                      )}
                      <button
                        onClick={() => setPendingDelete(user)}
                        disabled={updatingUsers.has(user.id)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-400 hover:text-accent-red active:text-accent-red hover:bg-accent-red/10 active:bg-accent-red/10 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
              )}
            </div>
            );
          })()}

          {/* Active Users — collapsible section per role, split by group inside */}
          <div className="rounded-card border border-page/50 bg-card/50 overflow-hidden">
            <div className="px-5 py-4 border-b border-page/50 flex items-center gap-2">
              <Users className="w-4 h-4 text-ink-400" />
              <h2 className="text-sm font-semibold text-ink-700">
                {t('members')} ({uFiltersActive ? `${activeUsers.length} of ${allActiveUsers.length}` : activeUsers.length})
              </h2>
            </div>

            {/* Filter bar: name / role / group / garmin */}
            <div className="px-4 py-3 border-b border-page/50 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[160px]">
                <Filter className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
                <input
                  value={uSearch}
                  onChange={e => setUSearch(e.target.value)}
                  placeholder={t('searchNameOrEmail')}
                  className="w-full bg-page border border-page rounded-lg ps-9 pe-3 h-9 text-sm text-ink-700 placeholder:text-ink-400 focus:outline-none focus:border-brand-600"
                />
              </div>
              <FilterPickerButton<'all' | Role>
                value={uRole}
                onChange={setURole}
                title={t('filterByRole')}
                label={t('allRoles')}
                options={[
                  { value: 'all', label: t('allRoles') },
                  ...allRoles.map(r => ({ value: r, label: roleConfig[r]?.label || r })),
                ]}
              />
              <FilterPickerButton<'all' | '0' | '1' | '2' | 'none'>
                value={uGroup}
                onChange={setUGroup}
                title={t('filterByGroup')}
                label={t('allGroups')}
                options={[
                  { value: 'all', label: t('allGroups') },
                  { value: '0', label: t('group1') },
                  { value: '1', label: t('group2') },
                  { value: '2', label: t('group3') },
                  { value: 'none', label: t('noGroup') },
                ]}
              />
              <SegmentedControl<'all' | 'with' | 'without'>
                value={uGarmin}
                onChange={setUGarmin}
                options={[
                  { value: 'all', label: t('anyGarmin') },
                  { value: 'with', label: t('withGarmin') },
                  { value: 'without', label: t('withoutGarmin') },
                ]}
              />
              {uFiltersActive && (
                <button
                  onClick={() => { setUSearch(''); setURole('all'); setUGroup('all'); setUGarmin('all'); }}
                  className="flex items-center gap-1 px-2.5 h-9 rounded-lg text-ink-400 hover:text-ink-900 hover:bg-page text-xs font-semibold"
                >
                  <X className="h-3.5 w-3.5" /> {t('clear')}
                </button>
              )}
            </div>

            {activeUsers.length === 0 ? (
              <EmptyState
                icon={Users}
                title={uFiltersActive ? t('noUsersMatchFilters') : t('noActiveUsers')}
                className="px-6 py-12"
              />
            ) : (
              <div className="divide-y divide-page/40">
                {allRoles
                  .map(role => ({ role, members: activeUsers.filter(u => u.role === role) }))
                  .filter(s => s.members.length > 0)
                  .map(({ role, members }) => {
                    const rc = roleConfig[role];
                    const roleKey = `role:${role}`;
                    const roleOpen = uFiltersActive || !collapsedSections.has(roleKey);
                    // Does this role have members assigned to real groups? If so, split.
                    const hasGroups = members.some(u => u.groupId && resolveGroup(groupsById[u.groupId]).index >= 0);
                    // Buckets 0,1,2 = Group 1/2/3, 99 = No group. Ordered.
                    const buckets: { key: number; label: string; hex: string; list: User[] }[] = [];
                    if (hasGroups) {
                      [0, 1, 2].forEach(idx => {
                        const list = members.filter(u => u.groupId && resolveGroup(groupsById[u.groupId]).index === idx);
                        if (list.length) buckets.push({ key: idx, label: `Group ${idx + 1}`, hex: resolveGroup(`group ${idx + 1}`).hex, list });
                      });
                      const none = members.filter(u => !u.groupId || resolveGroup(groupsById[u.groupId]).index < 0);
                      if (none.length) buckets.push({ key: 99, label: 'No group', hex: '#969696', list: none });
                    }
                    return (
                      <div key={role}>
                        {/* Role header */}
                        <button
                          onClick={() => toggleSection(roleKey)}
                          className="w-full flex items-center gap-2.5 px-5 py-3 hover:bg-page/60 transition-colors"
                        >
                          {roleOpen ? <ChevronDown className="w-4 h-4 text-ink-400" /> : <ChevronRight className="w-4 h-4 text-ink-400" />}
                          <span className={cn('w-2 h-2 rounded-full', rc?.dot || 'bg-ink-300')} />
                          <span className="text-sm font-semibold text-ink-700">{rc?.label || role}</span>
                          <span className="text-xs text-ink-400">({members.length})</span>
                        </button>

                        {roleOpen && (
                          <div className="px-3 pb-3 space-y-2">
                            {hasGroups ? (
                              buckets.map(b => {
                                const gKey = `${roleKey}:g${b.key}`;
                                const gOpen = uFiltersActive || !collapsedSections.has(gKey);
                                return (
                                  <div key={b.key} className="rounded-xl bg-page/30">
                                    <button
                                      onClick={() => toggleSection(gKey)}
                                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-page/40 transition-colors rounded-xl"
                                    >
                                      {gOpen ? <ChevronDown className="w-3.5 h-3.5 text-ink-400" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-400" />}
                                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.hex }} />
                                      <span className="text-xs font-semibold text-ink-500">{b.label}</span>
                                      <span className="text-2xs text-ink-400">({b.list.length})</span>
                                    </button>
                                    {gOpen && <div className="px-2 pb-2 space-y-2">{b.list.map(renderUserRow)}</div>}
                                  </div>
                                );
                              })
                            ) : (
                              members.map(renderUserRow)
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Feedback Tab — the same component the dedicated inbox at
          /dashboard/review/all renders. It used to be ~215 lines inline here,
          which meant the only way to give reports a real destination was a
          second copy of the triage logic. */}
      {activeTab === 'feedback' && <FeedbackAdmin />}

      {/* Tab Manager Tab */}
      {activeTab === 'tabs' && (
        <div className="rounded-card border border-page/50 bg-card/50">
          <div className="px-5 py-4 border-b border-page/50">
            <div className="flex items-center gap-2">
              <Layout className="w-4 h-4 text-ink-400" />
              <h2 className="text-sm font-semibold text-ink-700">{t('tabPermissions')}</h2>
            </div>
            <p className="text-xs text-ink-400 mt-1">{t('tabPermissionsDesc')}</p>
            <div className="flex items-center gap-4 mt-3 text-3xs font-semibold text-ink-400">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-brand-600 flex items-center justify-center"><Layout className="w-2 h-2 text-ink-700" /></div>
                {t('web')}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-accent-600 flex items-center justify-center"><Smartphone className="w-2 h-2 text-ink-700" /></div>
                {t('mobile')}
              </div>
            </div>
          </div>

          {(permissionsLoading || mobilePermissionsLoading) ? (
            <LoadingBlock />
          ) : (
            <div className="p-5 space-y-5">
              {allRoles.map(role => {
                const rc = roleConfig[role];
                const combinedTabs = [...new Set([...allTabs.map(t => t.key), ...allMobileTabs.map(t => t.key)])];
                const tabLabels: Record<string, string> = {};
                allTabs.forEach(t => { tabLabels[t.key] = t.label; });
                allMobileTabs.forEach(t => { tabLabels[t.key] = t.label; });

                return (
                  <InsetSection key={role} header={rc.label}>
                    {combinedTabs.map(tabKey => {
                      const webEnabled = isTabEnabled(role, tabKey);
                      const mobileEnabled = isMobileTabEnabled(role, tabKey);
                      const isWebTab = allTabs.some(t => t.key === tabKey);
                      const isMobileTab = allMobileTabs.some(t => t.key === tabKey);

                      return (
                        <InsetRow
                          key={tabKey}
                          label={tabLabels[tabKey]}
                          trailing={
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isWebTab && (
                                <button
                                  onClick={() => togglePermission(role, tabKey, webEnabled)}
                                  className={cn(
                                    'min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center transition-all',
                                    webEnabled ? 'bg-brand-600 text-white' : 'bg-page text-ink-400 hover:bg-ink-300/40'
                                  )}
                                  aria-label={t('web')}
                                  title={t('web')}
                                >
                                  <Layout className="w-4 h-4" />
                                </button>
                              )}
                              {isMobileTab && (
                                <button
                                  onClick={() => toggleMobilePermission(role, tabKey, mobileEnabled)}
                                  className={cn(
                                    'min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center transition-all',
                                    mobileEnabled ? 'bg-accent-600 text-white' : 'bg-page text-ink-400 hover:bg-ink-300/40'
                                  )}
                                  aria-label={t('mobile')}
                                  title={t('mobile')}
                                >
                                  <Smartphone className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          }
                        />
                      );
                    })}
                  </InsetSection>
                );
              })}

              {(hasPermissionChanges || hasMobilePermissionChanges) && (
                <div className="flex items-center justify-between p-4 bg-page border border-brand-600/30 rounded-xl">
                  <p className="text-sm text-ink-500">{t('unsavedChanges')}</p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { discardPermissionChanges(); discardMobilePermissionChanges(); }}
                      className="px-4 py-2 text-sm text-ink-500 hover:text-ink-900 rounded-lg border border-ink-300 hover:bg-page transition-colors"
                    >
                      {t('discard')}
                    </button>
                    <button
                      onClick={async () => {
                        if (hasPermissionChanges) await savePermissions();
                        if (hasMobilePermissionChanges) await saveMobilePermissions();
                      }}
                      disabled={savingPermissions || savingMobilePermissions}
                      className="px-4 py-2 text-sm text-white bg-brand-600 hover:bg-brand-700 rounded-lg transition-colors font-medium flex items-center gap-2"
                    >
                      {(savingPermissions || savingMobilePermissions) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {tc('save')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'notifications' && (
        <NotificationCenter />
      )}

      {/* Badge Manager detail (create additional milestone badges by distance/time) */}
      {activeTab === 'badges' && <BadgeManager />}

      {/* Challenge Manager detail (roadmap #13, Phase 4) */}
      {activeTab === 'challenges' && <ChallengeManager />}

      {/* Store Manager detail (roadmap #9) */}
      {activeTab === 'store' && <StoreManager />}

      {/* Perks Manager detail (roadmap #5) */}
      {activeTab === 'perks' && <PerksManager />}

      {/* הגרעין — the core squad list (migration 091) */}
      {activeTab === 'coreRunners' && <CoreRunnersManager />}
    </div>
  );
}
