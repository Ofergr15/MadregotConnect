'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Eye, GraduationCap, Pencil, ShieldCheck, Users } from 'lucide-react';
import { apiHeaders, useApi } from '@/lib/api';
import { teammateHref } from '@/lib/athletes/profile-link';
import { cn } from '@/lib/utils';
import { EmptyState, Sheet, SkeletonList, Switch } from '@/components/ui';
import { CLUB_PACKS, ENTRY_STEPS, type ClubNumbers } from '@/lib/club-numbers/compute';

type Data = ClubNumbers & { access: { admin: boolean; managers: string[] } };
import { Columns, Legend, Spark, WeekColumns, WeekLines, dm, monthShort } from './charts';

/**
 * "מדרגות במספרים" — the club's numbers for its admin (mockup ~/.cache/madregot/club-numbers-v3.html,
 * Ofer 2026-10-20). The overview opens on the people: the club's runners first, then the academy.
 * Every row leads to the screen where the thing it counts is handled.
 */

const TABS = [
  ['overview', 'סקירה'], ['core', 'רצי גרעין'], ['growth', 'צמיחה'], ['packs', 'דבוקות'],
  ['academy', 'אקדמיה'], ['insights', 'תובנות'], ['stability', 'יציבות'], ['attention', 'תשומת לב'],
] as const;
type Tab = (typeof TABS)[number][0];

const BLUE = '#1525FF', NAVY = '#0B5285', VIO = '#6D28D9', GREY = '#9A9CA6', PINK = '#C2185B', GREEN = '#15803d';
const PACK_COLOR: Record<string, string> = { 'דבוקה 1': BLUE, 'דבוקה 2': NAVY, 'דבוקה 3': VIO, 'בלי דבוקה': GREY, 'אקדמיה': PINK };
const STEP_LABEL: Record<(typeof ENTRY_STEPS)[number], string> = { inApp: 'נכנס לאפליקציה', watch: 'חיבור שעון', test: 'מבחן 30 דק׳', form: 'טופס התאמה', plan: 'תוכנית ראשונה' };
const WAITING: Record<(typeof ENTRY_STEPS)[number], string> = { inApp: 'ממתין שייכנס לאפליקציה', watch: 'ממתין לחיבור שעון', test: 'ממתין למבחן 30 דק׳', form: 'ממתין לטופס התאמה', plan: 'ממתין לתוכנית ראשונה' };
const STEP_OWNER: Record<(typeof ENTRY_STEPS)[number], string> = { inApp: 'מתאמן', watch: 'מתאמן', test: 'מתאמן', form: 'מתאמן', plan: 'מאמן' };
const FUNNEL_LABEL: Record<string, string> = { contact: 'פנו', form: 'מילאו טופס', intro_call: 'שיחת היכרות', characterization: 'אפיון', test: 'מבחן', first_plan: 'תוכנית ראשונה' };
const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

