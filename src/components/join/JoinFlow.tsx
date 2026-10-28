'use client';

import { nameProblem } from '@/lib/names/latin';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { JOURNEY, JourneyCard, JourneyHero, JourneyScreen, PrimaryButton } from '@/components/onboarding/journey-ui';
import { RegisterReceived } from '@/app/register/RegisterReceived';
import { DISTANCE_KM, DISTANCE_LABEL, clock, equivalent, kmh, packGoal, paceOf, parseTime, recommend, type Distance } from '@/lib/join/pace';
import { HEARD_FROM, HEARD_LABEL, type HeardFrom } from '@/lib/join/intake';

// One sign-up for the club and the academy (mockup ~/.cache/madregot/join-flow-mockup.html,
// Ofer 2026-10-20): the path first; the same details for both; the club then asks the
// marathon — "what matters to us is your marathon; if there is none, the others" — and
// recommends a pack from it, or the academy for anyone slower than the club. The academy
// path hands the details to the academy's own form, so every one of its questions stays.

interface Group { id: string; name: string; index: number; marathonGoal?: string | null }
type Step = 'path' | 'details' | 'marathon' | 'fallback' | 'pack';
import { JOIN_HANDOFF_KEY } from '@/lib/join/flag';
import { typeClock } from '@/lib/time-entry';
import { suggestEmail } from '@/lib/join/email-typo';
const PACK_HEX = ['#16a34a', '#159AFF', '#FF5315'];

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="-ms-2 flex min-h-[44px] items-center gap-0.5 px-2 text-[15px] font-extrabold" style={{ color: JOURNEY.ink }}>
      <ChevronRight className="h-5 w-5" />חזרה
    </button>
  );
}
function Field({ label, value, onChange, type = 'text', placeholder, dir, required }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; dir?: 'ltr'; required?: boolean;
}) {
  return (
    <label className="block rounded-2xl bg-white px-3.5 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <span className="block text-[12px] font-bold" style={{ color: JOURNEY.soft }}>{label}{required ? ' *' : ''}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} type={type} placeholder={placeholder} dir={dir}
        className="mt-0.5 w-full bg-transparent text-base font-semibold text-ink-900 placeholder:font-normal placeholder:text-ink-300 focus:outline-none" />
    </label>
  );
}
function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn('min-h-[44px] rounded-full px-4 text-[14px] font-extrabold shadow-[0_1px_2px_rgba(0,0,0,0.05)]', on ? 'bg-brand-600 text-white' : 'bg-white text-ink-900')}>{children}</button>
  );
}

