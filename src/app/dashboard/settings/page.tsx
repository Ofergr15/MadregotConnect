'use client';

import { useState, useEffect, useRef } from 'react';
import { Settings, Users, Shield, Loader2, CheckCircle2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'runner' | 'viewer';
  groupId?: string;
}

type Role = 'admin' | 'runner' | 'viewer';

const roleConfig = {
  admin: { label: 'Admin', bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', dot: 'bg-purple-400' },
  runner: { label: 'Runner', bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', dot: 'bg-green-400' },
  viewer: { label: 'Viewer', bg: 'bg-slate-500/20', text: 'text-slate-400', border: 'border-slate-500/30', dot: 'bg-slate-400' },
};

function RoleDropdown({ value, onChange, disabled }: { value: Role; onChange: (role: Role) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const config = roleConfig[value];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen(!open)}
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
        <div className="absolute top-full left-0 mt-1 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden min-w-[140px]">
          {(['admin', 'runner', 'viewer'] as Role[]).map(role => {
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

export default function SettingsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingUsers, setUpdatingUsers] = useState<Set<string>>(new Set());
  const [savedUsers, setSavedUsers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

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

  const updateUserRole = async (email: string, role: Role) => {
    setUpdatingUsers(prev => new Set(prev).add(email));
    setSavedUsers(prev => { const s = new Set(prev); s.delete(email); return s; });

    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });

      if (!response.ok) throw new Error('Failed to update user role');

      setUsers(prev => prev.map(u => u.email === email ? { ...u, role } : u));
      setSavedUsers(prev => new Set(prev).add(email));
      setTimeout(() => {
        setSavedUsers(prev => { const s = new Set(prev); s.delete(email); return s; });
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
      fetchUsers();
    } finally {
      setUpdatingUsers(prev => { const s = new Set(prev); s.delete(email); return s; });
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
      {/* Header */}
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

      {/* Users Table */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
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
                  onChange={(role) => updateUserRole(user.email, role)}
                  disabled={updatingUsers.has(user.email)}
                />
                {updatingUsers.has(user.email) && (
                  <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                )}
                {savedUsers.has(user.email) && (
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
    </div>
  );
}
