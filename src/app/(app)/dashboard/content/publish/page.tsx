'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronRight, ImagePlus, Loader2, Plus, Search, X } from 'lucide-react';
import { useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { COACH_ID } from '@/lib/constants';
import { cn, GROUP_HEX } from '@/lib/utils';
import { sortByPaceGroup } from '@/lib/plans/pace-group';
import { Switch } from '@/components/ui';
import { Avatar } from '@/components/day-session/WatchSend';
import { CHEER_REASONS, cheerText, plainText, splitMessage, type AudienceChoice, type AudienceMode, type CheerReason } from '@/lib/publish/model';
import { MIGRATION_161, MIGRATION_TEXT, pinUntil, type PinChoice } from '@/lib/publish/pin';
import { ClubCirclePreview, CheerCirclePreview, draftItem, FeedPreview, LockPreview, PinSetting, PreviewStage, type Place } from '@/components/publish/PublishPreview';
import type { CelebrationType } from '@/lib/feed/celebration';
import { CloseSetting, customInstants, DEFAULT_REMINDERS, ReminderSetting, SurveyTemplates, type CloseKind, type RemindersValue } from '@/components/publish/SurveySettings';
import { closePreset, israelDateTime, israelLocalToIso } from '@/lib/survey-reminders';
import { MIGRATION_164, MIGRATION_164_TEXT } from '@/lib/survey-messages';

// ═════════════════════════════════════════════════════════════════════════════
// לפרסם (mockup publish, C1–C3): a message, a cheer, a survey — each a post on the feed with
// likes and comments, the push optional. ?type=message|cheer|survey; the hub links here.
// Since 10-20 (mockup publish-preview-v2) every kind opens with "איך זה ייראה" — the
// feed's own card / circle / notification fed the draft — and shares one set of
// settings: where it shows, pinned to the top and for how long, the notification;
// a survey also takes more than one answer. Pin and multi need migration 161.
// ═════════════════════════════════════════════════════════════════════════════

type Kind = 'message' | 'cheer' | 'survey';
interface Athlete { id: string; name: string; group_id?: string; status: string }
interface Group { id: string; name: string; marathonGoal?: string }
interface Suggestion { athleteId: string; name: string; reason: 'race' | 'record'; detail: string; line: string; at: string }

const CARD = 'rounded-[18px] bg-card';
const LABEL = 'px-1.5 text-13 font-bold text-ink-400';
const REASON_ICON: Record<CheerReason, string> = { race: '🏁', record: '🏅', milestone: '💯', comeback: '🩹', birthday: '🎂', other: '✨' };

function useClub() {
  const { data: a } = useApi<{ athletes: Athlete[] }>(`/api/athletes?coach_id=${COACH_ID}`);
  const { data: g } = useApi<{ groups: Group[] }>(`/api/groups?coach_id=${COACH_ID}`);
  return useMemo(() => {
    const groups = sortByPaceGroup(g?.groups || []);
    const pack = (gid?: string) => { const i = gid ? groups.findIndex((x) => x.id === gid) : -1; return i < 0 ? 1 : Math.min(i, 2); };
    const people = (a?.athletes || []).filter((x) => x.status === 'active')
      .map((x) => ({ id: x.id, name: x.name, pack: pack(x.group_id) }))
      .sort((p, q) => p.name.localeCompare(q.name));
    return { groups, people, loaded: !!a && !!g };
  }, [a, g]);
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-[11px] bg-[#E3E3E9] p-[2px]" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)}
          className={cn('min-h-[38px] flex-1 rounded-[9px] text-sm font-semibold', value === v ? 'bg-white font-bold text-ink-900 shadow-[0_2px_6px_rgba(0,0,0,0.08)]' : 'text-ink-500')}>
          {l}
        </button>
      ))}
    </div>
  );
}

