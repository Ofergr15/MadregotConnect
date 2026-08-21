'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bell, Send, Trash2, Loader2, Clock, Repeat, CheckCircle, CheckCircle2, Users, User, Megaphone, Trophy, CalendarDays, GraduationCap, Activity, Plus } from 'lucide-react';
import { cn, getPlanWeekStart } from '@/lib/utils';
import { Sheet, Button, SegmentedControl, SkeletonList, EmptyState } from '@/components/ui';
import { InsetRow } from '@/components/ui/InsetList';

interface Group { id: string; name: string; }
interface Athlete { id: string; name: string; email: string; }

// Preset categories that pre-fill the compose form so the admin doesn't type
// everything each time. he+en so each athlete gets their language.
const TEMPLATES = [
  { key: 'workout', icon: Activity, label: 'אימון', titleHe: 'תזכורת אימון 🏃', bodyHe: 'אימון היום — נתראה!', titleEn: 'Workout reminder 🏃', bodyEn: "Today's workout — see you there!" },
  { key: 'race', icon: Trophy, label: 'מרוץ', titleHe: 'מרוץ מתקרב 🏆', bodyHe: '', titleEn: 'Upcoming race 🏆', bodyEn: '' },
  { key: 'event', icon: CalendarDays, label: 'אירוע', titleHe: 'אירוע חדש 📅', bodyHe: '', titleEn: 'New event 📅', bodyEn: '' },
  { key: 'announce', icon: Megaphone, label: 'הודעה', titleHe: 'הודעה מהצוות 📣', bodyHe: '', titleEn: 'Team announcement 📣', bodyEn: '' },
  { key: 'academy', icon: GraduationCap, label: 'אקדמיה', titleHe: 'אקדמיה 🎓', bodyHe: '', titleEn: 'Academy 🎓', bodyEn: '' },
];

interface UpcomingWorkout { dayOfWeek: number; dayName: string; name: string; type: string; }
interface NotificationRow {
  id: string;
  title_he: string; body_he: string;
  title_en: string | null; body_en: string | null;
  audience_type: string; audience_id: string | null;
  schedule_type: string; scheduled_at: string | null;
  recur_interval: number | null; recur_unit: string | null;
  next_run_at: string | null; status: string;
  last_sent_at: string | null; sent_count: number; created_at: string;
}

