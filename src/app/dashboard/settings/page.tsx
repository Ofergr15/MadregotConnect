'use client';

import { useState, useEffect, useRef } from 'react';
import { Settings, Users, Loader2, CheckCircle2, ChevronDown, AlertTriangle, X, Layout, Trash2 } from 'lucide-react';
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
}

type Role = 'admin' | 'coach' | 'runner' | 'core_runner' | 'viewer';

const roleConfig = {
  admin: { label: 'Admin', bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', dot: 'bg-purple-400' },
  coach: { label: 'Coach', bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', dot: 'bg-blue-400' },
  runner: { label: 'Runner', bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', dot: 'bg-green-400' },
  core_runner: { label: 'Core Runner', bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  viewer: { label: 'Viewer', bg: 'bg-slate-500/20', text: 'text-slate-400', border: 'border-slate-500/30', dot: 'bg-slate-400' },
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
          'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors',
          config.bg, config.text, config.border,
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-125 cursor-pointer'
        )}
      >
        <span className={cn('w-2 h-2 rounded-full', config.dot)}></span>
        {config.label}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className={cn(
          'absolute left-0 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden min-w-[140px]',
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
  { key: 'history', label: 'History' },
  { key: 'settings', label: 'Settings' },
];

const allRoles: Role[] = ['admin', 'coach', 'runner', 'core_runner', 'viewer'];

type SettingsTab = 'users' | 'tabs';

const settingsTabs = [
  { key: 'users' as SettingsTab, label: 'User Manager', icon: Users },
  { key: 'tabs' as SettingsTab, label: 'Tab Manager', icon: Layout },
];

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

  useEffect(() => {
    fetchUsers();
    fetchPermissions();
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
          <Settings className="w-7 h-7 text-slate-400" />
          <h1 className="text-2xl font-bold text-white">Settings</h1>
        </div>
        <p className="text-slate-400 text-sm">Manage your application</p>
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
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* User Manager Tab */}
      {activeTab === 'users' && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl">
          <div className="px-6 py-4 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-white">Users ({users.length})</h2>
            </div>
          </div>

          <div className="divide-y divide-slate-700/50">
            {users.map(user => {
              const status = user.onboardingStatus || 'pending';
              const steps = [
                { key: 'google', label: 'Google', completed: ['google_authed', 'garmin_authed', 'garmin_failed', 'active'].includes(status), active: status === 'google_authed', failed: false },
                { key: 'garmin', label: 'Garmin', completed: ['garmin_authed', 'active'].includes(status), active: status === 'google_authed', failed: status === 'garmin_failed' },
                { key: 'approval', label: 'Approved', completed: user.approved === true, active: user.approved === false && status === 'garmin_authed', failed: false },
                { key: 'active', label: 'Active', completed: status === 'active' && user.approved === true, active: false, failed: false },
              ];

              return (
                <div key={user.id} className="px-6 py-4 hover:bg-slate-700/20 transition-colors">
                  <div className="flex items-center justify-between gap-4">
                    {/* User info */}
                    <div className="min-w-0 w-[160px] shrink-0">
                      <div className="text-sm font-medium text-white truncate">{user.name}</div>
                      <div className="text-xs text-slate-500 truncate">{user.email}</div>
                    </div>

                    {/* Journey Pipeline */}
                    <div className="hidden sm:flex items-center gap-0.5 flex-1 justify-center">
                      {steps.map((step, idx) => (
                        <div key={step.key} className="flex items-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className={cn(
                              'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-all',
                              step.completed ? 'bg-green-500/20 border-green-500 text-green-400' :
                              step.active ? 'bg-amber-500/20 border-amber-500 text-amber-400 ring-2 ring-amber-500/20' :
                              step.failed ? 'bg-red-500/20 border-red-500 text-red-400' :
                              'bg-slate-800 border-slate-600 text-slate-500'
                            )}>
                              {step.failed ? '✕' : step.completed ? '✓' : idx + 1}
                            </div>
                            <span className={cn(
                              'text-[8px] font-semibold uppercase tracking-wider',
                              step.completed ? 'text-green-400' :
                              step.active ? 'text-amber-400' :
                              step.failed ? 'text-red-400' :
                              'text-slate-600'
                            )}>
                              {step.label}
                            </span>
                          </div>
                          {idx < steps.length - 1 && (
                            <div className={cn(
                              'w-5 h-0.5 mx-0.5 -mt-3',
                              step.completed ? 'bg-green-500' : 'bg-slate-700'
                            )} />
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {user.approved === false && (
                        <button
                          onClick={() => handleApprove(user)}
                          disabled={updatingUsers.has(user.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-500 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Approve
                        </button>
                      )}
                      <RoleDropdown
                        value={user.role}
                        onChange={(role) => handleRoleSelect(user, role)}
                        disabled={updatingUsers.has(user.id)}
                      />
                      {updatingUsers.has(user.id) && (
                        <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                      )}
                      {savedUsers.has(user.id) && (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      )}
                      <button
                        onClick={() => setPendingDelete(user)}
                        disabled={updatingUsers.has(user.id)}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                        title="Delete user"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {users.length === 0 && (
            <div className="px-6 py-12 text-center">
              <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No users found</p>
            </div>
          )}
        </div>
      )}

      {/* Tab Manager Tab */}
      {activeTab === 'tabs' && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl">
          <div className="px-6 py-4 border-b border-slate-700">
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
            <div className="p-6 space-y-6">
              {allRoles.map(role => {
                const rc = roleConfig[role];
                return (
                  <div key={role} className="bg-slate-900/50 border border-slate-700/50 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <span className={cn('w-2.5 h-2.5 rounded-full', rc.dot)}></span>
                      <h3 className={cn('text-sm font-semibold', rc.text)}>{rc.label}</h3>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {allTabs.map(tab => {
                        const enabled = isTabEnabled(role, tab.key);
                        return (
                          <button
                            key={tab.key}
                            onClick={() => togglePermission(role, tab.key, enabled)}
                            className={cn(
                              'flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border text-sm font-medium transition-all',
                              enabled
                                ? 'bg-primary-600/15 border-primary-500/40 text-white'
                                : 'bg-slate-800/50 border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400'
                            )}
                          >
                            <div className={cn(
                              'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
                              enabled
                                ? 'bg-primary-600 border-primary-500'
                                : 'bg-slate-700 border-slate-600'
                            )}>
                              {enabled && <CheckCircle2 className="w-3 h-3 text-white" />}
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
                <div className="flex items-center justify-between p-4 bg-slate-900 border border-primary-500/30 rounded-xl">
                  <p className="text-sm text-slate-300">You have unsaved changes</p>
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
                      Save Changes
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
