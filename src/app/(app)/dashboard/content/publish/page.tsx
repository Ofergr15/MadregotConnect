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
import { CHEER_REASONS, cheerText, plainText, splitMessage, type AudienceChoice, type AudienceMode, type CheerReason, type CloseChoice } from '@/lib/publish/model';

// ═════════════════════════════════════════════════════════════════════════════
// לפרסם (mockup publish, C1–C3): a message, a cheer, a survey — each a post on the feed with
// likes and comments, the push optional. ?type=message|cheer|survey; the hub links here.
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

/**
 * What the Madregot circle will look like (lib/feed/club-stories.ts): the row at the top
 * of the feed with the circle first, and the message it opens. Drawn with the same
 * shapes as components/feed/CelebrationStories.tsx, as the text is typed.
 */
function CirclePreview({ title, text }: { title: string; text: string }) {
  return (
    <div className="space-y-2">
      <p className={LABEL}>ככה זה ייראה</p>
      <div className="rounded-[22px] bg-card px-3 pb-3 pt-3">
        <p className="mb-2 px-1 text-[12px] font-extrabold text-ink-400">🎉 חוגגים השבוע</p>
        <div className="flex w-[72px] flex-col items-center text-center">
          <span className="relative rounded-full p-[3px]" style={{ background: 'conic-gradient(from 200deg,#1525FF,#5BC0EB,#1525FF)' }}>
            <span className="block rounded-full border-[3px] border-card bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/logo.png" alt="" className="h-[54px] w-[54px] rounded-full object-contain p-1" />
            </span>
            <span className="absolute end-0.5 top-0.5 h-3 w-3 rounded-full border-2 border-card bg-[#FF3B30]" />
          </span>
          <span className="mt-1.5 text-[12px] font-bold text-ink-900">מדרגות</span>
          <span className="text-[10.5px] text-ink-400">הודעה</span>
        </div>
      </div>
      <div className="overflow-hidden rounded-[22px] bg-card px-6 pb-5 pt-3 text-center shadow-[0_-1px_0_#E6E6EC]">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[#D7D7DC]" />
        <span className="mx-auto block h-[72px] w-[72px] rounded-full p-[3px]" style={{ background: 'conic-gradient(from 200deg,#1525FF,#5BC0EB,#1525FF)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="" className="block h-full w-full rounded-full border-[3px] border-card bg-white object-contain p-1" />
        </span>
        <h3 className="mt-3 text-[19px] font-black leading-tight text-ink-900">{title || 'הכותרת (השורה הראשונה)'}</h3>
        <p className="mt-1.5 whitespace-pre-line text-[14.5px] leading-relaxed text-ink-700">{text || 'הטקסט (מהשורה השנייה)'}</p>
        <span className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-2xl bg-brand-600 text-[15px] font-extrabold text-white">סגירה</span>
      </div>
    </div>
  );
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
  /** Surveys go to everyone or one pack (one survey row has one audience). */
  singleGroup?: boolean;
}) {
  const t = useTranslations('publish');
  const modes: Array<[AudienceMode, string]> = singleGroup
    ? [['all', t('audAll')], ['groups', t('audGroup')]]
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

function LockPreview({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[18px] bg-[#F2F2F7] px-3.5 py-2.5">
      <div className="flex items-center gap-2 text-xs font-bold text-ink-400"><span aria-hidden>🏃</span>MADREGOT<span className="ms-auto font-normal">עכשיו</span></div>
      <p dir="auto" className="mt-1 text-[15px] font-bold leading-snug text-ink-900">{title}</p>
      <p dir="auto" className="line-clamp-2 text-[15px] leading-snug text-ink-700">{body}</p>
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
  // cheer
  const { data: sug } = useApi<{ suggestions: Suggestion[] }>(kind === 'cheer' ? '/api/admin/cheers/suggestions' : null);
  const [who, setWho] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState<CheerReason>('race');
  const [detail, setDetail] = useState('');
  const [cheer, setCheer] = useState<string | null>(null);
  const [anyone, setAnyone] = useState(false);
  const autoCheer = who ? cheerText(who.name, who.id, reason, detail) : '';
  // survey
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [closes, setCloses] = useState<CloseChoice>('week');
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
      if (!res.ok) throw new Error();
      setMsg({ ok: true, text: t('published') });
      setTimeout(() => router.push('/dashboard/content'), 900);
    } catch { setMsg({ ok: false, text: t('failed') }); } finally { setBusy(false); }
  };

  const preview = splitMessage(text);
  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
  const canSend = kind === 'message' ? !!text.trim() && (place === 'circle' || ((audience.mode === 'all' || (audience.mode === 'groups' ? audience.groupIds.length > 0 : audience.athleteIds.length > 0)) && (when === 'now' || !!at)))
    : kind === 'cheer' ? !!who && !!(cheer ?? autoCheer).trim()
      : !!question.trim() && cleanOptions.length >= 2 && (sAudience.mode === 'all' || sAudience.groupIds.length === 1);

  const submit = () => {
    if (!canSend || busy) return;
    if (kind === 'message') {
      const toCircle = { title: preview.title, text: preview.body, days, push: circlePush };
      if (place === 'circle') { void send('/api/admin/club-stories', toCircle); return; }
      if (place === 'both') {
        // The circle first, quietly; the feed post (and its push, if on) is the send below.
        void (async () => {
          await fetch('/api/admin/club-stories', { method: 'POST', headers: await bearerHeaders(), body: JSON.stringify({ ...toCircle, push: false }) }).catch(() => null);
          void send('/api/admin/publish/message', { text, imageUrl, audience, push, scheduleAt: push && when === 'later' && at ? new Date(at).toISOString() : null });
        })();
        return;
      }
      void send('/api/admin/publish/message', { text, imageUrl, audience, push, scheduleAt: push && when === 'later' && at ? new Date(at).toISOString() : null });
    } else if (kind === 'cheer') {
      void send('/api/admin/cheers', { athleteId: who!.id, reason, text: cheer ?? autoCheer, push, days: cheerDays });
    } else {
      void send('/api/admin/surveys', {
        question_he: question, options_he: cleanOptions, closes,
        audience_type: sAudience.mode === 'groups' ? 'group' : 'all', audience_id: sAudience.mode === 'groups' ? sAudience.groupIds[0] : null,
        push, feed: true,
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
              <CirclePreview title={preview.title} text={preview.body} />
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
          {place !== 'circle' && push && (
            <>
              <p className={LABEL}>{t('when')}</p>
              <Seg value={when} options={[['now', t('now')], ['later', t('later')]]} onChange={setWhen} />
              {when === 'later' && (
                <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} dir="ltr" className={cn(CARD, 'min-h-[48px] w-full px-4 text-base font-bold')} />
              )}
              {text.trim() && <LockPreview title={preview.title} body={preview.body} />}
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
          <p className={LABEL}>{t('closes')}</p>
          <Seg value={closes} options={[['tomorrow', t('closesTomorrow')], ['week', t('closesWeek')], ['none', t('closesNever')]]} onChange={setCloses} />
          <p className={LABEL}>{t('toWhom')}</p>
          <AudiencePicker singleGroup value={sAudience} onChange={setSAudience} groups={club.groups} people={club.people} />
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