export function JoinFlow({ initialPath }: { initialPath?: 'club' | 'academy' | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialPath ? 'details' : 'path');
  const [path, setPath] = useState<'club' | 'academy' | null>(initialPath ?? null);
  const [first, setFirst] = useState(''); const [last, setLast] = useState('');
  const [email, setEmail] = useState(''); const [phone, setPhone] = useState('');
  const [heard, setHeard] = useState<HeardFrom | null>(null); const [who, setWho] = useState('');
  const [dist, setDist] = useState<Distance>('marathon');
  const [time, setTime] = useState(''); const [race, setRace] = useState(''); const [year, setYear] = useState('');
  const [noRace, setNoRace] = useState(false);
  // A near-miss domain (gmial.com) asked about once; "the address is right" is remembered.
  const [typoOk, setTypoOk] = useState('');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [interest, setInterest] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ state: 'new' | 'pending' | 'member'; email: string } | null>(null);

  useEffect(() => { fetch('/api/public/groups').then((r) => r.json()).then((d) => setGroups(d.groups || [])).catch(() => {}); }, []);
  const packs = useMemo(() => groups
    .map((g) => ({ ...g, goal: packGoal(g.marathonGoal || g.name) }))
    .filter((g): g is Group & { goal: number } => g.goal != null)
    .sort((a, b) => a.goal - b.goal), [groups]);
  const secs = parseTime(time);
  const marathonEq = secs != null ? (dist === 'marathon' ? secs : equivalent(secs, dist, 'marathon')) : null;
  const rec = marathonEq != null ? recommend(marathonEq, packs) : null;
  const slowest = packs[packs.length - 1];
  const tooSlow = marathonEq != null && packs.length > 0 && !rec;
  // On the pack step the recommendation is chosen for them — and nothing is, when the
  // time says the academy: a pack left over from a faster attempt must not stay picked.
  const recId = rec?.id ?? null;
  useEffect(() => { if (step === 'pack') setGroupId(recId); }, [step, recId]);

  const go = (s: Step) => { setError(null); setStep(s); window.scrollTo(0, 0); };
  const toAcademy = () => {
    try { sessionStorage.setItem(JOIN_HANDOFF_KEY, JSON.stringify({ firstName: first.trim(), lastName: last.trim(), email: email.trim(), phone: phone.trim(), heard, who: who.trim() })); } catch { /* private mode: the form asks again */ }
    router.push('/academy-register?from=join');
  };
  const details = () => {
    if (!first.trim() || !last.trim()) return setError('שם פרטי ושם משפחה');
    // The club's roster is in English letters (lib/names/latin), as on Strava: a Hebrew name
    // here was dropped at the approval link, which then showed an empty form instead of
    // "הכול נכון" (sign-up E2E, 2026-10-27) — and an English one is what Strava sign-in matches.
    if (path === 'club' && nameProblem(`${first} ${last}`) === 'not-latin') return setError('השם באנגלית, כמו ב-Strava — למשל Dana Levi');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('האימייל לא נראה תקין');
    if (suggestEmail(email) && typoOk !== email.trim()) return setError('typo');
    if (phone.replace(/\D/g, '').length < 9) return setError('מספר נייד');
    if (path === 'academy') return toAcademy();
    go('marathon');
  };
  const submit = async () => {
    if (!groupId) return setError('בחרו דבוקה');
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/public/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(), groupId, fullName: `${first.trim()} ${last.trim()}`, phone: phone.trim(), onb: 'v2',
          intake: { bestDistance: secs ? dist : null, bestSeconds: secs, race: race.trim(), year: Number(year) || null, noRace, heardFrom: heard, heardWho: who.trim(), academyInterest: interest },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error === 'invalid-email' ? 'האימייל לא נראה תקין' : 'ההרשמה נכשלה, נסו שוב');
      setDone({ state: data.state === 'member' || data.state === 'pending' ? data.state : 'new', email: email.trim().toLowerCase() });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  if (done) return <RegisterReceived state={done.state} email={done.email} name={first.trim()} />;

  const hero = (title: string, subtitle?: string) => <JourneyHero compact eyebrow="מצטרפים למדרגות" title={title} subtitle={subtitle} />;
  const typoFix = error === 'typo' ? suggestEmail(email) : null;
  const err = typoFix ? (
    <div role="alert" className="rounded-2xl bg-[#FFF4E5] px-3.5 py-3 text-center">
      <p className="text-[14px] font-bold text-ink-900">התכוונת ל־<bdi dir="ltr" className="font-black">{typoFix}</bdi>?</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => { setEmail(typoFix); setError(null); }} className="min-h-[44px] flex-1 rounded-xl bg-brand-600 text-[14px] font-black text-white">כן, לתקן</button>
        <button type="button" onClick={() => { setTypoOk(email.trim()); setError(null); }} className="min-h-[44px] flex-1 rounded-xl bg-white text-[14px] font-black text-ink-900">הכתובת נכונה</button>
      </div>
    </div>
  ) : error && <p role="alert" className="text-center text-sm font-bold text-accent-red">{error}</p>;

  if (step === 'path') return (
    <JourneyScreen testId="join-path" hero={hero('מצטרפים למדרגות 👋', 'מה מתאים לך? אפשר לשנות גם אחר כך')}
      actions={<PrimaryButton disabled={!path} onClick={() => go('details')}>המשך</PrimaryButton>}>
      {([['club', '🏃', 'המועדון', 'אימוני קבוצה בשלישי ושישי בבוקר, דבוקות לפי קצב מרתון, תוכנית שבועית ומאמני המועדון.'],
        ['academy', '🎯', 'האקדמיה', 'תוכנית אישית ומאמן אישי שמלווה אותך — און ליין, או משולב עם מפגשים. מכל רמה, גם מאפס.']] as const).map(([k, e, t, d]) => (
        <button key={k} type="button" onClick={() => setPath(k)} aria-pressed={path === k}
          className={cn('flex gap-3 rounded-[20px] border-2 bg-white p-4 text-start shadow-[0_1px_2px_rgba(0,0,0,0.05)]', path === k ? 'border-brand-600 bg-[#F4F5FF]' : 'border-transparent')}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-page text-2xl">{e}</span>
          <span><b className="block text-[16px] font-black text-ink-900">{t}</b><small className="mt-0.5 block text-[13px] leading-relaxed" style={{ color: JOURNEY.body }}>{d}</small></span>
        </button>
      ))}
      <p className="px-1 text-[13px]" style={{ color: JOURNEY.soft }}>לא בטוח/ה? בחר/י מועדון — אפשר לסמן שמעניין אותך לשמוע גם על האקדמיה, ונחזור אליך.</p>
    </JourneyScreen>
  );

  if (step === 'details') return (
    <JourneyScreen testId="join-details" hero={hero('כמה פרטים', 'כדי שנחזור אליך ונכיר אותך')}
      actions={<>{err}<PrimaryButton onClick={details}>המשך</PrimaryButton></>}>
      <div className="flex items-center justify-between">
        <Back onClick={() => go('path')} />
        <span className="rounded-xl bg-[#EEF0FF] px-3 py-1.5 text-[13px]">המסלול: <b className="font-black">{path === 'academy' ? '🎯 האקדמיה' : '🏃 המועדון'}</b> · <button type="button" onClick={() => go('path')} className="font-black text-brand-600">שינוי</button></span>
      </div>
      <div className="grid grid-cols-2 gap-2"><Field label={path === 'club' ? 'שם פרטי (באנגלית)' : 'שם פרטי'} value={first} onChange={setFirst} dir={path === 'club' ? 'ltr' : undefined} placeholder={path === 'club' ? 'Dana' : undefined} required /><Field label={path === 'club' ? 'שם משפחה (באנגלית)' : 'שם משפחה'} value={last} onChange={setLast} dir={path === 'club' ? 'ltr' : undefined} placeholder={path === 'club' ? 'Levi' : undefined} required /></div>
      <Field label="אימייל" value={email} onChange={setEmail} type="email" dir="ltr" required />
      <Field label="נייד" value={phone} onChange={setPhone} type="tel" dir="ltr" placeholder="050-0000000" required />
      <p className="mt-1 px-1 text-[13px] font-extrabold" style={{ color: JOURNEY.soft }}>איך הגעת אלינו?</p>
      <div className="flex flex-wrap gap-2">{HEARD_FROM.map((h) => <Chip key={h} on={heard === h} onClick={() => setHeard(h)}>{HEARD_LABEL[h]}</Chip>)}</div>
      {(heard === 'club-member' || heard === 'other' || heard === 'race') && (
        <Field label={heard === 'club-member' ? 'מי? (לא חובה)' : heard === 'race' ? 'איזה מרוץ? (לא חובה)' : 'ספרו לנו איך'} value={who} onChange={setWho} />
      )}
    </JourneyScreen>
  );

  if (step === 'marathon') return (
    <JourneyScreen testId="join-marathon" hero={hero('מה הזמן שלך במרתון?', 'הדבוקות שלנו נבנות סביב קצב מרתון — זה המספר שהכי חשוב לנו')}
      actions={<>{err}<PrimaryButton onClick={() => { if (!parseTime(time)) return setError('הזמן במרתון — למשל 2:41:20'); setDist('marathon'); setNoRace(false); go('pack'); }}>המשך</PrimaryButton></>}>
      <Back onClick={() => go('details')} />
      <label className="block rounded-[22px] border-2 border-brand-600 bg-white p-4 text-center">
        <span className="block text-[12.5px] font-extrabold" style={{ color: JOURNEY.soft }}>הזמן הכי טוב במרתון</span>
        <input value={dist === 'marathon' ? time : ''} onChange={(e) => { setDist('marathon'); setTime(typeClock(e.target.value)); }} inputMode="numeric" placeholder="2:41:20" dir="ltr" data-large
          style={{ fontSize: 40, lineHeight: 1.1 }}
          className="mt-1 w-full bg-transparent text-center font-black tracking-tight text-ink-900 placeholder:text-ink-300 focus:outline-none" />
        {dist === 'marathon' && secs && <span className="text-[14px] font-black text-brand-600">= <bdi dir="ltr">{paceOf(secs, DISTANCE_KM.marathon)}</bdi> לק״מ</span>}
      </label>
      <div className="grid grid-cols-2 gap-2"><Field label="איפה" value={race} onChange={setRace} placeholder="מרתון תל אביב" /><Field label="מתי (שנה)" value={year} onChange={setYear} placeholder="2026" dir="ltr" /></div>
      <button type="button" onClick={() => { setDist('half'); setTime(''); go('fallback'); }}
        className="flex flex-wrap items-center rounded-2xl border-[1.5px] border-dashed border-ink-300 bg-white px-4 py-3 text-start">
        <b className="flex-1 text-[14.5px] font-black text-ink-900">עוד לא רצתי מרתון</b><span className="text-lg font-black text-brand-600">‹</span>
        <small className="basis-full text-[12.5px]" style={{ color: JOURNEY.body }}>אז נשאל על חצי מרתון — ואם אין, 10 ק״מ, ואז 5</small>
      </button>
    </JourneyScreen>
  );

  if (step === 'fallback') return (
    <JourneyScreen testId="join-fallback" hero={hero('ומה הזמן הכי טוב שלך?', 'בלי מרתון — לפי הארוך ביותר שרצת, בסדר הזה')}
      actions={<>{err}<PrimaryButton onClick={() => { if (!noRace && !parseTime(time)) return setError('הזמן — למשל 1:18:40'); go('pack'); }}>המשך</PrimaryButton></>}>
      <Back onClick={() => go('marathon')} />
      {(['half', '10k', '5k'] as const).map((d, i) => (
        <div key={d} className={cn('rounded-2xl border-2 bg-white p-3', dist === d && !noRace ? 'border-brand-600 bg-[#F4F5FF]' : 'border-transparent')}>
          <button type="button" onClick={() => { setDist(d); setNoRace(false); setTime(''); }} className="flex w-full items-center gap-3 text-start">
            <i className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EEF0FF] text-[13px] font-black not-italic text-brand-600">{i + 1}</i>
            <span><b className="block text-[15px] font-black text-ink-900">{DISTANCE_LABEL[d]}</b>{i > 0 && <small className="text-[12px]" style={{ color: JOURNEY.soft }}>אם אין {DISTANCE_LABEL[(['half', '10k'] as const)[i - 1]]}</small>}</span>
          </button>
          {dist === d && !noRace && (
            <input value={time} onChange={(e) => setTime(typeClock(e.target.value))} inputMode="numeric" dir="ltr" data-large placeholder={d === 'half' ? '1:18:40' : d === '10k' ? '36:30' : '17:45'} aria-label={`זמן ב${DISTANCE_LABEL[d]}`}
              className="mt-2 h-12 w-full rounded-xl border-[1.5px] border-[#C9CCF5] bg-white px-3 text-center text-xl font-black text-ink-900 focus:outline-none" />
          )}
        </div>
      ))}
      <button type="button" onClick={() => { setNoRace(true); setTime(''); }} aria-pressed={noRace}
        className={cn('rounded-2xl border-2 bg-white p-3 text-start', noRace ? 'border-brand-600 bg-[#F4F5FF]' : 'border-transparent')}>
        <b className="block text-[14.5px] font-black text-ink-900">עוד לא רצתי תחרות</b><small className="text-[12.5px]" style={{ color: JOURNEY.body }}>נציע לך את האקדמיה — שם מתחילים מכל רמה</small>
      </button>
    </JourneyScreen>
  );

  // step === 'pack'
  const academyFirst = noRace || tooSlow;
  return (
    <JourneyScreen testId="join-pack" hero={hero('באיזו דבוקה?', 'הדבוקות של המועדון רצות מהר: המטרה של כל אחת היא זמן במרתון')}
      actions={<>{err}<PrimaryButton disabled={busy} onClick={() => void submit()}>{busy ? 'שולח…' : 'שליחה'}</PrimaryButton></>}>
      <Back onClick={() => go(dist === 'marathon' && !noRace ? 'marathon' : 'fallback')} />
      {/* The address every mail from here goes to, said back once before sending: a typo
          in the name part (grosfeldofr@) is invisible to any checker (2026-10-20). */}
      <p className="rounded-2xl bg-white px-3.5 py-2.5 text-[13.5px]" style={{ color: JOURNEY.body }} data-testid="join-email-echo">
        המייל שלך: <bdi dir="ltr" className="font-black text-ink-900">{email.trim().toLowerCase()}</bdi> · <button type="button" onClick={() => go('details')} className="font-black text-brand-600">שינוי</button>
      </p>
      {marathonEq != null && (
        <p className={cn('rounded-2xl px-3.5 py-2.5 text-[14px]', academyFirst ? 'bg-[#F1EBFF] text-[#3B1F8F]' : 'bg-[#FFF1E8] text-[#7A2E08]')}>
          לפי <b dir="ltr">{clock(secs!)}</b> ב{DISTANCE_LABEL[dist]}{dist !== 'marathon' && <> (מרתון משוער <bdi dir="ltr">{clock(marathonEq)}</bdi>)</>} — {rec ? <><b>{`דבוקה ${rec.index + 1}`}</b> מתאימה לך</> : <b>האקדמיה מתאימה לך יותר</b>}
        </p>
      )}
      {academyFirst && slowest && (<JourneyCard className="!bg-[#F1EBFF]">
          <b className="block text-[14.5px] font-black text-[#3B1F8F]">🎯 איטי/ת מ־<bdi dir="ltr">{paceOf(slowest.goal, DISTANCE_KM.marathon)}</bdi> לק״מ במרתון?</b>
          <small className="mt-0.5 block text-[12.5px] text-[#4B3A7A]">האקדמיה בנויה בשבילך — תוכנית אישית ומאמן, מסאב 3 ועד מתחילים מאפס.</small>
          <button type="button" onClick={toAcademy} className="mt-2 min-h-[40px] rounded-xl bg-[#7C3AED] px-3.5 text-[13.5px] font-black text-white">עבור למסלול האקדמיה ‹</button>
        </JourneyCard>)}
      {packs.map((p) => (
        <button key={p.id} type="button" onClick={() => setGroupId(p.id)} aria-pressed={groupId === p.id}
          className={cn('flex items-center gap-3 rounded-[18px] border-2 bg-white p-3 text-start', groupId === p.id ? 'border-brand-600 bg-[#F4F5FF]' : 'border-transparent')}>
          <i className="h-[54px] w-2.5 shrink-0 rounded-md" style={{ background: PACK_HEX[p.index] ?? '#9A9BA5' }} />
          <span className="min-w-0 flex-1">
            <b className="block text-[15.5px] font-black text-ink-900">דבוקה {p.index + 1}{rec?.id === p.id ? ' · מומלץ' : ''}</b>
            <small className="block text-[12.5px] font-bold text-ink-700">מרתון מתחת ל־<bdi dir="ltr">{clock(p.goal).replace(/:00$/, '')}</bdi></small>
            <small className="block text-[11.5px]" style={{ color: JOURNEY.soft }}>בערך: 10 ק״מ ב־<bdi dir="ltr">{clock(equivalent(p.goal, 'marathon', '10k'))}</bdi> · חצי ב־<bdi dir="ltr">{clock(equivalent(p.goal, 'marathon', 'half')).replace(/:\d\d$/, '')}</bdi></small>
          </span>
          <span className="min-w-[72px] shrink-0 text-center">
            <b className="block text-[26px] font-black leading-none tracking-tight text-ink-900"><bdi dir="ltr">{paceOf(p.goal, DISTANCE_KM.marathon)}</bdi></b>
            <small className="text-[11px] font-extrabold text-ink-500">לק״מ</small>
            <em className="block text-[11px] font-black not-italic text-brand-600">{kmh(p.goal, DISTANCE_KM.marathon)} קמ״ש</em>
          </span>
        </button>
      ))}
      {!academyFirst && slowest && (
        <JourneyCard className="!bg-[#F1EBFF]">
          <b className="block text-[14.5px] font-black text-[#3B1F8F]">🎯 איטי/ת מ־<bdi dir="ltr">{paceOf(slowest.goal, DISTANCE_KM.marathon)}</bdi> לק״מ במרתון?</b>
          <small className="mt-0.5 block text-[12.5px] text-[#4B3A7A]">האקדמיה בנויה בשבילך — תוכנית אישית ומאמן, מסאב 3 ועד מתחילים מאפס.</small>
          <button type="button" onClick={toAcademy} className="mt-2 min-h-[40px] rounded-xl bg-[#7C3AED] px-3.5 text-[13.5px] font-black text-white">עבור למסלול האקדמיה ‹</button>
        </JourneyCard>
      )}
      <button type="button" onClick={() => setInterest((v) => !v)} aria-pressed={interest}
        className="flex min-h-[52px] items-center justify-between rounded-2xl bg-white px-3.5 text-start">
        <b className="text-[14px] font-black text-ink-900">מעניין אותי לשמוע גם על האקדמיה</b>
        <span className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', interest ? 'bg-brand-600' : 'bg-ink-300')}>
          <i className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all', interest ? 'start-0.5' : 'end-0.5')} />
        </span>
      </button>
    </JourneyScreen>
  );
}
