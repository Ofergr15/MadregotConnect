'use client';

import { useState, useEffect } from 'react';
import {
  UserPlus, Copy, CheckCircle2, Wifi, WifiOff, Clock,
  Users as UsersIcon, Check, Mail, Trash2, ChevronDown,
  PauseCircle, PlayCircle, ArrowRightLeft, MessageCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isProtectedEmail } from '@/lib/constants';
import { Skeleton, SkeletonCard, Sheet, ConfirmSheet, SegmentedControl, InsetSection, InsetRow, Card, Button, EmptyState, BigStat } from '@/components/ui';
import { useTranslations } from 'next-intl';

interface Athlete {
  id: string;
  name: string;
  email: string;
  groupName: string | null;
  groupId: string | null;
  status: 'active' | 'invited' | 'paused' | 'disconnected';
  lastSynced: string | null;
  createdAt: string;
  dataSource?: 'garmin' | 'strava';
  hasGarmin?: boolean;
  hasStrava?: boolean;
  stravaEnabled?: boolean;
  onboardingStatus?: string | null;
}

interface Group {
  id: string;
  name: string;
  level?: 'fast' | 'medium' | 'slow';
  marathonGoal?: string;
}

const groupColors: Record<string, { bg: string; text: string; border: string }> = {
  'Group 1': { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/20' },
  'Group 2': { bg: 'bg-yellow-500/15', text: 'text-yellow-400', border: 'border-yellow-500/20' },
  'Group 3': { bg: 'bg-orange-500/15', text: 'text-orange-400', border: 'border-orange-500/20' },
};

function getGroupStyle(name: string | null) {
  if (!name) return null;
  return groupColors[name] || { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/20' };
}

export default function AthletesPage() {
  const t = useTranslations('athletes');
  const tc = useTranslations('common');
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteGroup, setInviteGroup] = useState('');
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [publicLink, setPublicLink] = useState<string | null>(null);
  const [publicLinkCopied, setPublicLinkCopied] = useState(false);
  const [generatingPublicLink, setGeneratingPublicLink] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [moveModal, setMoveModal] = useState<{ athleteId: string; athleteName: string } | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
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

  const toggleDataSource = async (athleteId: string, source: 'garmin' | 'strava') => {
    try {
      await fetch('/api/admin/athlete-source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteId, dataSource: source }),
      });
      fetchAthletes();
    } catch (error) {
      console.error('Failed to toggle source:', error);
    }
  };

  const connectStrava = async (athleteId: string) => {
    try {
      const res = await fetch(`/api/strava?athleteId=${athleteId}`);
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (error) {
      console.error('Failed to connect Strava:', error);
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

  const generatePublicLink = async () => {
    setGeneratingPublicLink(true);
    try {
      const response = await fetch('/api/athletes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicLink: true }),
      });
      const data = await response.json();
      if (response.ok) {
        setPublicLink(data.inviteLink);
      }
    } catch (error) {
      console.error('Failed to generate public link:', error);
    } finally {
      setGeneratingPublicLink(false);
    }
  };

  const copyPublicLink = () => {
    if (publicLink) {
      const message = `היי! 🏃‍♂️
הצטרפו למדרגות After 2KM ב-Garmin Connect!
חברו את השעון שלכם וקבלו את האימונים ישירות:
${publicLink}`;
      navigator.clipboard.writeText(message);
      setPublicLinkCopied(true);
      setTimeout(() => setPublicLinkCopied(false), 2000);
    }
  };

  const sharePublicLinkWhatsApp = () => {
    if (publicLink) {
      const message = `היי! 🏃‍♂️
הצטרפו למדרגות After 2KM ב-Garmin Connect!
חברו את השעון שלכם וקבלו את האימונים ישירות:
${publicLink}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
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
            <Wifi className="h-3 w-3" /> {t('active')}
          </span>
        );
      case 'invited':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
            <Clock className="h-3 w-3" /> {t('invited')}
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30">
            <PauseCircle className="h-3 w-3" /> {t('paused')}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
            <WifiOff className="h-3 w-3" /> {t('disconnected')}
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-3">
        <Skeleton className="h-8 w-40 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-slate-400 mt-1">{t('subtitle')}</p>
        </div>
        <Button variant="primary" onClick={() => { setShowInvite(true); setInviteLink(null); }}>
          <UserPlus className="h-4 w-4" />
          {t('inviteAthlete')}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Card variant="solid">
          <BigStat value={athletes.filter(a => a.status === 'active').length} label={t('active')} />
        </Card>
        <Card variant="solid">
          <BigStat value={athletes.filter(a => a.status === 'invited').length} label={t('invited')} />
        </Card>
        <Card variant="solid">
          <BigStat value={athletes.filter(a => a.status === 'paused').length} label={t('paused')} />
        </Card>
        <Card variant="solid">
          <BigStat value={athletes.length} label={t('total')} />
        </Card>
      </div>

      {/* Filter tabs */}
      <SegmentedControl
        value={filter}
        onChange={setFilter}
        options={(['all', 'active', 'invited', 'paused'] as const).map((tab) => ({
          value: tab,
          label: `${tab} (${tab === 'all' ? athletes.length : athletes.filter((a) => a.status === tab).length})`,
        }))}
        className="w-fit"
      />

      {/* Invite Form — a bottom sheet like every other transient/task flow on
          this page (action menu, move-to-group, delete confirm), instead of
          an inline panel that used to expand the page flow. */}
      <Sheet
        open={showInvite}
        onOpenChange={(o) => { setShowInvite(o); if (!o) { setInviteLink(null); setInviteGroup(''); } }}
        title={t('inviteNewAthlete')}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder={t('athleteName')}
              className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder={t('emailAddress')}
              type="email"
              className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {/* Group picker — tapping opens a Sheet of InsetRow options,
                same "pick one from a list" pattern as everywhere else in the
                app, instead of a native <select>. */}
            <button
              type="button"
              onClick={() => setGroupPickerOpen(true)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 min-h-[44px] flex items-center justify-between gap-2 text-start hover:border-slate-600 transition-colors"
            >
              <span className={cn('truncate', inviteGroup ? 'text-white' : 'text-slate-500')}>
                {inviteGroup ? groups.find((g) => g.id === inviteGroup)?.name : t('noGroup')}
              </span>
              <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
            </button>
          </div>
          <Button variant="primary" className="w-full" onClick={createInvite} disabled={submitting || !inviteName.trim() || !inviteEmail.trim()}>
            <Mail className="h-4 w-4" />
            {submitting ? t('generating') : t('generateInviteLink')}
          </Button>
          {inviteLink && (
            <div className="bg-slate-700/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4" />
                {t('invitationCreated')}
              </div>
              <div className="flex items-center gap-2">
                <input value={inviteLink} readOnly className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm" />
                <Button variant="secondary" onClick={copyLink} className={copied ? 'bg-green-600 hover:bg-green-600' : undefined}>
                  {copied ? <><Check className="h-4 w-4" />{tc('copied')}</> : <><Copy className="h-4 w-4" />{tc('copy')}</>}
                </Button>
                <Button variant="secondary" onClick={shareViaWhatsApp} className="bg-[#25D366] hover:bg-[#20BA59]" title="Share via WhatsApp">
                  <MessageCircle className="h-4 w-4" />
                  {t('whatsApp')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Sheet>

      {/* Group picker Sheet for the invite form above. */}
      <Sheet open={groupPickerOpen} onOpenChange={setGroupPickerOpen} title={t('group')}>
        <InsetSection>
          <InsetRow
            label={t('noGroup')}
            trailing={!inviteGroup ? <Check className="h-4 w-4 text-primary-400" /> : undefined}
            onClick={() => { setInviteGroup(''); setGroupPickerOpen(false); }}
          />
          {groups.map((g) => (
            <InsetRow
              key={g.id}
              icon={UsersIcon}
              label={g.name}
              trailing={inviteGroup === g.id ? <Check className="h-4 w-4 text-primary-400" /> : undefined}
              onClick={() => { setInviteGroup(g.id); setGroupPickerOpen(false); }}
            />
          ))}
        </InsetSection>
      </Sheet>

      {/* Public Invite Link - for WhatsApp Group */}
      <Card variant="solid">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold">{t('publicInviteLink')}</h3>
            <p className="text-sm text-slate-400 mt-1">
              {t('publicInviteDesc')}
            </p>
          </div>
          {!publicLink && (
            <Button variant="primary" onClick={generatePublicLink} disabled={generatingPublicLink}>
              <UserPlus className="h-4 w-4" />
              {generatingPublicLink ? t('generating') : t('generateLink')}
            </Button>
          )}
        </div>
        {publicLink && (
          <div className="bg-slate-700/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <input value={publicLink} readOnly className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm" />
              <Button variant="secondary" onClick={copyPublicLink} className={publicLinkCopied ? 'bg-green-600 hover:bg-green-600' : undefined}>
                {publicLinkCopied ? <><Check className="h-4 w-4" />{tc('copied')}</> : <><Copy className="h-4 w-4" />{tc('copy')}</>}
              </Button>
              <Button variant="secondary" onClick={sharePublicLinkWhatsApp} className="bg-[#25D366] hover:bg-[#20BA59]">
                <MessageCircle className="h-4 w-4" />
                {t('whatsApp')}
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              {t('publicLinkNote')}
            </p>
          </div>
        )}
      </Card>

      {/* Athletes Roster — one native-styled list at every viewport width
          (was a raw HTML <table> on md+ and a separately hand-rolled card
          list below md, two renderers to keep in sync). Tapping a row opens
          the same action sheet the old "..." button opened. */}
      {filteredAthletes.length > 0 ? (
        <InsetSection>
          {filteredAthletes.map((athlete) => {
            const initials = athlete.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
            const groupStyle = getGroupStyle(athlete.groupName);
            return (
              <button
                key={athlete.id}
                onClick={() => setActiveMenu(athlete.id)}
                className="w-full text-start active:bg-slate-700/40 transition-colors"
              >
                <div className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
                  <span className="shrink-0 w-9 h-9 rounded-full bg-primary-500/20 flex items-center justify-center">
                    <span className="text-primary-400 font-semibold text-xs">{initials}</span>
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-medium text-white truncate" dir="auto">{athlete.name}</span>
                    <span className="block text-xs text-slate-400 truncate">{athlete.email}</span>
                    {(athlete.groupName || athlete.hasGarmin || athlete.hasStrava) && (
                      <span className="flex flex-wrap items-center gap-1 mt-1">
                        {athlete.groupName && (
                          <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium', groupStyle?.bg, groupStyle?.text)}>
                            {athlete.groupName}
                          </span>
                        )}
                        {athlete.hasGarmin && <span className="text-2xs font-bold px-1.5 py-0.5 rounded bg-green-500/15 text-green-400">Garmin</span>}
                        {athlete.hasStrava && <span className="text-2xs font-bold px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400">Strava</span>}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0">{getStatusBadge(athlete.status)}</span>
                </div>
              </button>
            );
          })}
        </InsetSection>
      ) : (
        <EmptyState
          icon={UsersIcon}
          title={t('noAthletes')}
          description={filter !== 'all' ? t('noAthletesStatus') : t('inviteFirst')}
        />
      )}

      {/* Athlete actions — one shared sheet, opened from either the desktop
          table row or the mobile card (was two separate absolute-positioned
          dropdowns, the classic desktop-menu tell). */}
      <Sheet
        open={!!activeMenu}
        onOpenChange={(o) => { if (!o) setActiveMenu(null); }}
        title={athletes.find((a) => a.id === activeMenu)?.name}
      >
        {(() => {
          const athlete = athletes.find((a) => a.id === activeMenu);
          if (!athlete) return null;
          return (
            <InsetSection>
              <InsetRow
                icon={ArrowRightLeft}
                iconBg="bg-primary-600"
                label={t('moveToGroup')}
                onClick={() => { setMoveModal({ athleteId: athlete.id, athleteName: athlete.name }); setActiveMenu(null); }}
              />
              {athlete.status === 'active' ? (
                <InsetRow
                  icon={PauseCircle}
                  iconBg="bg-orange-500"
                  label={t('pause')}
                  onClick={() => updateAthleteStatus(athlete.id, 'paused')}
                />
              ) : athlete.status === 'paused' ? (
                <InsetRow
                  icon={PlayCircle}
                  iconBg="bg-green-500"
                  label={t('reactivate')}
                  onClick={() => updateAthleteStatus(athlete.id, 'active')}
                />
              ) : null}
              <InsetRow
                icon={Wifi}
                iconBg="bg-orange-500"
                label={athlete.stravaEnabled ? t('disableStrava') : t('enableStrava')}
                onClick={async () => {
                  const newEnabled = !athlete.stravaEnabled;
                  await fetch('/api/admin/athlete-source', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ athleteId: athlete.id, stravaEnabled: newEnabled }),
                  });
                  fetchAthletes();
                  setActiveMenu(null);
                }}
              />
              {athlete.hasStrava && (
                <InsetRow
                  icon={ArrowRightLeft}
                  iconBg="bg-orange-500"
                  label={athlete.dataSource === 'strava' ? t('switchToGarmin') : t('switchToStrava')}
                  onClick={() => { toggleDataSource(athlete.id, athlete.dataSource === 'strava' ? 'garmin' : 'strava'); setActiveMenu(null); }}
                />
              )}
              {!isProtectedEmail(athlete.email) && (
                <InsetRow
                  icon={Trash2}
                  iconBg="bg-red-500"
                  label={tc('delete')}
                  danger
                  onClick={() => { setConfirmDelete({ id: athlete.id, name: athlete.name }); setActiveMenu(null); }}
                />
              )}
            </InsetSection>
          );
        })()}
      </Sheet>

      {/* Move Group Sheet */}
      <Sheet
        open={!!moveModal}
        onOpenChange={(o) => { if (!o) { setMoveModal(null); setSelectedGroupId(null); } }}
        title={moveModal ? `${t('moveToGroup')} ${moveModal.athleteName}` : undefined}
      >
        {moveModal && (
          <>
            <InsetSection className="mb-4">
              {[...groups]
                .sort((a, b) => {
                  // Sort by marathonGoal (faster times first) or by name if no marathonGoal
                  if (a.marathonGoal && b.marathonGoal) {
                    return a.marathonGoal.localeCompare(b.marathonGoal);
                  }
                  if (a.marathonGoal) return -1;
                  if (b.marathonGoal) return 1;
                  return a.name.localeCompare(b.name);
                })
                .map(g => {
                  const levelIconBg: Record<'fast' | 'medium' | 'slow', string> = {
                    fast: 'bg-green-500',
                    medium: 'bg-yellow-500',
                    slow: 'bg-orange-500',
                  };
                  const level = g.level || 'medium';
                  const isSelected = selectedGroupId === g.id;
                  return (
                    <InsetRow
                      key={g.id}
                      icon={UsersIcon}
                      iconBg={levelIconBg[level]}
                      label={g.name}
                      value={g.marathonGoal}
                      trailing={isSelected ? <Check className="h-4 w-4 text-primary-400" /> : undefined}
                      onClick={() => setSelectedGroupId(g.id)}
                    />
                  );
                })}
            </InsetSection>
            <Button
              variant="primary"
              className="w-full"
              onClick={() => {
                if (selectedGroupId) {
                  updateAthleteGroup(moveModal.athleteId, selectedGroupId);
                  setSelectedGroupId(null);
                }
              }}
              disabled={!selectedGroupId}
            >
              {tc('save')}
            </Button>
          </>
        )}
      </Sheet>

      {/* Delete Confirmation */}
      <ConfirmSheet
        open={!!confirmDelete}
        onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}
        title={t('deleteAthlete')}
        description={confirmDelete ? t('deleteConfirm', { name: confirmDelete.name }) : undefined}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        onConfirm={() => { if (confirmDelete) deleteAthlete(confirmDelete.id); }}
      />
    </div>
  );
}
