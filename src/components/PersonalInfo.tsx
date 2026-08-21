'use client';

import { useState, useEffect } from 'react';
import { User, Loader2, CheckCircle2, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

interface PersonalInfoData {
  birthDate: string | null;
  gender: 'male' | 'female' | null;
  shoeSize: string | null;
}

// Athlete self-service personal info (birth date / gender / shoe size) —
// Settings detail screen. Mirrors the Profile page's group-edit pattern: local
// editable state + a Save button that only appears once something changed.
// Saves via PUT /api/athletes/me (owner-only: athleteId is the caller's own
// id, same trust model as /api/athletes/notification-prefs).
export function PersonalInfo({ athleteId }: { athleteId: string }) {
  const t = useTranslations('settings');
  const [initial, setInitial] = useState<PersonalInfoData | null>(null);
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  const [shoeSize, setShoeSize] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!athleteId) return;
    fetch(`/api/athletes/me?id=${athleteId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const a = data?.athlete;
        const info: PersonalInfoData = {
          birthDate: a?.birthDate || null,
          gender: a?.gender || null,
          shoeSize: a?.shoeSize || null,
        };
        setInitial(info);
        setBirthDate(info.birthDate || '');
        setGender(info.gender);
        setShoeSize(info.shoeSize || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [athleteId]);

  const hasChanges = !!initial && (
    birthDate !== (initial.birthDate || '') ||
    gender !== initial.gender ||
    shoeSize !== (initial.shoeSize || '')
  );

  const save = async () => {
    if (!athleteId || !hasChanges) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/athletes/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: athleteId,
          birthDate: birthDate || null,
          gender,
          shoeSize: shoeSize.trim() || null,
        }),
      });
      if (res.ok) {
        setInitial({ birthDate: birthDate || null, gender, shoeSize: shoeSize.trim() || null });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // ignore — the form keeps the attempted values, user can retry
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-violet-500/15 flex items-center justify-center">
            <User className="h-4.5 w-4.5 text-violet-400" />
          </div>
          <h2 className="font-semibold text-white">{t('personalInfo')}</h2>
        </div>
        {saved && (
          <div className="flex items-center gap-1.5 text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-xs font-medium">{t('saved')}</span>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('birthDate')}</label>
          <input
            type="date"
            value={birthDate}
            onChange={e => setBirthDate(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50 [color-scheme:dark]"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('gender')}</label>
          <div className="grid grid-cols-2 gap-2">
            {(['male', 'female'] as const).map(g => {
              const isSelected = gender === g;
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGender(g)}
                  className={cn(
                    'px-4 py-2.5 rounded-xl border text-sm font-medium transition-all min-h-[44px]',
                    isSelected
                      ? 'border-primary-600/60 bg-primary-600/10 text-white'
                      : 'border-slate-700/50 bg-slate-900/30 text-slate-400 hover:bg-slate-700/30 hover:border-slate-600'
                  )}
                >
                  {t(g === 'male' ? 'genderMale' : 'genderFemale')}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('shoeSize')}</label>
          <input
            type="text"
            value={shoeSize}
            onChange={e => setShoeSize(e.target.value)}
            placeholder={t('shoeSizeOptional')}
            className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50"
          />
        </div>
      </div>

      {hasChanges && (
        <button
          onClick={save}
          disabled={saving}
          className="mt-5 w-full bg-primary-600 hover:bg-primary-700 text-white font-semibold px-4 py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('saving')}
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {t('saveChanges')}
            </>
          )}
        </button>
      )}
    </div>
  );
}
