'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Send, CheckCircle2, MessageSquare, Bug, Lightbulb, Dumbbell, MessageCircle, Camera, Images, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders } from '@/lib/api';
import { Card, Button, Spinner, Sheet, SegmentedControl, InsetSection, InsetRow } from '@/components/ui';

type FeedbackCategory = 'feature_request' | 'bug_report' | 'training_feedback' | 'general';

// Wraps a lucide icon so it keeps its own category color even inside
// SegmentedControl (whose track only colors the button's text, not the
// icon) — the one place the original per-category color-coding survives,
// per the design-system guidance to not reinvent the whole toggle.
function coloredIcon(Icon: React.ComponentType<{ className?: string }>, colorClass: string) {
  return function ColoredIcon({ className }: { className?: string }) {
    return <Icon className={cn(className, colorClass)} />;
  };
}

const categories = [
  { value: 'feature_request' as FeedbackCategory, labelKey: 'featureRequest' as const, icon: Lightbulb, color: 'text-purple-400' },
  { value: 'bug_report' as FeedbackCategory, labelKey: 'bugReport' as const, icon: Bug, color: 'text-red-400' },
  { value: 'training_feedback' as FeedbackCategory, labelKey: 'trainingFeedback' as const, icon: Dumbbell, color: 'text-blue-400' },
  { value: 'general' as FeedbackCategory, labelKey: 'general' as const, icon: MessageCircle, color: 'text-teal-400' },
];

export default function ReviewPage() {
  const t = useTranslations('review');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('general');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);
  const [athleteName, setAthleteName] = useState('');
  const [athleteEmail, setAthleteEmail] = useState('');
  const [athleteId, setAthleteId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAthleteName(localStorage.getItem('athlete_name') || '');
    setAthleteEmail(localStorage.getItem('athlete_email') || '');
    setAthleteId(localStorage.getItem('athlete_id') || '');

    const groupId = localStorage.getItem('athlete_group_id');
    if (groupId) {
      fetch('/api/groups')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const group = (data?.groups || data || []).find((g: any) => g.id === groupId);
          if (group?.name) setGroupName(group.name);
        })
        .catch(() => {});
    }
  }, []);

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSending(true);
    setError(false);
    try {
      // Identity (athlete, name, email, squad) is stamped server-side from the
      // session — the local athleteName/groupName below are only for the "filing
      // as …" line this screen shows.
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: await apiHeaders(true),
        body: JSON.stringify({
          message: message.trim(),
          category,
          image: imagePreview || undefined,
        }),
      });
      if (res.ok) {
        setSent(true);
        setMessage('');
        setCategory('general');
        setImagePreview(null);
        setTimeout(() => setSent(false), 4000);
      } else {
        // Non-2xx response — surface it instead of silently doing nothing.
        setError(true);
      }
    } catch {
      // Network error — same visible failure state as a non-2xx response.
      setError(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-600/10 border border-primary-600/20 mb-4">
          <MessageSquare className="h-7 w-7 text-primary-600" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-white">{t('title')}</h1>
        <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
          {t('subtitle')}
        </p>
      </div>

      <Card variant="muted" className="p-5 sm:p-6">
        <div className="mb-4">
          <label className="text-xs font-semibold text-slate-400 mb-2.5 block">{t('category')}</label>
          <SegmentedControl
            value={category}
            onChange={setCategory}
            options={categories.map((cat) => ({
              value: cat.value,
              label: t(cat.labelKey),
              icon: coloredIcon(cat.icon, cat.color),
            }))}
          />
        </div>

        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder={t('placeholder')}
          rows={6}
          className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-600/50 focus:border-primary-600/50 transition-all"
        />

        {imagePreview && (
          <div className="relative mt-3 inline-block">
            <img src={imagePreview} alt="Attached" className="max-h-32 rounded-lg border border-slate-700/50" />
            <button
              onClick={() => setImagePreview(null)}
              className="absolute -top-2 -end-2 min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-700 hover:bg-red-500 rounded-full transition-colors"
            >
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
        )}

        {/* Tap-to-open action sheet (Take Photo / Choose from Library) —
            replaces the old HTML drag-and-drop dropzone, which had no iOS
            equivalent. */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="mt-4 w-full flex items-center justify-center gap-2 px-5 py-4 min-h-[44px] rounded-xl border border-slate-700/50 bg-slate-800/40 hover:bg-slate-800/60 text-slate-200 hover:text-primary-400 transition-all"
        >
          <Camera className="h-5 w-5" />
          <span className="text-sm font-semibold">{imagePreview ? t('changeScreenshot') : t('attachScreenshot')}</span>
        </button>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />

        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-3">
            <p className="text-xs text-slate-500">
              <span className="text-slate-300 font-medium">{athleteName || t('anonymous')}</span>
              {groupName && <span className="text-slate-500"> · {groupName}</span>}
            </p>
          </div>
          <Button variant="primary" onClick={handleSubmit} disabled={!message.trim() || sending}>
            {sending ? <Spinner size={16} /> : <Send className="h-4 w-4" />}
            {t('send')}
          </Button>
        </div>

        {error && <p className="mt-4 text-sm text-red-400 text-center">{t('submitError')}</p>}

        {sent && (
          <div className="mt-4 flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 animate-fade-in">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            <span>{t('thankYou')}</span>
          </div>
        )}
      </Card>

      <Sheet open={pickerOpen} onOpenChange={setPickerOpen} title={t('attachScreenshot')}>
        <InsetSection>
          <InsetRow
            icon={Camera}
            iconBg="bg-primary-600"
            label={t('takePhoto')}
            onClick={() => { setPickerOpen(false); cameraInputRef.current?.click(); }}
          />
          <InsetRow
            icon={Images}
            iconBg="bg-slate-600"
            label={t('chooseFromLibrary')}
            onClick={() => { setPickerOpen(false); libraryInputRef.current?.click(); }}
          />
        </InsetSection>
      </Sheet>
    </div>
  );
}
