'use client';

import { useState, useEffect } from 'react';
import { Settings, Users, Shield, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'runner' | 'viewer';
  groupId?: string;
}

type Role = 'admin' | 'runner' | 'viewer';

const roleColors = {
  admin: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  runner: 'bg-green-500/10 text-green-400 border-green-500/20',
  viewer: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

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

      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }

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
    setSavedUsers(prev => {
      const newSet = new Set(prev);
      newSet.delete(email);
      return newSet;
    });

    try {
      const response = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, role }),
      });

      if (!response.ok) {
        throw new Error('Failed to update user role');
      }

      // Update local state
      setUsers(prevUsers =>
        prevUsers.map(user =>
          user.email === email ? { ...user, role } : user
        )
      );

      // Show success indicator
      setSavedUsers(prev => new Set(prev).add(email));
      setTimeout(() => {
        setSavedUsers(prev => {
          const newSet = new Set(prev);
          newSet.delete(email);
          return newSet;
        });
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
      // Revert to original role on error
      fetchUsers();
    } finally {
      setUpdatingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(email);
        return newSet;
      });
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
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Settings className="w-8 h-8 text-slate-400" />
          <h1 className="text-3xl font-bold text-white">Settings</h1>
        </div>
        <p className="text-slate-400">Manage users and roles</p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Desktop Table */}
      <div className="hidden md:block bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-800/50">
              <th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Name
                </div>
              </th>
              <th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                Email
              </th>
              <th className="px-6 py-4 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Role
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-700/30 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-white">{user.name}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-slate-300">{user.email}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-3">
                    <select
                      value={user.role}
                      onChange={(e) => updateUserRole(user.email, e.target.value as Role)}
                      disabled={updatingUsers.has(user.email)}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                        roleColors[user.role],
                        "bg-transparent cursor-pointer",
                        "focus:outline-none focus:ring-2 focus:ring-slate-500",
                        updatingUsers.has(user.email) && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <option value="admin" className="bg-slate-800 text-white">Admin</option>
                      <option value="runner" className="bg-slate-800 text-white">Runner</option>
                      <option value="viewer" className="bg-slate-800 text-white">Viewer</option>
                    </select>
                    {updatingUsers.has(user.email) && (
                      <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                    )}
                    {savedUsers.has(user.email) && (
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <div className="px-6 py-12 text-center">
            <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No users found</p>
          </div>
        )}
      </div>

      {/* Mobile Card List */}
      <div className="md:hidden space-y-4">
        {users.map((user) => (
          <div
            key={user.id}
            className="bg-slate-800 border border-slate-700 rounded-lg p-5"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1 min-w-0">
                <h3 className="text-white font-medium mb-1 truncate">{user.name}</h3>
                <p className="text-sm text-slate-400 truncate">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Shield className="w-3.5 h-3.5" />
                Role
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={user.role}
                  onChange={(e) => updateUserRole(user.email, e.target.value as Role)}
                  disabled={updatingUsers.has(user.email)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                    roleColors[user.role],
                    "bg-transparent cursor-pointer",
                    "focus:outline-none focus:ring-2 focus:ring-slate-500",
                    updatingUsers.has(user.email) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <option value="admin" className="bg-slate-800 text-white">Admin</option>
                  <option value="runner" className="bg-slate-800 text-white">Runner</option>
                  <option value="viewer" className="bg-slate-800 text-white">Viewer</option>
                </select>
                {updatingUsers.has(user.email) && (
                  <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                )}
                {savedUsers.has(user.email) && (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                )}
              </div>
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <div className="bg-slate-800 border border-slate-700 rounded-lg px-6 py-12 text-center">
            <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No users found</p>
          </div>
        )}
      </div>
    </div>
  );
}
