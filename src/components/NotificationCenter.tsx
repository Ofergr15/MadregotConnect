'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, Send, Trash2, Loader2, Clock, Repeat, CheckCircle, CheckCircle2, Users, User, Megaphone, Trophy, CalendarDays, GraduationCap, Activity, Plus, HelpCircle, X, BarChart3, Gift, Camera, Pencil, Footprints, ImagePlus } from 'lucide-react';
import { cn, getPlanWeekStart } from '@/lib/utils';
import { apiHeaders, useApi } from '@/lib/api';
import { bearerHeaders } from '@/lib/auth/bearer-headers';
import { Sheet, Button, ConfirmSheet, SegmentedControl, SkeletonList, EmptyState, Switch } from '@/components/ui';
import { InsetRow, InsetSection } from '@/components/ui/InsetList';
import { dateOffsetStr, minutesToHHMM, roundToStep, describeNotificationRow, SCHEDULE_STEP_MIN, type StatusIconKind } from '@/lib/notifications/scheduling';

interface Group { id: string; name: string; }
interface Athlete { id: string; name: string; email: string; }
interface RecurringTemplate {
  id: string; day_of_week: number;
  question_he: string; question_en: string | null;
  options_he: string[]; options_en: string[] | null;
  active: boolean;
}
const DOW_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// Preset categories that pre-fill the compose form so the admin doesn't type
// everything each time. he+en so each athlete gets their language.
const TEMPLATES = [
  { key: 'workout', icon: Activity, label: 'אימון', titleHe: 'תזכורת אימון 🏃', bodyHe: 'אימון היום — נתראה!', titleEn: 'Workout reminder 🏃', bodyEn: "Today's workout — see you there!" },
  { key: 'race', icon: Trophy, label: 'מרוץ', titleHe: 'מרוץ מתקרב 🏆', bodyHe: 'ההרשמה למרוץ הקרוב נפתחה — היכנסו לפרטים', titleEn: 'Upcoming race 🏆', bodyEn: 'Registration for the upcoming race is open — check the details' },
  { key: 'event', icon: CalendarDays, label: 'אירוע', titleHe: 'אירוע חדש 📅', bodyHe: 'אירוע חדש נוסף ליומן המדרגות — היכנסו לפרטים', titleEn: 'New event 📅', bodyEn: 'A new event was added to the Madregot calendar — check it out' },
  { key: 'announce', icon: Megaphone, label: 'הודעה', titleHe: 'הודעה מהצוות 📣', bodyHe: 'יש לנו הודעה חשובה לכל חברי המדרגות', titleEn: 'Team announcement 📣', bodyEn: 'An important announcement for all Madregot members' },
  { key: 'academy', icon: GraduationCap, label: 'אקדמיה', titleHe: 'אקדמיה 🎓', bodyHe: 'עדכון חדש באקדמיית המדרגות — היכנסו לצפייה', titleEn: 'Academy 🎓', bodyEn: 'A new update in the Madregot Academy — check it out' },
  { key: 'perk', icon: Gift, label: 'שותפות', titleHe: 'שותפות חדשה! 🎁', bodyHe: 'שותפות חדשה עם ספונסר של המדרגות נוספה — היכנסו לצפייה', titleEn: 'New partnership! 🎁', bodyEn: 'A new sponsor partnership was added — check it out' },
  { key: 'photos', icon: Camera, label: 'תמונות', titleHe: 'תמונות חדשות עלו! 📸', bodyHe: 'תמונות מהריצה האחרונה זמינות לצפייה', titleEn: 'New photos! 📸', bodyEn: 'Photos from the last run are available to view' },
];

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

  const { statusText, audienceText, iconKind, iconBg } = describeNotificationRow(n);
  const ICON_BY_KIND: Record<StatusIconKind, typeof CheckCircle> = { sent: CheckCircle, cancelled: X, recurring: Repeat, scheduled: Clock };
  const Icon = ICON_BY_KIND[iconKind];

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
              iconBg="bg-band-3"
              label="ביטול תזמון"
              onClick={() => { setActionsOpen(false); onCancel(n.id); }}
            />
          )}
          <InsetRow
            icon={Trash2}
            iconBg="bg-accent-red"
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
  // Group list for the "send to group" picker. Same SWR key the Header uses on
  // every screen, so opening this panel doesn't re-run the groups+athletes join.
  const { data: groupsData } = useApi<{ groups?: Group[] }>('/api/groups');
  const groups: Group[] = (groupsData?.groups || []).map(g => ({ id: g.id, name: g.name }));
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [list, setList] = useState<NotificationRow[]>([]);
  const [surveys, setSurveys] = useState<SurveyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Recurring pace-group poll templates — one row per team day (migration
  // 073), each independently editable so Tuesday's and Friday's content can
  // differ without a code deploy.
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTemplate[]>([]);
  const [templateEditOpen, setTemplateEditOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringTemplate | null>(null);
  const [tplQuestionHe, setTplQuestionHe] = useState('');
  const [tplQuestionEn, setTplQuestionEn] = useState('');
  const [tplOptionsHe, setTplOptionsHe] = useState<string[]>(['', '']);
  const [tplOptionsEn, setTplOptionsEn] = useState<string[]>(['', '']);
  const [tplActive, setTplActive] = useState(true);
  const [tplSaving, setTplSaving] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);

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
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
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
      // The server identifies the approver from the session, so there's no
      // longer a localStorage email to race with the mount effect.
      const res = await fetch('/api/notifications', { headers: await bearerHeaders(false) });
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

  const loadRecurringTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/recurring-surveys');
      const data = await res.json();
      setRecurringTemplates(data.templates || []);
    } catch { /* noop */ }
  }, []);

  const openEditTemplate = (tpl: RecurringTemplate) => {
    setEditingTemplate(tpl);
    setTplQuestionHe(tpl.question_he);
    setTplQuestionEn(tpl.question_en || '');
    setTplOptionsHe(tpl.options_he.length ? tpl.options_he : ['', '']);
    setTplOptionsEn(tpl.options_en?.length ? tpl.options_en : ['', '']);
    setTplActive(tpl.active);
    setTplError(null);
    setTemplateEditOpen(true);
  };

  const saveTemplate = async () => {
    if (!editingTemplate) return;
    const cleanOptionsHe = tplOptionsHe.map((o) => o.trim()).filter(Boolean);
    if (!tplQuestionHe.trim()) { setTplError('שאלה בעברית נדרשת'); return; }
    if (cleanOptionsHe.length < 2) { setTplError('נדרשות לפחות 2 תשובות אפשריות'); return; }
    setTplSaving(true);
    setTplError(null);
    try {
      const res = await fetch('/api/admin/recurring-surveys', {
        method: 'PATCH',
        headers: await bearerHeaders(),
        body: JSON.stringify({
          dayOfWeek: editingTemplate.day_of_week,
          questionHe: tplQuestionHe,
          questionEn: tplQuestionEn || null,
          optionsHe: cleanOptionsHe,
          optionsEn: tplOptionsEn.map((o) => o.trim()).filter(Boolean),
          active: tplActive,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'השמירה נכשלה');
      setTemplateEditOpen(false);
      loadRecurringTemplates();
    } catch (e: any) {
      setTplError(e.message);
    } finally {
      setTplSaving(false);
    }
  };

  useEffect(() => {
    apiHeaders().then(h => fetch('/api/admin/users', { headers: h })).then(r => r.ok ? r.json() : null).then(d => {
      if (d?.users) setAthletes(d.users.map((u: any) => ({ id: u.id, name: u.name, email: u.email })));
    }).catch(() => {});
    // This week's upcoming workouts (from the plan) for one-tap reminders.
    const DN = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
    const todayDow = new Date().getDay();
    // Session-gated now (requireMember), so this needs the bearer header — the
    // same treatment /api/admin/users gets above.
    apiHeaders().then(h => fetch('/api/dashboard/weekly', { headers: h })).then(r => r.ok ? r.json() : null).then(d => {
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
    loadRecurringTemplates();
  }, [loadList, loadSurveys, loadRecurringTemplates]);

  const reset = () => {
    setTitleHe(''); setBodyHe(''); setTitleEn(''); setBodyEn('');
    setImageUrl(''); setImageError(null);
    setAudienceType('all'); setAudienceId('');
    setScheduleType('now'); setScheduledAt(''); setRecurInterval(1); setRecurUnit('week');
    setComposeMode('message');
    setSurveyQuestionHe(''); setSurveyQuestionEn('');
    setSurveyOptionsHe(['', '']); setSurveyOptionsEn(['', '']);
    setMsg(null);
  };

  const uploadImage = async (file: File) => {
    setUploadingImage(true);
    setImageError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      // No Content-Type — fetch has to set the multipart boundary itself.
      const res = await fetch('/api/admin/notifications/image', {
        method: 'POST',
        headers: await bearerHeaders(false),
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'העלאה נכשלה');
      setImageUrl(data.url);
    } catch (err: any) {
      setImageError(err.message || 'העלאה נכשלה');
    } finally {
      setUploadingImage(false);
    }
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
        headers: await bearerHeaders(),
        body: JSON.stringify({
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
        headers: await bearerHeaders(),
        body: JSON.stringify({
          title_he: titleHe, body_he: bodyHe,
          title_en: titleEn || null, body_en: bodyEn || null,
          image_url: imageUrl || null,
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
    await fetch(`/api/notifications?id=${id}`, { method: 'DELETE', headers: await bearerHeaders(false) });
    loadList();
  };
  const cancel = async (id: string) => {
    await fetch('/api/notifications', {
      method: 'PUT',
      headers: await bearerHeaders(),
      body: JSON.stringify({ id, status: 'cancelled' }),
    });
    loadList();
  };

  const inputCls = 'w-full bg-page/50 border border-page rounded-lg px-3 py-2.5 text-base text-ink-700 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-600';

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
  // fallback unless an image was attached (then icon+image both use it,
  // matching sw.ts's push handler), title/body verbatim. Surveys always push
  // the fixed "tap to answer" body — the question text itself only becomes
  // the title (see /api/admin/surveys route).
  const previewTitle = (composeMode === 'survey' ? surveyQuestionHe : titleHe).trim() || 'כותרת ההתראה';
  const previewBody = composeMode === 'survey' ? 'לחצו לענות על הסקר' : (bodyHe.trim() || 'תוכן ההתראה');
  // Surveys go out through /api/admin/surveys, which has no image_url field at
  // all — an image attached while composing a plain message (then switching
  // to survey mode without clearing it) can never actually be delivered, so
  // the preview must not show it here even though `imageUrl` is still set
  // (kept in state so switching back to message mode doesn't lose it).
  const previewImageUrl = composeMode === 'survey' ? '' : imageUrl;
  const notifPreview = (
    <div>
      <label className="text-xs font-semibold text-ink-400 mb-1.5 block">תצוגה מקדימה — כך זה יופיע במכשיר</label>
      <div className="rounded-2xl bg-white shadow-lg border border-black/5 overflow-hidden" dir="rtl">
        <div className="p-3 flex items-start gap-2.5">
          <img src={previewImageUrl || '/images/icon-192.png'} alt="" className="w-9 h-9 rounded-[10px] shrink-0 object-cover" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <span className="text-[10px] font-bold text-ink-400 uppercase tracking-wide">Madregot</span>
              <span className="text-[10px] text-ink-400">עכשיו</span>
            </div>
            <p className="text-[13px] font-bold text-ink-900 truncate" dir="auto">{previewTitle}</p>
            <p className="text-[13px] text-ink-900 line-clamp-2" dir="auto">{previewBody}</p>
          </div>
        </div>
        {/* Expanded banner — only Chrome/Android renders `image` this large;
            iOS shows just the small icon above regardless. Shown here so the
            preview is honest about that platform gap rather than implying a
            richer result everywhere. */}
        {previewImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewImageUrl} alt="" className="w-full max-h-40 object-cover border-t border-black/5" />
        )}
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
        <h3 className="font-bold text-ink-700">התראות</h3>
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

      {/* Recurring pace-group poll templates — one row per team day,
          independently editable (migration 073 / cron/tick.ts consumes
          these directly, so a save here changes next week's actual send
          with no code deploy). */}
      {recurringTemplates.length > 0 && (
        <div className="mt-6">
          <h3 className="font-bold text-ink-700 mb-3 flex items-center gap-2">
            <Footprints className="w-4 h-4 text-brand-600" /> תבניות דבוקות שבועיות
          </h3>
          <InsetSection>
            {recurringTemplates.map((tpl) => (
              <InsetRow
                key={tpl.id}
                icon={Pencil}
                iconBg={tpl.active ? 'bg-brand-600' : 'bg-ink-300'}
                label={DOW_NAMES_HE[tpl.day_of_week] || `יום ${tpl.day_of_week}`}
                sublabel={tpl.question_he}
                value={tpl.active ? undefined : 'כבוי'}
                onClick={() => openEditTemplate(tpl)}
              />
            ))}
          </InsetSection>
        </div>
      )}

      {/* Surveys — a genuinely different kind from the push-only list above:
          each one collects athlete responses, so results (a per-option
          count) are shown inline instead of just a delivery status. */}
      {surveys.length > 0 && (
        <div className="mt-6">
          <h3 className="font-bold text-ink-700 mb-3 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-600" /> סקרים
          </h3>
          <div className="space-y-2">
            {surveys.map((s) => {
              const max = Math.max(1, ...s.counts);
              return (
                <div key={s.id} className="bg-page/40 rounded-xl border border-page/30 p-3">
                  <p className="text-sm font-semibold text-ink-700 mb-2" dir="auto">{s.question_he}</p>
                  <div className="space-y-1.5">
                    {s.options_he.map((opt, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-ink-500 w-20 truncate shrink-0" dir="auto">{opt}</span>
                        <div className="flex-1 h-2 rounded-full bg-card overflow-hidden">
                          <div
                            className="h-full bg-brand-600 rounded-full"
                            style={{ width: `${((s.counts[i] || 0) / max) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-ink-400 w-6 text-end shrink-0 tabular-nums">{s.counts[i] || 0}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-3xs text-ink-400 mt-2">{s.totalResponses} תשובות</p>
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
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-page/40 hover:bg-ink-300/40 text-ink-700 text-xs font-semibold transition" dir="rtl">
                    <Icon className="w-3.5 h-3.5 text-brand-600" /> {tpl.label}
                  </button>
                );
              })}
            </div>

            {/* Future workouts — one-tap reminder, auto-dated */}
            <div className="mb-3 rounded-xl bg-page/40 border border-page/40 p-2.5">
              <p className="text-2xs font-bold text-ink-400 mb-1.5" dir="rtl">אימונים קרובים · תזכורת בלחיצה</p>
              {upcoming.length > 0 ? (
                <div className="space-y-1">
                  {upcoming.map(w => (
                    <button key={w.dayOfWeek} onClick={() => remindWorkout(w)}
                      className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-card/60 hover:bg-page transition text-right" dir="rtl">
                      <span className="text-xs text-ink-700 truncate">{w.dayName} · {w.name}</span>
                      <span className="text-3xs font-bold text-brand-600 shrink-0">שלח תזכורת ←</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 px-1 py-1.5" dir="rtl">
                  <span className="text-xs text-ink-400">אין תוכנית לשבוע הזה עדיין</span>
                  <a href="/dashboard/program" className="text-3xs font-bold text-brand-600 shrink-0">הוספת תוכנית ←</a>
                </div>
              )}
            </div>
          </>
        )}

        {/* תוכן — one visually distinct card per mode, instead of a
            continuous scroll of bare labeled inputs. */}
        <div className="rounded-2xl bg-page/40 border border-page/40 p-3 space-y-3 mb-3">
          <p className="text-2xs font-bold text-ink-400 uppercase tracking-wide" dir="rtl">תוכן</p>
          {composeMode === 'message' ? (
            <>
              <div>
                <label className="text-xs font-semibold text-ink-400">כותרת (עברית)</label>
                <input dir="rtl" value={titleHe} onChange={e => setTitleHe(e.target.value)} className={inputCls} placeholder="לדוגמה: אימון היום ב-18:00" />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-400">תוכן (עברית)</label>
                <textarea dir="rtl" value={bodyHe} onChange={e => setBodyHe(e.target.value)} rows={2} className={inputCls} placeholder="פרטי ההתראה" />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-400 mb-1.5 block" dir="rtl">תמונה (אופציונלי)</label>
                <input
                  ref={imageFileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(f); }}
                />
                {imageUrl ? (
                  <div className="flex items-center gap-2" dir="rtl">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                    <button
                      onClick={() => setImageUrl('')}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-accent-red hover:text-accent-red bg-card/60 hover:bg-page transition"
                    >
                      <X className="w-3.5 h-3.5" /> הסרת תמונה
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => imageFileRef.current?.click()}
                    disabled={uploadingImage}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-brand-600 bg-brand-600/10 hover:bg-brand-600/20 transition disabled:opacity-50"
                  >
                    {uploadingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                    {uploadingImage ? 'מעלה...' : 'הוספת תמונה'}
                  </button>
                )}
                {imageError && <p className="text-xs text-accent-red mt-1.5" dir="rtl">{imageError}</p>}
              </div>
              {notifPreview}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink-400">Title (English)</label>
                  <input value={titleEn} onChange={e => setTitleEn(e.target.value)} className={inputCls} placeholder="optional" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink-400">Body (English)</label>
                  <input value={bodyEn} onChange={e => setBodyEn(e.target.value)} className={inputCls} placeholder="optional" />
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-ink-400">שאלה (עברית)</label>
                <input dir="rtl" value={surveyQuestionHe} onChange={e => setSurveyQuestionHe(e.target.value)} className={inputCls} placeholder="לדוגמה: איזה יום מתאים לאימון נוסף?" />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-400">תשובות אפשריות (עברית)</label>
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
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-400 hover:text-accent-red shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSurveyOptionsHe([...surveyOptionsHe, ''])}
                    className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
                  >
                    <Plus className="w-3.5 h-3.5" /> הוספת אפשרות
                  </button>
                </div>
              </div>
              {notifPreview}
              <div>
                <label className="text-xs font-semibold text-ink-400">Question (English, optional)</label>
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
          <div className="rounded-2xl bg-page/40 border border-page/40 p-3">
            <label className="text-xs font-semibold text-ink-400">קהל יעד</label>
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
                <span className="text-xs text-ink-400 mt-2 block" dir="rtl">אין דבוקות</span>
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
                    <span className="text-ink-700">{selectedAthlete.name}</span>
                    <span className="text-2xs text-ink-400" dir="ltr">{selectedAthlete.email}</span>
                  </span>
                ) : (
                  <span className="text-ink-400">בחרו רץ…</span>
                )}
              </button>
            )}
          </div>

          {/* תזמון — surveys always send immediately (no separate cron path
              for one notification kind); scheduling only applies to regular
              messages. */}
          {composeMode === 'message' && (
            <div className="rounded-2xl bg-page/40 border border-page/40 p-3 space-y-2">
              <div>
                <label className="text-xs font-semibold text-ink-400">תזמון</label>
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
                            active ? 'bg-brand-600 text-white' : 'bg-page/40 text-ink-500 hover:bg-ink-300/40'
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
                  <span className="text-xs text-ink-400 shrink-0">כל</span>
                  <input
                    type="number"
                    min={1}
                    value={recurInterval}
                    onChange={e => {
                      // A plain number input's `min` attribute is only
                      // enforced on <form> submit, which this isn't — clamp
                      // by hand so an emptied field or "0"/negative value
                      // can't reach the server as a runaway interval.
                      const n = Math.floor(Number(e.target.value));
                      setRecurInterval(Number.isFinite(n) && n >= 1 ? n : 1);
                    }}
                    className="w-20 bg-page/50 border border-page rounded-lg px-3 py-2 text-ink-700"
                  />
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

          {msg && <p className="text-sm text-brand-600">{msg}</p>}

          <button onClick={() => setConfirmSendOpen(true)} disabled={sending}
            className="w-full inline-flex items-center justify-center gap-2 min-h-[48px] bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-bold rounded-lg transition">
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
        <div className="rounded-2xl bg-page/40 overflow-hidden divide-y divide-page/50 max-h-[50vh] overflow-y-auto">
          {filteredAthletes.map(a => (
            <InsetRow
              key={a.id}
              label={a.name}
              sublabel={a.email}
              onClick={() => { setAudienceId(a.id); setAthletePickerOpen(false); setAthleteSearch(''); }}
              trailing={a.id === audienceId ? <CheckCircle2 className="h-4 w-4 text-brand-600" /> : <span className="w-4 h-4" />}
            />
          ))}
          {filteredAthletes.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-ink-400" dir="rtl">אין תוצאות</p>
          )}
        </div>
      </Sheet>

      {/* Edit a recurring pace-group template — same card-per-section shape
          as the compose sheet, scoped to one team day at a time. */}
      <Sheet
        open={templateEditOpen}
        onOpenChange={setTemplateEditOpen}
        title={editingTemplate ? `תבנית יום ${DOW_NAMES_HE[editingTemplate.day_of_week]}` : ''}
      >
        <div className="space-y-3 pb-2">
          {tplError && <div className="p-3 rounded-xl bg-accent-red/10 border border-accent-red/20 text-accent-red-ink text-xs">{tplError}</div>}

          <div className="rounded-2xl bg-page/40 border border-page/40 p-3 space-y-3">
            <div>
              <label className="text-xs font-semibold text-ink-400">שאלה (עברית)</label>
              <input dir="rtl" value={tplQuestionHe} onChange={e => setTplQuestionHe(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-400">Question (English, optional)</label>
              <input value={tplQuestionEn} onChange={e => setTplQuestionEn(e.target.value)} className={inputCls} placeholder="optional" />
            </div>
          </div>

          <div className="rounded-2xl bg-page/40 border border-page/40 p-3">
            <label className="text-xs font-semibold text-ink-400">תשובות אפשריות (עברית)</label>
            <div className="space-y-2 mt-1">
              {tplOptionsHe.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    dir="rtl"
                    value={opt}
                    onChange={e => setTplOptionsHe(tplOptionsHe.map((o, j) => j === i ? e.target.value : o))}
                    className={inputCls}
                    placeholder={`אפשרות ${i + 1}`}
                  />
                  {tplOptionsHe.length > 2 && (
                    <button
                      type="button"
                      onClick={() => setTplOptionsHe(tplOptionsHe.filter((_, j) => j !== i))}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-400 hover:text-accent-red shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setTplOptionsHe([...tplOptionsHe, ''])}
                className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                <Plus className="w-3.5 h-3.5" /> הוספת אפשרות
              </button>
            </div>
            {tplQuestionEn.trim() && (
              <div className="space-y-2 mt-3">
                <label className="text-xs font-semibold text-ink-400">Options (English)</label>
                {tplOptionsHe.map((_, i) => (
                  <input
                    key={i}
                    value={tplOptionsEn[i] || ''}
                    onChange={e => {
                      const next = [...tplOptionsEn];
                      next[i] = e.target.value;
                      setTplOptionsEn(next);
                    }}
                    className={inputCls}
                    placeholder={`Option ${i + 1} (English)`}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-page/40 border border-page/40 p-3 flex items-center justify-between" dir="rtl">
            <span className="text-sm text-ink-700">פעיל</span>
            <Switch checked={tplActive} onChange={setTplActive} ariaLabel="פעיל" />
          </div>

          <Button className="w-full" onClick={saveTemplate} disabled={tplSaving}>
            {tplSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {tplSaving ? 'שומר...' : 'שמירה'}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
