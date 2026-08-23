'use client';

import { useState, useEffect } from 'react';
import { Trophy, Loader2, Plus, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Sheet, SegmentedControl, Button, LoadingBlock, EmptyState, ConfirmSheet, Switch } from '@/components/ui';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { authedFetch } from '@/lib/auth/authed-fetch';

interface Challenge {
  id: string;
  nameHe: string;
  nameEn: string;
  descriptionHe: string | null;
  descriptionEn: string | null;
  metric: 'distance_km' | 'workout_count' | 'elevation_m';
  targetValue: number;
  scope: 'individual' | 'group';
  startDate: string;
  endDate: string;
  active: boolean;
  icon: string;
  iconUrl: string | null;
}

type Metric = 'distance_km' | 'workout_count' | 'elevation_m';
type Scope = 'individual' | 'group';

function metricLabel(c: Challenge, t: (key: string) => string): string {
  const unit = c.metric === 'distance_km' ? 'km' : c.metric === 'elevation_m' ? 'm' : t('metricWorkouts');
  return `${c.targetValue} ${unit}`;
}

/**
 * Settings > Management > Challenge Manager detail screen (roadmap #13,
 * Phase 4). Shows the full challenge history (read-only list, including
 * ended ones — the athlete-facing GET /api/challenges only shows currently
 * active ones) and a "+ New Challenge" form. Creating a challenge also
 * creates its underlying badge (rule_type='challenge_completed') server-side
 * — see POST /api/admin/challenges — so this form needs no separate "pick a
 * badge" step.
 */