const n = (v: number) => Math.round(v).toLocaleString('en-US');
const B = ({ children }: { children: React.ReactNode }) => <bdi dir="ltr">{children}</bdi>;
const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`;
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
const profile = (id: string) => teammateHref(id) ?? '/dashboard/people';
const mmss = (v: number | null) => (v == null ? '—' : `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`);

// ── small pieces ────────────────────────────────────────────────────────────────────

function Card({ children, className, href }: { children: React.ReactNode; className?: string; href?: string }) {
  const cls = cn('mx-4 mb-2.5 block rounded-[22px] bg-card p-3.5', href && 'active:opacity-80', className);
  return href ? <Link href={href} className={cls}>{children}</Link> : <section className={cls}>{children}</section>;
}
const Sub = ({ children }: { children: React.ReactNode }) => <div className="px-5 pb-2 pt-4 text-[12.5px] font-extrabold text-ink-400">{children}</div>;
function CardHead({ title, side }: { title: string; side?: React.ReactNode }) {
  return <div className="mb-1.5 flex items-baseline justify-between gap-2"><b className="text-sm font-extrabold text-ink-900">{title}</b>{side && <span className="text-[11.5px] text-ink-400">{side}</span>}</div>;
}
function Insight({ children, tone = 'b' }: { children: React.ReactNode; tone?: 'b' | 'y' }) {
  return <div className={cn('mt-2.5 rounded-[14px] px-3 py-2.5 text-[12.5px] font-medium leading-relaxed', tone === 'b' ? 'bg-[#EEF0FF] text-[#1D2A99]' : 'bg-[#FFF4E5] text-[#7A3E06]')}>{children}</div>;
}
function Tri({ items }: { items: Array<[React.ReactNode, string, string?]> }) {
  return (
    <div className="mt-3 flex border-t border-[#F0F1F4] pt-2.5">
      {items.map(([v, l, tone], i) => (
        <div key={i} className={cn('flex flex-1 flex-col gap-px', i > 0 && 'border-s border-[#F0F1F4] ps-2.5')}>
          <b className={cn('text-[17px] font-black', tone === 'up' && 'text-[#15803d]', tone === 'dn' && 'text-[#B42318]')}>{v}</b>
          <span className="text-[11px] leading-tight text-ink-400">{l}</span>
        </div>
      ))}
    </div>
  );
}
function Kpi({ label, value, note, tone, href }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: 'pink' | 'pinkLine' | 'up'; href?: string }) {
  const body = (
    <>
      <span className={cn('text-[11.5px] font-extrabold', tone === 'pink' || tone === 'pinkLine' ? 'text-[#C2185B]' : 'text-ink-400')}>{label}</span>
      <b className={cn('mt-0.5 text-[32px] font-black leading-[1.1] tracking-tight', tone === 'pink' ? 'text-[#8E1043]' : 'text-ink-900')}>{value}</b>
      {note && <em className="text-[11px] not-italic text-ink-400">{note}</em>}
    </>
  );
  const cls = cn('flex flex-1 flex-col rounded-[20px] p-3', tone === 'pink' ? 'bg-[#FCE9F2]' : 'bg-card', tone === 'pinkLine' && 'shadow-[inset_0_0_0_1.5px_#F3D3E2]');
  return href ? <Link href={href} className={cn(cls, 'active:opacity-80')}>{body}</Link> : <div className={cls}>{body}</div>;
}
function SectionHead({ icon: Icon, title, side, academy }: { icon: typeof Users; title: string; side: string; academy?: boolean }) {
  return (
    <div className={cn('mx-4 mb-2.5 mt-6 flex items-center gap-2.5 border-t border-[#E1E3EA] pt-4', !academy && 'mt-3.5 border-t-0 pt-0')}>
      <span className={cn('grid h-[34px] w-[34px] place-items-center rounded-[11px]', academy ? 'bg-[#FCE9F2] text-[#C2185B]' : 'bg-[#EEF0FF] text-brand-600')}><Icon className="h-[18px] w-[18px]" /></span>
      <h2 className={cn('text-[22px] font-black tracking-tight', academy ? 'text-[#8E1043]' : 'text-ink-900')}>{title}</h2>
      <span className="ms-auto text-xs font-bold text-ink-400">{side}</span>
    </div>
  );
}
const Up = ({ v }: { v: number }) => <span className={v >= 0 ? 'text-[#15803d]' : 'text-[#B42318]'}><B>{pct(v)}</B></span>;

// ── the screen ──────────────────────────────────────────────────────────────────────

export function ClubNumbers() {
  const [tab, setTab] = useState<Tab>('overview');
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && TABS.some(([k]) => k === t)) setTab(t as Tab);
  }, []);
  const { data, error, isLoading, mutate } = useApi<Data>('/api/admin/club-numbers');
  const [who, setWho] = useState(false);
  const go = (t: Tab) => { setTab(t); window.history.replaceState(null, '', `?tab=${t}`); window.scrollTo({ top: 0 }); };

  return (
    <div className="pb-28">
      <div className="flex items-center justify-between px-[18px] pt-2">
        <h1 className="text-[27px] font-black tracking-tight text-ink-900">מדרגות במספרים</h1>
        {data?.access?.admin && (
          <button type="button" onClick={() => setWho(true)} className="flex min-h-[36px] items-center gap-1 rounded-full bg-card px-3 text-[12.5px] font-bold text-brand-600">
            <ShieldCheck className="h-4 w-4" />מי רואה<span className="text-ink-400"> · <B>{data.access.managers.length}</B></span>
          </button>
        )}
      </div>
      <div className="mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => go(k)} className={cn('min-h-[34px] flex-none rounded-full px-3 text-[12.5px] font-bold', tab === k ? 'bg-ink-900 text-white' : 'bg-card text-ink-500')}>{label}</button>
        ))}
      </div>
      {error ? <EmptyState title={(error as { status?: number }).status === 403 ? 'המסך הזה למנהלי המדרגות בלבד' : 'לא הצלחנו לטעון את המספרים'} />
        : isLoading || !data ? <div className="p-4"><SkeletonList count={5} /></div>
          : (
            <>
              {tab === 'overview' && <Overview d={data} go={go} />}
              {tab === 'core' && <Core d={data} onSaved={() => mutate()} />}
              {tab === 'growth' && <Growth d={data} />}
              {tab === 'packs' && <Packs d={data} />}
              {tab === 'academy' && <Academy d={data} />}
              {tab === 'insights' && <Insights d={data} />}
              {tab === 'stability' && <Stability d={data} />}
              {tab === 'attention' && <Attention d={data} />}
              {data.access?.admin && <ManagersSheet open={who} onClose={() => setWho(false)} d={data} onSaved={() => mutate()} />}
            </>
          )}
    </div>
  );
}

// ── overview ────────────────────────────────────────────────────────────────────────

function EntryRow({ count, title, tone, people, action, href }: { count: number; title: string; tone: 'w' | 'r' | 'x' | 'ok'; people: Array<{ id: string; name: string }>; action?: string; href: string }) {
  const tones = { w: ['bg-[#FFF4E5] text-[#B45309]', '#B45309'], r: ['bg-[#EEF0FF] text-brand-600', BLUE], x: ['bg-[#FDECEA] text-[#B42318]', '#B42318'], ok: ['bg-[#E8F6EE] text-[#15803d]', GREEN] } as const;
  return (
    <Link href={href} className="flex items-center gap-2.5 border-b border-[#F3F4F6] py-2.5 last:border-0 active:opacity-70">
      <span className={cn('grid h-[34px] w-[34px] flex-none place-items-center rounded-[11px] text-[15px] font-black', tones[tone][0])}><B>{count}</B></span>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="text-[13.5px] font-extrabold text-ink-900">{title}</b>
        <span className="truncate text-end text-[11.5px] text-ink-400" dir="ltr">{people.length ? people.map((p) => p.name).join(' · ') : '—'}</span>
      </span>
      {people.length > 0 && (
        <span className="flex flex-none">
          {people.slice(0, 3).map((p) => <i key={p.id} className="-ms-[7px] grid h-6 w-6 place-items-center rounded-full border-2 border-white text-[8.5px] font-extrabold not-italic text-white first:ms-0" style={{ background: tones[tone][1] }}>{initials(p.name)}</i>)}
        </span>
      )}
      {action && <span className="flex-none rounded-full bg-[#F2F3F6] px-2.5 py-[5px] text-[11.5px] font-extrabold text-brand-600">{action}</span>}
    </Link>
  );
}

function Overview({ d, go }: { d: Data; go: (t: Tab) => void }) {
  const c = d.overview.club; const a = d.overview.academy;
  const fullWeeks = d.weeks.slice(0, -1);
  return (
    <>
      <SectionHead icon={Users} title="רצי מדרגות" side="3 דבוקות" />
      <div className="mx-4 flex gap-2">
        <Kpi label="חברי מועדון" value={<B>{c.members}</B>} note={<span className="text-[#15803d]"><B>+{c.newThisMonth}</B> בחודש</span>} href="/dashboard/people" />
        <Kpi label="רצו השבוע" value={<B>{c.ranThisWeek}</B>} note={<><B>{`${c.opened7}/${c.accountsActive}`}</B> פתחו את האפליקציה</>} />
      </div>
      <Card className="mt-2.5" href="/dashboard/team-volume">
        <CardHead title="שבוע מול שבוע" side="ק״מ · מאז ההשקה" />
        <WeekColumns weeks={fullWeeks} km={c.weeklyKm.map((w) => w.km)} soFar={c.soFar} lastSame={c.lastSame} projected={c.projected} nowLabel="השבוע" />
        <Legend items={[{ label: 'השבוע עד היום', color: BLUE }, { label: 'צפי לסוף השבוע', color: BLUE, dashed: true }, { label: 'שבוע שעבר באותה נקודה', color: '#16171F', line: true }]} />
        <Tri items={[[<B key="a">{n(c.soFar)}</B>, `השבוע עד היום (${DAYS.slice(0, d.dayIndex + 1).length > 1 ? `א׳–${DAYS[d.dayIndex]}׳` : 'א׳'})`], [<B key="b">{n(c.lastSame)}</B>, `שבוע שעבר עד ${DAYS[d.dayIndex]}׳`], [c.projected != null ? <B key="c">{n(c.projected)}</B> : '—', 'צפי לסוף השבוע']]} />
      </Card>
      <Card>
        <button type="button" onClick={() => go('growth')} className="block w-full text-start">
          <CardHead title="חשבונות באפליקציה" side={<><B>{c.accounts[0]}</B> ← <B>{c.accounts.at(-1)}</B> מאז ההשקה</>} />
          <WeekLines weeks={d.weeks} series={[{ label: 'accounts', color: BLUE, values: c.accounts }]} area />
        </button>
        <Tri items={[[<B key="a">{`${c.opened7}/${c.accountsActive}`}</B>, 'פתחו השבוע'], [<B key="b">+{c.accountsNewMonth}</B>, 'בחודש האחרון'], [<B key="c">{c.invited}</B>, 'הוזמנו ולא נכנסו']]} />
      </Card>
      <Sub>כניסה למועדון</Sub>
      <Card className="px-3.5 py-1.5">
        <EntryRow count={c.entry.pending.length} title="ממתינים לאישור" tone="w" people={c.entry.pending} action="לאשר" href="/dashboard/entry-queue" />
        <EntryRow count={c.entry.ready.length} title="אושרו, עוד לא נכנסו" tone="r" people={c.entry.ready} action="לשלוח שוב" href="/dashboard/registrations" />
        <EntryRow count={c.entry.silent.length} title="נכנסו, בלי ריצה" tone="x" people={c.entry.silent} action="לבדוק" href="/dashboard/people" />
        <EntryRow count={c.entry.active} title="פעילים" tone="ok" people={[]} href="/dashboard/people" />
        {c.entry.duplicates.length > 0 && (
          <Link href="/dashboard/people" className="my-1.5 block rounded-[10px] bg-[#FFF4E5] px-2.5 py-[7px] text-[11.5px] text-[#7A3E06]">
            נרשמו פעמיים: <bdi>{c.entry.duplicates.join(', ')}</bdi> — לאחד לפני שמאשרים
          </Link>
        )}
      </Card>

      <SectionHead icon={GraduationCap} title="אקדמיה" side={`${a.coaches} מאמנים · ${a.bandsTotal} דבוקות`} academy />
      <div className="mx-4 flex gap-2">
        <Kpi label="מתאמנים" value={<B>{a.trainees}</B>} note={<span className="text-[#15803d]"><B>+{a.newThisMonth}</B> בחודש</span>} tone="pink" href="/dashboard/academy?tab=members" />
        <Kpi label="בתהליך כניסה" value={<B>{a.entering}</B>} note={a.entering ? 'עוד לא סיימו להיכנס' : 'כולם בפנים'} tone="pinkLine" />
      </div>
      <Sub>איפה אנחנו עומדים</Sub>
      <Card>
        <div className="flex items-center justify-between"><b className="text-[14.5px] font-extrabold">בתהליך כניסה</b><span className="rounded-full bg-[#FCE9F2] px-2.5 py-[3px] text-[11.5px] font-extrabold text-[#8E1043]"><B>{a.entering}</B> מתוך <B>{a.trainees}</B></span></div>
        {a.traineeRows.map((t) => (
          <Link key={t.id} href={`/dashboard/academy/week?athlete=${t.id}`} className="mt-2.5 block rounded-2xl bg-[#FBF5F8] px-3 py-2.5 active:opacity-80">
            <div className="flex items-baseline gap-1.5"><b className="text-sm">{t.name}</b><span className="text-[11.5px] text-ink-400">{t.pack} · הצטרף <B>{dm(t.joined)}</B></span></div>
            <div className="mt-2 flex gap-[5px]">
              {ENTRY_STEPS.map((s) => (
                <i key={s} title={STEP_LABEL[s]} className={cn('grid h-[22px] flex-1 place-items-center rounded-[7px] text-xs font-black not-italic text-white',
                  t.done[s] ? 'bg-[#C2185B]' : t.next === s ? 'bg-white shadow-[inset_0_0_0_2px_#C2185B]' : 'bg-white shadow-[inset_0_0_0_1.5px_#EAD3DE]')}>{t.done[s] ? '✓' : ''}</i>
              ))}
            </div>
            <div className="mt-[7px] flex justify-between text-[11px] text-ink-400">
              <span className="font-extrabold text-[#8E1043]">{t.next ? WAITING[t.next] : 'מתאמן פעיל'}</span>
              {t.next && <span>אצל: {STEP_OWNER[t.next]} · <B>{t.waitingDays}</B> ימים</span>}
            </div>
          </Link>
        ))}
        <div className="mx-3 mt-1.5 flex gap-[5px]">{ENTRY_STEPS.map((s) => <span key={s} className="flex-1 text-center text-[8.5px] leading-tight text-ink-400">{STEP_LABEL[s]}</span>)}</div>
        {a.entering > 0 && <Insight tone="y">{a.traineeRows.filter((t) => t.next).map((t) => `${t.name} — ${WAITING[t.next!].replace('ממתין ', '')}`).join(' · ')}. הצעדים האלה אצל המתאמנים — שווה תזכורת.</Insight>}
        <Link href="/dashboard/academy?tab=funnel" className="mt-3.5 flex items-center justify-between">
          <b className="text-[14.5px] font-extrabold">מועמדים בדרך</b>
          <span className="rounded-full bg-[#FCE9F2] px-2.5 py-[3px] text-[11.5px] font-extrabold text-[#8E1043]"><B>{a.openCandidates.length}</B></span>
        </Link>
        <p className="mt-1 text-xs text-ink-400">{a.openCandidates.length ? a.openCandidates.map((x) => x.name).join(' · ') : 'אין כרגע פניות פתוחות — מאינסטגרם או מהטופס.'}</p>
      </Card>
    </>
  );
}

// ── core runners ────────────────────────────────────────────────────────────────────

function LoadChip({ load }: { load: { ratio: number | null; state: string } }) {
  if (load.ratio == null) return <span className="rounded-full bg-[#F2F3F6] px-2 py-[3px] text-[11px] font-extrabold">—</span>;
  const p = Math.round((load.ratio - 1) * 100);
  const [cls, word] = load.state === 'spike' ? ['bg-[#FDECEA] text-[#B42318]', 'קפיצה'] : load.state === 'drop' ? ['bg-[#FFF4E5] text-[#B45309]', 'ירידה'] : ['bg-[#E8F6EE] text-[#15803d]', 'עומס רגיל'];
  return <span className={cn('flex-none rounded-full px-2 py-[3px] text-[11px] font-extrabold', cls)}>{word} · <B>{p === 0 ? '0%' : pct(p)}</B></span>;
}

function Core({ d, onSaved }: { d: Data; onSaved: () => void }) {
  const rs = d.core.runners;
  const [edit, setEdit] = useState(false);
  const balanced = rs.filter((r) => r.load.state === 'normal').length;
  const teamRate = rs.length ? Math.round((rs.reduce((s, r) => s + r.teamHit, 0) / rs.reduce((s, r) => s + r.teamOf, 0)) * 100) : 0;
  const long40 = rs.filter((r) => r.long.km >= 40).length;
  const spikes = rs.filter((r) => r.load.state === 'spike');
  return (
    <>
      <div className="flex items-center justify-between px-[18px] pt-3"><h2 className="text-[22px] font-black">רצי גרעין</h2>
        {d.access?.admin && <button type="button" onClick={() => setEdit(true)} className="flex min-h-[36px] items-center gap-1 text-[13px] font-bold text-brand-600"><Pencil className="h-3.5 w-3.5" />עריכה</button>}</div>
      <p className="mx-[18px] mt-1 text-[13.5px] leading-relaxed text-ink-500">מי שרץ 3 פעמים ומעלה בכל אחד מ-8 השבועות האחרונים — <B>{rs.length}</B> רצים. אפשר להוסיף ולהוריד ידנית.</p>
      <div className="mx-4 mt-3 flex gap-2">
        <Kpi label="רצו השבוע" value={<B>{`${rs.filter((r) => r.soFar > 0).length}/${rs.length}`}</B>} />
        <Kpi label="עומס רגיל" value={<B>{balanced}</B>} note={<>מתוך <B>{rs.length}</B></>} />
        <Kpi label="ימי קבוצה" value={<B>{teamRate}%</B>} note="4 שבועות" />
      </div>
      <div className="mx-4 mt-2.5">
        <Insight>{spikes.length ? `${spikes.map((r) => r.name).join(', ')} — בקפיצת עומס. שווה לבדוק.` : 'אף אחד לא בקפיצת עומס.'}{long40 ? ` ${long40} רצו ארוכה של 40+ ק״מ בשבועיים האחרונים.` : ''}</Insight>
      </div>
      <Card className="mt-2.5">
        <b className="text-sm font-extrabold">מה זה &quot;עומס&quot;?</b>
        <p className="mb-1.5 mt-1 text-[12.5px] leading-relaxed text-ink-500">כמה הרץ רץ ב-7 הימים האחרונים, לעומת שבוע רגיל שלו — הממוצע של 4 השבועות האחרונים.</p>
        {([['bg-[#E8F6EE] text-[#15803d]', 'עומס רגיל', 'עד 30% מעל או 20% מתחת לרגיל'], ['bg-[#FDECEA] text-[#B42318]', 'קפיצה', 'יותר מ-30% מעל הרגיל — עלייה מהירה מדי, הסיכון לפציעה עולה. שווה לדבר איתו.'], ['bg-[#FFF4E5] text-[#B45309]', 'ירידה', 'יותר מ-20% מתחת לרגיל — שבוע קל, מחלה, פציעה או חוסר מוטיבציה.']] as const).map(([cls, w, t]) => (
          <div key={w} className="flex items-start gap-2 py-[5px] text-[11.5px] leading-snug text-ink-500"><span className={cn('w-[76px] flex-none rounded-full py-[3px] text-center text-[11px] font-extrabold', cls)}>{w}</span><span>{t}</span></div>
        ))}
      </Card>
      <Sub>השבוע · א׳–ש׳</Sub>
      {rs.map((r) => (
        <Link key={r.id} href={profile(r.id)} className="mx-4 mb-2 block rounded-[20px] bg-card px-3 pb-2.5 pt-3 active:opacity-80">
          <div className="flex items-center gap-[7px]"><b className="text-[14.5px] font-extrabold">{r.name}</b><span className="flex-1 text-[11.5px] text-ink-400">{r.academy ? 'אקדמיה' : r.pack}</span><LoadChip load={r.load} /></div>
          <div className="mt-2.5 flex gap-1">
            {r.days.map((v, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
                <span className={cn('text-[9.5px] font-bold', d.insights.teamDays.includes(i) ? 'text-brand-600' : 'text-ink-400')}>{DAYS[i]}</span>
                <i className={cn('grid h-6 w-full place-items-center rounded-[7px] text-[10.5px] font-extrabold not-italic text-white',
                  v > 0 ? 'bg-brand-600' : i > d.dayIndex ? 'bg-[repeating-linear-gradient(45deg,#F2F3F6_0_4px,#fff_4px_8px)]' : 'bg-[#F2F3F6]',
                  d.insights.teamDays.includes(i) && v === 0 && 'shadow-[inset_0_0_0_1.5px_#1525FF55]')}>{v > 0 ? <B>{Math.round(v)}</B> : ''}</i>
              </div>
            ))}
          </div>
          <div className="mt-[7px] text-[11px] text-ink-500">7 ימים אחרונים: <b className="text-ink-900"><B>{r.last7}</B> ק״מ</b> · שבוע רגיל שלו: <b className="text-ink-900"><B>{r.weekly28}</B> ק״מ</b></div>
          <div className="mt-2 flex items-center gap-2"><div className="h-[7px] flex-1 overflow-hidden rounded-full bg-[#ECEDF1]"><i className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, r.avg4 ? (r.soFar / r.avg4) * 100 : 0)}%` }} /></div>
            <span className="text-[11px] text-ink-500"><B>{r.soFar}</B> ק״מ מתוך <B>{Math.round(r.avg4)}</B> בשבוע רגיל</span></div>
          <div className="mt-1.5 flex items-center gap-2.5 text-[11px] text-ink-400">
            <span>ארוכה: <b className="text-ink-900"><B>{r.long.km}</B></b>{r.long.date && <> · <B>{dm(r.long.date)}</B></>}</span>
            <span>ימי קבוצה: <b className="text-ink-900"><B>{`${r.teamHit}/${r.teamOf}`}</B></b></span>
            <Spark values={r.km12.slice(-8)} className="ms-auto !h-[22px] !w-[70px]" />
          </div>
        </Link>
      ))}
      <CoreSheet open={edit} onClose={() => setEdit(false)} d={d} onSaved={onSaved} />
    </>
  );
}