export function NotificationCenter() {
  const [actorEmail, setActorEmail] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [list, setList] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // compose sheet
  const [composeOpen, setComposeOpen] = useState(false);
  const [athletePickerOpen, setAthletePickerOpen] = useState(false);
  const [athleteSearch, setAthleteSearch] = useState('');

  // compose form
  const [titleHe, setTitleHe] = useState('');
  const [bodyHe, setBodyHe] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [audienceType, setAudienceType] = useState<'all' | 'group' | 'athlete'>('all');
  const [audienceId, setAudienceId] = useState('');
  const [scheduleType, setScheduleType] = useState<'now' | 'once_at' | 'recurring'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [recurInterval, setRecurInterval] = useState(1);
  const [recurUnit, setRecurUnit] = useState<'day' | 'week'>('week');
  const [upcoming, setUpcoming] = useState<UpcomingWorkout[]>([]);

  const applyTemplate = (tpl: typeof TEMPLATES[number]) => {
    setTitleHe(tpl.titleHe); setBodyHe(tpl.bodyHe);
    setTitleEn(tpl.titleEn); setBodyEn(tpl.bodyEn);
    setMsg(null);
  };

  // Pre-fill a reminder for a specific upcoming workout, scheduled to that day.
  const remindWorkout = (w: UpcomingWorkout) => {
    setTitleHe('תזכורת אימון 🏃');
    setBodyHe(`${w.dayName}: ${w.name}`);
    setTitleEn('Workout reminder 🏃');
    setBodyEn(w.name);
    setAudienceType('all');
    setAudienceId('');
    // Auto-target that weekday: compute its date within the current plan week.
    const weekStart = new Date(getPlanWeekStart(new Date()));
    weekStart.setDate(weekStart.getDate() + w.dayOfWeek);
    weekStart.setHours(7, 0, 0, 0); // default morning reminder
    if (weekStart.getTime() > Date.now()) {
      setScheduleType('once_at');
      // datetime-local wants local YYYY-MM-DDTHH:mm
      const pad = (n: number) => String(n).padStart(2, '0');
      setScheduledAt(`${weekStart.getFullYear()}-${pad(weekStart.getMonth() + 1)}-${pad(weekStart.getDate())}T07:00`);
    } else {
      setScheduleType('now');
    }
    setMsg('מוכן לשליחה — בדקו ושלחו ↓');
  };

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications');
      const data = await res.json();
      setList(data.notifications || []);
    } catch { /* noop */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    setActorEmail(localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '');
    fetch('/api/groups').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.groups) setGroups(d.groups.map((g: any) => ({ id: g.id, name: g.name })));
    }).catch(() => {});
    fetch('/api/admin/users').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.users) setAthletes(d.users.map((u: any) => ({ id: u.id, name: u.name, email: u.email })));
    }).catch(() => {});
    // This week's upcoming workouts (from the plan) for one-tap reminders.
    const DN = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
    const todayDow = new Date().getDay();
    fetch('/api/dashboard/weekly').then(r => r.ok ? r.json() : null).then(d => {
      const days = (d?.dailyDistances || []).filter((x: any) => x.dayOfWeek >= todayDow && x.max > 0);
      setUpcoming(days.map((x: any) => ({
        dayOfWeek: x.dayOfWeek,
        dayName: `יום ${DN[x.dayOfWeek]}`,
        name: x.sessions?.[0]?.name || x.type || 'אימון',
        type: x.type || '',
      })));
    }).catch(() => {});
    loadList();
  }, [loadList]);

  const reset = () => {
    setTitleHe(''); setBodyHe(''); setTitleEn(''); setBodyEn('');
    setAudienceType('all'); setAudienceId('');
    setScheduleType('now'); setScheduledAt(''); setRecurInterval(1); setRecurUnit('week');
    setMsg(null);
  };

  const submit = async () => {
    if (!titleHe.trim() || !bodyHe.trim()) { setMsg('כותרת ותוכן בעברית נדרשים'); return; }
    if (audienceType !== 'all' && !audienceId) { setMsg('בחרו קהל יעד'); return; }
    if ((scheduleType === 'once_at' || scheduleType === 'recurring') && !scheduledAt) {
      setMsg('בחרו תאריך ושעה'); return;
    }
    setSending(true); setMsg(null);
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorEmail,
          title_he: titleHe, body_he: bodyHe,
          title_en: titleEn || null, body_en: bodyEn || null,
          audience_type: audienceType,
          audience_id: audienceType === 'all' ? null : audienceId,
          schedule_type: scheduleType,
          scheduled_at: scheduleType === 'now' ? null : new Date(scheduledAt).toISOString(),
          recur_interval: scheduleType === 'recurring' ? recurInterval : null,
          recur_unit: scheduleType === 'recurring' ? recurUnit : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      reset();
      setComposeOpen(false);
      loadList();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSending(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/notifications?id=${id}&actorEmail=${encodeURIComponent(actorEmail)}`, { method: 'DELETE' });
    loadList();
  };
  const cancel = async (id: string) => {
    await fetch('/api/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, actorEmail, status: 'cancelled' }),
    });
    loadList();
  };

  const inputCls = 'w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2.5 text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-600';

  const selectedAthleteName = athletes.find(a => a.id === audienceId)?.name;
  const filteredAthletes = athletes.filter(a => !athleteSearch.trim() || a.name.toLowerCase().includes(athleteSearch.trim().toLowerCase()));

  return (
    <div>
      {/* Landing — the notification list, with a "+" to drill into compose.
          Replaces the permanent desktop-style split-pane compose+list console:
          on mobile that collapsed into one giant stacked form with no
          navigation hierarchy or title bar. */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-white">התראות</h3>
        <Button size="sm" onClick={() => { reset(); setComposeOpen(true); }}>
          <Plus className="w-4 h-4" />
          שליחת התראה
        </Button>
      </div>

      {loading ? (
        <SkeletonList count={4} />
      ) : list.length === 0 ? (
        <EmptyState icon={Bell} title="אין התראות עדיין" />
      ) : (
        <div className="space-y-2">
          {list.map(n => (
            <div key={n.id} className="bg-slate-900/40 rounded-xl border border-slate-700/30 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate" dir="auto">{n.title_he}</p>
                  <p className="text-xs text-slate-400 truncate" dir="auto">{n.body_he}</p>
                  <div className="flex items-center gap-2 mt-1.5 text-3xs text-slate-500">
                    {n.status === 'sent' ? <CheckCircle className="w-3 h-3 text-green-400" />
                      : n.schedule_type === 'recurring' ? <Repeat className="w-3 h-3 text-primary-600" />
                      : <Clock className="w-3 h-3 text-amber-400" />}
                    <span>
                      {n.status === 'sent' ? `נשלח (${n.sent_count})`
                        : n.status === 'cancelled' ? 'בוטל'
                        : n.schedule_type === 'recurring' ? `כל ${n.recur_interval} ${n.recur_unit === 'week' ? 'שבועות' : 'ימים'}`
                        : n.next_run_at ? new Date(n.next_run_at).toLocaleString('he-IL') : 'מתוזמן'}
                    </span>
                    <span>· {n.audience_type === 'all' ? 'הכל' : n.audience_type === 'group' ? 'קבוצה' : 'אדם'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {n.status === 'scheduled' && (
                    <button onClick={() => cancel(n.id)} title="ביטול" className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-amber-400">
                      <Clock className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => remove(n.id)} title="מחיקה" className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Compose — a bottom sheet instead of a permanently-rendered pane. */}
      <Sheet open={composeOpen} onOpenChange={setComposeOpen} title="שליחת התראה">
        {/* Category templates — one tap pre-fills the message */}
        <div className="flex flex-wrap gap-2 mb-3">
          {TEMPLATES.map(tpl => {
            const Icon = tpl.icon;
            return (
              <button key={tpl.key} onClick={() => applyTemplate(tpl)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-700/40 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition" dir="rtl">
                <Icon className="w-3.5 h-3.5 text-primary-600" /> {tpl.label}
              </button>
            );
          })}
        </div>

        {/* Future workouts — one-tap reminder, auto-dated */}
        <div className="mb-3 rounded-xl bg-slate-900/40 border border-slate-700/40 p-2.5">
          <p className="text-2xs font-bold text-slate-400 mb-1.5" dir="rtl">אימונים קרובים · תזכורת בלחיצה</p>
          {upcoming.length > 0 ? (
            <div className="space-y-1">
              {upcoming.map(w => (
                <button key={w.dayOfWeek} onClick={() => remindWorkout(w)}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-slate-800/60 hover:bg-slate-800 transition text-right" dir="rtl">
                  <span className="text-xs text-slate-200 truncate">{w.dayName} · {w.name}</span>
                  <span className="text-3xs font-bold text-primary-600 shrink-0">שלח תזכורת ←</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 px-1 py-1.5" dir="rtl">
              <span className="text-xs text-slate-500">אין תוכנית לשבוע הזה עדיין</span>
              <a href="/dashboard/program" className="text-3xs font-bold text-primary-600 shrink-0">הוספת תוכנית ←</a>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-400">כותרת (עברית)</label>
            <input dir="rtl" value={titleHe} onChange={e => setTitleHe(e.target.value)} className={inputCls} placeholder="לדוגמה: אימון היום ב-18:00" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-400">תוכן (עברית)</label>
            <textarea dir="rtl" value={bodyHe} onChange={e => setBodyHe(e.target.value)} rows={2} className={inputCls} placeholder="פרטי ההתראה" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-400">Title (English)</label>
              <input value={titleEn} onChange={e => setTitleEn(e.target.value)} className={inputCls} placeholder="optional" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400">Body (English)</label>
              <input value={bodyEn} onChange={e => setBodyEn(e.target.value)} className={inputCls} placeholder="optional" />
            </div>
          </div>

          {/* Audience — segmented control + contextual picker */}
          <div>
            <label className="text-xs font-semibold text-slate-400">קהל יעד</label>
            <SegmentedControl
              className="mt-1.5"
              value={audienceType}
              onChange={(v) => { setAudienceType(v); setAudienceId(''); }}
              options={[
                { value: 'all', icon: Users, label: 'כל הרצים' },
                { value: 'group', icon: Users, label: 'דבוקה' },
                { value: 'athlete', icon: User, label: 'אדם' },
              ]}
            />
            {audienceType === 'group' && (
              groups.length > 0 ? (
                <SegmentedControl
                  className="mt-2"
                  value={audienceId}
                  onChange={setAudienceId}
                  options={groups.map(g => ({ value: g.id, label: g.name }))}
                />
              ) : (
                <span className="text-xs text-slate-500 mt-2 block" dir="rtl">אין דבוקות</span>
              )
            )}
            {audienceType === 'athlete' && (
              <button
                type="button"
                onClick={() => setAthletePickerOpen(true)}
                className={cn(inputCls, 'mt-2 flex items-center justify-between text-start')}
                dir="rtl"
              >
                <span className={selectedAthleteName ? 'text-white' : 'text-slate-500'}>
                  {selectedAthleteName || 'בחרו רץ…'}
                </span>
              </button>
            )}
          </div>

          {/* Schedule */}
          <div>
            <label className="text-xs font-semibold text-slate-400">תזמון</label>
            <SegmentedControl
              className="mt-1"
              value={scheduleType}
              onChange={setScheduleType}
              options={[
                { value: 'now', label: 'עכשיו' },
                { value: 'once_at', label: 'בזמן מסוים' },
                { value: 'recurring', label: 'חוזר' },
              ]}
            />
          </div>
          {(scheduleType === 'once_at' || scheduleType === 'recurring') && (
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className={inputCls} />
          )}
          {scheduleType === 'recurring' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 shrink-0">כל</span>
              <input type="number" min={1} value={recurInterval} onChange={e => setRecurInterval(Number(e.target.value))} className="w-20 bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-white" />
              <SegmentedControl<'day' | 'week'>
                className="flex-1"
                value={recurUnit}
                onChange={setRecurUnit}
                options={[
                  { value: 'day', label: 'ימים' },
                  { value: 'week', label: 'שבועות' },
                ]}
              />
            </div>
          )}

          {msg && <p className="text-sm text-primary-600">{msg}</p>}

          <button onClick={submit} disabled={sending}
            className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-bold rounded-lg transition">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {scheduleType === 'now' ? 'שליחה עכשיו' : 'תזמון'}
          </button>
        </div>
      </Sheet>

      {/* Athlete picker — a searchable bottom sheet, replacing the raw
          native <select> dropdown. */}
      <Sheet open={athletePickerOpen} onOpenChange={(o) => { setAthletePickerOpen(o); if (!o) setAthleteSearch(''); }} title="בחרו רץ">
        <input
          value={athleteSearch}
          onChange={e => setAthleteSearch(e.target.value)}
          placeholder="חיפוש…"
          dir="rtl"
          className={cn(inputCls, 'mb-3')}
        />
        <div className="rounded-2xl bg-slate-900/40 overflow-hidden divide-y divide-slate-700/50 max-h-[50vh] overflow-y-auto">
          {filteredAthletes.map(a => (
            <InsetRow
              key={a.id}
              label={a.name}
              onClick={() => { setAudienceId(a.id); setAthletePickerOpen(false); setAthleteSearch(''); }}
              trailing={a.id === audienceId ? <CheckCircle2 className="h-4 w-4 text-primary-400" /> : <span className="w-4 h-4" />}
            />
          ))}
          {filteredAthletes.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-500" dir="rtl">אין תוצאות</p>
          )}
        </div>
      </Sheet>
    </div>
  );
}
