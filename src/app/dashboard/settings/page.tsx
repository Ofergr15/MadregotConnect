'use client';

import { useState, useEffect, useRef } from 'react';
import { Settings, Users, Loader2, CheckCircle2, ChevronDown, AlertTriangle, X, Layout, Trash2, Shield, Watch, Mail, Clock, MessageSquare, Filter, Bug, Lightbulb, Dumbbell, MessageCircle, GripVertical, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'coach' | 'runner' | 'core_runner' | 'viewer';
  groupId?: string;
  onboardingStatus?: string;
  approved?: boolean;
  approvedAt?: string | null;
  lastSeenAt?: string | null;
}

type Role = 'admin' | 'coach' | 'runner' | 'core_runner' | 'viewer';

const roleConfig = {
  admin: { label: 'Admin', bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/30', dot: 'bg-purple-400' },
  coach: { label: 'Coach', bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30', dot: 'bg-blue-400' },
  runner: { label: 'Runner', bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/30', dot: 'bg-green-400' },
  core_runner: { label: 'Core Runner', bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  viewer: { label: 'Viewer', bg: 'bg-slate-500/15', text: 'text-slate-400', border: 'border-slate-500/30', dot: 'bg-slate-400' },
};

function RoleDropdown({ value, onChange, disabled }: { value: Role; onChange: (role: Role) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleOpen = () => {
    if (disabled) return;
    if (!open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUp(spaceBelow < 200);
    }
    setOpen(!open);
  };

  const config = roleConfig[value];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={handleOpen}
        disabled={disabled}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors',
          config.bg, config.text, config.border,
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-125 cursor-pointer'
        )}
      >
        <span className={cn('w-1.5 h-1.5 rounded-full', config.dot)}></span>
        {config.label}
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className={cn(
          'absolute right-0 z-50 bg-slate-800 border border-slate-600 rounded-xl shadow-xl overflow-hidden min-w-[150px]',
          openUp ? 'bottom-full mb-1' : 'top-full mt-1'
        )}>
          {(['admin', 'coach', 'runner', 'core_runner', 'viewer'] as Role[]).map(role => {
            const rc = roleConfig[role];
            const isSelected = role === value;
            return (
              <button
                key={role}
                onClick={() => { onChange(role); setOpen(false); }}
                className={cn(
                  'w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors text-left',
                  isSelected ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/50'
                )}
              >
                <span className={cn('w-2 h-2 rounded-full', rc.dot)}></span>
                {rc.label}
                {isSelected && <CheckCircle2 className="h-3.5 w-3.5 ml-auto text-primary-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ConfirmDialogProps {
  user: User;
  newRole: Role;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ user, newRole, onConfirm, onCancel }: ConfirmDialogProps) {
  const oldConfig = roleConfig[user.role];
  const newConfig = roleConfig[newRole];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <h3 className="text-lg font-semibold text-white">Change Role</h3>
          <button onClick={onCancel} className="ml-auto text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-slate-300 text-sm mb-4">
          Change <span className="font-medium text-white">{user.name}</span> from{' '}
          <span className={cn('font-medium', oldConfig.text)}>{oldConfig.label}</span>{' '}
          to{' '}
          <span className={cn('font-medium', newConfig.text)}>{newConfig.label}</span>?
        </p>

        {(newRole === 'admin' || newRole === 'coach') && user.role !== 'admin' && user.role !== 'coach' && (
          <p className="text-amber-400/80 text-xs mb-4">
            This will remove the user from the athletes list and add them as a coach.
          </p>
        )}
        {(newRole === 'runner' || newRole === 'core_runner' || newRole === 'viewer') && (user.role === 'admin' || user.role === 'coach') && (
          <p className="text-amber-400/80 text-xs mb-4">
            This will remove the user from the coaches list and add them as an athlete.
          </p>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-300 hover:text-white rounded-lg border border-slate-600 hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm text-white bg-[#4338ff] hover:bg-[#3730d4] rounded-lg transition-colors font-medium"
          >
            Confirm Change
          </button>
        </div>
      </div>
    </div>
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
  { key: 'groups', label: 'Groups' },
  { key: 'activities', label: 'Activities' },
  { key: 'races', label: 'Races' },
  { key: 'program', label: 'Program' },
  { key: 'review', label: 'Review' },
  { key: 'history', label: 'History' },
  { key: 'settings', label: 'Settings' },
];

const allMobileTabs = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'athletes', label: 'Athletes' },
  { key: 'activities', label: 'Activities' },
  { key: 'program', label: 'Program' },
  { key: 'practice', label: 'Practice' },
  { key: 'races', label: 'Races' },
  { key: 'settings', label: 'Settings' },
];

const allRoles: Role[] = ['admin', 'coach', 'runner', 'core_runner', 'viewer'];

type SettingsTab = 'users' | 'tabs' | 'feedback';

const settingsTabs = [
  { key: 'users' as SettingsTab, label: 'User Manager', icon: Users },
  { key: 'tabs' as SettingsTab, label: 'Tab Manager', icon: Layout },
  { key: 'feedback' as SettingsTab, label: 'Feedback', icon: MessageSquare },
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

const statusConfig = {
  new: { label: 'New', bg: 'bg-blue-500/15', text: 'text-blue-400', border: 'border-blue-500/30' },
  idea: { label: 'Idea', bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/30' },
  sprint: { label: 'Sprint', bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
  denied: { label: 'Denied', bg: 'bg-slate-500/15', text: 'text-slate-400', border: 'border-slate-500/30' },
  done: { label: 'Done', bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/30' },
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
  const [activeTab, setActiveTab] = useState<SettingsTab>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
    fetchPermissions();
    fetchMobilePermissions();
    fetchFeedback();
  }, []);

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
      if (!response.ok) throw new Error('Failed to fetch mobile permissions');
      const data = await response.json();
      setMobilePermissions(data.permissions || []);
      setSavedMobilePermissions(data.permissions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load mobile permissions');
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
      await Promise.all(
        changed.map(p =>
          fetch('/api/admin/mobile-tab-permissions', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
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

  const handleDragEnd = (dragId: string, dropId: string) => {
    if (dragId === dropId) return;
    const items = [...feedbackItems];
    const dragIdx = items.findIndex(i => i.id === dragId);
    const dropIdx = items.findIndex(i => i.id === dropId);
    if (dragIdx === -1 || dropIdx === -1) return;
    const [moved] = items.splice(dragIdx, 1);
    items.splice(dropIdx, 0, moved);
    const reordered = items.map((item, i) => ({ ...item, sort_order: i }));
    setFeedbackItems(reordered);
    const sprintItems = reordered.filter(i => (i.status || 'new') === 'sprint');
    sprintItems.forEach((item, i) => {
      fetch('/api/feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, sort_order: i }),
      });
    });
    setDraggedItem(null);
    setDragOverItem(null);
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
      await Promise.all(
        changed.map(p =>
          fetch('/api/admin/tab-permissions', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
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
      const response = await fetch('/api/admin/users');
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
      const approverEmail = localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
      const response = await fetch('/api/admin/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteId: user.id, approverEmail }),
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
      const response = await fetch(`/api/admin/users?id=${user.id}`, { method: 'DELETE' });
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
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, role: newRole }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update user role');
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
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
      </div>
    );
  }

  const pendingUsers = users.filter(u => u.approved === false);
  const activeUsers = users.filter(u => u.approved !== false);

  return (
    <div className="max-w-4xl mx-auto">
      {pendingChange && (
        <ConfirmDialog
          user={pendingChange.user}
          newRole={pendingChange.newRole}
          onConfirm={confirmRoleChange}
          onCancel={() => setPendingChange(null)}
        />
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Trash2 className="w-5 h-5 text-red-400" />
              <h3 className="text-lg font-semibold text-white">Delete User</h3>
              <button onClick={() => setPendingDelete(null)} className="ml-auto text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-slate-300 text-sm mb-2">
              Delete <span className="font-medium text-white">{pendingDelete.name}</span> ({pendingDelete.email})?
            </p>
            <p className="text-slate-500 text-xs mb-4">
              This will remove all their data including activities. They can register again as a new user.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setPendingDelete(null)}
                className="px-4 py-2 text-sm text-slate-300 hover:text-white rounded-lg border border-slate-600 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors font-medium"
              >
                Delete User
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Settings className="w-6 h-6 text-slate-400" />
          <h1 className="text-2xl font-bold text-white">Settings</h1>
        </div>
        <p className="text-slate-400 text-sm">Manage users and permissions</p>
      </div>

      {/* Settings Tabs */}
      <div className="flex items-center gap-1 mb-6 bg-slate-800/50 p-1 rounded-xl border border-slate-700/50 w-fit">
        {settingsTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                isActive
                  ? 'bg-[#4338ff] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-red-400 text-sm">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* User Manager Tab */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          {/* Pending Approval Section */}
          {pendingUsers.length > 0 && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-amber-400">Pending Approval ({pendingUsers.length})</h3>
              </div>
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
                          'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                          onboarding.step >= 1 ? 'bg-green-500/15 text-green-400' : 'bg-slate-700 text-slate-500'
                        )}>Google</span>
                        <span className={cn(
                          'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                          onboarding.step >= 2 ? 'bg-green-500/15 text-green-400' : 'bg-slate-700 text-slate-500'
                        )}>Garmin</span>
                      </div>

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
                        Approve
                      </button>
                      <button
                        onClick={() => setPendingDelete(user)}
                        disabled={updatingUsers.has(user.id)}
                        className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Active Users */}
          <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50">
            <div className="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" />
                <h2 className="text-sm font-semibold text-white">Members ({activeUsers.length})</h2>
              </div>
            </div>

            <div className="p-3 space-y-2">
              {activeUsers.map(user => {
                const isAdmin = user.role === 'admin';
                const rc = roleConfig[user.role];

                let lastSeenLabel = 'Never';
                let lastSeenColor = 'text-slate-500';
                if (user.lastSeenAt) {
                  const hoursAgo = (Date.now() - new Date(user.lastSeenAt).getTime()) / 3600000;
                  if (hoursAgo < 1) { lastSeenLabel = 'Online'; lastSeenColor = 'text-green-400'; }
                  else if (hoursAgo < 24) { lastSeenLabel = `${Math.floor(hoursAgo)}h ago`; lastSeenColor = 'text-green-400'; }
                  else if (hoursAgo < 72) { lastSeenLabel = `${Math.floor(hoursAgo / 24)}d ago`; lastSeenColor = 'text-slate-400'; }
                  else { lastSeenLabel = `${Math.floor(hoursAgo / 24)}d ago`; lastSeenColor = 'text-slate-500'; }
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
                    {/* Avatar */}
                    <div className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center shrink-0',
                      isAdmin ? 'bg-purple-500/20' : 'bg-slate-700/50'
                    )}>
                      {isAdmin ? (
                        <Shield className="w-4.5 h-4.5 text-purple-400" />
                      ) : (
                        <span className="text-xs font-bold text-slate-300">
                          {user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                        </span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-white truncate">{user.name}</p>
                        {isAdmin && (
                          <span className="text-[10px] font-bold text-purple-400 bg-purple-500/15 px-1.5 py-0.5 rounded">
                            ADMIN
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-slate-500 truncate">{user.email}</span>
                        <span className={cn('text-[10px] font-medium', lastSeenColor)}>{lastSeenLabel}</span>
                        {user.onboardingStatus === 'garmin_authed' && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20 flex items-center gap-1">
                            <Watch className="w-2.5 h-2.5" />Garmin
                          </span>
                        )}
                        {user.onboardingStatus === 'google_authed' && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
                            Google only
                          </span>
                        )}
                        {user.approved === false && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">
                            Pending
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {savedUsers.has(user.id) && (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      )}
                      {updatingUsers.has(user.id) && (
                        <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                      )}
                      {!isAdmin && (
                        <>
                          <RoleDropdown
                            value={user.role}
                            onChange={(role) => handleRoleSelect(user, role)}
                            disabled={updatingUsers.has(user.id)}
                          />
                          <button
                            onClick={() => setPendingDelete(user)}
                            disabled={updatingUsers.has(user.id)}
                            className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                            title="Delete user"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {activeUsers.length === 0 && (
                <div className="px-6 py-12 text-center">
                  <Users className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-400 text-sm">No active users</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Feedback Tab */}
      {activeTab === 'feedback' && (
        <>
          {selectedFeedback && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setSelectedFeedback(null)}>
              <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="px-6 py-5 border-b border-slate-700/50 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-[#4338ff]/15 flex items-center justify-center">
                      <span className="text-sm font-bold text-[#4338ff]">
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
                  <button onClick={() => setSelectedFeedback(null)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="px-6 py-5">
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

                  <div className="border-t border-slate-700/50 pt-4">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-xs font-semibold text-slate-400 mb-2 block">Status</label>
                        <div className="flex flex-wrap gap-1.5">
                          {(['new', 'idea', 'sprint', 'denied', 'done'] as FeedbackStatus[]).map(status => {
                            const config = statusConfig[status];
                            const isSelected = (selectedFeedback.status || 'new') === status;
                            return (
                              <button
                                key={status}
                                onClick={() => updateFeedbackStatus(selectedFeedback.id, status, selectedFeedback.priority || 'medium')}
                                disabled={updatingFeedback === selectedFeedback.id}
                                className={cn(
                                  'text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all',
                                  isSelected ? `${config.bg} ${config.border} ${config.text}` : 'bg-slate-700/30 border-slate-600/50 text-slate-500 hover:border-slate-500 hover:text-slate-400',
                                  updatingFeedback === selectedFeedback.id && 'opacity-50 cursor-not-allowed'
                                )}
                              >
                                {config.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-400 mb-2 block">Priority</label>
                        <div className="flex flex-wrap gap-1.5">
                          {(['low', 'medium', 'high'] as FeedbackPriority[]).map(priority => {
                            const config = priorityConfig[priority];
                            const isSelected = (selectedFeedback.priority || 'medium') === priority;
                            return (
                              <button
                                key={priority}
                                onClick={() => updateFeedbackStatus(selectedFeedback.id, selectedFeedback.status || 'new', priority)}
                                disabled={updatingFeedback === selectedFeedback.id}
                                className={cn(
                                  'text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all',
                                  isSelected ? `${config.bg} ${config.border} ${config.text}` : 'bg-slate-700/30 border-slate-600/50 text-slate-500 hover:border-slate-500 hover:text-slate-400',
                                  updatingFeedback === selectedFeedback.id && 'opacity-50 cursor-not-allowed'
                                )}
                              >
                                {config.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    {updatingFeedback === selectedFeedback.id && (
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Updating...
                      </div>
                    )}

                    <div className="mt-4 pt-3 border-t border-slate-700/50">
                      <label className="text-xs font-semibold text-slate-400 mb-2 block">Admin Notes</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={adminNotes}
                          onChange={e => setAdminNotes(e.target.value)}
                          placeholder="Add a tag or note..."
                          className="flex-1 bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-[#4338ff]/50"
                        />
                        <button
                          onClick={() => updateFeedbackStatus(selectedFeedback.id, selectedFeedback.status || 'new', selectedFeedback.priority || 'medium', adminNotes)}
                          disabled={updatingFeedback === selectedFeedback.id}
                          className="px-3 py-2 rounded-lg bg-[#4338ff] hover:bg-[#3730d4] text-white text-xs font-bold transition-colors disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                      {selectedFeedback.admin_notes && adminNotes !== selectedFeedback.admin_notes && (
                        <p className="text-[10px] text-slate-500 mt-1.5">Current: {selectedFeedback.admin_notes}</p>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-700/50 flex justify-end">
                      <button
                        onClick={() => { if (confirm('Delete this feedback?')) deleteFeedback(selectedFeedback.id); }}
                        disabled={updatingFeedback === selectedFeedback.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-400 hover:bg-red-500/10 border border-red-500/20 hover:border-red-500/40 transition-all disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Category filter */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button
              onClick={() => setFilterCategory('all')}
              className={cn('text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-all', filterCategory === 'all' ? 'bg-[#4338ff]/10 border-[#4338ff]/30 text-[#4338ff]' : 'bg-slate-700/30 border-slate-600/50 text-slate-500 hover:text-slate-400')}
            >All</button>
            {(['feature_request', 'bug_report', 'training_feedback', 'general'] as FeedbackCategory[]).map(cat => {
              const config = categoryConfig[cat];
              const CatIcon = config.icon;
              return (
                <button key={cat} onClick={() => setFilterCategory(cat)}
                  className={cn('flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-all', filterCategory === cat ? `${config.bg} ${config.border} ${config.color}` : 'bg-slate-700/30 border-slate-600/50 text-slate-500 hover:text-slate-400')}
                ><CatIcon className="w-3 h-3" />{config.label}</button>
              );
            })}
          </div>

          {/* Kanban Board */}
          {feedbackLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3 overflow-x-auto">
              {(['new', 'idea', 'sprint', 'denied', 'done'] as FeedbackStatus[]).map(status => {
                const colConfig = statusConfig[status];
                const colItems = feedbackItems.filter(item => {
                  if ((item.status || 'new') !== status) return false;
                  if (filterCategory !== 'all' && (item.category || 'general') !== filterCategory) return false;
                  return true;
                });
                return (
                  <div
                    key={status}
                    className="bg-slate-900/40 rounded-xl border border-slate-700/30 flex flex-col min-h-[300px]"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedItem) {
                        updateFeedbackStatus(draggedItem, status, feedbackItems.find(f => f.id === draggedItem)?.priority || 'medium');
                        setDraggedItem(null);
                      }
                    }}
                  >
                    {/* Column header */}
                    <div className="px-3 py-2.5 border-b border-slate-700/30 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={cn('w-2 h-2 rounded-full', colConfig.bg.replace('/15', ''))} style={{ backgroundColor: status === 'new' ? '#3b82f6' : status === 'idea' ? '#a855f7' : status === 'sprint' ? '#f59e0b' : status === 'done' ? '#22c55e' : '#64748b' }} />
                        <span className={cn('text-xs font-bold', colConfig.text)}>{colConfig.label}</span>
                      </div>
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{colItems.length}</span>
                    </div>
                    {/* Cards */}
                    <div className="p-2 space-y-2 flex-1 overflow-y-auto max-h-[500px]">
                      {colItems.map(item => {
                        const catCfg = categoryConfig[item.category || 'general'];
                        const CatIcon = catCfg.icon;
                        const priCfg = priorityConfig[item.priority || 'medium'];
                        const date = new Date(item.created_at);
                        const timeAgo = (() => {
                          const h = (Date.now() - date.getTime()) / 3600000;
                          if (h < 1) return 'Just now';
                          if (h < 24) return `${Math.floor(h)}h ago`;
                          if (h < 48) return 'Yesterday';
                          return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        })();
                        return (
                          <div
                            key={item.id}
                            draggable
                            onDragStart={() => setDraggedItem(item.id)}
                            onClick={() => { setSelectedFeedback(item); setAdminNotes(item.admin_notes || ''); }}
                            className={cn(
                              'p-3 rounded-lg bg-slate-800/60 border border-slate-700/40 cursor-pointer hover:border-[#4338ff]/40 hover:bg-slate-800 transition-all',
                              draggedItem === item.id && 'opacity-50 scale-95'
                            )}
                          >
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className={cn('flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded border', catCfg.bg, catCfg.border, catCfg.color)}>
                                <CatIcon className="w-2.5 h-2.5" />{catCfg.label}
                              </span>
                              <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded border', priCfg.bg, priCfg.border, priCfg.text)}>
                                {priCfg.label}
                              </span>
                            </div>
                            <p className="text-xs text-white leading-relaxed line-clamp-3 mb-2">{item.message}</p>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-slate-500 font-medium">{item.athlete_name.split(' ')[0]}</span>
                              <span className="text-[9px] text-slate-600">{timeAgo}</span>
                            </div>
                            {item.admin_notes && (
                              <p className="text-[9px] text-slate-500 italic mt-1 border-t border-slate-700/30 pt-1">{item.admin_notes}</p>
                            )}
                          </div>
                        );
                      })}
                      {colItems.length === 0 && (
                        <div className="flex items-center justify-center h-20 text-[10px] text-slate-600">
                          Drop items here
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Tab Manager Tab */}
      {activeTab === 'tabs' && (
        <>
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50">
          <div className="px-5 py-4 border-b border-slate-700/50">
            <div className="flex items-center gap-2">
              <Layout className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-white">Tab Permissions</h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">Configure which tabs each role can access</p>
          </div>

          {permissionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
            </div>
          ) : (
            <div className="p-5 space-y-5">
              {allRoles.map(role => {
                const rc = roleConfig[role];
                return (
                  <div key={role} className="bg-slate-900/40 border border-slate-700/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className={cn('w-2 h-2 rounded-full', rc.dot)}></span>
                      <h3 className={cn('text-sm font-semibold', rc.text)}>{rc.label}</h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {allTabs.map(tab => {
                        const enabled = isTabEnabled(role, tab.key);
                        return (
                          <button
                            key={tab.key}
                            onClick={() => togglePermission(role, tab.key, enabled)}
                            className={cn(
                              'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                              enabled
                                ? 'bg-[#4338ff]/10 border-[#4338ff]/30 text-white'
                                : 'bg-slate-800/50 border-slate-700/50 text-slate-500 hover:border-slate-600 hover:text-slate-400'
                            )}
                          >
                            <div className={cn(
                              'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors',
                              enabled ? 'bg-[#4338ff] border-[#4338ff]' : 'bg-slate-700 border-slate-600'
                            )}>
                              {enabled && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                            </div>
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {hasPermissionChanges && (
                <div className="flex items-center justify-between p-4 bg-slate-900 border border-[#4338ff]/30 rounded-xl">
                  <p className="text-sm text-slate-300">Unsaved changes</p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={discardPermissionChanges}
                      className="px-4 py-2 text-sm text-slate-300 hover:text-white rounded-lg border border-slate-600 hover:bg-slate-700 transition-colors"
                    >
                      Discard
                    </button>
                    <button
                      onClick={savePermissions}
                      disabled={savingPermissions}
                      className="px-4 py-2 text-sm text-white bg-[#4338ff] hover:bg-[#3730d4] rounded-lg transition-colors font-medium flex items-center gap-2"
                    >
                      {savingPermissions && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile Tab Permissions */}
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 mt-5">
          <div className="px-5 py-4 border-b border-slate-700/50">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-white">Mobile Tab Permissions</h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">Configure which tabs each role can see on the mobile app</p>
          </div>

          {mobilePermissionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
            </div>
          ) : (
            <div className="p-5 space-y-5">
              {allRoles.map(role => {
                const rc = roleConfig[role];
                return (
                  <div key={role} className="bg-slate-900/40 border border-slate-700/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className={cn('w-2 h-2 rounded-full', rc.dot)}></span>
                      <h3 className={cn('text-sm font-semibold', rc.text)}>{rc.label}</h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {allMobileTabs.map(tab => {
                        const enabled = isMobileTabEnabled(role, tab.key);
                        return (
                          <button
                            key={tab.key}
                            onClick={() => toggleMobilePermission(role, tab.key, enabled)}
                            className={cn(
                              'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                              enabled
                                ? 'bg-green-500/10 border-green-500/30 text-white'
                                : 'bg-slate-800/50 border-slate-700/50 text-slate-500 hover:border-slate-600 hover:text-slate-400'
                            )}
                          >
                            <div className={cn(
                              'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors',
                              enabled ? 'bg-green-500 border-green-500' : 'bg-slate-700 border-slate-600'
                            )}>
                              {enabled && <CheckCircle2 className="w-2.5 h-2.5 text-white" />}
                            </div>
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {hasMobilePermissionChanges && (
                <div className="flex items-center justify-between p-4 bg-slate-900 border border-green-500/30 rounded-xl">
                  <p className="text-sm text-slate-300">Unsaved mobile changes</p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={discardMobilePermissionChanges}
                      className="px-4 py-2 text-sm text-slate-300 hover:text-white rounded-lg border border-slate-600 hover:bg-slate-700 transition-colors"
                    >
                      Discard
                    </button>
                    <button
                      onClick={saveMobilePermissions}
                      disabled={savingMobilePermissions}
                      className="px-4 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors font-medium flex items-center gap-2"
                    >
                      {savingMobilePermissions && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
