'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { resolveGroup } from '@/lib/utils';
import { JOURNEY, JourneyCard, JourneyHero, JourneyScreen, PrimaryButton, SecondaryButton } from '@/components/onboarding/journey-ui';

/**
 * "How will we tell you you're in?" — REQUIRED for a Strava sign-in (2026-10-19).
 *
 * Strava gives us no email, so the address on file is the synthetic
 * strava_<id>@strava.madregot.local, and an iPhone Safari tab cannot take a push:
 * without an address, approving them reaches nobody. While it was an optional card
 * on the waiting screen 1 of 7 left one, and the one who waited longest (36 days)
 * never came back. So it is now a step of its own, before the waiting screen, and
 * the approvers are not even told about the request until it is done
 * (POST /api/onboarding/notify-email → announceSignupRequest).
 *
 * Also asks, optionally, for their pace group, which the public form asks and a
 * Strava sign-in never did — the approver's "no group" was the other thing that
 * held these people at the door.
 */
export interface ApprovalContact { needed: boolean; email: string | null; name: string | null }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The address on their pending request, or whether one is needed at all. Null while asking or on failure. */
export function useApprovalContact(): [ApprovalContact | null | 'error', (c: ApprovalContact) => void] {
  const [contact, setContact] = useState<ApprovalContact | null | 'error'>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/onboarding/notify-email', { headers: await bearerHeaders() });
        if (!res.ok) throw new Error(String(res.status));
        const d = (await res.json()) as ApprovalContact;
        if (live) setContact({ needed: !!d.needed, email: d.email ?? null, name: d.name ?? null });
      } catch {
        if (live) setContact('error');
      }
    })();
    return () => { live = false; };
  }, []);
  return [contact, setContact];
}

interface PublicGroup { id: string; name: string; index?: number; marathonGoal?: string }

function groupNameHe(g: PublicGroup): string {
  const i = typeof g.index === 'number' ? g.index : resolveGroup(g.name).index;
  return i >= 0 ? `קבוצה ${i + 1}` : g.name;
}
function goalHe(goal?: string): string {
  const g = (goal || '').trim();
  return g ? `יעד מרתון ${g.replace(/^sub\s*/i, 'תת ')}` : '';
}

