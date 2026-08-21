'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { Sheet, Button, SegmentedControl, Skeleton } from '@/components/ui';

interface PersonalInfoData {
  birthDate: string | null;
  gender: 'male' | 'female' | null;
  shoeSize: string | null;
}

type EditField = 'birthDate' | 'gender' | 'shoeSize' | null;

// Athlete self-service personal info (birth date / gender / shoe size) —
// Settings detail screen. Matches the grouped inset-list + drill-in-sheet
// pattern used one level up on the Settings landing page, instead of an
// always-editable form. Saves via PUT /api/athletes/me (owner-only: athleteId
// is the caller's own id, same trust model as /api/athletes/notification-prefs).
export function PersonalInfo({ athleteId }: { athleteId: string }) {
  const t = useTranslations('settings');
  const [initial, setInitial] = useState<PersonalInfoData | null>(null);
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  const [shoeSize, setShoeSize] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editField, setEditField] = useState<EditField>(null);

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

  // Persists a full snapshot (all three fields travel together in one PUT,
  // same as before) — called from each field's own edit sheet once the user
  // commits that field's change.
  const persist = async (data: PersonalInfoData) => {
    if (!athleteId) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/athletes/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: athleteId, ...data }),
      });
      if (res.ok) {
        setInitial(data);
        setBirthDate(data.birthDate || '');
        setGender(data.gender);
        setShoeSize(data.shoeSize || '');
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // ignore — the field keeps the attempted value, user can retry
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <InsetSection header={t('personalInfo')}>
        {[0, 1, 2].map(i => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
            <Skeleton className="h-7 w-7 rounded-md shrink-0" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </InsetSection>
    );
  }

  const genderLabel = gender ? t(gender === 'male' ? 'genderMale' : 'genderFemale') : undefined;

  return (
    <div>
      <InsetSection header={t('personalInfo')}>
        <InsetRow
          label={t('birthDate')}
          value={birthDate || undefined}
          onClick={() => setEditField('birthDate')}
        />
        <InsetRow
          label={t('gender')}
          value={genderLabel}
          onClick={() => setEditField('gender')}
        />
        <InsetRow
          label={t('shoeSize')}
          value={shoeSize || undefined}
          onClick={() => setEditField('shoeSize')}
        />
      </InsetSection>

      {saved && (
        <p className="flex items-center gap-1.5 text-green-400 px-1 -mt-2 mb-2">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">{t('saved')}</span>
        </p>
      )}

      {/* Birth date edit sheet */}
      <Sheet open={editField === 'birthDate'} onOpenChange={o => !o && setEditField(null)} title={t('birthDate')}>
        <input
          type="date"
          value={birthDate}
          onChange={e => setBirthDate(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50 [color-scheme:dark] mb-4"
        />
        <Button
          className="w-full"
          disabled={saving}
          onClick={() => { persist({ birthDate: birthDate || null, gender, shoeSize: shoeSize.trim() || null }); setEditField(null); }}
        >
          {t('saveChanges')}
        </Button>
      </Sheet>

      {/* Gender edit sheet — a two-option exclusive choice, so selecting a
          segment saves and closes immediately (no extra "Save" tap needed). */}
      <Sheet open={editField === 'gender'} onOpenChange={o => !o && setEditField(null)} title={t('gender')}>
        <SegmentedControl<'male' | 'female'>
          value={gender ?? 'male'}
          onChange={(g) => { persist({ birthDate: birthDate || null, gender: g, shoeSize: shoeSize.trim() || null }); setEditField(null); }}
          options={[
            { value: 'male', label: t('genderMale') },
            { value: 'female', label: t('genderFemale') },
          ]}
        />
      </Sheet>

      {/* Shoe size edit sheet */}
      <Sheet open={editField === 'shoeSize'} onOpenChange={o => !o && setEditField(null)} title={t('shoeSize')}>
        <input
          type="text"
          value={shoeSize}
          onChange={e => setShoeSize(e.target.value)}
          placeholder={t('shoeSizeOptional')}
          className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50 mb-4"
        />
        <Button
          className="w-full"
          disabled={saving}
          onClick={() => { persist({ birthDate: birthDate || null, gender, shoeSize: shoeSize.trim() || null }); setEditField(null); }}
        >
          {t('saveChanges')}
        </Button>
      </Sheet>
    </div>
  );
}
