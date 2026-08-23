'use client';

import { useState, useEffect, useCallback } from 'react';
import { Bell, Send, Trash2, Loader2, Clock, Repeat, CheckCircle, CheckCircle2, Users, User, Megaphone, Trophy, CalendarDays, GraduationCap, Activity, Plus, HelpCircle, X, BarChart3, Gift, Camera } from 'lucide-react';
import { cn, getPlanWeekStart } from '@/lib/utils';
import { Sheet, Button, ConfirmSheet, SegmentedControl, SkeletonList, EmptyState } from '@/components/ui';
import { InsetRow, InsetSection } from '@/components/ui/InsetList';

interface Group { id: string; name: string; }
interface Athlete { id: string; name: string; email: string; }

// Preset categories that pre-fill the compose form so the admin doesn't type
// everything each time. he+en so each athlete gets their language.
const TEMPLATES = [
  { key: 'workout', icon: Activity, label: 'אימון', titleHe: 'תזכורת אימון 🏃', bodyHe: 'אימון היום — נתראה!', titleEn: 'Workout reminder 🏃', bodyEn: "Today's workout — see you there!" },
  { key: 'race', icon: Trophy, label: 'מרוץ', titleHe: 'מרוץ מתקרב 🏆', bodyHe: 'ההרשמה למרוץ הקרוב נפתחה — היכנסו לפרטים', titleEn: 'Upcoming race 🏆', bodyEn: 'Registration for the upcoming race is open — check the details' },
  { key: 'event', icon: CalendarDays, label: 'אירוע', titleHe: 'אירוע חדש 📅', bodyHe: 'אירוע חדש נוסף ליומן המדרגות — היכנסו לפרטים', titleEn: 'New event 📅', bodyEn: 'A new event was added to the Madregot calendar — check it out' },
  { key: 'announce', icon: Megaphone, label: 'הודעה', titleHe: 'הודעה מהצוות 📣', bodyHe: 'יש לנו הודעה חשובה לכל חברי המדרגות', titleEn: 'Team announcement 📣', bodyEn: 'An important announcement for all Madregot members' },
  { key: 'academy', icon: GraduationCap, label: 'אקדמיה', titleHe: 'אקדמיה 🎓', bodyHe: 'עדכון חדש באקדמיית המדרגות — היכנסו לצפייה', titleEn: 'Academy 🎓', bodyEn: 'A new update in the Madregot Academy — check it out' },
  { key: 'perk', icon: Gift, label: 'הטבה', titleHe: 'הטבה חדשה! 🎁', bodyHe: 'הטבה חדשה מספונסר המדרגות נוספה — היכנסו לצפייה', titleEn: 'New perk! 🎁', bodyEn: 'A new sponsor perk was added — check it out' },
  { key: 'photos', icon: Camera, label: 'תמונות', titleHe: 'תמונות חדשות עלו! 📸', bodyHe: 'תמונות מהריצה האחרונה זמינות לצפייה', titleEn: 'New photos! 📸', bodyEn: 'Photos from the last run are available to view' },
];

const pad2 = (n: number) => String(n).padStart(2, '0');
// Local YYYY-MM-DD for "today + N days" — same date shape the datetime-local
// / scheduledAt string already uses, just computed from a day offset instead
// of typed by hand.
function dateOffsetStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
// 5 min is the real delivery-precision ceiling (src/app/api/cron/tick scans
// scheduled_notifications every 5 min — see vercel.json) — the chooser only
// ever offers/stores values on that grid so it can't promise more than the
// backend delivers.
const SCHEDULE_STEP_MIN = 5;
function minutesToHHMM(totalMinutes: number): string {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}
function roundToStep(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return minutesToHHMM(Math.round((h * 60 + m) / SCHEDULE_STEP_MIN) * SCHEDULE_STEP_MIN);
}
function nowTimeStr(): string {
  const d = new Date();
  // Round UP, not to nearest — a default has to still be in the future.
  return minutesToHHMM(Math.ceil((d.getHours() * 60 + d.getMinutes()) / SCHEDULE_STEP_MIN) * SCHEDULE_STEP_MIN);
}
const QUICK_SCHEDULE_DAYS = [
  { days: 0, label: 'היום' },
  { days: 1, label: 'מחר' },
  { days: 2, label: 'מחרתיים' },
  { days: 3, label: 'בעוד 3 ימים' },
  { days: 4, label: 'בעוד 4 ימים' },
  { days: 7, label: 'בעוד שבוע' },
];

