'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  UserPlus, Copy, CheckCircle2, Wifi, WifiOff, Clock,
  Users as UsersIcon, Check, Mail, Trash2, ChevronDown,
  PauseCircle, PlayCircle, ArrowRightLeft, MessageCircle, UserMinus,
  Wrench, Search, Lock, Unlock, DoorOpen, User as UserIcon
} from 'lucide-react';
import { cn, getGroupChip } from '@/lib/utils';
import { apiHeaders, useApi } from '@/lib/api';
import { isProtectedEmail } from '@/lib/constants';
import { Skeleton, SkeletonCard, Sheet, ConfirmSheet, SegmentedControl, InsetSection, InsetRow, Card, Button, EmptyState, BigStat } from '@/components/ui';
import { useTranslations } from 'next-intl';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { teammateHref } from '@/lib/athletes/profile-link';
import { maintenanceBlocks, type MaintenanceState } from '@/lib/maintenance-rule';

interface Athlete {
  id: string;
  name: string;
  email: string;
  groupName: string | null;
  groupId: string | null;
  /** 'removed' = taken out of the club from the entry queue; history kept. */
  status: 'active' | 'invited' | 'paused' | 'disconnected' | 'removed';
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



export default function AthletesPage() {
  const t = useTranslations('athletes');
  const tc = useTranslations('common');
  // Cached via useApi (SWR) — revisiting this tab shows the last-known roster
  // instantly instead of a blank spinner, matching the fix already applied to
  // Home. Mutations call `mutateAthletes()` (a plain revalidate, no optimistic
  // patch) in place of the old manual re-fetch.
  const { data: athletesData, isLoading: loading, mutate: mutateAthletes } = useApi<{ athletes: Athlete[] }>('/api/athletes');
  const { data: groupsData } = useApi<{ groups: Group[] }>('/api/groups');
  const athletes = athletesData?.athletes || [];
  const groups = groupsData?.groups || [];
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
  const [filter, setFilter] = useState<'all' | 'active' | 'invited' | 'paused' | 'blocked'>('all');
  const [query, setQuery] = useState('');

  // Maintenance, on the roster. It is the only state on this screen that can make
  // a perfectly active member unable to open the app at all, and until now it was
  // invisible here: the switch lived in Settings and the allowlist was a text
  // field of addresses, so "why can't Dana get in" had no answer on the screen
  // that lists Dana. `allowlist` only comes back to an approver — so its absence,
  // not `maintenance`, is what decides whether any of this renders. Without it we
  // cannot tell who is exempt, and guessing would paint the whole club as blocked.
  const { data: maintenanceData, mutate: mutateMaintenance } =
    useApi<{ maintenance: boolean; allowlist?: string[] }>('/api/maintenance');
  const canSeeMaintenance = Array.isArray(maintenanceData?.allowlist);
  const maintenanceState: MaintenanceState = useMemo(
    () => ({ on: !!maintenanceData?.maintenance, allow: maintenanceData?.allowlist || [] }),
    [maintenanceData],
  );
  const [releasing, setReleasing] = useState<string | null>(null);
  const [turningOff, setTurningOff] = useState(false);

  // Same predicate the API gate uses (maintenance-rule.ts), given the handles this
  // screen has. Never the JWT address — a Strava login's is synthetic, so it can
  // match nothing; the id is the handle that always exists.
  const blockedByMaintenance = (athlete: Athlete) =>
    canSeeMaintenance
    && maintenanceBlocks({ athleteEmail: athlete.email, athleteId: athlete.id }, maintenanceState);

  /** Handles worth writing for one person: the id always, the address if it's real. */
  const handlesFor = (athlete: Athlete) =>
    [athlete.id, athlete.email]
      .map((h) => String(h || '').toLowerCase().trim())
      .filter((h) => h && !h.endsWith('.local'));

  const setMaintenanceAllow = async (allowlist: string[]) => {
    const res = await fetch('/api/maintenance', {
      method: 'PUT',
      headers: await bearerHeaders(),
      body: JSON.stringify({ allowlist }),
    });
    if (res.ok) mutateMaintenance();
  };

  const toggleMaintenanceFor = async (athlete: Athlete, release: boolean) => {
    setReleasing(athlete.id);
    try {
      const handles = handlesFor(athlete);
      const next = release
        ? [...new Set([...maintenanceState.allow, ...handles])]
        : maintenanceState.allow.filter((entry) => !handles.includes(entry));
      await setMaintenanceAllow(next);
      setActiveMenu(null);
    } finally {
      setReleasing(null);
    }
  };

  const turnMaintenanceOff = async () => {
    setTurningOff(true);
    try {
      const res = await fetch('/api/maintenance', {
        method: 'PUT',
        headers: await bearerHeaders(),
        body: JSON.stringify({ on: false }),
      });
      if (res.ok) mutateMaintenance();
    } finally {
      setTurningOff(false);
    }
  };

  const createInvite = async () => {
    if (!inviteName.trim() || !inviteEmail.trim()) return;
    setSubmitting(true);
    try {
      const response = await fetch('/api/athletes', {
        method: 'POST',
        headers: await bearerHeaders(),
        body: JSON.stringify({ name: inviteName, email: inviteEmail, groupId: inviteGroup || undefined }),
      });
      const data = await response.json();
      if (response.ok) {
        setInviteLink(data.inviteLink);
        setInviteName('');
        setInviteEmail('');
        setInviteGroup('');
        mutateAthletes();
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
        headers: await bearerHeaders(),
        body: JSON.stringify({ id: athleteId, groupId }),
      });
      mutateAthletes();
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
        headers: await bearerHeaders(),
        body: JSON.stringify({ athleteId, dataSource: source }),
      });
      mutateAthletes();
    } catch (error) {
      console.error('Failed to toggle source:', error);
    }
  };

  const connectStrava = async (athleteId: string) => {
    try {
      // Authenticated: the link branch of /api/strava is self-or-staff gated,
      // because its `state` decides whose athlete row the returning Strava
      // tokens get written onto.
      const res = await fetch(`/api/strava?athleteId=${athleteId}`, {
        headers: await apiHeaders(),
      });
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
        headers: await bearerHeaders(),
        body: JSON.stringify({ id: athleteId, status }),
      });
      mutateAthletes();
      setActiveMenu(null);
    } catch (error) {
      console.error('Failed to update status:', error);
    }
  };

  const deleteAthlete = async (athleteId: string) => {
    try {
      await fetch(`/api/athletes?id=${athleteId}`, { method: 'DELETE', headers: await bearerHeaders(false) });
      mutateAthletes();
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
        headers: await bearerHeaders(),
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

  const filteredAthletes = athletes.filter((a) => {
    // 22 members and no way to find one — every "where is X" ended in a scroll.
    const needle = query.trim().toLowerCase();
    if (needle && !`${a.name} ${a.email}`.toLowerCase().includes(needle)) return false;
    if (filter === 'all') return true;
    if (filter === 'blocked') return blockedByMaintenance(a);
    return a.status === filter;
  });

  const blockedCount = canSeeMaintenance ? athletes.filter(blockedByMaintenance).length : 0;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-accent-600/20 text-accent-900 border border-accent-600/30">
            <Wifi className="h-3 w-3" /> {t('active')}
          </span>
        );
      case 'invited':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-band-3/20 text-band-3-ink border border-band-3/30">
            <Clock className="h-3 w-3" /> {t('invited')}
          </span>
        );
      // Its own badge rather than falling through to "disconnected", which would
      // read as a sync problem — the opposite of a deliberate removal.
      case 'removed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-page text-ink-400 border border-page">
            <UserMinus className="h-3 w-3" /> {t('removed')}
          </span>
        );
      case 'paused':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-band-3/20 text-band-3-ink border border-band-3/30">
            <PauseCircle className="h-3 w-3" /> {t('paused')}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-accent-red/20 text-accent-red border border-accent-red/30">
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
          <p className="text-ink-400 mt-1">{t('subtitle')}</p>
        </div>
        <Button variant="primary" onClick={() => { setShowInvite(true); setInviteLink(null); }}>
          <UserPlus className="h-4 w-4" />
          {t('inviteAthlete')}
        </Button>
      </div>

      {/* Maintenance banner — the club is closed and this is the screen where you
          find out who that hurts, with the switch right here instead of buried in
          Settings. Shown only to an approver, who is the only caller that gets an
          allowlist back and the only one allowed to write it. */}
      {canSeeMaintenance && maintenanceState.on && (
        <Card variant="solid" className="border border-accent-red/40 bg-accent-red/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-9 h-9 rounded-full bg-accent-red/15 flex items-center justify-center">
                <Wrench className="h-4 w-4 text-accent-red" />
              </span>
              <div>
                <p className="font-semibold text-accent-red">{t('maintenanceOn')}</p>
                <p className="text-sm text-ink-400 mt-0.5">
                  {t('maintenanceBlockedCount', { count: blockedCount })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* The roster can release one person, but the queue is where their
                  whole state is — approval, last entry, watch, notifications —
                  and where approving also lets them past the window. */}
              <Link href="/dashboard/entry-queue">
                <Button variant="secondary">
                  <DoorOpen className="h-4 w-4" />
                  {t('maintenanceOpenQueue')}
                </Button>
              </Link>
              <Button variant="primary" onClick={turnMaintenanceOff} disabled={turningOff}>
                <Wrench className="h-4 w-4" />
                {turningOff ? t('maintenanceTurningOff') : t('maintenanceTurnOff')}
              </Button>
            </div>
          </div>
        </Card>
      )}

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
      <div className="flex flex-wrap items-center gap-3">
      <SegmentedControl
        value={filter}
        onChange={setFilter}
        options={(maintenanceState.on && canSeeMaintenance
          ? (['all', 'active', 'invited', 'paused', 'blocked'] as const)
          : (['all', 'active', 'invited', 'paused'] as const)
        ).map((tab) => ({
          value: tab,
          // `t(tab)`, not the raw key: these chips rendered as "all (22) /
          // active (21) / invited (1) / paused (0)" — four English words in the
          // middle of a Hebrew page, directly under the stat blocks that already
          // say פעיל / הוזמן / מושהה. The keys existed; the interpolation just
          // never went through the translator.
          label: `${t(tab)} (${
            tab === 'all'
              ? athletes.length
              : tab === 'blocked'
                ? blockedCount
                : athletes.filter((a) => a.status === tab).length
          })`,
        }))}
        className="w-fit"
      />

        {/* Search — a roster this size was scroll-only until now. */}
        <label className="relative flex-1 min-w-[200px]">
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-ink-400 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full bg-card border border-page rounded-full ps-9 pe-4 py-2.5 min-h-[44px] text-[15px] focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
        </label>
      </div>

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
              className="bg-page border border-page rounded-lg px-4 py-2.5 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder={t('emailAddress')}
              type="email"
              className="bg-page border border-page rounded-lg px-4 py-2.5 min-h-[44px] focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            {/* Group picker — tapping opens a Sheet of InsetRow options,
                same "pick one from a list" pattern as everywhere else in the
                app, instead of a native <select>. */}
            <button
              type="button"
              onClick={() => setGroupPickerOpen(true)}
              className="bg-page border border-page rounded-lg px-4 py-2.5 min-h-[44px] flex items-center justify-between gap-2 text-start hover:border-ink-300 transition-colors"
            >
              <span className={cn('truncate', inviteGroup ? 'text-ink-700' : 'text-ink-400')}>
                {inviteGroup ? groups.find((g) => g.id === inviteGroup)?.name : t('noGroup')}
              </span>
              <ChevronDown className="h-4 w-4 text-ink-400 shrink-0" />
            </button>
          </div>
          <Button variant="primary" className="w-full" onClick={createInvite} disabled={submitting || !inviteName.trim() || !inviteEmail.trim()}>
            <Mail className="h-4 w-4" />
            {submitting ? t('generating') : t('generateInviteLink')}
          </Button>
          {inviteLink && (
            <div className="bg-page/50 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-accent-600 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4" />
                {t('invitationCreated')}
              </div>
              <div className="flex items-center gap-2">
                <input value={inviteLink} readOnly className="flex-1 bg-page border border-ink-300 rounded-lg px-4 py-2 text-sm" />
                <Button variant="secondary" onClick={copyLink} className={copied ? 'bg-accent-600 hover:opacity-90' : undefined}>
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
            trailing={!inviteGroup ? <Check className="h-4 w-4 text-brand-600" /> : undefined}
            onClick={() => { setInviteGroup(''); setGroupPickerOpen(false); }}
          />
          {groups.map((g) => (
            <InsetRow
              key={g.id}
              icon={UsersIcon}
              label={g.name}
              trailing={inviteGroup === g.id ? <Check className="h-4 w-4 text-brand-600" /> : undefined}
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
            <p className="text-sm text-ink-400 mt-1">
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
          <div className="bg-page/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <input value={publicLink} readOnly className="flex-1 bg-page border border-ink-300 rounded-lg px-4 py-2 text-sm" />
              <Button variant="secondary" onClick={copyPublicLink} className={publicLinkCopied ? 'bg-accent-600 hover:opacity-90' : undefined}>
                {publicLinkCopied ? <><Check className="h-4 w-4" />{tc('copied')}</> : <><Copy className="h-4 w-4" />{tc('copy')}</>}
              </Button>
              <Button variant="secondary" onClick={sharePublicLinkWhatsApp} className="bg-[#25D366] hover:bg-[#20BA59]">
                <MessageCircle className="h-4 w-4" />
                {t('whatsApp')}
              </Button>
            </div>
            <p className="text-xs text-ink-400">
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
            const groupStyle = getGroupChip(athlete.groupName);
            return (
              <button
                key={athlete.id}
                onClick={() => setActiveMenu(athlete.id)}
                className="w-full text-start active:bg-page/40 transition-colors"
              >
                <div className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
                  <span className="shrink-0 w-9 h-9 rounded-full bg-brand-600/20 flex items-center justify-center">
                    <span className="text-brand-600 font-semibold text-xs">{initials}</span>
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-medium text-ink-700 truncate" dir="auto">{athlete.name}</span>
                    <span className="block text-xs text-ink-400 truncate">{athlete.email}</span>
                    {(athlete.groupName || athlete.hasGarmin || athlete.hasStrava) && (
                      <span className="flex flex-wrap items-center gap-1 mt-1">
                        {athlete.groupName && (
                          <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-medium', groupStyle?.bg, groupStyle?.text)}>
                            {athlete.groupName}
                          </span>
                        )}
                        {athlete.hasGarmin && <span className="text-2xs font-bold px-1.5 py-0.5 rounded bg-accent-600/15 text-accent-900">Garmin</span>}
                        {athlete.hasStrava && <span className="text-2xs font-bold px-1.5 py-0.5 rounded bg-band-3/15 text-band-3-ink">Strava</span>}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 flex items-center gap-1.5">
                    {blockedByMaintenance(athlete) && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-2xs font-semibold bg-accent-red/15 text-accent-red border border-accent-red/30">
                        <Lock className="h-3 w-3" /> {t('maintenanceBlockedBadge')}
                      </span>
                    )}
                    {canSeeMaintenance && maintenanceState.on && !blockedByMaintenance(athlete) && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-2xs font-semibold bg-accent-600/15 text-accent-900 border border-accent-600/30">
                        <Unlock className="h-3 w-3" /> {t('maintenanceAllowedBadge')}
                      </span>
                    )}
                    {getStatusBadge(athlete.status)}
                  </span>
                </div>
              </button>
            );
          })}
        </InsetSection>
      ) : (
        <EmptyState
          icon={UsersIcon}
          title={t('noAthletes')}
          description={query.trim() ? t('noSearchMatches') : filter !== 'all' ? t('noAthletesStatus') : t('inviteFirst')}
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
              {/* The roster row itself cannot be the link: it is a <button> that
                  opens this sheet, and an <a> inside a <button> is invalid markup
                  that browsers un-nest — one of the two targets dies silently. So
                  the profile is the FIRST action in the sheet the row already
                  opens, which is also where the academy's MemberSheet puts it. */}
              <InsetRow
                icon={UserIcon}
                iconBg="bg-ink-300"
                label={tc('viewProfile')}
                href={teammateHref(athlete.id) ?? undefined}
              />
              <InsetRow
                icon={ArrowRightLeft}
                iconBg="bg-brand-600"
                label={t('moveToGroup')}
                onClick={() => { setMoveModal({ athleteId: athlete.id, athleteName: athlete.name }); setActiveMenu(null); }}
              />
              {athlete.status === 'active' ? (
                <InsetRow
                  icon={PauseCircle}
                  iconBg="bg-band-3"
                  label={t('pause')}
                  onClick={() => updateAthleteStatus(athlete.id, 'paused')}
                />
              ) : athlete.status === 'paused' ? (
                <InsetRow
                  icon={PlayCircle}
                  iconBg="bg-accent-600"
                  label={t('reactivate')}
                  onClick={() => updateAthleteStatus(athlete.id, 'active')}
                />
              ) : null}
              {/* Let them in, or shut them back out, without leaving the roster.
                  Writes the athlete ID (plus a real address if the row has one),
                  because the allowlist is matched against handles and an id is the
                  only one every member is guaranteed to have. */}
              {canSeeMaintenance && maintenanceState.on && (
                blockedByMaintenance(athlete) ? (
                  <InsetRow
                    icon={Unlock}
                    iconBg="bg-accent-600"
                    label={releasing === athlete.id ? t('maintenanceSaving') : t('maintenanceRelease')}
                    onClick={() => toggleMaintenanceFor(athlete, true)}
                  />
                ) : (
                  <InsetRow
                    icon={Lock}
                    iconBg="bg-accent-red"
                    label={releasing === athlete.id ? t('maintenanceSaving') : t('maintenanceBlock')}
                    onClick={() => toggleMaintenanceFor(athlete, false)}
                  />
                )
              )}
              <InsetRow
                icon={Wifi}
                iconBg="bg-band-3"
                label={athlete.stravaEnabled ? t('disableStrava') : t('enableStrava')}
                onClick={async () => {
                  const newEnabled = !athlete.stravaEnabled;
                  await fetch('/api/admin/athlete-source', {
                    method: 'PATCH',
                    headers: await bearerHeaders(),
                    body: JSON.stringify({ athleteId: athlete.id, stravaEnabled: newEnabled }),
                  });
                  mutateAthletes();
                  setActiveMenu(null);
                }}
              />
              {athlete.hasStrava && (
                <InsetRow
                  icon={ArrowRightLeft}
                  iconBg="bg-band-3"
                  label={athlete.dataSource === 'strava' ? t('switchToGarmin') : t('switchToStrava')}
                  onClick={() => { toggleDataSource(athlete.id, athlete.dataSource === 'strava' ? 'garmin' : 'strava'); setActiveMenu(null); }}
                />
              )}
              {!isProtectedEmail(athlete.email) && (
                <InsetRow
                  icon={Trash2}
                  iconBg="bg-accent-red"
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
                    fast: 'bg-accent-600',
                    medium: 'bg-band-3',
                    slow: 'bg-band-3',
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
                      trailing={isSelected ? <Check className="h-4 w-4 text-brand-600" /> : undefined}
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