function CoreSheet({ open, onClose, d, onSaved }: { open: boolean; onClose: () => void; d: Data; onSaved: () => void }) {
  const auto = useMemo(() => new Set(d.stability.runners.filter((r) => d.core.all.find((a) => a.id === r.id)?.inCore).map((r) => r.id)), [d]);
  const [on, setOn] = useState<Set<string>>(auto);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setOn(new Set(d.core.all.filter((a) => a.inCore).map((a) => a.id))); }, [open, d]);
  const save = async () => {
    setBusy(true);
    // The rule's own picks are not stored: only what differs from it.
    const rule = new Set(d.stability.runners.filter((r) => d.core.runners.some((c) => c.id === r.id)).map((r) => r.id));
    const add = [...on].filter((id) => !rule.has(id)); const remove = [...rule].filter((id) => !on.has(id));
    const res = await fetch('/api/admin/club-numbers/core', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify({ add, remove }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) { onSaved(); onClose(); }
  };
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }} title="רצי גרעין">
      <p className="mb-2 text-[13px] text-ink-500">ברירת המחדל: 3+ ריצות בכל אחד מ-8 השבועות האחרונים. כאן מוסיפים ומורידים.</p>
      <div className="max-h-[55vh] overflow-y-auto">
        {d.core.all.map((a) => (
          <div key={a.id} className="flex items-center gap-2 border-b border-[#F3F4F6] py-2.5">
            <span className="flex-1 text-sm font-semibold">{a.name}<span className="ms-1.5 text-xs font-normal text-ink-400">{a.pack}</span></span>
            <Switch size="sm" checked={on.has(a.id)} onChange={(v) => setOn((s) => { const nx = new Set(s); if (v) nx.add(a.id); else nx.delete(a.id); return nx; })} ariaLabel={a.name} />
          </div>
        ))}
      </div>
      <button type="button" disabled={busy} onClick={save} className="mt-4 flex h-[50px] w-full items-center justify-center rounded-[14px] bg-ink-900 text-[15px] font-bold text-white disabled:opacity-60">שמירה</button>
    </Sheet>
  );
}

