'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InsetSection, InsetRow } from '@/components/ui/InsetList';
import { Sheet, Button, SegmentedControl, Skeleton, Switch } from '@/components/ui';
import { apiHeaders } from '@/lib/api';

const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
type ShirtSize = (typeof SHIRT_SIZES)[number];

// EU running-shoe sizing, half-size steps — a free-text field let people type
// anything (US/UK/cm mixed in), so this is a fixed picklist instead.
const SHOE_SIZES = Array.from({ length: 21 }, (_, i) => (36 + i * 0.5).toString().replace(/\.0$/, ''));

interface PersonalInfoData {
  name: string;
  birthDate: string | null;
  gender: 'male' | 'female' | null;
  shoeSize: string | null;
  shirtSize: ShirtSize | null;
  phone: string | null;
  discoverable: boolean;
}

type EditField = 'name' | 'birthDate' | 'gender' | 'shoeSize' | 'shirtSize' | 'phone' | null;

// Athlete self-service personal info (name / birth date / gender / shoe size /
// shirt size / phone) — Settings detail screen. shirtSize/phone were already
// collected for Academy registrants (academy_intake JSON + a promoted phone
// column) but had no self-service path for regular club members — same
// fields, same InsetSection + drill-in-Sheet pattern as everything else here.
// Saves via PUT /api/athletes/me, which gates the `id` it is given on
// requireCallerForAthlete (self-or-staff, resolved from the verified session)
// — so staff can edit a member here too, not just the athlete themself.
export function PersonalInfo({ athleteId }: { athleteId: string }) {
  const t = useTranslations('settings');
  const [initial, setInitial] = useState<PersonalInfoData | null>(null);
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  const [shoeSize, setShoeSize] = useState('');
  const [shirtSize, setShirtSize] = useState<ShirtSize | null>(null);
  const [phone, setPhone] = useState('');
  const [discoverable, setDiscoverable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editField, setEditField] = useState<EditField>(null);
  const [nameError, setNameError] = useState(false);

  useEffect(() => {
    if (!athleteId) return;
    apiHeaders()
      .then(headers => fetch(`/api/athletes/me?id=${athleteId}`, { headers }))
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const a = data?.athlete;
        const info: PersonalInfoData = {
          name: a?.name || '',
          birthDate: a?.birthDate || null,
          gender: a?.gender || null,
          shoeSize: a?.shoeSize || null,
          shirtSize: a?.shirtSize || null,
          phone: a?.phone || null,
          discoverable: a?.discoverable ?? true,
        };
        setInitial(info);
        setName(info.name);
        setBirthDate(info.birthDate || '');
        setGender(info.gender);
        setShoeSize(info.shoeSize || '');
        setShirtSize(info.shirtSize);
        setPhone(info.phone || '');
        setDiscoverable(info.discoverable);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [athleteId]);

  // Persists a full snapshot (all fields travel together in one PUT) — called
  // from each field's own edit sheet once the user commits that field's
  // change. `name` also propagates to localStorage since the greeting/avatar
  // initials elsewhere in the app read it from there, not from a live fetch.
  const persist = async (data: PersonalInfoData) => {
    if (!athleteId) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/athletes/me', {
        method: 'PUT',
        headers: await apiHeaders(true),
        body: JSON.stringify({ id: athleteId, ...data }),
      });
      if (res.ok) {
        setInitial(data);
        setName(data.name);
        setBirthDate(data.birthDate || '');
        setGender(data.gender);
        setShoeSize(data.shoeSize || '');
        setShirtSize(data.shirtSize);
        setPhone(data.phone || '');
        setDiscoverable(data.discoverable);
        try { localStorage.setItem('athlete_name', data.name); } catch { /* ignore */ }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // ignore — the field keeps the attempted value, user can retry
    } finally {
      setSaving(false);
    }
  };

  // Every field travels together in one PUT — this builds that snapshot from
  // current state plus a single override, so each sheet only needs to name
  // what it's actually changing.
  const snapshot = (override: Partial<PersonalInfoData>): PersonalInfoData => ({
    name, birthDate: birthDate || null, gender, shoeSize: shoeSize.trim() || null,
    shirtSize, phone: phone.trim() || null, discoverable,
    ...override,
  });

  if (loading) {
    return (
      <InsetSection header={t('personalInfo')}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 min-h-[52px]">
            <Skeleton className="h-7 w-7 rounded-md shrink-0" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </InsetSection>
    );
  }

  const genderLabel = gender ? t(gender === 'male' ? 'genderMale' : 'genderFemale') : undefined;
  const notSet = t('notSet');

  return (
    <div>
      <InsetSection header={t('personalInfo')}>
        <InsetRow
          label={t('fullName')}
          value={name || undefined}
          valueSuccess={!!name}
          onClick={() => setEditField('name')}
        />
        <InsetRow
          label={t('birthDate')}
          value={birthDate || notSet}
          valueMuted={!birthDate}
          valueSuccess={!!birthDate}
          onClick={() => setEditField('birthDate')}
        />
        <InsetRow
          label={t('gender')}
          value={genderLabel || notSet}
          valueMuted={!genderLabel}
          valueSuccess={!!genderLabel}
          onClick={() => setEditField('gender')}
        />
        <InsetRow
          label={t('shoeSize')}
          value={shoeSize || notSet}
          valueMuted={!shoeSize}
          valueSuccess={!!shoeSize}
          onClick={() => setEditField('shoeSize')}
        />
        <InsetRow
          label={t('shirtSize')}
          value={shirtSize || notSet}
          valueMuted={!shirtSize}
          valueSuccess={!!shirtSize}
          onClick={() => setEditField('shirtSize')}
        />
        <InsetRow
          label={t('phone')}
          value={phone || notSet}
          valueSuccess={!!phone}
          valueMuted={!phone}
          onClick={() => setEditField('phone')}
        />
      </InsetSection>

      {/* Privacy — only controls the Member Discovery browse/search list;
          teammates who already know you (feed, leaderboards, direct follow)
          are unaffected, matching that feature's own stated scope. */}
      <InsetSection header={t('privacy')}>
        <InsetRow
          label={t('discoverable')}
          sublabel={t('discoverableHint')}
          trailing={
            <Switch
              checked={discoverable}
              onChange={(v) => { setDiscoverable(v); persist(snapshot({ discoverable: v })); }}
              disabled={saving}
              loading={saving}
              ariaLabel={t('discoverable')}
            />
          }
        />
      </InsetSection>

      {saved && (
        <p className="flex items-center gap-1.5 text-green-400 px-1 -mt-2 mb-2">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">{t('saved')}</span>
        </p>
      )}

      {/* Name edit sheet — shown everywhere else in the app (greeting, feed,
          leaderboards), so it can't be saved empty. */}
      <Sheet open={editField === 'name'} onOpenChange={o => !o && setEditField(null)} title={t('fullName')}>
        <input
          type="text"
          value={name}
          onChange={e => { setName(e.target.value); setNameError(false); }}
          placeholder={t('fullNamePlaceholder')}
          className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50 mb-2"
        />
        {nameError && <p className="text-xs text-red-400 mb-2">{t('nameRequired')}</p>}
        <Button
          className="w-full mt-2"
          disabled={saving}
          onClick={() => {
            if (!name.trim()) { setNameError(true); return; }
            persist(snapshot({ name: name.trim() }));
            setEditField(null);
          }}
        >
          {t('saveChanges')}
        </Button>
      </Sheet>

      {/* Birth date edit sheet */}
      <Sheet open={editField === 'birthDate'} onOpenChange={o => !o && setEditField(null)} title={t('birthDate')}>
        <input
          type="date"
          value={birthDate}
          onChange={e => setBirthDate(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-600/50 [color-scheme:dark] mb-4"
        />
        <Button className="w-full" disabled={saving} onClick={() => { persist(snapshot({})); setEditField(null); }}>
          {t('saveChanges')}
        </Button>
      </Sheet>

      {/* Gender edit sheet — a two-option exclusive choice, so selecting a
          segment saves and closes immediately (no extra "Save" tap needed). */}
      <Sheet open={editField === 'gender'} onOpenChange={o => !o && setEditField(null)} title={t('gender')}>
        <SegmentedControl<'male' | 'female'>
          value={gender}
          onChange={(g) => { persist(snapshot({ gender: g })); setEditField(null); }}
          options={[
            { value: 'male', label: t('genderMale'), activeBg: 'bg-blue-600' },
            { value: 'female', label: t('genderFemale'), activeBg: 'bg-rose-500' },
          ]}
        />
      </Sheet>

      {/* Shoe size edit sheet — fixed EU picklist (was free text), same
          instant-save-on-tap pattern as gender/shirt size. Scrollable since
          21 half-size options don't fit a SegmentedControl row. */}
      <Sheet open={editField === 'shoeSize'} onOpenChange={o => !o && setEditField(null)} title={t('shoeSize')}>
        <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
          <InsetSection>
            {SHOE_SIZES.map(size => {
              const isSelected = shoeSize === size;
              return (
                <InsetRow
                  key={size}
                  label={size}
                  onClick={() => { setShoeSize(size); persist(snapshot({ shoeSize: size })); setEditField(null); }}
                  trailing={isSelected ? <CheckCircle2 className="h-5 w-5 text-primary-500" /> : undefined}
                />
              );
            })}
          </InsetSection>
        </div>
      </Sheet>

      {/* Shirt size edit sheet — fixed set, same instant-save pattern as gender. */}
      <Sheet open={editField === 'shirtSize'} onOpenChange={o => !o && setEditField(null)} title={t('shirtSize')}>
        <SegmentedControl<ShirtSize>
          value={shirtSize}
          onChange={(s) => { persist(snapshot({ shirtSize: s })); setEditField(null); }}
          options={SHIRT_SIZES.map(s => ({ value: s, label: s }))}
        />
      </Sheet>

      {/* Phone edit sheet */}
      <Sheet open={editField === 'phone'} onOpenChange={o => !o && setEditField(null)} title={t('phone')}>
        <input
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder={t('phonePlaceholder')}
          dir="ltr"
          className="w-full px-3 py-2.5 rounded-xl bg-slate-900/50 border border-slate-700/50 text-sm text-white placeholder-slate-500 text-end focus:outline-none focus:border-primary-600/50 mb-4"
        />
        <Button className="w-full" disabled={saving} onClick={() => { persist(snapshot({})); setEditField(null); }}>
          {t('saveChanges')}
        </Button>
      </Sheet>
    </div>
  );
}
