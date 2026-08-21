'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  GraduationCap, Watch, Plus, Search, UserMinus, Users, ClipboardCheck, CalendarPlus,
  BarChart3, Trophy, Settings as SettingsIcon, UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, Spinner, Card, Button, EmptyState, BigStat, SkeletonList, InsetSection, InsetRow } from '@/components/ui';
import { AcademyCompliance } from '@/components/AcademyCompliance';
import { AcademyPlanComposer } from '@/components/AcademyPlanComposer';
import { AcademyStats } from '@/components/AcademyStats';
import { AcademyResults } from '@/components/AcademyResults';
import { AcademySettingsPanel } from '@/components/AcademySettings';
import { AcademyRegistrations } from '@/components/AcademyRegistrations';

interface Athlete {
  id: string;
  name: string;
  email: string;
  groupName: string | null;
  groupId: string | null;
  status: 'active' | 'invited' | 'paused' | 'disconnected';
  isAcademy?: boolean;
  hasGarmin?: boolean;
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

function initialsOf(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '?';
}

// Local scrollable variant of the shared SegmentedControl (src/components/ui):
// same track + pill visual language, but segments are `shrink-0` and the
// track scrolls horizontally instead of splitting into equal `flex-1` slots —
// SegmentedControl can't fit 7 options on a single row. Kept local to this
// page rather than changing the shared primitive.
function ScrollableSegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; icon?: React.ComponentType<{ className?: string }> }>;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-0.5 overflow-x-auto scrollbar-hide rounded-xl bg-slate-800 p-1 border border-slate-700', className)}>
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => { if (!active) { try { navigator.vibrate?.(6); } catch { /* no-op */ } onChange(opt.value); } }}
            className={cn(
              'shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors min-h-[44px]',
              active ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AcademyPage() {
  const t = useTranslations('academy');
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'roster' | 'registrations' | 'stats' | 'plans' | 'compliance' | 'results' | 'settings'>('roster');

  useEffect(() => {
    fetchAthletes();
    // Deep-link to a tab, e.g. /dashboard/academy?tab=results (from the header bell).
    const tab = new URLSearchParams(window.location.search).get('tab');
    const valid = ['roster', 'registrations', 'stats', 'plans', 'compliance', 'results', 'settings'];
    if (tab && valid.includes(tab)) setView(tab as any);
  }, []);

  const fetchAthletes = async () => {
    try {
      const res = await fetch('/api/athletes');
      const data = await res.json();
      setAthletes(data.athletes || []);
    } catch (err) {
      console.error('Failed to fetch athletes:', err);
    } finally {
      setLoading(false);
    }
  };

  const setAcademy = async (athleteId: string, isAcademy: boolean) => {
    setSaving(athleteId);
    // Optimistic update
    setAthletes(prev => prev.map(a => (a.id === athleteId ? { ...a, isAcademy } : a)));
    try {
      const res = await fetch('/api/athletes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: athleteId, isAcademy }),
      });
      if (!res.ok) throw new Error('save failed');
    } catch (err) {
      console.error('Failed to update academy status:', err);
      // Revert on failure
      setAthletes(prev => prev.map(a => (a.id === athleteId ? { ...a, isAcademy: !isAcademy } : a)));
    } finally {
      setSaving(null);
    }
  };

  const academyAthletes = useMemo(
    () => athletes.filter(a => a.isAcademy),
    [athletes]
  );

  const addableAthletes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return athletes
      .filter(a => !a.isAcademy && a.status !== 'invited')
      .filter(a => !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q));
  }, [athletes, search]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <SkeletonList count={5} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="bg-primary-600/20 w-12 h-12 rounded-2xl flex items-center justify-center ring-1 ring-primary-500/20">
            <GraduationCap className="h-6 w-6 text-primary-300" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">{t('title')}</h1>
            <p className="text-sm text-slate-400">{t('subtitle')}</p>
          </div>
        </div>
        {view === 'roster' && (
          <Button onClick={() => setShowAdd(true)} className="shrink-0">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t('addAthlete')}</span>
          </Button>
        )}
      </div>

      {/* View toggle — 7 sections is too many for a single-row segmented
          control, so this scrolls horizontally instead of wrapping into a
          grid that reflows awkwardly on narrow screens. */}
      <ScrollableSegmentedControl
        value={view}
        onChange={setView}
        options={[
          { value: 'roster', label: t('tabRoster'), icon: Users },
          { value: 'registrations', label: t('tabRegistrations'), icon: UserPlus },
          { value: 'stats', label: t('tabStats'), icon: BarChart3 },
          { value: 'plans', label: t('tabPlans'), icon: CalendarPlus },
          { value: 'compliance', label: t('tabCompliance'), icon: ClipboardCheck },
          { value: 'results', label: t('tabResults'), icon: Trophy },
          { value: 'settings', label: t('tabSettings'), icon: SettingsIcon },
        ]}
        className="-mx-4 px-4 sm:mx-0 sm:px-0 mb-6"
      />

      {view === 'registrations' ? (
        <AcademyRegistrations />
      ) : view === 'stats' ? (
        <AcademyStats />
      ) : view === 'results' ? (
        <AcademyResults />
      ) : view === 'settings' ? (
        <AcademySettingsPanel />
      ) : view === 'compliance' ? (
        <AcademyCompliance />
      ) : view === 'plans' ? (
        <AcademyPlanComposer
          athletes={academyAthletes.map(a => ({ id: a.id, name: a.name, hasGarmin: a.hasGarmin }))}
        />
      ) : (
      <>
      {/* Stat */}
      <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card variant="muted">
          <BigStat value={academyAthletes.length} label={t('statAthletes')} />
        </Card>
        <Card variant="muted">
          <BigStat value={academyAthletes.filter(a => a.hasGarmin).length} label={t('statConnectedGarmin')} />
        </Card>
        <Card variant="muted">
          <BigStat value={academyAthletes.filter(a => a.status === 'active').length} label={t('statActive')} />
        </Card>
      </div>

      {/* Roster */}
      {academyAthletes.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={t('noAthletesYet')}
          description={t('noAthletesDesc')}
          action={(
            <Button onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4" />
              {t('addAthlete')}
            </Button>
          )}
        />
      ) : (
        <InsetSection>
          {academyAthletes.map(a => {
            const gs = getGroupStyle(a.groupName);
            return (
              <InsetRow
                key={a.id}
                label={a.name}
                sublabel={a.email}
                trailing={
                  <div className="flex items-center gap-2 shrink-0">
                    {a.groupName && gs && (
                      <span className={cn('text-xs font-bold px-2.5 py-1 rounded-lg border', gs.bg, gs.text, gs.border)}>
                        {a.groupName}
                      </span>
                    )}
                    <span className={cn('shrink-0', a.hasGarmin ? 'text-emerald-400' : 'text-slate-600')} title={a.hasGarmin ? t('garminConnected') : t('noGarmin')}>
                      <Watch className="h-4.5 w-4.5" />
                    </span>
                    <button
                      onClick={() => setAcademy(a.id, false)}
                      disabled={saving === a.id}
                      className="shrink-0 flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-500/10 text-xs font-semibold transition-colors disabled:opacity-50"
                      title={t('removeFromAcademy')}
                    >
                      {saving === a.id ? <Spinner size={16} /> : <UserMinus className="h-4 w-4" />}
                      <span className="hidden sm:inline">{t('remove')}</span>
                    </button>
                  </div>
                }
              />
            );
          })}
        </InsetSection>
      )}
      </>
      )}

      {/* Add Sheet */}
      <Sheet
        open={showAdd}
        onOpenChange={(o) => { if (!o) setShowAdd(false); }}
        title={t('addToAcademy')}
        bodyClassName="px-2"
      >
        <div className="px-2 pb-3">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('searchAthletes')}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl ps-9 pe-3 min-h-[44px] text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-primary-500"
            />
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {addableAthletes.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">
              {search ? t('noMatchingAthletes') : t('allAlreadyInAcademy')}
            </p>
          ) : (
            addableAthletes.map(a => {
              const gs = getGroupStyle(a.groupName);
              return (
                <button
                  key={a.id}
                  onClick={() => setAcademy(a.id, true)}
                  disabled={saving === a.id}
                  className="w-full flex items-center gap-3 p-3 min-h-[44px] rounded-xl hover:bg-slate-700/50 active:scale-[0.98] transition-all text-start disabled:opacity-50"
                >
                  <div className="bg-slate-700 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-slate-300 shrink-0">
                    {initialsOf(a.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white text-sm truncate">{a.name}</div>
                    <div className="text-xs text-slate-400 truncate">{a.email}</div>
                  </div>
                  {a.groupName && gs && (
                    <span className={cn('text-3xs font-bold px-2 py-0.5 rounded-md border', gs.bg, gs.text, gs.border)}>
                      {a.groupName}
                    </span>
                  )}
                  {saving === a.id ? (
                    <Spinner size={16} className="shrink-0" />
                  ) : (
                    <Plus className="h-4 w-4 text-primary-400 shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </Sheet>
    </div>
  );
}