function ManagersSheet({ open, onClose, d, onSaved }: { open: boolean; onClose: () => void; d: Data; onSaved: () => void }) {
  const [on, setOn] = useState<Set<string>>(new Set(d.access.managers));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setOn(new Set(d.access.managers)); }, [open, d.access.managers]);
  const save = async () => {
    setBusy(true);
    const res = await fetch('/api/admin/club-numbers/managers', { method: 'PUT', headers: await apiHeaders(true), body: JSON.stringify({ ids: [...on] }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) { onSaved(); onClose(); }
  };
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }} title="מנהלי מדרגות">
      <p className="mb-2 text-[13px] leading-relaxed text-ink-500">מי שמסומן כאן רואה את &quot;מדרגות במספרים&quot;, ומקבל למטה טאב &quot;ניהול&quot;. רק המסך הזה — לא עריכה ולא כלי צוות.</p>
      <div className="max-h-[55vh] overflow-y-auto">
        {d.core.all.map((a) => (
          <div key={a.id} className="flex items-center gap-2 border-b border-[#F3F4F6] py-2.5">
            <span className="flex-1 text-sm font-semibold">{a.name}<span className="ms-1.5 text-xs font-normal text-ink-400">{a.pack}</span></span>
            <Switch size="sm" checked={on.has(a.id)} onChange={(v) => setOn((st) => { const nx = new Set(st); if (v) nx.add(a.id); else nx.delete(a.id); return nx; })} ariaLabel={a.name} />
          </div>
        ))}
      </div>
      <button type="button" disabled={busy} onClick={save} className="mt-4 flex h-[50px] w-full items-center justify-center rounded-[14px] bg-ink-900 text-[15px] font-bold text-white disabled:opacity-60">שמירה</button>
    </Sheet>
  );
}

