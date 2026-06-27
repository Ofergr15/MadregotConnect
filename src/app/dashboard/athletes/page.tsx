'use client';

import { useState, useEffect } from 'react';
import {
  UserPlus, Copy, CheckCircle2, Wifi, WifiOff, Clock,
  Users as UsersIcon, Check, Mail, MoreVertical, Trash2,
  PauseCircle, PlayCircle, ArrowRightLeft, X, MessageCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Athlete {
  id: string;
  name: string;
  email: string;
  groupName: string | null;
  groupId: string | null;
  status: 'active' | 'invited' | 'paused' | 'disconnected';
  lastSynced: string | null;
  createdAt: string;
}

interface Group {
  id: string;
  name: string;
}

export default function AthletesPage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteGroup, setInviteGroup] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [moveModal, setMoveModal] = useState<{ athleteId: string; athleteName: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'invited' | 'paused'>('all');

  useEffect(() => {
    fetchAthletes();
    fetchGroups();
  }, []);

  const fetchAthletes = async () => {
    try {
      const response = await fetch('/api/athletes');
      const data = await response.json();
      setAthletes(data.athletes || []);
    } catch (error) {
      console.error('Failed to fetch athletes:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await fetch('/api/groups');
      const data = await response.json();
      setGroups(data.groups || []);
    } catch (error) {
      console.error('Failed to fetch groups:', error);
    }
  };

  const createInvite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) return;
    setSubmitting(true);
    try {
      const response = await fetch('/api/athletes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: inviteName, email: inviteEmail }),
      });
      const data = await response.json();
      if (response.ok) {
        setInviteLink(data.inviteLink);
        setInviteName('');
        setInviteEmail('');
        setInviteGroup('');
        fetchAthletes();
      }
    } catch (error) {
      console.error('Failed to create invite:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const updateAthleteGroup = async (athleteId: string, groupId: string | null) => {
    try {
      await fetch('/api/athletes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: athleteId, groupId }),
      });
      fetchAthletes();
      setMoveModal(null);
      setActiveMenu(null);
    } catch (error) {
      console.error('Failed to update group:', error);
    }
  };

  const updateAthleteStatus = async (athleteId: string, status: string) => {
    try {
      await fetch('/api/athletes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: athleteId, status }),
      });
      fetchAthletes();
      setActiveMenu(null);
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  const deleteAthlete = async (athleteId: string) => {
    try {
      await fetch(`/api/athletes?id=${athleteId}`, { method: 'DELETE' });
      fetchAthletes();
      setConfirmDelete(null);
      setActiveMenu(null);
    } catch (error) {
      console.error('Failed to delete athlete:', error);
    }
  };

  const copyLink = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareViaWhatsApp = () => {
    if (inviteLink) {
      const message = `היי! 🏃‍♂️
הצטרף/י למדרגות After 2KM ב-Garmin Connect.
לחץ/י על הלינק כדי לחבר את השעון שלך ולקבל את האימונים ישירות:
${inviteLink}`;
      const encodedMessage = encodeURIComponent(message);
      window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
    }
  };

  const filteredAthletes = athletes.filter(a => {
    if (filter === 'all') return true;
    return a.status === filter;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
            <Wifi className="h-3 w-3" /> Active
          </span>
        );
      case 'invited':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
            <Clock className="h-3 w-3" /> Invited
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30">
            <PauseCircle className="h-3 w-3" /> Paused
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
            <WifiOff className="h-3 w-3" /> Disconnected
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Athletes</h1>
          <p className="text-slate-400 mt-1">Manage your athletes and their Garmin connections</p>
        </div>
        <button
          onClick={() => { setShowInvite(!showInvite); setInviteLink(null); }}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <UserPlus className="h-4 w-4" />
          Invite Athlete
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="bg-green-500/20 p-2 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{athletes.filter(a => a.status === 'active').length}</p>
              <p className="text-xs text-slate-400">Active</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="bg-yellow-500/20 p-2 rounded-lg">
              <Clock className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{athletes.filter(a => a.status === 'invited').length}</p>
              <p className="text-xs text-slate-400">Invited</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="bg-orange-500/20 p-2 rounded-lg">
              <PauseCircle className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{athletes.filter(a => a.status === 'paused').length}</p>
              <p className="text-xs text-slate-400">Paused</p>
            </div>
          </div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-3">
            <div className="bg-primary-500/20 p-2 rounded-lg">
              <UsersIcon className="h-5 w-5 text-primary-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{athletes.length}</p>
              <p className="text-xs text-slate-400">Total</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-slate-800 rounded-lg p-1 border border-slate-700 w-fit">
        {(['all', 'active', 'invited', 'paused'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors capitalize',
              filter === tab ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'
            )}
          >
            {tab} {tab !== 'all' && `(${athletes.filter(a => a.status === tab).length})`}
            {tab === 'all' && ` (${athletes.length})`}
          </button>
        ))}
      </div>

      {/* Invite Form */}
      {showInvite && (
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 space-y-4">
          <h3 className="font-semibold text-lg">Invite New Athlete</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="Athlete name"
              className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="Email address"
              type="email"
              className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <select
              value={inviteGroup}
              onChange={(e) => setInviteGroup(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">No group (assign later)</option>
              {groups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={createInvite}
            disabled={submitting || !inviteName.trim() || !inviteEmail.trim()}
            className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <Mail className="h-4 w-4" />
            {submitting ? 'Creating...' : 'Generate Invite Link'}
          </button>
          {inviteLink && (
            <div className="bg-slate-700/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4" />
                Invitation created!
              </div>
              <div className="flex items-center gap-2">
                <input value={inviteLink} readOnly className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm" />
                <button
                  onClick={copyLink}
                  className={cn(
                    "px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2",
                    copied ? "bg-green-600 text-white" : "bg-slate-600 hover:bg-slate-500 text-white"
                  )}
                >
                  {copied ? <><Check className="h-4 w-4" />Copied!</> : <><Copy className="h-4 w-4" />Copy</>}
                </button>
                <button
                  onClick={shareViaWhatsApp}
                  className="px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 bg-[#25D366] hover:bg-[#20BA59] text-white"
                  title="Share via WhatsApp"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Athletes Table */}
      {filteredAthletes.length > 0 ? (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-700/50">
                  <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-6 py-4">Name</th>
                  <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-6 py-4">Email</th>
                  <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-6 py-4">Group</th>
                  <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-6 py-4">Status</th>
                  <th className="text-left text-xs font-medium text-slate-400 uppercase tracking-wider px-6 py-4">Joined</th>
                  <th className="text-right text-xs font-medium text-slate-400 uppercase tracking-wider px-6 py-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {filteredAthletes.map((athlete) => (
                  <tr key={athlete.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="bg-primary-500/20 w-10 h-10 rounded-full flex items-center justify-center">
                          <span className="text-primary-400 font-semibold text-sm">
                            {athlete.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                          </span>
                        </div>
                        <span className="font-medium">{athlete.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">{athlete.email}</td>
                    <td className="px-6 py-4">
                      {athlete.groupName ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-500/20 text-purple-400 text-xs font-medium">
                          {athlete.groupName}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-sm">No group</span>
                      )}
                    </td>
                    <td className="px-6 py-4">{getStatusBadge(athlete.status)}</td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {new Date(athlete.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right relative">
                      <button
                        onClick={() => setActiveMenu(activeMenu === athlete.id ? null : athlete.id)}
                        className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                      >
                        <MoreVertical className="h-4 w-4 text-slate-400" />
                      </button>
                      {activeMenu === athlete.id && (
                        <div className="absolute right-6 top-12 z-10 bg-slate-700 border border-slate-600 rounded-lg shadow-xl py-1 w-48">
                          <button
                            onClick={() => { setMoveModal({ athleteId: athlete.id, athleteName: athlete.name }); setActiveMenu(null); }}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-slate-600 flex items-center gap-2"
                          >
                            <ArrowRightLeft className="h-4 w-4" /> Move to Group
                          </button>
                          {athlete.status === 'active' ? (
                            <button
                              onClick={() => updateAthleteStatus(athlete.id, 'paused')}
                              className="w-full text-left px-4 py-2 text-sm hover:bg-slate-600 flex items-center gap-2 text-orange-400"
                            >
                              <PauseCircle className="h-4 w-4" /> Pause
                            </button>
                          ) : athlete.status === 'paused' ? (
                            <button
                              onClick={() => updateAthleteStatus(athlete.id, 'active')}
                              className="w-full text-left px-4 py-2 text-sm hover:bg-slate-600 flex items-center gap-2 text-green-400"
                            >
                              <PlayCircle className="h-4 w-4" /> Reactivate
                            </button>
                          ) : null}
                          <button
                            onClick={() => { setConfirmDelete({ id: athlete.id, name: athlete.name }); setActiveMenu(null); }}
                            className="w-full text-left px-4 py-2 text-sm hover:bg-slate-600 flex items-center gap-2 text-red-400"
                          >
                            <Trash2 className="h-4 w-4" /> Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl border border-slate-700 text-center py-16">
          <div className="bg-slate-700/50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
            <UsersIcon className="h-10 w-10 text-slate-500" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No athletes found</h3>
          <p className="text-slate-400 mb-4">
            {filter !== 'all' ? 'No athletes with this status' : 'Invite your first athlete to get started'}
          </p>
        </div>
      )}

      {/* Move Group Modal */}
      {moveModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Move {moveModal.athleteName}</h3>
              <button onClick={() => setMoveModal(null)} className="p-1 hover:bg-slate-700 rounded">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => updateAthleteGroup(moveModal.athleteId, null)}
                className="w-full text-left px-4 py-3 rounded-lg hover:bg-slate-700 text-slate-300 transition-colors"
              >
                No group
              </button>
              {groups.map(g => (
                <button
                  key={g.id}
                  onClick={() => updateAthleteGroup(moveModal.athleteId, g.id)}
                  className="w-full text-left px-4 py-3 rounded-lg hover:bg-slate-700 text-white transition-colors flex items-center gap-2"
                >
                  <UsersIcon className="h-4 w-4 text-purple-400" />
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 w-full max-w-sm">
            <h3 className="font-semibold text-lg mb-2">Delete Athlete</h3>
            <p className="text-slate-400 text-sm mb-6">
              Are you sure you want to remove <span className="text-white font-medium">{confirmDelete.name}</span>? This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteAthlete(confirmDelete.id)}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