/** The step itself: a whole screen. `editing` = fixing an address already left. */
export function ApprovalEmailStep({ name, initialEmail, editing = false, onSaved, onCancel, footer }: {
  name: string | null;
  initialEmail?: string | null;
  editing?: boolean;
  onSaved: (email: string) => void;
  onCancel?: () => void;
  /** Below the form: the claim-your-account card and the sign-out, as on the waiting screen. */
  footer?: React.ReactNode;
}) {
  const t = useTranslations('pendingEmail');
  const [email, setEmail] = useState(initialEmail || '');
  const [groups, setGroups] = useState<PublicGroup[]>([]);
  const [groupId, setGroupId] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'bad' | 'error'>('idle');
  const first = (name || '').trim().split(/\s+/)[0] || '';

  useEffect(() => {
    if (editing) return;
    // Optional field: a failure only means no picker.
    fetch('/api/public/groups').then((r) => r.json()).then((d) => setGroups(d.groups || [])).catch(() => {});
  }, [editing]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!EMAIL.test(clean)) { setState('bad'); return; }
    setState('saving');
    try {
      const res = await fetch('/api/onboarding/notify-email', {
        method: 'POST', headers: await bearerHeaders(), body: JSON.stringify({ email: clean, groupId: groupId || null }),
      });
      if (res.status === 400) { setState('bad'); return; }
      if (!res.ok) throw new Error(String(res.status));
      onSaved(clean);
    } catch { setState('error'); }
  };

  return (
    <form onSubmit={save} noValidate>
      <JourneyScreen
        testId="approval-email-step"
        hero={<JourneyHero
          eyebrow={t('stepEyebrow')}
          title={editing ? t('editTitle') : first ? t('stepTitle', { first }) : t('stepTitleNoName')}
          subtitle={editing ? t('editSub') : t('stepSub')}
        />}
        actions={(
          <>
            <PrimaryButton type="submit" disabled={state === 'saving'}>{state === 'saving' ? '…' : editing ? t('save') : t('submit')}</PrimaryButton>
            {editing
              ? <SecondaryButton onClick={onCancel}>{t('cancel')}</SecondaryButton>
              : <p className="pt-1 text-center text-[12.5px]" style={{ color: JOURNEY.soft }}>{t('submitNote')}</p>}
          </>
        )}
      >
        <JourneyCard>
          <label htmlFor="approval-email" className="mb-1 block text-[13px] font-bold" style={{ color: JOURNEY.soft }}>
            {t('fieldLabel')} <span style={{ color: JOURNEY.red }}>*</span>
          </label>
          <input
            id="approval-email" type="email" inputMode="email" autoComplete="email" required value={email}
            onChange={(e) => { setEmail(e.target.value); if (state !== 'idle') setState('idle'); }}
            dir={email ? 'ltr' : 'rtl'} placeholder={t('placeholder')}
            className={`h-[52px] w-full rounded-2xl border bg-white px-4 text-base focus:outline-none ${email ? 'text-left' : 'text-right'}`}
            style={{ borderColor: state === 'bad' ? JOURNEY.red : JOURNEY.line, color: JOURNEY.ink }}
            data-testid="approval-email-input"
          />
          <p className="mt-1.5 text-[12.5px]" style={{ color: JOURNEY.soft }}>{t('fieldHint')}</p>
          {state === 'bad' && <p role="alert" className="mt-2 text-[13px] font-bold" style={{ color: JOURNEY.red }}>{t('bad')}</p>}
          {state === 'error' && <p role="alert" className="mt-2 text-[13px] font-bold" style={{ color: JOURNEY.red }}>{t('error')}</p>}
        </JourneyCard>

        {!editing && groups.length > 0 && (
          <fieldset className="rounded-[20px] bg-white p-4">
            <legend className="sr-only">{t('groupLegend')}</legend>
            <p className="mb-2 text-[13px] font-bold" style={{ color: JOURNEY.soft }} aria-hidden>
              {t('groupLegend')} <span className="font-normal">{t('optional')}</span>
            </p>
            <div className="flex flex-col gap-2">
              {[...groups.map((g) => ({ id: g.id, title: groupNameHe(g), sub: goalHe(g.marathonGoal) })), { id: '', title: t('groupUnsure'), sub: t('groupUnsureSub') }].map((o) => {
                const selected = groupId === o.id;
                return (
                  <label
                    key={o.id || 'unsure'}
                    className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-2xl border-2 bg-white px-4"
                    style={{ borderColor: selected ? JOURNEY.dusk : JOURNEY.line }}
                  >
                    <input type="radio" name="group" checked={selected} onChange={() => setGroupId(o.id)} className="sr-only" />
                    <span className="min-w-0 flex-1 text-[15px]" style={{ color: JOURNEY.ink }}>
                      <b>{o.title}</b>{o.sub && <span style={{ color: JOURNEY.soft }}> · {o.sub}</span>}
                    </span>
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2"
                      style={selected ? { background: JOURNEY.dusk, borderColor: JOURNEY.dusk } : { borderColor: JOURNEY.line }}
                      aria-hidden="true"
                    >
                      {selected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3.5} />}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
        {footer}
      </JourneyScreen>
    </form>
  );
}

/** On the waiting screen, once an address is on file: where the news will go, and the way to fix it. */
export function ApprovalEmailSent({ email, justSaved, onFix }: { email: string; justSaved: boolean; onFix: () => void }) {
  const t = useTranslations('pendingEmail');
  return (
    <div className="rounded-[20px] bg-white p-4 text-start" style={{ boxShadow: 'inset 0 0 0 1.5px #0f8a4a' }} dir="rtl" data-testid="approval-email-saved">
      <p className="text-[15px] font-bold" style={{ color: JOURNEY.ink }}>✉️ {justSaved ? t('sentTitleNow') : t('sentTitle')}</p>
      <p className="mt-0.5 text-[13.5px] leading-snug" style={{ color: JOURNEY.soft }}>
        {t.rich('sentBody', { email: () => <bdi dir="ltr" className="font-bold">{email}</bdi> })}
      </p>
      <p className="mt-2 text-[13px]" style={{ color: JOURNEY.soft }}>
        {t('sentHelp')} ·{' '}
        <button type="button" onClick={onFix} className="font-bold underline underline-offset-2" style={{ color: JOURNEY.dusk }}>{t('fix')}</button>
      </p>
    </div>
  );
}
