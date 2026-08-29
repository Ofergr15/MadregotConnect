'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Settings, Users, Loader2, CheckCircle2, ChevronDown, ChevronRight, AlertTriangle, X, Layout, Trash2, Shield, Watch, Mail, Clock, MessageSquare, Filter, Bug, Lightbulb, Dumbbell, MessageCircle, Smartphone, Bell, BellRing, User as UserIcon, Award, Trophy, ShoppingBag, Gift } from 'lucide-react';
import { cn, resolveGroup } from '@/lib/utils';
import { NotificationCenter } from '@/components/NotificationCenter';
import { NotificationPrefs } from '@/components/NotificationPrefs';
import { PersonalInfo } from '@/components/PersonalInfo';
import { BadgeManager } from '@/components/BadgeManager';
import { ChallengeManager } from '@/components/ChallengeManager';
import { StoreManager } from '@/components/StoreManager';
import { PerksManager } from '@/components/PerksManager';
import { MaintenanceRow, MaintenanceAllowlist } from '@/components/MaintenanceToggle';
import { WatchAlertsCard } from '@/components/WatchAlertsCard';
import { ReminderConfig } from '@/components/ReminderConfig';
import { canApprove, canGrantAdmin } from '@/lib/constants';
import { authHeaders } from '@/lib/api';
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
  admin: { label: 'Admin', bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/30', dot: 'bg-purple-400' },
  coach: { label: 'Coach', bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30', dot: 'bg-blue-400' },
  academy_coach: { label: 'Academy Coach', bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/30', dot: 'bg-cyan-400' },
  runner: { label: 'Runner', bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/30', dot: 'bg-green-400' },
  core_runner: { label: 'Core Runner', bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  academy_user: { label: 'Academy', bg: 'bg-primary-500/15', text: 'text-primary-400', border: 'border-primary-500/30', dot: 'bg-primary-400' },
  viewer: { label: 'Viewer', bg: 'bg-slate-500/15', text: 'text-slate-400', border: 'border-slate-500/30', dot: 'bg-slate-400' },
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
        <div className="rounded-2xl bg-slate-900/40 overflow-hidden divide-y divide-slate-700/50">
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
                  trailing={isSelected ? <CheckCircle2 className="h-4 w-4 text-primary-400" /> : <span className="w-4 h-4" />}
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
        className="flex items-center gap-1.5 px-3 h-9 rounded-lg bg-slate-900 border border-slate-700 text-sm text-white hover:border-slate-500 transition-colors"
      >
        <span className="truncate max-w-[110px]">{current?.label ?? label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-500 shrink-0" />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={title}>
        <div className="rounded-2xl bg-slate-900/40 overflow-hidden divide-y divide-slate-700/50">
          {options.map(opt => (
            <InsetRow
              key={opt.value}
              label={opt.label}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              trailing={opt.value === value ? <CheckCircle2 className="h-4 w-4 text-primary-400" /> : <span className="w-4 h-4" />}
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

type SettingsTab = 'users' | 'tabs' | 'feedback' | 'notifications' | 'reminders' | 'notifprefs' | 'personalInfo' | 'badges' | 'challenges' | 'store' | 'perks';

const settingsTabs = [
  // iconBg = the colored glyph tile (panel-18 iOS-Settings look).
  { key: 'users' as SettingsTab, label: 'User Manager', icon: Users, iconBg: 'bg-indigo-500' },
  { key: 'tabs' as SettingsTab, label: 'Tab Manager', icon: Layout, iconBg: 'bg-amber-500' },
  { key: 'feedback' as SettingsTab, label: 'Feedback', icon: MessageSquare, iconBg: 'bg-teal-500' },
  { key: 'notifications' as SettingsTab, label: 'Notifications', icon: Bell, iconBg: 'bg-rose-500' },
  { key: 'badges' as SettingsTab, label: 'Badge Manager', icon: Award, iconBg: 'bg-fuchsia-500' },
  { key: 'challenges' as SettingsTab, label: 'Challenge Manager', icon: Trophy, iconBg: 'bg-orange-500' },
  { key: 'store' as SettingsTab, label: 'Store Manager', icon: ShoppingBag, iconBg: 'bg-cyan-600' },
  { key: 'perks' as SettingsTab, label: 'Perks Manager', icon: Gift, iconBg: 'bg-pink-600' },
];

type FeedbackCategory = 'feature_request' | 'bug_report' | 'training_feedback' | 'general';
type FeedbackStatus = 'new' | 'idea' | 'sprint' | 'denied' | 'done';
type FeedbackPriority = 'low' | 'medium' | 'high';

interface FeedbackItem {
  id: string;
  athlete_name: string;
  athlete_email: string | null;
  group_name: string | null;
  message: string;
  category: FeedbackCategory;
  status: FeedbackStatus;
  priority: FeedbackPriority;
  admin_notes: string | null;
  sort_order: number | null;
  image_url: string | null;
  created_at: string;
}

const categoryConfig = {
  feature_request: { label: 'Feature Request', icon: Lightbulb, color: 'text-purple-400', bg: 'bg-purple-500/15', border: 'border-purple-500/30' },
  bug_report: { label: 'Bug Report', icon: Bug, color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30' },
  training_feedback: { label: 'Training Feedback', icon: Dumbbell, color: 'text-blue-400', bg: 'bg-blue-500/15', border: 'border-blue-500/30' },
  general: { label: 'General', icon: MessageCircle, color: 'text-teal-400', bg: 'bg-teal-500/15', border: 'border-teal-500/30' },
};

const priorityConfig = {
  low: { label: 'Low', bg: 'bg-cyan-500/15', text: 'text-cyan-400', border: 'border-cyan-500/30' },
  medium: { label: 'Medium', bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  high: { label: 'High', bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
};

function getOnboardingStep(status: string | undefined, approved: boolean | undefined): { step: number; label: string; color: string } {
  if (approved === true) return { step: 3, label: 'Active', color: 'text-green-400' };
  if (status === 'garmin_authed') return { step: 2, label: 'Awaiting approval', color: 'text-amber-400' };
  if (status === 'google_authed') return { step: 1, label: 'Needs Garmin', color: 'text-orange-400' };
  return { step: 0, label: 'Pending', color: 'text-slate-400' };
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');

  const getStatusLabel = (status: FeedbackStatus) => {
    return t(status);
  };

  const getPriorityLabel = (priority: FeedbackPriority) => {
    return t(priority);
  };

  // null = the Settings landing (iOS-style list); a value = a detail screen
  // open. The 8 "ניהול" rows now live in Coach Tools and link here with
  // ?tab=<key> so their detail screens still open directly, no duplication.
  // personalInfo/notifprefs aren't in that grid (they're their own always-
  // visible rows above it) but are still real, refreshable deep-link targets.
  const router = useRouter();
  const searchParams = useSearchParams();
  const ALL_TAB_KEYS: SettingsTab[] = [...settingsTabs.map(st => st.key), 'personalInfo', 'notifprefs'];
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
  const [loading, setLoading] = useState(true);
  // Whether the signed-in account is allowed to approve registrations / grant
  // admin. Computed client-side (identity lives in localStorage); the server
  // re-checks both anyway.
  const [canApproveHere, setCanApproveHere] = useState(false);
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
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null);
  const [filterCategory, setFilterCategory] = useState<FeedbackCategory | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<FeedbackStatus | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<FeedbackPriority | 'all'>('all');
  const [updatingFeedback, setUpdatingFeedback] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState<string>('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [groupsById, setGroupsById] = useState<Record<string, string>>({});
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [uSearch, setUSearch] = useState('');
  const [uRole, setURole] = useState<'all' | Role>('all');
  const [uGroup, setUGroup] = useState<'all' | '0' | '1' | '2' | 'none'>('all');
  const [uGarmin, setUGarmin] = useState<'all' | 'with' | 'without'>('all');

  useEffect(() => {
    const me = localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
    setCanApproveHere(canApprove(me));
    setCanGrantAdminHere(canGrantAdmin(me));
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchPermissions();
    fetchMobilePermissions();
    fetchFeedback();
    // Group names, to label the group sub-sections in User Manager.
    fetch('/api/groups')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.groups) {
          const map: Record<string, string> = {};
          d.groups.forEach((g: any) => { map[g.id] = g.name; });
          setGroupsById(map);
        }
      })
      .catch(() => {});
  }, []);

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
    let lastSeenColor = 'text-slate-500';
    if (user.lastSeenAt) {
      const hoursAgo = (Date.now() - new Date(user.lastSeenAt).getTime()) / 3600000;
      if (hoursAgo < 1) { lastSeenLabel = t('online'); lastSeenColor = 'text-green-400'; }
      else if (hoursAgo < 24) { lastSeenLabel = t('hoursAgo', { hours: Math.floor(hoursAgo) }); lastSeenColor = 'text-green-400'; }
      else { lastSeenLabel = t('daysAgo', { days: Math.floor(hoursAgo / 24) }); lastSeenColor = hoursAgo < 72 ? 'text-slate-400' : 'text-slate-500'; }
    }
    return (
      <div
        key={user.id}
        className={cn(
          'flex items-center gap-3 p-3.5 rounded-xl transition-all',
          isAdmin
            ? 'bg-purple-500/5 border border-purple-500/20'
            : 'bg-slate-900/40 border border-transparent hover:border-slate-700/50 hover:bg-slate-800/60'
        )}
      >
        <div className={cn('w-10 h-10 rounded-full flex items-center justify-center shrink-0', isAdmin ? 'bg-purple-500/20' : 'bg-slate-700/50')}>
          {isAdmin ? (
            <Shield className="w-4.5 h-4.5 text-purple-400" />
          ) : (
            <span className="text-xs font-bold text-slate-300">{user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white truncate">{user.name}</p>
            {isAdmin && <span className="text-3xs font-bold text-purple-400 bg-purple-500/15 px-1.5 py-0.5 rounded">{t('admin').toUpperCase()}</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-slate-500 truncate">{user.email}</span>
            <span className={cn('text-3xs font-medium', lastSeenColor)}>{lastSeenLabel}</span>
            {user.onboardingStatus === 'garmin_authed' && (
              <span className="text-3xs font-bold px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20 flex items-center gap-1">
                <Watch className="w-2.5 h-2.5" />{t('garmin')}
              </span>
            )}
            {user.onboardingStatus === 'google_authed' && (
              <span className="text-3xs font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">{t('googleOnly')}</span>
            )}
            {user.approved === false && (
              <span className="text-3xs font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">{t('pending')}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {savedUsers.has(user.id) && <CheckCircle2 className="w-4 h-4 text-green-400" />}
          {updatingUsers.has(user.id) && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />}
          {!isAdmin && (
            <>
              <RoleDropdown value={user.role} onChange={(role) => handleRoleSelect(user, role)} disabled={updatingUsers.has(user.id)} canGrantAdmin={canGrantAdminHere} t={t} />
              <button
                onClick={() => setPendingDelete(user)}
                disabled={updatingUsers.has(user.id)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
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

  const fetchFeedback = async () => {
    try {
      setFeedbackLoading(true);
      const res = await fetch('/api/feedback');
      if (!res.ok) return;
      const data = await res.json();
      setFeedbackItems(data.feedback || []);
    } catch {
    } finally {
      setFeedbackLoading(false);
    }
  };

  const updateFeedbackStatus = async (id: string, status: FeedbackStatus, priority: FeedbackPriority, notes?: string) => {
    setFeedbackItems(prev => prev.map(f => f.id === id ? { ...f, status, priority, admin_notes: notes ?? f.admin_notes } : f));
    if (selectedFeedback && selectedFeedback.id === id) {
      setSelectedFeedback({ ...selectedFeedback, status, priority, admin_notes: notes ?? selectedFeedback.admin_notes });
    }
    try {
      const body: any = { id, status, priority };
      if (notes !== undefined) body.admin_notes = notes;
      await fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      await fetchFeedback();
    }
  };

  const deleteFeedback = async (id: string) => {
    setUpdatingFeedback(id);
    try {
      const res = await fetch('/api/feedback', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setSelectedFeedback(null);
        await fetchFeedback();
      }
    } catch {
    } finally {
      setUpdatingFeedback(null);
    }
  };

  const filteredFeedback = feedbackItems.filter(item => {
    if (filterCategory !== 'all' && (item.category || 'general') !== filterCategory) return false;
    if (filterStatus !== 'all' && (item.status || 'new') !== filterStatus) return false;
    if (filterPriority !== 'all' && (item.priority || 'medium') !== filterPriority) return false;
    return true;
  });

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
      const response = await fetch('/api/admin/users', { headers: authHeaders() });
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
      const response = await fetch(`/api/admin/users?id=${user.id}`, { method: 'DELETE', headers: authHeaders() });
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
      const actorEmail = localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ email: user.email, role: newRole, actorEmail }),
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

  if (loading) {
    return <LoadingBlock className="min-h-[60vh]" size={32} />;
  }

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
          <h1 className="text-3xl font-extrabold text-white tracking-tight" dir="rtl">{t('title')}</h1>
        </div>
      ) : (
        <BackNav label={t('title')} onBack={() => setActiveTab(null)} className="mb-4" />
      )}

      {/* ═══ LANDING — iOS-Settings inset lists (drill into detail screens) ═══ */}
      {activeTab === null && (
        <>
          {/* First card: maintenance toggle + reminders, grouped like the reference. */}
          <InsetSection>
            <MaintenanceRow />
            <InsetRow
              icon={UserIcon}
              iconBg="bg-violet-500"
              label={t('personalInfo')}
              onClick={() => setActiveTab('personalInfo')}
              trailing={<ChevronRight className="h-4 w-4 text-slate-500 shrink-0 rotate-180" />}
            />
            <InsetRow
              icon={BellRing}
              iconBg="bg-rose-500"
              label={t('notificationPrefs')}
              onClick={() => setActiveTab('notifprefs')}
              trailing={<ChevronRight className="h-4 w-4 text-slate-500 shrink-0 rotate-180" />}
            />
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

      {/* Reminders detail */}
      {activeTab === 'reminders' && <ReminderConfig />}

      {/* Notification preferences detail (per-user category toggles) */}
      {activeTab === 'notifprefs' && notifPrefsAthleteId && <NotificationPrefs athleteId={notifPrefsAthleteId} />}
      {activeTab === 'notifprefs' && !notifPrefsAthleteId && (
        <p className="text-sm text-slate-500 text-center py-10" dir="rtl">התחברו כספורטאי כדי לנהל העדפות התראות אישיות.</p>
      )}

      {/* Personal info detail (birth date / gender / shoe size) */}
      {activeTab === 'personalInfo' && notifPrefsAthleteId && <PersonalInfo athleteId={notifPrefsAthleteId} />}
      {activeTab === 'personalInfo' && !notifPrefsAthleteId && (
        <p className="text-sm text-slate-500 text-center py-10" dir="rtl">התחברו כספורטאי כדי לערוך פרטים אישיים.</p>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={() => setError(null)} className="ms-auto min-h-[44px] min-w-[44px] flex items-center justify-center text-red-400 hover:text-red-300 -my-2 -me-2">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* User Manager Tab */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* Pending Approval Section (collapsible) */}
          {pendingUsers.length > 0 && (() => {
            const pendOpen = !collapsedSections.has('pending');
            return (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <button
                onClick={() => toggleSection('pending')}
                className="w-full flex items-center gap-2 mb-3"
              >
                {pendOpen ? <ChevronDown className="w-4 h-4 text-amber-400" /> : <ChevronRight className="w-4 h-4 text-amber-400" />}
                <Clock className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-amber-400">{t('pendingApproval')} ({pendingUsers.length})</h3>
              </button>
              {pendOpen && (
              <div className="space-y-2">
                {pendingUsers.map(user => {
                  const onboarding = getOnboardingStep(user.onboardingStatus, user.approved);
                  return (
                    <div key={user.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/80 border border-slate-700/50">
                      <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-amber-400">
                          {user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{user.name}</p>
                        <p className="text-xs text-slate-500 truncate">{user.email}</p>
                      </div>

                      {/* Status chips */}
                      <div className="hidden sm:flex items-center gap-1.5">
                        <span className={cn(
                          'text-3xs font-semibold px-2 py-0.5 rounded-full',
                          onboarding.step >= 1 ? 'bg-green-500/15 text-green-400' : 'bg-slate-700 text-slate-500'
                        )}>{t('google')}</span>
                        <span className={cn(
                          'text-3xs font-semibold px-2 py-0.5 rounded-full',
                          onboarding.step >= 2 ? 'bg-green-500/15 text-green-400' : 'bg-slate-700 text-slate-500'
                        )}>{t('garmin')}</span>
                      </div>

                      {canApproveHere ? (
                        <button
                          onClick={() => handleApprove(user)}
                          disabled={updatingUsers.has(user.id)}
                          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-green-600 hover:bg-green-500 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                        >
                          {updatingUsers.has(user.id) ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          {t('approve')}
                        </button>
                      ) : (
                        <span className="text-3xs font-medium text-slate-500 shrink-0 px-2 py-1 rounded bg-slate-700/40">
                          {t('awaitingApproval')}
                        </span>
                      )}
                      <button
                        onClick={() => setPendingDelete(user)}
                        disabled={updatingUsers.has(user.id)}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50 shrink-0"
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
          <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-700/50 flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-white">
                {t('members')} ({uFiltersActive ? `${activeUsers.length} of ${allActiveUsers.length}` : activeUsers.length})
              </h2>
            </div>

            {/* Filter bar: name / role / group / garmin */}
            <div className="px-4 py-3 border-b border-slate-700/50 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[160px]">
                <Filter className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <input
                  value={uSearch}
                  onChange={e => setUSearch(e.target.value)}
                  placeholder={t('searchNameOrEmail')}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg ps-9 pe-3 h-9 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-primary-500"
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
                  className="flex items-center gap-1 px-2.5 h-9 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 text-xs font-semibold"
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
              <div className="divide-y divide-slate-700/40">
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
                      if (none.length) buckets.push({ key: 99, label: 'No group', hex: '#64748b', list: none });
                    }
                    return (
                      <div key={role}>
                        {/* Role header */}
                        <button
                          onClick={() => toggleSection(roleKey)}
                          className="w-full flex items-center gap-2.5 px-5 py-3 hover:bg-slate-800/60 transition-colors"
                        >
                          {roleOpen ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                          <span className={cn('w-2 h-2 rounded-full', rc?.dot || 'bg-slate-400')} />
                          <span className="text-sm font-semibold text-white">{rc?.label || role}</span>
                          <span className="text-xs text-slate-500">({members.length})</span>
                        </button>

                        {roleOpen && (
                          <div className="px-3 pb-3 space-y-2">
                            {hasGroups ? (
                              buckets.map(b => {
                                const gKey = `${roleKey}:g${b.key}`;
                                const gOpen = uFiltersActive || !collapsedSections.has(gKey);
                                return (
                                  <div key={b.key} className="rounded-xl bg-slate-900/30">
                                    <button
                                      onClick={() => toggleSection(gKey)}
                                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-800/40 transition-colors rounded-xl"
                                    >
                                      {gOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
                                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.hex }} />
                                      <span className="text-xs font-semibold text-slate-300">{b.label}</span>
                                      <span className="text-2xs text-slate-500">({b.list.length})</span>
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

      {/* Feedback Tab */}
      {activeTab === 'feedback' && (
        <>
          {selectedFeedback && (
            <Sheet open onOpenChange={(o) => { if (!o) { setSelectedFeedback(null); setConfirmDeleteOpen(false); } }}>
              <div className="pb-4 mb-1 border-b border-slate-700/50 flex items-center">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-primary-600/15 flex items-center justify-center">
                    <span className="text-sm font-bold text-primary-600">
                      {selectedFeedback.athlete_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    </span>
                  </div>
                  <div>
                    <p className="text-base font-bold text-white">{selectedFeedback.athlete_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {selectedFeedback.athlete_email && <span className="text-xs text-slate-400">{selectedFeedback.athlete_email}</span>}
                      {selectedFeedback.group_name && <span className="text-xs text-slate-500">· {selectedFeedback.group_name}</span>}
                    </div>
                  </div>
                </div>
              </div>
                <div className="pt-4">
                  <div className="flex items-center gap-2 mb-4">
                    {(() => {
                      const catConfig = categoryConfig[selectedFeedback.category || 'general'];
                      const CatIcon = catConfig.icon;
                      return (
                        <span className={cn('flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border', catConfig.bg, catConfig.border, catConfig.color)}>
                          <CatIcon className="w-3.5 h-3.5" />
                          {catConfig.label}
                        </span>
                      );
                    })()}
                    <span className="text-xs text-slate-500">
                      {new Date(selectedFeedback.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-base text-white leading-relaxed whitespace-pre-wrap mb-4">{selectedFeedback.message}</p>
                  {selectedFeedback.image_url && (
                    <img src={selectedFeedback.image_url} alt="Attached" className="max-h-48 rounded-lg border border-slate-700/50 mb-5" />
                  )}

                  <div className="border-t border-slate-700/50 pt-4 space-y-4">
                    <div className={cn(updatingFeedback === selectedFeedback.id && 'opacity-50 pointer-events-none')}>
                      <label className="text-xs font-semibold text-slate-400 mb-2 block">{t('status')}</label>
                      <SegmentedControl<FeedbackStatus>
                        value={selectedFeedback.status || 'new'}
                        onChange={(status) => updateFeedbackStatus(selectedFeedback.id, status, selectedFeedback.priority || 'medium')}
                        options={(['new', 'idea', 'sprint', 'denied', 'done'] as FeedbackStatus[]).map(status => ({ value: status, label: getStatusLabel(status) }))}
                      />
                    </div>
                    <div className={cn(updatingFeedback === selectedFeedback.id && 'opacity-50 pointer-events-none')}>
                      <label className="text-xs font-semibold text-slate-400 mb-2 block">{t('priority')}</label>
                      <SegmentedControl<FeedbackPriority>
                        value={selectedFeedback.priority || 'medium'}
                        onChange={(priority) => updateFeedbackStatus(selectedFeedback.id, selectedFeedback.status || 'new', priority)}
                        options={(['low', 'medium', 'high'] as FeedbackPriority[]).map(priority => ({ value: priority, label: getPriorityLabel(priority) }))}
                      />
                    </div>
                    {updatingFeedback === selectedFeedback.id && (
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {t('updating')}
                      </div>
                    )}

                    <div className="pt-3 border-t border-slate-700/50">
                      <label className="text-xs font-semibold text-slate-400 mb-2 block">{t('adminNotes')}</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={adminNotes}
                          onChange={e => setAdminNotes(e.target.value)}
                          placeholder={t('addTagOrNote')}
                          className="flex-1 bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-primary-600/50"
                        />
                        <button
                          onClick={() => updateFeedbackStatus(selectedFeedback.id, selectedFeedback.status || 'new', selectedFeedback.priority || 'medium', adminNotes)}
                          disabled={updatingFeedback === selectedFeedback.id}
                          className="px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
                        >
                          {tc('save')}
                        </button>
                      </div>
                      {selectedFeedback.admin_notes && adminNotes !== selectedFeedback.admin_notes && (
                        <p className="text-3xs text-slate-500 mt-1.5">{t('currentNote', { note: selectedFeedback.admin_notes })}</p>
                      )}
                    </div>

                    <div className="pt-3 border-t border-slate-700/50 flex justify-end">
                      <button
                        onClick={() => setConfirmDeleteOpen(true)}
                        disabled={updatingFeedback === selectedFeedback.id}
                        className="flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-semibold text-red-400 hover:bg-red-500/10 border border-red-500/20 hover:border-red-500/40 transition-all disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {tc('delete')}
                      </button>
                    </div>
                  </div>
                </div>
            </Sheet>
          )}

          {/* Delete confirmation — a native ConfirmSheet, replacing the browser
              `confirm()` dialog (unstyleable, unlocalizable, not RTL-safe, and
              renders as a jarring native alert box on iOS). */}
          <ConfirmSheet
            open={confirmDeleteOpen}
            onOpenChange={setConfirmDeleteOpen}
            title={tc('delete')}
            description={t('deleteFeedbackConfirm')}
            confirmLabel={tc('delete')}
            cancelLabel={tc('cancel')}
            onConfirm={() => { if (selectedFeedback) deleteFeedback(selectedFeedback.id); }}
          />

          {/* Category filter */}
          <div className="mb-4">
            <SegmentedControl<FeedbackCategory | 'all'>
              value={filterCategory}
              onChange={setFilterCategory}
              options={[
                { value: 'all', label: t('all') },
                ...(['feature_request', 'bug_report', 'training_feedback', 'general'] as FeedbackCategory[]).map(cat => ({
                  value: cat, label: categoryConfig[cat].label, icon: categoryConfig[cat].icon,
                })),
              ]}
            />
          </div>

          {/* Feedback list — grouped by status. The drag-and-drop Kanban board
              was removed: native HTML5 dragstart/drop events don't fire from
              touch input on iOS Safari, so the board was effectively undraggable
              on a real phone. Status now changes from the detail sheet's
              segmented control above. */}
          {feedbackLoading ? (
            <LoadingBlock />
          ) : feedbackItems.length === 0 ? (
            <EmptyState icon={MessageSquare} title={t('noFeedback')} />
          ) : (
            <div className="space-y-4">
              {(['new', 'idea', 'sprint', 'denied', 'done'] as FeedbackStatus[]).map(status => {
                const colItems = feedbackItems.filter(item => {
                  if ((item.status || 'new') !== status) return false;
                  if (filterCategory !== 'all' && (item.category || 'general') !== filterCategory) return false;
                  return true;
                });
                if (colItems.length === 0) return null;
                return (
                  <InsetSection key={status} header={`${getStatusLabel(status)} (${colItems.length})`}>
                    {colItems.map(item => {
                      const catCfg = categoryConfig[item.category || 'general'];
                      const CatIcon = catCfg.icon;
                      const priCfg = priorityConfig[item.priority || 'medium'];
                      const date = new Date(item.created_at);
                      const timeAgo = (() => {
                        const h = (Date.now() - date.getTime()) / 3600000;
                        if (h < 1) return t('justNow');
                        if (h < 24) return t('hoursAgo', { hours: Math.floor(h) });
                        if (h < 48) return t('yesterday');
                        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      })();
                      return (
                        <button
                          key={item.id}
                          onClick={() => { setSelectedFeedback(item); setAdminNotes(item.admin_notes || ''); }}
                          className="w-full text-start px-4 py-3 active:bg-slate-700/40 transition-colors"
                        >
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className={cn('flex items-center gap-1 text-3xs font-semibold px-1.5 py-0.5 rounded border', catCfg.bg, catCfg.border, catCfg.color)}>
                              <CatIcon className="w-2.5 h-2.5" />{catCfg.label}
                            </span>
                            <span className={cn('text-3xs font-semibold px-1.5 py-0.5 rounded border', priCfg.bg, priCfg.border, priCfg.text)}>
                              {getPriorityLabel(item.priority || 'medium')}
                            </span>
                          </div>
                          <p className="text-sm text-white leading-relaxed line-clamp-2 mb-1.5">{item.message}</p>
                          <div className="flex items-center justify-between">
                            <span className="text-3xs text-slate-500 font-medium">{item.athlete_name.split(' ')[0]}</span>
                            <span className="text-3xs text-slate-400">{timeAgo}</span>
                          </div>
                          {item.admin_notes && (
                            <p className="text-3xs text-slate-500 italic mt-1 border-t border-slate-700/30 pt-1">{item.admin_notes}</p>
                          )}
                        </button>
                      );
                    })}
                  </InsetSection>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Tab Manager Tab */}
      {activeTab === 'tabs' && (
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50">
          <div className="px-5 py-4 border-b border-slate-700/50">
            <div className="flex items-center gap-2">
              <Layout className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-white">{t('tabPermissions')}</h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">{t('tabPermissionsDesc')}</p>
            <div className="flex items-center gap-4 mt-3 text-3xs font-semibold text-slate-400">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-primary-600 flex items-center justify-center"><Layout className="w-2 h-2 text-white" /></div>
                {t('web')}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-green-500 flex items-center justify-center"><Smartphone className="w-2 h-2 text-white" /></div>
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
                                    webEnabled ? 'bg-primary-600 text-white' : 'bg-slate-700 text-slate-500 hover:bg-slate-600'
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
                                    mobileEnabled ? 'bg-green-500 text-white' : 'bg-slate-700 text-slate-500 hover:bg-slate-600'
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
                <div className="flex items-center justify-between p-4 bg-slate-900 border border-primary-600/30 rounded-xl">
                  <p className="text-sm text-slate-300">{t('unsavedChanges')}</p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { discardPermissionChanges(); discardMobilePermissionChanges(); }}
                      className="px-4 py-2 text-sm text-slate-300 hover:text-white rounded-lg border border-slate-600 hover:bg-slate-700 transition-colors"
                    >
                      {t('discard')}
                    </button>
                    <button
                      onClick={async () => {
                        if (hasPermissionChanges) await savePermissions();
                        if (hasMobilePermissionChanges) await saveMobilePermissions();
                      }}
                      disabled={savingPermissions || savingMobilePermissions}
                      className="px-4 py-2 text-sm text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors font-medium flex items-center gap-2"
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
    </div>
  );
}