// ── growth ──────────────────────────────────────────────────────────────────────────

function Growth({ d }: { d: Data }) {
  const g = d.growth; const w = d.weeks; const full = w.slice(0, -1);
  const act = g.activeByWeek; const acc = g.accounts;
  const km = g.weeklyKm; const first4 = km.slice(0, 4).reduce((s, v) => s + v, 0) / 4; const last4 = km.slice(-4).reduce((s, v) => s + v, 0) / 4;
  const peak = Math.max(...km);
  const startAc = g.perRunnerAcademy.findIndex((v) => v != null);
  return (
    <>
      <div className="px-[18px] pt-3"><h2 className="text-[22px] font-black">צמיחה</h2></div>
      <p className="mx-[18px] mt-1 text-[13.5px] leading-relaxed text-ink-500">מאז ההשקה ב-<B>{dm(d.launchDate)}</B> — מי הצטרף, ומי באמת רץ. עוד שנה יהיה פה גם &quot;מול אשתקד&quot;.</p>
      <Card className="mt-3">
        <span className="text-[12.5px] font-extrabold text-ink-400">רצים באפליקציה</span>
        <div className="flex flex-wrap items-baseline gap-1.5"><b className="text-[44px] font-black leading-tight tracking-tight"><B>{act.at(-1)}</B></b><span className="font-bold text-ink-500">רצו השבוע</span>
          <em className="w-full text-[12.5px] font-bold not-italic text-[#15803d]"><B>{act[0]}</B> בהשקה · <B>{act[0] ? pct(Math.round(((act.at(-1)! / act[0]) - 1) * 100)) : ''}</B></em></div>
      </Card>
      <Card>
        <CardHead title="חשבונות מול רצים פעילים" side="בכל שבוע" />
        <WeekLines weeks={w} series={[{ label: 'חשבונות', color: BLUE, values: acc }, { label: 'רצו', color: GREEN, values: act }]} height={160} />
        <Legend items={[{ label: 'חשבונות', color: BLUE }, { label: 'רצו באותו שבוע', color: GREEN }]} />
        <Insight><B>{act.at(-1)}</B> מתוך <B>{acc.at(-1)}</B> החשבונות רצו השבוע.</Insight>
      </Card>
      <Sub>ק״מ שבועי</Sub>
      <Card href="/dashboard/team-volume">
        <CardHead title="ק״מ בשבוע · כל המועדון" side={<><B>{n(km[0] ?? 0)}</B> ← <B>{n(km.at(-1) ?? 0)}</B></>} />
        <WeekLines weeks={full} series={[{ label: 'km', color: BLUE, values: km }]} area />
        <Tri items={[[<Up key="a" v={first4 ? Math.round((last4 / first4 - 1) * 100) : 0} />, '4 שב׳ אחרונים מול 4 הראשונים'], [<B key="b">{n(last4)}</B>, 'ממוצע שבועי עכשיו'], [<B key="c">{n(peak)}</B>, `שיא — ${dm(full[km.indexOf(peak)])}`]]} />
      </Card>
      <Sub>גודל הדבוקות</Sub>
      <Card>
        <WeekLines weeks={w} series={CLUB_PACKS.map((p) => ({ label: p, color: PACK_COLOR[p], values: g.packsByWeek[p] }))} endLabels={false} />
        <Legend items={CLUB_PACKS.map((p) => ({ label: p, color: PACK_COLOR[p] }))} />
        {CLUB_PACKS.map((p) => {
          const s = g.packsByWeek[p];
          return (
            <Link key={p} href={p.startsWith('דבוקה') ? `/dashboard/packs/${p.slice(-1)}` : '/dashboard/people'} className="flex items-center gap-2 border-b border-[#F5F6F8] py-2 text-[13px] last:border-0">
              <i className="h-[9px] w-[9px] rounded-[3px]" style={{ background: PACK_COLOR[p] }} /><b className="flex-1">{p}</b>
              <span className="text-xs text-ink-400"><B>{s[0]}</B> ← <B>{s.at(-1)}</B></span><span className="w-11 text-end font-extrabold text-[#15803d]"><B>+{(s.at(-1) ?? 0) - (s[0] ?? 0)}</B></span>
            </Link>
          );
        })}
      </Card>
      <Sub>אקדמיה</Sub>
      <Card><WeekLines weeks={w} series={[{ label: 'trainees', color: PINK, values: g.traineesByWeek }]} height={110} area /></Card>
      <Sub>ק״מ לרץ · מועדון מול אקדמיה</Sub>
      <Card>
        <CardHead title="ק״מ בשבוע לרץ" side="מועדון מול אקדמיה" />
        {startAc >= 0 ? (
          <>
            <WeekLines weeks={full.slice(startAc)} series={[{ label: 'מועדון', color: BLUE, values: g.perRunnerClub.slice(startAc) }, { label: 'אקדמיה', color: PINK, values: g.perRunnerAcademy.slice(startAc) }]} />
            <Legend items={[{ label: 'מועדון (רגיל)', color: BLUE }, { label: 'אקדמיה', color: PINK }]} />
          </>
        ) : <WeekLines weeks={full} series={[{ label: 'מועדון', color: BLUE, values: g.perRunnerClub }]} />}
      </Card>
    </>
  );
}

// ── packs ───────────────────────────────────────────────────────────────────────────