export function ChallengeManager() {
  const t = useTranslations('challengeManager');
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [nameHe, setNameHe] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [descriptionHe, setDescriptionHe] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [metric, setMetric] = useState<Metric>('distance_km');
  const [targetValue, setTargetValue] = useState('');
  const [scope, setScope] = useState<Scope>('individual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeState, setActiveState] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Challenge | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const fetchChallenges = () => {
    setLoading(true);
    authedFetch('/api/admin/challenges')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setChallenges(d?.challenges || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchChallenges(); }, []);

  const resetForm = () => {
    setEditingId(null);
    setNameHe('');
    setNameEn('');
    setDescriptionHe('');
    setDescriptionEn('');
    setMetric('distance_km');
    setTargetValue('');
    setScope('individual');
    setStartDate('');
    setEndDate('');
    setActiveState(true);
    setError(null);
  };

  const openNew = () => {
    resetForm();
    setSheetOpen(true);
  };

  const openEdit = (challenge: Challenge) => {
    setEditingId(challenge.id);
    setNameHe(challenge.nameHe);
    setNameEn(challenge.nameEn);
    setDescriptionHe(challenge.descriptionHe || '');
    setDescriptionEn(challenge.descriptionEn || '');
    setMetric(challenge.metric);
    setTargetValue(String(challenge.targetValue));
    setScope(challenge.scope);
    setStartDate(challenge.startDate);
    setEndDate(challenge.endDate);
    setActiveState(challenge.active);
    setError(null);
    setSheetOpen(true);
  };

  const canSave =
    nameHe.trim().length > 0 &&
    nameEn.trim().length > 0 &&
    Number(targetValue) > 0 &&
    !!startDate &&
    !!endDate &&
    endDate >= startDate &&
    !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        nameHe: nameHe.trim(),
        nameEn: nameEn.trim(),
        descriptionHe: descriptionHe.trim() || undefined,
        descriptionEn: descriptionEn.trim() || undefined,
        metric,
        targetValue: Number(targetValue),
        scope,
        startDate,
        endDate,
        ...(editingId ? { active: activeState } : {}),
      };
      const res = await authedFetch(
        editingId ? `/api/admin/challenges/${editingId}` : '/api/admin/challenges',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || (editingId ? t('updateError') : t('createError')));

      setSheetOpen(false);
      resetForm();
      fetchChallenges();
    } catch (err: unknown) {
      setError((err as Error).message || (editingId ? t('updateError') : t('createError')));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setDeleteError(null);
    try {
      const res = await authedFetch(`/api/admin/challenges/${target.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('deleteError'));
      fetchChallenges();
    } catch (err: unknown) {
      setDeleteError((err as Error).message || t('deleteError'));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white">{t('existingChallenges')}</h2>
        <Button size="sm" onClick={openNew}>
          <Plus className="h-4 w-4" />
          {t('newChallenge')}
        </Button>
      </div>

      {deleteError && (
        <div className="mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{deleteError}</div>
      )}

      {loading ? (
        <LoadingBlock />
      ) : challenges.length === 0 ? (
        <EmptyState icon={Trophy} title={t('noChallenges')} />
      ) : (
        <InsetSection>
          {challenges.map((c) => (
            <InsetRow
              key={c.id}
              label={c.nameHe}
              sublabel={`${c.nameEn} · ${metricLabel(c, t)} · ${c.startDate} → ${c.endDate}`}
              trailing={
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={cn('text-2xs font-bold px-2 py-0.5 rounded-full', c.active ? 'bg-green-500/15 text-green-400' : 'bg-slate-700 text-slate-500')}>
                    {c.active ? t('active') : t('inactive')}
                  </span>
                  <button
                    onClick={() => openEdit(c)}
                    className="p-2 min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
                    aria-label={t('edit')}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(c)}
                    className="p-2 min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-500/10"
                    aria-label={t('delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <div className="w-9 h-9 rounded-full bg-slate-900/60 border border-slate-700/50 flex items-center justify-center overflow-hidden">
                    {c.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.iconUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-base">{c.icon}</span>
                    )}
                  </div>
                </div>
              }
            />
          ))}
        </InsetSection>
      )}

      <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) resetForm(); }} title={editingId ? t('editChallenge') : t('newChallenge')}>
        <div className="space-y-4 pb-2">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('nameHebrew')}</label>
              <input
                value={nameHe}
                onChange={(e) => setNameHe(e.target.value)}
                dir="rtl"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('nameEnglish')}</label>
              <input
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                dir="ltr"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('descriptionHebrew')}</label>
              <input
                value={descriptionHe}
                onChange={(e) => setDescriptionHe(e.target.value)}
                dir="rtl"
                placeholder={t('optional')}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('descriptionEnglish')}</label>
              <input
                value={descriptionEn}
                onChange={(e) => setDescriptionEn(e.target.value)}
                dir="ltr"
                placeholder={t('optional')}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('metric')}</label>
            <SegmentedControl<Metric>
              value={metric}
              onChange={setMetric}
              options={[
                { value: 'distance_km', label: t('metricDistance') },
                { value: 'workout_count', label: t('metricWorkouts') },
                { value: 'elevation_m', label: t('metricElevation') },
              ]}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">
              {t('targetValue')} ({metric === 'distance_km' ? 'km' : metric === 'elevation_m' ? 'm' : t('metricWorkouts')})
            </label>
            <input
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              placeholder="100"
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('scope')}</label>
            <SegmentedControl<Scope>
              value={scope}
              onChange={setScope}
              options={[
                { value: 'individual', label: t('scopeIndividual') },
                { value: 'group', label: t('scopeGroup') },
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('startDate')}</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white [color-scheme:dark] focus:outline-none focus:border-primary-600/50"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('endDate')}</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white [color-scheme:dark] focus:outline-none focus:border-primary-600/50"
              />
            </div>
          </div>

          {editingId && (
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50">
              <span className="text-sm font-medium text-white">{activeState ? t('active') : t('inactive')}</span>
              <Switch checked={activeState} onChange={(v) => setActiveState(v)} size="sm" />
            </div>
          )}

          <Button className="w-full" onClick={handleSave} disabled={!canSave}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
            {saving ? (editingId ? t('updating') : t('creating')) : (editingId ? t('saveChanges') : t('createChallenge'))}
          </Button>
        </div>
      </Sheet>

      <ConfirmSheet
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t('deleteChallenge')}
        description={t('deleteChallengeDesc')}
        confirmLabel={t('delete')}
        onConfirm={handleDelete}
      />
    </div>
  );
}
