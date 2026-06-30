'use client';

import { useState, useEffect, useRef } from 'react';
import { Settings, Users, Loader2, CheckCircle2, ChevronDown, AlertTriangle, X, Layout } from 'lucide-react';
import { cn } from '@/lib/utils';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'coach' | 'runner' | 'viewer';
  groupId?: string;
}

type Role = 'admin' | 'coach' | 'runner' | 'viewer';

const roleConfig = {
  admin: { label: 'Admin', bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', dot: 'bg-purple-400' },
  coach: { label: 'Coach', bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', dot: 'bg-blue-400' },
  runner: { label: 'Runner', bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', dot: 'bg-green-400' },
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
          {(['admin', 'coach', 'runner', 'viewer'] as Role[]).map(role => {
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
        {(newRole === 'runner' || newRole === 'viewer') && (user.role === 'admin' || user.role === 'coach') && (
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
  { key: 'plan/new', label: 'New Plan' },
  { key: 'athletes', label: 'Athletes' },
  { key: 'groups', label: 'Groups' },
  { key: 'program', label: 'Program' },
  { key: 'history', label: 'History' },
  { key: 'settings', label: 'Settings' },
];

const allRoles: Role[] = ['admin', 'coach', 'runner', 'viewer'];

export default function SettingsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingUsers, setUpdatingUsers] = useState<Set<string>>(new Set());
  const [savedUsers, setSavedUsers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<{ user: User; newRole: Role } | null>(null);
  const [permissions, setPermissions] = useState<TabPermission[]>([]);
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  const [updatingPermission, setUpdatingPermission] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load permissions');
    } finally {
      setPermissionsLoading(false);
    }
  };

  const togglePermission = async (role: string, tab: string, currentEnabled: boolean) => {
    const key = `${role}-${tab}`;
    setUpdatingPermission(key);
    try {
      const response = await fetch('/api/admin/tab-permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, tab, enabled: !currentEnabled }),
      });
      if (!response.ok) throw new Error('Failed to update permission');
      setPermissions(prev =>
        prev.map(p => p.role === role && p.tab === tab ? { ...p, enabled: !currentEnabled } : p)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update permission');
    } finally {
      setUpdatingPermission(null);
    }
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

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Settings className="w-7 h-7 text-slate-400" />
          <h1 className="text-2xl font-bold text-white">Settings</h1>
        </div>
        <p className="text-slate-400 text-sm">Manage users and roles</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-xl">
        <div className="px-6 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">Users ({users.length})</h2>
          </div>
        </div>

        <div className="divide-y divide-slate-700/50">
          {users.map(user => (
            <div key={user.id} className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-slate-700/20 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">{user.name}</div>
                <div className="text-xs text-slate-500 truncate">{user.email}</div>
              </div>
              <div className="flex items-center gap-2">
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
              </div>
            </div>
          ))}
        </div>

        {users.length === 0 && (
          <div className="px-6 py-12 text-center">
            <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No users found</p>
          </div>
        )}
      </div>

      {/* Tab Permissions Section */}
      <div className="mt-8 bg-slate-800 border border-slate-700 rounded-xl">
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
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Tab</th>
                  {allRoles.map(role => (
                    <th key={role} className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider">
                      <span className={cn('inline-flex items-center gap-1.5', roleConfig[role].text)}>
                        <span className={cn('w-2 h-2 rounded-full', roleConfig[role].dot)}></span>
                        {roleConfig[role].label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {allTabs.map(tab => (
                  <tr key={tab.key} className="hover:bg-slate-700/20 transition-colors">
                    <td className="px-6 py-3 text-sm text-white font-medium">{tab.label}</td>
                    {allRoles.map(role => {
                      const enabled = isTabEnabled(role, tab.key);
                      const key = `${role}-${tab.key}`;
                      const isUpdating = updatingPermission === key;
                      return (
                        <td key={role} className="px-4 py-3 text-center">
                          <button
                            onClick={() => togglePermission(role, tab.key, enabled)}
                            disabled={isUpdating}
                            className={cn(
                              'w-8 h-8 rounded-lg border transition-all inline-flex items-center justify-center',
                              enabled
                                ? 'bg-primary-600/30 border-primary-500/50 text-primary-400'
                                : 'bg-slate-700/30 border-slate-600 text-slate-600 hover:border-slate-500',
                              isUpdating && 'opacity-50'
                            )}
                          >
                            {isUpdating ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : enabled ? (
                              <CheckCircle2 className="w-4 h-4" />
                            ) : (
                              <X className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