interface UpcomingWorkout { dayOfWeek: number; dayName: string; name: string; type: string; }
interface SurveyRow {
  id: string;
  question_he: string;
  options_he: string[];
  counts: number[];
  totalResponses: number;
  created_at: string;
}
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

// Tap the row → action sheet, exact composition as the Athletes page (the
// app-wide reference for this pattern, src/app/dashboard/athletes/page.tsx):
// a plain Sheet titled with the item, an InsetSection of action InsetRows,
// destructive one behind ConfirmSheet. Replaces two bare icon buttons that
// used to fire delete/cancel straight from the row with zero confirmation.
function NotificationRowView({ n, onCancel, onRemove }: {
  n: NotificationRow;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const statusText = n.status === 'sent' ? `נשלח (${n.sent_count})`
    : n.status === 'cancelled' ? 'בוטל'
    : n.schedule_type === 'recurring' ? `כל ${n.recur_interval} ${n.recur_unit === 'week' ? 'שבועות' : 'ימים'}`
    : n.next_run_at ? new Date(n.next_run_at).toLocaleString('he-IL') : 'מתוזמן';
  const audienceText = n.audience_type === 'all' ? 'הכל' : n.audience_type === 'group' ? 'קבוצה' : 'אדם';

  const Icon = n.status === 'sent' ? CheckCircle : n.status === 'cancelled' ? X : n.schedule_type === 'recurring' ? Repeat : Clock;
  const iconBg = n.status === 'sent' ? 'bg-green-500' : n.status === 'cancelled' ? 'bg-slate-600' : 'bg-amber-500';

  return (
    <>
      <InsetRow
        icon={Icon}
        iconBg={iconBg}
        label={n.title_he}
        sublabel={n.body_he}
        value={`${statusText} · ${audienceText}`}
        onClick={() => setActionsOpen(true)}
      />

      <Sheet open={actionsOpen} onOpenChange={setActionsOpen} title={n.title_he}>
        <InsetSection>
          {n.status === 'scheduled' && (
            <InsetRow
              icon={Clock}
              iconBg="bg-amber-500"
              label="ביטול תזמון"
              onClick={() => { setActionsOpen(false); onCancel(n.id); }}
            />
          )}
          <InsetRow
            icon={Trash2}
            iconBg="bg-red-500"
            label="מחיקה"
            danger
            onClick={() => { setActionsOpen(false); setConfirmDeleteOpen(true); }}
          />
        </InsetSection>
      </Sheet>

      <ConfirmSheet
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="למחוק את ההתראה?"
        description={n.title_he}
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        onConfirm={() => onRemove(n.id)}
      />
    </>
  );
}

export function NotificationCenter() {
  const [actorEmail, setActorEmail] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [list, setList] = useState<NotificationRow[]>([]);
  const [surveys, setSurveys] = useState<SurveyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // compose sheet
  const [composeOpen, setComposeOpen] = useState(false);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [athletePickerOpen, setAthletePickerOpen] = useState(false);
  const [athleteSearch, setAthleteSearch] = useState('');
  // 'message' = the existing push-notification flow; 'survey' = a question
  // with options that athletes answer in-app, not just a one-way push.
  const [composeMode, setComposeMode] = useState<'message' | 'survey'>('message');
  const [surveyQuestionHe, setSurveyQuestionHe] = useState('');
  const [surveyQuestionEn, setSurveyQuestionEn] = useState('');
  const [surveyOptionsHe, setSurveyOptionsHe] = useState(['', '']);
  const [surveyOptionsEn, setSurveyOptionsEn] = useState(['', '']);

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

  const loadSurveys = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/surveys');
      const data = await res.json();
      setSurveys(data.surveys || []);
    } catch { /* noop */ }
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
    loadSurveys();
  }, [loadList, loadSurveys]);

  const reset = () => {
    setTitleHe(''); setBodyHe(''); setTitleEn(''); setBodyEn('');
    setAudienceType('all'); setAudienceId('');
    setScheduleType('now'); setScheduledAt(''); setRecurInterval(1); setRecurUnit('week');
    setComposeMode('message');
    setSurveyQuestionHe(''); setSurveyQuestionEn('');
    setSurveyOptionsHe(['', '']); setSurveyOptionsEn(['', '']);
    setMsg(null);
  };

  const submitSurvey = async () => {
    const cleanOptionsHe = surveyOptionsHe.map((o) => o.trim()).filter(Boolean);
    if (!surveyQuestionHe.trim()) { setMsg('שאלה בעברית נדרשת'); return; }
    if (cleanOptionsHe.length < 2) { setMsg('נדרשות לפחות 2 תשובות אפשריות'); return; }
    if (audienceType !== 'all' && !audienceId) { setMsg('בחרו קהל יעד'); return; }

    setSending(true); setMsg(null);
    try {
      const res = await fetch('/api/admin/surveys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorEmail,
          question_he: surveyQuestionHe,
          question_en: surveyQuestionEn || null,
          options_he: cleanOptionsHe,
          options_en: surveyOptionsEn.map((o) => o.trim()).filter(Boolean),
          audience_type: audienceType,
          audience_id: audienceType === 'all' ? null : audienceId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Failed');
      reset();
      setComposeOpen(false);
      loadSurveys();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    if (composeMode === 'survey') { await submitSurvey(); return; }
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
      if (!res.ok) throw new Error(data.message || data.error || 'Failed');
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

  const selectedAthlete = athletes.find(a => a.id === audienceId);
  const selectedAthleteName = selectedAthlete?.name;
  const filteredAthletes = athletes.filter(a => !athleteSearch.trim() || a.name.toLowerCase().includes(athleteSearch.trim().toLowerCase()));

  // Scheduled vs. past — same grouping regardless of who it went to (all /
  // group / one athlete all mix together within each section, same as before).
  const scheduledList = list.filter(n => n.status === 'scheduled');
  const pastList = list.filter(n => n.status !== 'scheduled');

  const audienceSummary =
    audienceType === 'all' ? 'כל הרצים'
    : audienceType === 'group' ? (groups.find(g => g.id === audienceId)?.name ? `דבוקת "${groups.find(g => g.id === audienceId)?.name}"` : 'הדבוקה שנבחרה')
    : (selectedAthleteName || 'הנמען שנבחר');
  const confirmDescription = composeMode === 'survey'
    ? `הסקר יישלח ל${audienceSummary}`
    : `ההתראה תישלח ל${audienceSummary}${scheduleType === 'now' ? ' עכשיו' : ' — מתוזמן'}`;

  // scheduledAt stays one 'YYYY-MM-DDTHH:mm' string (what the API + remindWorkout
  // already expect) — day and hour are just two views onto it, so quick-pick
  // chips can set the date half without touching whatever hour was chosen.
  const [schedDate, schedTime] = scheduledAt ? scheduledAt.split('T') : ['', ''];
  // Today's default has to be "now" — a fixed morning hour could already be in
  // the past by the time someone picks "today". Any other day is guaranteed to
  // be in the future regardless, so a plain morning default is fine there.
  const setSchedDate = (d: string) =>
    setScheduledAt(`${d}T${schedTime || (d === dateOffsetStr(0) ? nowTimeStr() : '07:00')}`);
  const setSchedTime = (t: string) => setScheduledAt(`${schedDate || dateOffsetStr(0)}T${roundToStep(t)}`);

  // Mirrors exactly what the service worker renders (src/app/sw.ts): app icon
  // fallback (compose never sets a custom one), title/body verbatim. Surveys
  // always push the fixed "tap to answer" body — the question text itself
  // only becomes the title (see /api/admin/surveys route).
  const previewTitle = (composeMode === 'survey' ? surveyQuestionHe : titleHe).trim() || 'כותרת ההתראה';
  const previewBody = composeMode === 'survey' ? 'לחצו לענות על הסקר' : (bodyHe.trim() || 'תוכן ההתראה');
  const notifPreview = (
    <div>
      <label className="text-xs font-semibold text-slate-400 mb-1.5 block">תצוגה מקדימה — כך זה יופיע במכשיר</label>
      <div className="rounded-2xl bg-white shadow-lg border border-black/5 p-3 flex items-start gap-2.5" dir="rtl">
        <img src="/images/icon-192.png" alt="" className="w-9 h-9 rounded-[10px] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Madregot</span>
            <span className="text-[10px] text-slate-400">עכשיו</span>
          </div>
          <p className="text-[13px] font-bold text-slate-900 truncate" dir="auto">{previewTitle}</p>
          <p className="text-[13px] text-slate-700 line-clamp-2" dir="auto">{previewBody}</p>
        </div>
      </div>
    </div>
  );

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
        <div className="space-y-5">
          {/* Grouped by status, not by who it's going to — "all"/group/one
              athlete all mix together within each group, same as scheduling
              already treats them, just no longer jumbled together in one
              flat list regardless of whether they've fired yet. */}
          {scheduledList.length > 0 && (
            <InsetSection header="מתוזמן">
              {scheduledList.map(n => (
                <NotificationRowView key={n.id} n={n} onCancel={cancel} onRemove={remove} />
              ))}
            </InsetSection>
          )}
          {pastList.length > 0 && (
            <InsetSection header="היסטוריה">
              {pastList.map(n => (
                <NotificationRowView key={n.id} n={n} onCancel={cancel} onRemove={remove} />
              ))}
            </InsetSection>
          )}
        </div>
      )}

      {/* Surveys — a genuinely different kind from the push-only list above:
          each one collects athlete responses, so results (a per-option
          count) are shown inline instead of just a delivery status. */}
      {surveys.length > 0 && (
        <div className="mt-6">
          <h3 className="font-bold text-white mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary-400" /> סקרים
          </h3>
          <div className="space-y-2">
            {surveys.map((s) => {
              const max = Math.max(1, ...s.counts);
              return (
                <div key={s.id} className="bg-slate-900/40 rounded-xl border border-slate-700/30 p-3">
                  <p className="text-sm font-semibold text-white mb-2" dir="auto">{s.question_he}</p>
                  <div className="space-y-1.5">
                    {s.options_he.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-slate-300 w-20 truncate shrink-0" dir="auto">{opt}</span>
                        <div className="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-primary-600 rounded-full"
                            style={{ width: `${((s.counts[i] || 0) / max) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-400 w-6 text-end shrink-0 tabular-nums">{s.counts[i] || 0}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-3xs text-slate-500 mt-2">{s.totalResponses} תשובות</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Compose — a bottom sheet instead of a permanently-rendered pane. */}
      <Sheet open={composeOpen} onOpenChange={setComposeOpen} title="שליחת התראה">
        <SegmentedControl
          className="mb-3"
          value={composeMode}
          onChange={(v) => { setComposeMode(v); setMsg(null); }}
          options={[
            { value: 'message', icon: Megaphone, label: 'הודעה' },
            { value: 'survey', icon: HelpCircle, label: 'סקר' },
          ]}
        />

        {composeMode === 'message' && (
          <>
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
          </>
        )}

        {/* תוכן — one visually distinct card per mode, instead of a
            continuous scroll of bare labeled inputs. */}
        <div className="rounded-2xl bg-slate-900/40 border border-slate-700/40 p-3 space-y-3 mb-3">
          <p className="text-2xs font-bold text-slate-400 uppercase tracking-wide" dir="rtl">תוכן</p>
          {composeMode === 'message' ? (
            <>
              <div>
                <label className="text-xs font-semibold text-slate-400">כותרת (עברית)</label>
                <input dir="rtl" value={titleHe} onChange={e => setTitleHe(e.target.value)} className={inputCls} placeholder="לדוגמה: אימון היום ב-18:00" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400">תוכן (עברית)</label>
                <textarea dir="rtl" value={bodyHe} onChange={e => setBodyHe(e.target.value)} rows={2} className={inputCls} placeholder="פרטי ההתראה" />
              </div>
              {notifPreview}
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
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-slate-400">שאלה (עברית)</label>
                <input dir="rtl" value={surveyQuestionHe} onChange={e => setSurveyQuestionHe(e.target.value)} className={inputCls} placeholder="לדוגמה: איזה יום מתאים לאימון נוסף?" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400">תשובות אפשריות (עברית)</label>
                <div className="space-y-2 mt-1">
                  {surveyOptionsHe.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        dir="rtl"
                        value={opt}
                        onChange={e => setSurveyOptionsHe(surveyOptionsHe.map((o, j) => j === i ? e.target.value : o))}
                        className={inputCls}
                        placeholder={`אפשרות ${i + 1}`}
                      />
                      {surveyOptionsHe.length > 2 && (
                        <button
                          type="button"
                          onClick={() => setSurveyOptionsHe(surveyOptionsHe.filter((_, j) => j !== i))}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-red-400 shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSurveyOptionsHe([...surveyOptionsHe, ''])}
                    className="flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-500"
                  >
                    <Plus className="w-3.5 h-3.5" /> הוספת אפשרות
                  </button>
                </div>
              </div>
              {notifPreview}
              <div>
                <label className="text-xs font-semibold text-slate-400">Question (English, optional)</label>
                <input value={surveyQuestionEn} onChange={e => setSurveyQuestionEn(e.target.value)} className={inputCls} placeholder="optional" />
                {surveyQuestionEn.trim() && (
                  <div className="space-y-2 mt-2">
                    {surveyOptionsHe.map((_, i) => (
                      <input
                        key={i}
                        value={surveyOptionsEn[i] || ''}
                        onChange={e => {
                          const next = [...surveyOptionsEn];
                          next[i] = e.target.value;
                          setSurveyOptionsEn(next);
                        }}
                        className={inputCls}
                        placeholder={`Option ${i + 1} (English)`}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="space-y-3">
          {/* קהל יעד — segmented control + contextual picker */}
          <div className="rounded-2xl bg-slate-900/40 border border-slate-700/40 p-3">
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
                {selectedAthlete ? (
                  <span className="flex flex-col items-start">
                    <span className="text-white">{selectedAthlete.name}</span>
                    <span className="text-2xs text-slate-500" dir="ltr">{selectedAthlete.email}</span>
                  </span>
                ) : (
                  <span className="text-slate-500">בחרו רץ…</span>
                )}
              </button>
            )}
          </div>

          {/* תזמון — surveys always send immediately (no separate cron path
              for one notification kind); scheduling only applies to regular
              messages. */}
          {composeMode === 'message' && (
            <div className="rounded-2xl bg-slate-900/40 border border-slate-700/40 p-3 space-y-2">
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
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_SCHEDULE_DAYS.map(q => {
                      const targetDate = dateOffsetStr(q.days);
                      const active = schedDate === targetDate;
                      return (
                        <button
                          key={q.days}
                          type="button"
                          onClick={() => setSchedDate(targetDate)}
                          className={cn(
                            'px-2.5 py-1.5 rounded-lg text-xs font-semibold transition',
                            active ? 'bg-primary-600 text-white' : 'bg-slate-700/40 text-slate-300 hover:bg-slate-700'
                          )}
                        >
                          {q.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} className={inputCls} />
                    <input type="time" step={300} value={schedTime || ''} onChange={e => setSchedTime(e.target.value)} className={inputCls} />
                  </div>
                </div>
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
            </div>
          )}

          {msg && <p className="text-sm text-primary-600">{msg}</p>}

          <button onClick={() => setConfirmSendOpen(true)} disabled={sending}
            className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-bold rounded-lg transition">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {composeMode === 'survey' ? 'שליחת סקר' : scheduleType === 'now' ? 'שליחה עכשיו' : 'תזמון'}
          </button>
        </div>
      </Sheet>

      {/* One more explicit tap before an actual send/schedule goes out — a
          broadcast to real people deserves a "are you sure", separate from
          (and no substitute for) the view-as read-only guard above. */}
      <ConfirmSheet
        open={confirmSendOpen}
        onOpenChange={setConfirmSendOpen}
        title={composeMode === 'survey' ? 'לשלוח את הסקר?' : 'לשלוח את ההתראה?'}
        description={confirmDescription}
        confirmLabel={composeMode === 'survey' ? 'שליחת הסקר' : scheduleType === 'now' ? 'שליחה עכשיו' : 'תזמון'}
        cancelLabel="ביטול"
        danger={false}
        onConfirm={submit}
      />

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
              sublabel={a.email}
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