function Packs({ d }: { d: Data }) {
  const p = d.packs; const order = [...CLUB_PACKS, 'אקדמיה'];
  const max = Math.max(1, ...p.months.map((m, i) => order.reduce((s, k) => s + (p.packMonthKm[k]?.[i] ?? 0), 0)));
  const totalKm = p.share.reduce((s, r) => s + r.km, 0); const totalR = p.share.reduce((s, r) => s + r.runners, 0);
  const top = [...p.share].sort((a, b) => b.km - a.km)[0];
  return (
    <>
      <div className="px-[18px] pt-3"><h2 className="text-[22px] font-black">דבוקות</h2></div>
      <Sub>ק״מ בחודש לפי דבוקה · השנה</Sub>
      <Card>
        <div className="flex h-[130px] items-end gap-1.5" dir="ltr">
          {p.months.map((m, i) => (
            <div key={m} className="flex h-full flex-1 flex-col items-center gap-[3px]">
              <div className="flex w-full flex-1 flex-col justify-end gap-px">
                {[...order].reverse().map((k) => <i key={k} className="block w-full rounded-[2px]" style={{ height: `${((p.packMonthKm[k]?.[i] ?? 0) / max) * 100}%`, background: PACK_COLOR[k] }} />)}
              </div>
              <em className="text-[9.5px] not-italic text-ink-400">{monthShort(m)}</em>
            </div>
          ))}
        </div>
        <Legend items={order.map((k) => ({ label: k, color: PACK_COLOR[k] }))} />
      </Card>
      <Sub>מי מושך את המועדון · 4 חודשים</Sub>
      <Card>
        <div className="grid grid-cols-[84px_44px_1fr] pb-1 text-[10.5px] font-extrabold text-ink-400"><span /><span>רצים</span><span>ק״מ</span></div>
        {p.share.map((r) => (
          <Link key={r.pack} href={r.pack.startsWith('דבוקה') ? `/dashboard/packs/${r.pack.slice(-1)}` : '/dashboard/academy'} className="grid grid-cols-[84px_44px_1fr] items-center border-b border-[#F5F6F8] py-1.5 last:border-0">
            <span className="flex items-center gap-[5px] text-xs font-bold"><i className="h-2 w-2 rounded-[3px]" style={{ background: PACK_COLOR[r.pack] }} />{r.pack}</span>
            <b className="text-[13px] font-extrabold text-ink-500"><B>{Math.round((r.runners / totalR) * 100)}%</B></b>
            <span className="flex items-center gap-1.5"><i className="block h-3 rounded" style={{ width: `${(r.km / totalKm) * 160}%`, maxWidth: '80%', background: PACK_COLOR[r.pack] }} /><b className="text-[13px] font-black"><B>{Math.round((r.km / totalKm) * 100)}%</B></b></span>
          </Link>
        ))}
        {top && <Insight>{top.pack} — <B>{Math.round((top.runners / totalR) * 100)}%</B> מהרצים, <B>{Math.round((top.km / totalKm) * 100)}%</B> מהק״מ.</Insight>}
      </Card>
      <Sub>קצב חציוני בריצות 5–25 ק״מ · דקות לק״מ</Sub>
      <Card>
        <PaceChart months={p.months} series={(['דבוקה 1', 'דבוקה 2', 'דבוקה 3'] as const).map((k) => ({ label: k, color: PACK_COLOR[k], values: p.pace[k] }))} />
        <Legend items={(['דבוקה 1', 'דבוקה 2', 'דבוקה 3'] as const).map((k) => ({ label: k, color: PACK_COLOR[k] }))} />
        <Insight tone="y">ככל שהקו גבוה יותר — מהר יותר. הקיץ מאט בדרך כלל את כולם (חום), ומספטמבר הקצב חוזר.</Insight>
      </Card>
      <Sub>חברים בכל דבוקה · מההשקה להיום</Sub>
      <Card>
        {CLUB_PACKS.map((k) => (
          <div key={k} className="flex items-center gap-2 border-b border-[#F5F6F8] py-2 text-[13px] last:border-0">
            <i className="h-[9px] w-[9px] rounded-[3px]" style={{ background: PACK_COLOR[k] }} /><b className="flex-1">{k}</b>
            <span className="font-extrabold"><B>{p.sizeAtLaunch[k]}</B> ← <B>{p.sizeNow[k]}</B></span>
          </div>
        ))}
      </Card>
    </>
  );
}