function PeoplePicker({ people, picked, onToggle, single }: { people: Array<{ id: string; name: string; pack: number }>; picked: string[]; onToggle: (id: string) => void; single?: boolean }) {
  const t = useTranslations('publish');
  const [q, setQ] = useState('');
  const shown = q.trim() ? people.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())) : people;
  return (
    <div className="space-y-2">
      <label className="flex h-11 items-center gap-2 rounded-xl bg-[#E3E3E9] px-3 text-ink-400">
        <Search className="h-4 w-4" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPeople')} className="min-w-0 flex-1 bg-transparent text-base text-ink-900 outline-none placeholder:text-ink-400" />
      </label>
      <div className={cn(CARD, 'max-h-[280px] overflow-y-auto')}>
        {shown.map((p) => {
          const on = picked.includes(p.id);
          return (
            <button key={p.id} type="button" onClick={() => onToggle(p.id)} aria-pressed={on}
              className="flex min-h-[54px] w-full items-center gap-3 border-b border-[#EFEFF4] px-4 text-start last:border-0">
              <Avatar name={p.name} pack={p.pack} size={32} />
              <b className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink-900">{p.name}</b>
              <span className={cn('grid h-6 w-6 place-items-center rounded-full border-2 text-xs font-black text-white', on ? 'border-brand-600 bg-brand-600' : 'border-ink-300', single && 'rounded-full')}>{on ? '✓' : ''}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AudiencePicker({ value, onChange, groups, people, singleGroup }: {
  value: AudienceChoice; onChange: (v: AudienceChoice) => void;
  groups: Group[]; people: Array<{ id: string; name: string; pack: number }>;
  /** Surveys go to everyone, one pack or the academy (one survey row has one audience). */
  singleGroup?: boolean;
}) {
  const t = useTranslations('publish');
  const modes: Array<[AudienceMode, string]> = singleGroup
    ? [['all', t('audAll')], ['groups', t('audGroup')], ['academy', t('audAcademy')]]
    : [['all', t('audAll')], ['groups', t('audGroup')], ['people', t('audPeople')]];
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div className="space-y-2">
      <Seg value={value.mode} options={modes} onChange={(mode) => onChange({ ...value, mode })} />
      {value.mode === 'groups' && (
        <div className="flex flex-wrap gap-2">
          {groups.map((g, i) => {
            const on = value.groupIds.includes(g.id);
            return (
              <button key={g.id} type="button" aria-pressed={on}
                onClick={() => onChange({ ...value, groupIds: singleGroup ? [g.id] : toggle(value.groupIds, g.id) })}
                className={cn('inline-flex min-h-[44px] items-center gap-2 rounded-full border-[1.5px] px-3.5 text-sm font-bold', on ? 'border-brand-600 bg-brand-600/10 text-brand-600' : 'border-[#E5E5EB] bg-white text-ink-500')}>
                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: GROUP_HEX[Math.min(i, 2)] }} />{g.name}
              </button>
            );
          })}
        </div>
      )}
      {value.mode === 'people' && <PeoplePicker people={people} picked={value.athleteIds} onToggle={(id) => onChange({ ...value, athleteIds: toggle(value.athleteIds, id) })} />}
    </div>
  );
}

export default function PublishPage() {
  const t = useTranslations('publish');
  const router = useRouter();
  const club = useClub();
  const [kind, setKind] = useState<Kind>('message');
  const [place, setPlace] = useState<'feed' | 'circle' | 'both'>('feed');
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const k = q.get('type');
    if (k === 'cheer' || k === 'survey' || k === 'message') setKind(k);
    // The hub's "עיגול מדרגות" tile lands on a message already set to the circle.
    if (q.get('place') === 'circle') setPlace('circle');
  }, []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // message
  const [text, setText] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [audience, setAudience] = useState<AudienceChoice>({ mode: 'all', groupIds: [], athleteIds: [] });
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [push, setPush] = useState(true);
  // Where a message shows: a feed post, the Madregot circle (lib/feed/club-stories.ts), or both.
  const [days, setDays] = useState<1 | 2 | 7>(1);
  const [cheerDays, setCheerDays] = useState<1 | 3 | 7>(1);
  const [circlePush, setCirclePush] = useState(false);
  // "נעוץ בראש הפיד" (160): a message's or a survey's post first in the feed until its time.
  const [pin, setPin] = useState(false);
  const [pinChoice, setPinChoice] = useState<PinChoice>('day');
  const [pinDate, setPinDate] = useState('');
  const [sPin, setSPin] = useState(false);
  const [sPinChoice, setSPinChoice] = useState<PinChoice>('close');
  const [multi, setMulti] = useState(false);
  // cheer
  const { data: sug } = useApi<{ suggestions: Suggestion[] }>(kind === 'cheer' ? '/api/admin/cheers/suggestions' : null);
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState<CheerReason>('race');
  const [detail, setDetail] = useState('');
  const [cheer, setCheer] = useState<string | null>(null);
  const [anyone, setAnyone] = useState(false);
  const autoCheer = who ? cheerText(who.name, who.id, reason, detail) : '';
  // The hub's "לאשר" on a suggested cheer (Content v4): ?athlete= lands on it, filled in.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('athlete');
    const s = id ? sug?.suggestions.find((x) => x.athleteId === id) : null;
    if (s && !who) { setWho({ id: s.athleteId, name: s.name }); setReason(s.reason); setDetail(s.detail); }
  }, [sug, who]);
  // survey
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  // When it closes: any date and time; the quick buttons fill them (lib/survey-reminders).
  const [close, setClose] = useState<{ kind: CloseKind; date: string; time: string }>(() => { const k: CloseKind = 'week'; return { kind: k, ...closePreset(k) }; });
  const [reminders, setReminders] = useState<RemindersValue>(DEFAULT_REMINDERS);
  // Names shown is the default; hidden needs migration 164.
  const [namesShown, setNamesShown] = useState(true);
  const [sAudience, setSAudience] = useState<AudienceChoice>({ mode: 'all', groupIds: [], athleteIds: [] });

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData(); form.append('file', file);
      const res = await fetch('/api/admin/notifications/image', { method: 'POST', headers: await bearerHeaders(false), body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'upload');
      setImageUrl(data.url);
    } catch { setMsg({ ok: false, text: t('uploadFailed') }); } finally { setUploading(false); }
  };

  const send = async (url: string, body: unknown) => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify(body) });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        // Pin / more than one answer before 160 is in the database: said plainly, nothing was posted.
        if ((out as { error?: string }).error === MIGRATION_161) { setMsg({ ok: false, text: MIGRATION_TEXT }); return; }
        if ((out as { error?: string }).error === MIGRATION_164) { setMsg({ ok: false, text: MIGRATION_164_TEXT }); return; }
        throw new Error();
      }
      const done = (await res.json().catch(() => ({}))) as { joinedAt?: string | null };
      // One push a day: said, so nobody wonders why their phone stayed quiet.
      setMsg({ ok: true, text: done.joinedAt ? t('publishedJoined', { time: israelDateTime(done.joinedAt).time }) : t('published') });
      setTimeout(() => router.push('/dashboard/content'), 900);
    } catch { setMsg({ ok: false, text: t('failed') }); } finally { setBusy(false); }
  };

  const preview = splitMessage(text);
  const surveyCloses = close.kind === 'none' ? null : israelLocalToIso(close.date, close.time);
  const closeOk = close.kind === 'none' || (!!surveyCloses && Date.parse(surveyCloses) > Date.now() + 5 * 60_000);
  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
  const canSend = kind === 'message' ? !!text.trim() && (place === 'circle' || ((audience.mode === 'all' || (audience.mode === 'groups' ? audience.groupIds.length > 0 : audience.athleteIds.length > 0)) && (when === 'now' || !!at)))
    : kind === 'cheer' ? !!who && !!(cheer ?? autoCheer).trim()
      : !!question.trim() && cleanOptions.length >= 2 && (sAudience.mode !== 'groups' || sAudience.groupIds.length === 1) && closeOk;

  // A scheduled message is posted later, by the cron: its pin would start now, so it has none.
  const canPin = place !== 'circle' && !(push && when === 'later');
  const pinBody = pin && canPin ? { pin: pinChoice, pinDate: pinChoice === 'date' && pinDate ? new Date(pinDate).toISOString() : null } : {};
  const now = new Date();
  const msgPinned = pin && canPin ? pinUntil(pinChoice, now, { date: pinDate ? new Date(pinDate).toISOString() : null }) : null;
  const surveyPinned = sPin ? pinUntil(sPinChoice, now, { date: pinDate ? new Date(pinDate).toISOString() : null, closesAt: surveyCloses }) : null;
  const msgPlaces: Place[] = [
    ...(place !== 'circle' ? ['feed' as const] : []),
    ...(place !== 'feed' ? ['circle' as const] : []),
    ...((place === 'circle' ? circlePush : push) ? ['push' as const] : []),
  ];
  const cheerType: CelebrationType = reason === 'race' ? 'race' : reason === 'birthday' ? 'birthday' : reason === 'other' || reason === 'comeback' ? 'other' : 'achievement';
  const cheerShown = plainText(cheer ?? autoCheer);

  const submit = () => {
    if (!canSend || busy) return;
    if (kind === 'message') {
      const toCircle = { title: preview.title, text: preview.body, days, push: circlePush };
      if (place === 'circle') { void send('/api/admin/club-stories', toCircle); return; }
      if (place === 'both') {
        // The circle first, quietly; the feed post (and its push, if on) is the send below.
        void (async () => {
          await fetch('/api/admin/club-stories', { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify({ ...toCircle, push: false }) }).catch(() => null);
          void send('/api/admin/publish/message', { text, imageUrl, audience, push, scheduleAt: push && when === 'later' && at ? new Date(at).toISOString() : null, ...pinBody });
        })();
        return;
      }
      void send('/api/admin/publish/message', { text, imageUrl, audience, push, scheduleAt: push && when === 'later' && at ? new Date(at).toISOString() : null, ...pinBody });
    } else if (kind === 'cheer') {
      void send('/api/admin/cheers', { athleteId: who!.id, reason, text: cheer ?? autoCheer, push, days: cheerDays });
    } else {
      void send('/api/admin/surveys', {
        question_he: question, options_he: cleanOptions, closesAt: surveyCloses,
        audience_type: sAudience.mode === 'groups' ? 'group' : sAudience.mode === 'academy' ? 'academy' : 'all', audience_id: sAudience.mode === 'groups' ? sAudience.groupIds[0] : null,
        push, feed: true, multi, anonymous: !namesShown,
        reminders: { picked: reminders.picked, custom: customInstants(reminders.custom) },
        ...(sPin ? { pin: sPinChoice, pinDate: sPinChoice === 'date' && pinDate ? new Date(pinDate).toISOString() : null } : {}),
      });
    }
  };

  return (
    <div className="space-y-3 pb-4" dir="rtl">
      <div className="flex items-center gap-2">
        <Link href="/dashboard/content" className="inline-flex min-h-[44px] items-center gap-0.5 text-[15px] font-semibold text-brand-600"><ChevronRight className="h-4 w-4" />{t('back')}</Link>
      </div>
      <h1 className="text-[26px] font-black text-ink-700">{t(`title_${kind}`)}</h1>
      <Seg value={kind} options={[['message', `📣 ${t('typeMessage')}`], ['cheer', `🏅 ${t('typeCheer')}`], ['survey', `📊 ${t('typeSurvey')}`]]} onChange={(k) => { setKind(k); setMsg(null); }} />

      {kind === 'message' && (
        <PreviewStage places={msgPlaces}>
          {(p) => p === 'feed' ? <FeedPreview item={draftItem({ body: text || 'מה שתכתבו יופיע כאן', imageUrl })} pinnedUntil={msgPinned} />
            : p === 'circle' ? <ClubCirclePreview title={preview.title} text={preview.body} />
              : <LockPreview title={preview.title} body={preview.body} />}
        </PreviewStage>
      )}
      {kind === 'cheer' && (
        <PreviewStage places={push ? ['circle', 'push'] : ['circle']}>
          {(p) => p === 'circle' ? <CheerCirclePreview name={who?.name ?? ''} type={cheerType} text={cheerShown} />
            : <LockPreview title={who ? `🏅 מגיע ל־${who.name.split(' ')[0]} ברכה` : '🏅 ברכה'} body={cheerShown.slice(0, 160)} />}
        </PreviewStage>
      )}
      {kind === 'survey' && (
        <PreviewStage places={push ? ['feed', 'push'] : ['feed']}>
          {(p) => p === 'feed'
            ? <FeedPreview item={draftItem({ body: question || 'השאלה', payload: { surveyDraft: { options: options.map((o, i) => o.trim() || `תשובה ${i + 1}`), closesAt: surveyCloses, multi } } })} pinnedUntil={surveyPinned} />
            : <LockPreview title={question || 'השאלה'} body="לחצו לענות על הסקר" />}
        </PreviewStage>
      )}

      {kind === 'message' && (
        <>
          <p className={LABEL}>{t('whatToSay')}</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} dir="auto" placeholder={t('messagePlaceholder')}
            className={cn(CARD, 'w-full resize-none px-4 py-3 text-[16px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-300')} />
          <label className={cn(CARD, 'flex min-h-[52px] cursor-pointer items-center gap-3 px-4')}>
            <ImagePlus className="h-5 w-5 text-brand-600" />
            <span className="flex-1 text-[15px] font-bold text-brand-600">{imageUrl ? t('imageChange') : t('imageAdd')}</span>
            {uploading && <Loader2 className="h-4 w-4 animate-spin text-ink-400" />}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          </label>
          {imageUrl && (
            <div className="relative overflow-hidden rounded-[18px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="" className="max-h-56 w-full object-cover" />
              <button type="button" onClick={() => setImageUrl(null)} aria-label={t('imageRemove')} className="absolute end-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white"><X className="h-4 w-4" /></button>
            </div>
          )}
          <p className={LABEL}>{t('whereShown')}</p>
          <Seg value={place} options={[['feed', t('placeFeed')], ['circle', t('placeCircle')], ['both', t('placeBoth')]]} onChange={setPlace} />
          {place !== 'feed' && (
            <>
              <p className="px-1 text-13 leading-snug text-ink-400">{t('circleSub')}</p>
              <p className={LABEL}>{t('circleDays')}</p>
              <Seg value={String(days) as '1' | '2' | '7'} options={[['1', t('days_1')], ['2', t('days_2')], ['7', t('days_7')]]} onChange={(v) => setDays(Number(v) as 1 | 2 | 7)} />
            </>
          )}
          {place === 'circle' && (
            <div className={cn(CARD, 'overflow-hidden')}>
              <div className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0"><b className="block text-[15px] text-ink-900">{t('circlePush')}</b><small className="block text-13 text-ink-400">{t('circlePushSub')}</small></span>
                <Switch checked={circlePush} onChange={setCirclePush} activeColor="bg-[#1FA55B]" ariaLabel={t('circlePush')} />
              </div>
            </div>
          )}
          {place !== 'circle' && (<>
          <p className={LABEL}>{t('toWhom')}</p>
          <AudiencePicker value={audience} onChange={setAudience} groups={club.groups} people={club.people} />
          <div className={cn(CARD, 'overflow-hidden')}>
            <div className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0"><b className="block text-[15px] text-ink-900">{t('pushLabel')}</b><small className="block text-13 text-ink-400">{t('pushSub')}</small></span>
              <Switch checked={push} onChange={setPush} activeColor="bg-[#1FA55B]" ariaLabel={t('pushLabel')} />
            </div>
          </div>
          </>)}
          {canPin && <PinSetting on={pin} setOn={setPin} choice={pinChoice} setChoice={setPinChoice} date={pinDate} setDate={setPinDate} choices={['evening', 'day', '3d', 'week', 'date']} />}
          {place !== 'circle' && push && (
            <>
              <p className={LABEL}>{t('when')}</p>
              <Seg value={when} options={[['now', t('now')], ['later', t('later')]]} onChange={setWhen} />
              {when === 'later' && (
                <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} dir="ltr" className={cn(CARD, 'min-h-[48px] w-full px-4 text-base font-bold')} />
              )}
            </>
          )}
        </>
      )}

      {kind === 'cheer' && (
        <>
          <p className={LABEL}>{t('toWhom')}</p>
          {!anyone && (
            <div className={cn(CARD, 'overflow-hidden')}>
              {(sug?.suggestions || []).map((s) => {
                const on = who?.id === s.athleteId && reason === s.reason;
                return (
                  <button key={`${s.athleteId}:${s.reason}`} type="button" aria-pressed={on}
                    onClick={() => { setWho({ id: s.athleteId, name: s.name }); setReason(s.reason); setDetail(s.detail); setCheer(null); }}
                    className="flex min-h-[60px] w-full items-center gap-3 border-b border-[#EFEFF4] px-4 text-start last:border-0">
                    <Avatar name={s.name} pack={club.people.find((p) => p.id === s.athleteId)?.pack ?? 1} size={36} />
                    <span className="min-w-0 flex-1"><b className="block truncate text-[15px] text-ink-900">{s.name}</b><small className="block truncate text-13 text-ink-400">{REASON_ICON[s.reason]} {s.line}</small></span>
                    <span className={cn('grid h-6 w-6 place-items-center rounded-full border-2 text-xs font-black text-white', on ? 'border-brand-600 bg-brand-600' : 'border-ink-300')}>{on ? '✓' : ''}</span>
                  </button>
                );
              })}
              {sug && !sug.suggestions.length && <p className="px-4 py-3 text-sm text-ink-400">{t('noSuggestions')}</p>}
              <button type="button" onClick={() => setAnyone(true)} className="flex min-h-[52px] w-full items-center gap-3 px-4 text-[15px] font-bold text-brand-600"><Search className="h-4 w-4" />{t('someoneElse')}</button>
            </div>
          )}
          {anyone && (
            <>
              <PeoplePicker single people={club.people} picked={who ? [who.id] : []} onToggle={(id) => { const p = club.people.find((x) => x.id === id); if (p) { setWho({ id: p.id, name: p.name }); setCheer(null); } }} />
              <button type="button" onClick={() => setAnyone(false)} className="min-h-[44px] px-1 text-sm font-bold text-brand-600">{t('backToSuggestions')}</button>
            </>
          )}
          <p className={LABEL}>{t('why')}</p>
          <div className="grid grid-cols-3 gap-2">
            {CHEER_REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={reason === r} onClick={() => { setReason(r); setCheer(null); }}
                className={cn('min-h-[58px] rounded-2xl border-[1.5px] text-13 font-bold', reason === r ? 'border-brand-600 bg-brand-600/10 text-brand-600' : 'border-transparent bg-white text-ink-700')}>
                <span aria-hidden className="block text-xl">{REASON_ICON[r]}</span>{t(`reason_${r}`)}
              </button>
            ))}
          </div>
          {(reason === 'race' || reason === 'record' || reason === 'milestone' || reason === 'other') && (
            <input value={detail} onChange={(e) => { setDetail(e.target.value); setCheer(null); }} dir="auto" placeholder={t('detailPlaceholder')}
              className={cn(CARD, 'min-h-[48px] w-full px-4 text-[15px] outline-none placeholder:text-ink-300')} />
          )}
          {who && (
            <>
              <p className={LABEL}>{t('cardText')}</p>
              <textarea value={plainText(cheer ?? autoCheer)} onChange={(e) => setCheer(e.target.value.replace(who.name, `@[${who.name}](${who.id})`))} rows={3} dir="auto"
                className={cn(CARD, 'w-full resize-none px-4 py-3 text-[16px] leading-relaxed text-ink-900 outline-none')} />
              {cheer !== null && <button type="button" onClick={() => setCheer(null)} className="min-h-[44px] px-1 text-sm font-bold text-brand-600">{t('autoText')}</button>}
            </>
          )}
          <p className={LABEL}>כמה זמן בעיגולים</p>
          <Seg value={String(cheerDays) as '1' | '3' | '7'} options={[['1', 'היום'], ['3', '3 ימים'], ['7', 'שבוע']]} onChange={(v) => setCheerDays(Number(v) as 1 | 3 | 7)} />
          <p className="px-1 text-12 text-ink-400">ב״חוגגים השבוע״ בראש הפיד. הפוסט בפיד נשאר תמיד.</p>
          <div className={cn(CARD, 'flex min-h-[56px] items-center justify-between gap-3 px-4 py-2')}>
            <span className="min-w-0"><b className="block text-[15px] text-ink-900">{t('pushClub')}</b><small className="block text-13 text-ink-400">{t('pushClubSub')}</small></span>
            <Switch checked={push} onChange={setPush} activeColor="bg-[#1FA55B]" ariaLabel={t('pushClub')} />
          </div>
        </>
      )}

      {kind === 'survey' && (
        <>
          <SurveyTemplates onPick={(tpl) => { setQuestion(tpl.question); setOptions(tpl.options.length >= 2 ? tpl.options : ['', '']); setMulti(!!tpl.multi); }} />
          <p className={LABEL}>{t('question')}</p>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} dir="auto" placeholder={t('questionPlaceholder')} maxLength={200}
            className={cn(CARD, 'min-h-[52px] w-full px-4 text-[16px] font-semibold outline-none placeholder:font-normal placeholder:text-ink-300')} />
          <p className={LABEL}>{t('answers_label')}</p>
          {options.map((o, i) => (
            <div key={i} className={cn(CARD, 'flex min-h-[50px] items-center gap-2 px-4')}>
              <input value={o} onChange={(e) => setOptions((l) => l.map((x, j) => (j === i ? e.target.value : x)))} dir="auto" placeholder={t('optionN', { n: i + 1 })} maxLength={80}
                className="min-w-0 flex-1 bg-transparent text-[15.5px] outline-none placeholder:text-ink-300" />
              {options.length > 2 && <button type="button" aria-label={t('removeOption')} onClick={() => setOptions((l) => l.filter((_, j) => j !== i))} className="grid h-10 w-10 place-items-center text-ink-300"><X className="h-4 w-4" /></button>}
            </div>
          ))}
          {options.length < 6 && (
            <button type="button" onClick={() => setOptions((l) => [...l, ''])} className={cn(CARD, 'flex min-h-[50px] w-full items-center gap-2 px-4 text-[15px] font-bold text-brand-600')}><Plus className="h-4 w-4" />{t('addOption')}</button>
          )}
          <div className={cn(CARD, 'flex min-h-[56px] items-center justify-between gap-3 px-4 py-2')}>
            <span className="min-w-0"><b className="block text-[15px] text-ink-900">אפשר לסמן יותר מתשובה אחת</b><small className="block text-13 text-ink-400">{multi ? 'ריבועים — כל אחד מסמן כמה שרוצה' : 'כל אחד בוחר תשובה אחת'}</small></span>
            <Switch checked={multi} onChange={setMulti} activeColor="bg-[#1FA55B]" ariaLabel="אפשר לסמן יותר מתשובה אחת" />
          </div>
          <CloseSetting kind={close.kind} date={close.date} time={close.time} onChange={setClose} />
          {!closeOk && <p className="px-1.5 text-13 font-bold text-accent-red">{t('closesPast')}</p>}
          <p className={LABEL}>{t('toWhom')}</p>
          <AudiencePicker singleGroup value={sAudience} onChange={setSAudience} groups={club.groups} people={club.people} />
          <ReminderSetting closesAt={closeOk ? surveyCloses : null} value={reminders} onChange={setReminders} />
          <div className={cn(CARD, 'flex min-h-[56px] items-center justify-between gap-3 px-4 py-2')}>
            <span className="min-w-0"><b className="block text-[15px] text-ink-900">{t('namesShown')}</b><small className="block text-13 text-ink-400">{namesShown ? t('namesShownSub') : t('namesHiddenSub')}</small></span>
            <Switch checked={namesShown} onChange={setNamesShown} activeColor="bg-[#1FA55B]" ariaLabel={t('namesShown')} />
          </div>
          <PinSetting on={sPin} setOn={setSPin} choice={sPinChoice} setChoice={setSPinChoice} date={pinDate} setDate={setPinDate} choices={['close', 'day', '3d', 'week', 'date']} />
          <div className={cn(CARD, 'flex min-h-[56px] items-center justify-between gap-3 px-4 py-2')}>
            <span className="min-w-0"><b className="block text-[15px] text-ink-900">{t('pushLabel')}</b><small className="block text-13 text-ink-400">{t('surveyFeedSub')}</small></span>
            <Switch checked={push} onChange={setPush} activeColor="bg-[#1FA55B]" ariaLabel={t('pushLabel')} />
          </div>
        </>
      )}

      {msg && <p role="status" className={cn('rounded-[14px] px-3 py-2.5 text-sm font-bold', msg.ok ? 'bg-accent-600/10 text-accent-900' : 'bg-accent-red/10 text-accent-red')}>{msg.text}</p>}

      {/* Sticky in the page's own scroller, not `fixed`: the tab bar is part of the shell's
          layout, so a fixed bar sat behind it and the button could not be reached (10-19). */}
      <div className="sticky bottom-0 z-20 -mx-1 rounded-t-[20px] border-t border-[#E6E6EC] bg-page/95 px-1 pb-3 pt-3 backdrop-blur">
        <button type="button" disabled={!canSend || busy} onClick={submit}
          className="mx-auto flex h-14 w-full max-w-lg items-center justify-center gap-2 rounded-[17px] bg-brand-600 text-[17px] font-extrabold text-white disabled:opacity-40">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : t(`cta_${kind}`)}
        </button>
      </div>
    </div>
  );
}