function PaceChart({ months, series }: { months: number[]; series: Array<{ label: string; color: string; values: Array<number | null> }> }) {
  const W = 300, H = 130; const vals = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  if (!vals.length) return null;
  const lo = Math.min(...vals) - 0.05, hi = Math.max(...vals) + 0.05;
  const x = (i: number) => (i * W) / Math.max(1, months.length - 1); const y = (v: number) => 8 + ((v - lo) / (hi - lo)) * (H - 30);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full overflow-visible" style={{ height: H, direction: 'ltr' }}>
      {[lo, (lo + hi) / 2, hi].map((v) => <g key={v}><line x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="#EEF0F4" /><text x={W} y={y(v) - 2} textAnchor="end" className="fill-ink-400 text-[10px]">{mmss(v)}</text></g>)}
      {series.map((s) => <polyline key={s.label} fill="none" stroke={s.color} strokeWidth={2.4} strokeLinejoin="round" points={s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ')} />)}
      {months.map((m, i) => (i === 0 || i === months.length - 1 || i % 3 === 0) && <text key={m} x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === months.length - 1 ? 'end' : 'middle'} className="fill-ink-400 text-[10px]">{monthShort(m)}</text>)}
    </svg>
  );
}

// ── academy ─────────────────────────────────────────────────────────────────────────

function Academy({ d }: { d: Data }) {
  const a = d.academy; const tw = a.traineesByWeek; const ws = d.weeks;
  const first = Math.max(0, tw.findIndex((v) => v > 0) - 4);
  const show = tw.slice(first); const wks = ws.slice(first);
  const maxF = Math.max(1, ...a.funnel.map((f) => f.count));
  return (
    <>
      <div className="px-[18px] pt-3"><h2 className="text-[22px] font-black text-[#8E1043]">אקדמיה</h2></div>
      <Card className="mt-3">
        <span className="text-[12.5px] font-extrabold text-ink-400">מתאמנים באקדמיה</span>
        <div className="flex flex-wrap items-baseline gap-1.5"><b className="text-[44px] font-black leading-tight"><B>{a.trainees.length}</B></b><span className="font-bold text-ink-500">מתאמנים · <B>{a.coaches}</B> מאמנים</span></div>
        <p className="text-[12.5px] text-ink-400">{a.trainees.map((t) => `${t.name} — ${dm(t.joined)}`).join(' · ')}</p>
      </Card>
      <Sub>מתאמנים · שבוע מול שבוע</Sub>
      <Card>
        <div className="flex items-end gap-1" dir="ltr">
          {show.map((v, i) => {
            const ch = i ? v - show[i - 1] : 0;
            return (
              <div key={wks[i]} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                <span className="text-[10.5px] font-black text-[#8E1043]"><B>{v}</B></span>
                <div className="flex h-[70px] w-full items-end overflow-hidden rounded-md bg-[#F7EEF3]"><i className="block w-full bg-[#C2185B]" style={{ height: `${(v / Math.max(3, ...show)) * 100}%` }} /></div>
                <em className="text-[8.5px] not-italic text-ink-400">{dm(wks[i])}</em>
                <b className="h-3 text-[9.5px] text-[#15803d]">{ch > 0 ? <B>+{ch}</B> : ''}</b>
              </div>
            );
          })}
        </div>
        <Tri items={[[<B key="a">{tw.at(-1)}</B>, 'השבוע'], [<B key="b">{(tw.at(-1) ?? 0) - (tw.at(-2) ?? 0)}</B>, 'מול שבוע שעבר'], [<B key="c">+{(tw.at(-1) ?? 0) - (tw.at(-5) ?? 0)}</B>, 'ב-4 שבועות']]} />
      </Card>
      <Sub>המשפך · מאז שנפתח</Sub>
      <Card href="/dashboard/academy?tab=funnel">
        <div className="flex items-stretch gap-1.5">
          {a.funnel.map((f, i) => (
            <div key={f.stage} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <b className="text-lg font-black text-[#8E1043]"><B>{f.count}</B></b>
              <div className="flex h-[84px] w-full items-end overflow-hidden rounded-[10px] bg-[#F7EEF3]"><i className="block w-full rounded-t-[10px] bg-[#C2185B]" style={{ height: `${Math.max((f.count / maxF) * 100, 4)}%` }} /></div>
              <span className="min-h-[24px] text-center text-[10px] font-bold leading-tight text-ink-500">{FUNNEL_LABEL[f.stage]}</span>
              <em className="h-3 text-[9.5px] not-italic text-ink-400">{i && a.funnel[i - 1].count ? <B>{Math.round((f.count / a.funnel[i - 1].count) * 100)}%</B> : ''}</em>
            </div>
          ))}
        </div>
      </Card>
      <Sub>דבוקות האקדמיה</Sub>
      <Card>
        <div className="flex gap-1.5">
          {a.bands.map((b) => (
            <div key={b.band} className={cn('flex flex-1 flex-col items-center rounded-xl py-2', b.trainees ? 'bg-[#FCE9F2]' : 'bg-[#F4F5F8]')}>
              <b className="text-[11px] text-ink-400">{b.band}</b><span className={cn('text-lg font-black', b.trainees ? 'text-[#C2185B]' : 'text-[#C9CCD6]')}><B>{b.trainees}</B></span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-400"><B>{a.bands.filter((b) => !b.trainees).length}</B> דבוקות עוד ריקות — מקום לגדול בלי לפתוח מאמנים חדשים.</p>
      </Card>
      <Sub>נפח המתאמנים · ק״מ בחודש</Sub>
      <Card><Columns values={a.monthKm} labels={d.packs.months.map(monthShort)} hi={a.monthKm.map((_, i) => i).slice(-2)} color={PINK} soft="#F3D3E2" showValues={[a.monthKm.indexOf(Math.max(...a.monthKm))]} /></Card>
    </>
  );
}

// ── insights ────────────────────────────────────────────────────────────────────────

function Insights({ d }: { d: Data }) {
  const s = d.insights;
  const hv = s.hours.slice(3, 22); const peakH = s.hours.indexOf(Math.max(...s.hours));
  const morning = s.runs ? Math.round((s.hours.slice(4, 8).reduce((a, b) => a + b, 0) / s.runs) * 100) : 0;
  const team = s.teamDays.reduce((a, k) => a + s.dow[k], 0) / s.teamDays.length;
  const other = s.dow.filter((_, i) => !s.teamDays.includes(i)); const otherAvg = other.reduce((a, b) => a + b, 0) / (other.length || 1);
  const bucket = s.dist.indexOf(Math.max(...s.dist)); const dl = ['0–5', '5–10', '10–15', '15–20', '20–25', '25–30', '30–35', '35+'];
  const longTotal = s.longRuns.reduce((a, b) => a + b, 0); const longPeak = s.longRuns.indexOf(Math.max(...s.longRuns));
  const tPeak = Math.max(...s.treadmill);
  const ages = s.ages; const ab = [ages.filter((a) => a < 30).length, ages.filter((a) => a >= 30 && a < 35).length, ages.filter((a) => a >= 35 && a < 40).length, ages.filter((a) => a >= 40).length];
  return (
    <>
      <div className="px-[18px] pt-3"><h2 className="text-[22px] font-black">תובנות</h2></div>
      <p className="mx-[18px] mt-1 text-[13.5px] text-ink-500">מה הנתונים של השנה אומרים על המועדון — מתעדכן לבד.</p>
      <Sub>מתי רצים</Sub>
      <Card>
        <Columns values={hv} labels={hv.map((_, i) => ([4, 6, 8, 12, 18, 21].includes(i + 3) ? String(i + 3) : ''))} hi={[peakH - 3]} />
        <Insight><B>{morning}%</B> מהריצות יוצאות בין 4:00 ל-8:00. השעה העמוסה: <B>{peakH}:00</B>.</Insight>
      </Card>
      <Card>
        <Columns values={s.dow} labels={DAYS} hi={s.teamDays} showValues={s.teamDays} height={96} />
        <Insight>ימי הקבוצה עמוסים ב-<B>{pct(Math.round((team / otherAvg - 1) * 100))}</B> מיום רגיל.</Insight>
      </Card>
      <Sub>איך רצים</Sub>
      <Card>
        <Columns values={s.dist} labels={dl} hi={[bucket]} showValues={[bucket]} height={100} />
        <Insight>הריצה הנפוצה: <B>{dl[bucket]}</B> ק״מ. <B>{n(longTotal)}</B> ריצות של 20+ ק״מ השנה — {monthShort(s.months[longPeak])} שיא עם <B>{s.longRuns[longPeak]}</B>.</Insight>
      </Card>
      <Card className="flex gap-2.5">
        <div className="flex-1 rounded-[14px] bg-[#F4F5F8] p-2.5"><b className="block text-xl font-black"><B>{tPeak}%</B></b><span className="text-[11px] leading-snug text-ink-500">ריצות הליכון בחודש הכי חם, מול <B>{s.treadmill[0]}%</B> בינואר</span></div>
        <div className="flex-1 rounded-[14px] bg-[#F4F5F8] p-2.5"><b className="block text-xl font-black"><B>{s.longRuns[longPeak]}</B></b><span className="text-[11px] leading-snug text-ink-500">ריצות ארוכות (20+) ב{monthShort(s.months[longPeak])} — הכי הרבה השנה</span></div>
      </Card>
      <Sub>מי רץ</Sub>
      <Card>
        <Columns values={ab} labels={['20–29', '30–34', '35–39', '40+']} hi={[ab.indexOf(Math.max(...ab))]} showValues={[0, 1, 2, 3]} height={90} format={(v) => String(v)} />
        {ages.length > 0 && <Insight tone="y">גיל חציוני <B>{ages[ages.length >> 1]}</B>, מ-<B>{ages[0]}</B> עד <B>{ages.at(-1)}</B>. {s.gender.female === 1 ? 'רצה אחת' : <><B>{s.gender.female}</B> רצות</>} מתוך <B>{s.gender.known}</B> — הקהל הכי פתוח לגדול.</Insight>}
      </Card>
    </>
  );
}

// ── stability ───────────────────────────────────────────────────────────────────────

function Stability({ d }: { d: Data }) {
  const s = d.stability;
  const ranked = [...s.runners].sort((a, b) => b.counts12.filter((c) => c >= 3).length - a.counts12.filter((c) => c >= 3).length || b.runs8 - a.runs8);
  const row = (r: (typeof ranked)[number]) => (
    <Link key={r.id} href={profile(r.id)} className="flex items-center gap-2 border-b border-[#F5F6F8] py-[7px]">
      <span className="w-[108px] flex-none truncate text-[12.5px] font-bold">{r.name}</span>
      <div className="flex flex-1 gap-[3px]" dir="ltr">{r.counts12.map((c, i) => <i key={i} className={cn('block h-3 flex-1 rounded', c >= 3 ? 'bg-[#15803d]' : c > 0 ? 'bg-[#9FD9B4]' : 'bg-[#ECEDF1]')} />)}</div>
      <b className="w-6 text-end text-[13px] font-black"><B>{r.runs8}</B></b>
    </Link>
  );
  const steady = [...s.runners].filter((r) => r.cv != null).sort((a, b) => (a.cv ?? 9) - (b.cv ?? 9)).slice(0, 3);
  return (
    <>
      <div className="px-[18px] pt-3"><h2 className="text-[22px] font-black">יציבות</h2></div>
      <Card className="mt-3">
        <span className="text-[12.5px] font-extrabold text-ink-400">רצו כל שבוע מאז ינואר</span>
        <div className="flex flex-wrap items-baseline gap-1.5"><b className="text-[44px] font-black leading-tight"><B>{s.everyWeekSinceJan}</B></b><span className="font-bold text-ink-500">מתוך <B>{s.members}</B></span><em className="w-full text-[12.5px] not-italic text-ink-400"><B>{s.weeksSinceJan}</B> שבועות ברצף, בלי שבוע אחד ריק</em></div>
        <Tri items={[[<B key="a">{s.threePlusAll8}</B>, '3+ ריצות כל שבוע, 8 שבועות'], [<B key="b">{s.runsPerWeek}</B>, 'ריצות לרץ בשבוע'], [<B key="c">{s.ran7of8}</B>, 'רצו 7–8 מתוך 8 השבועות']]} />
      </Card>
      <Sub>המתמידים · 12 שבועות</Sub>
      <Card>
        <div className="flex justify-between border-b border-[#F0F1F4] pb-1.5 text-[10.5px] font-bold text-ink-400"><span>כל משבצת — שבוע, הישן משמאל</span><span>ריצות ב-8 שב׳</span></div>
        {ranked.slice(0, 6).map(row)}
        {ranked.length > 9 && <div className="py-2 text-center text-[11.5px] text-ink-400">עוד <B>{ranked.length - 9}</B> רצים</div>}
        {ranked.length > 6 && <><div className="pt-1 text-[10.5px] font-bold text-ink-400">פחות יציבים</div>{ranked.slice(-3).map(row)}</>}
        <div className="mt-2 flex gap-3 text-[10.5px] text-ink-400">{([['bg-[#15803d]', '3+ ריצות'], ['bg-[#9FD9B4]', '1–2'], ['bg-[#ECEDF1]', 'לא רץ']] as const).map(([c, l]) => <span key={l} className="flex items-center gap-1"><i className={cn('block h-3 w-3 rounded', c)} />{l}</span>)}</div>
      </Card>
      <Sub>הכי יציבים בנפח</Sub>
      <Card>
        {steady.map((r, i) => (
          <Link key={r.id} href={profile(r.id)} className="flex items-center gap-2.5 border-b border-[#F5F6F8] py-[7px] last:border-0">
            <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-[#FFF4E5] text-[13px] font-black text-[#B45309]">{i + 1}</span>
            <span className="flex min-w-0 flex-1 flex-col"><b className="text-sm font-bold">{r.name}</b><span className="text-[11.5px] text-ink-400">{r.pack} · <B>{Math.round(r.avg12)}</B> ק״מ בשבוע, כמעט בלי תנודה</span></span>
          </Link>
        ))}
      </Card>
    </>
  );
}

// ── attention ───────────────────────────────────────────────────────────────────────

function Attention({ d }: { d: Data }) {
  const a = d.attention;
  return (
    <>
      <div className="px-[18px] pt-3"><h2 className="text-[22px] font-black">דורש תשומת לב</h2></div>
      <p className="mx-[18px] mt-1 text-[13.5px] leading-relaxed text-ink-500">מי שהנפח שלו ירד, מי שלא פותח את האפליקציה, ומי שעוד לא התחיל. נגיעה בשם — הפרופיל שלו.</p>
      <Sub>ירידה בנפח · שבועיים מול 6 שבועות</Sub>
      <Card>
        {a.dropping.length ? a.dropping.map((r) => (
          <Link key={r.id} href={profile(r.id)} className="flex items-center gap-2.5 border-b border-[#F5F6F8] py-2.5 last:border-0">
            <span className="flex min-w-0 flex-1 flex-col"><b className="text-sm font-bold">{r.name}</b><span className="text-[11.5px] text-ink-400">{r.pack} · <B>{r.from}</B> ← <B>{r.to}</B> ק״מ בשבוע</span></span>
            <span className="rounded-full bg-[#FDECEA] px-2.5 py-1 text-[11.5px] font-extrabold text-[#B42318]"><B>{pct(r.change ?? 0)}</B></span>
          </Link>
        )) : <p className="py-2 text-[13px] text-ink-400">אין ירידות חדות.</p>}
      </Card>
      <Sub>לא פתחו את האפליקציה חודש</Sub>
      <Card>
        {a.notOpening.length ? a.notOpening.map((r) => (
          <Link key={r.id} href={profile(r.id)} className="flex items-center gap-2.5 border-b border-[#F5F6F8] py-2.5 last:border-0">
            <span className="flex min-w-0 flex-1 flex-col"><b className="text-sm font-bold">{r.name}</b><span className="text-[11.5px] text-ink-400">{r.pack} · לא נכנס מאז <B>{dm(r.lastSeen)}</B></span></span>
            <Eye className="h-4 w-4 text-[#B45309]" />
          </Link>
        )) : <p className="py-2 text-[13px] text-ink-400">כולם נכנסו בחודש האחרון.</p>}
      </Card>
      <Sub>עוד לא התחילו</Sub>
      <Card>
        {a.notStarted.map((r) => (
          <Link key={r.id} href="/dashboard/people" className="flex items-center gap-2.5 border-b border-[#F5F6F8] py-2.5 last:border-0">
            <span className="flex-1"><b className="text-sm font-bold">{r.name}</b><span className="block text-[11.5px] text-ink-400">אף ריצה לא סונכרנה</span></span>
            <span className="rounded-full bg-[#F2F3F6] px-2.5 py-1 text-[11.5px] font-extrabold">לחבר שעון</span>
          </Link>
        ))}
        <Link href="/dashboard/registrations" className="flex items-center gap-2.5 py-2.5">
          <span className="flex-1"><b className="text-sm font-bold"><B>{a.invited}</B> הוזמנו</b><span className="block text-[11.5px] text-ink-400">קיבלו הזמנה ולא נכנסו</span></span>
          <span className="rounded-full bg-[#F2F3F6] px-2.5 py-1 text-[11.5px] font-extrabold">לשלוח שוב</span>
        </Link>
      </Card>
    </>
  );
}

