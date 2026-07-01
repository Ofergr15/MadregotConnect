'use client';

import { useState, useEffect, useRef } from 'react';
import { Send, CheckCircle2, MessageSquare, Bug, Lightbulb, Dumbbell, MessageCircle, Camera, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type FeedbackCategory = 'feature_request' | 'bug_report' | 'training_feedback' | 'general';

const categories = [
  { value: 'feature_request' as FeedbackCategory, label: 'Feature Request', icon: Lightbulb, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
  { value: 'bug_report' as FeedbackCategory, label: 'Bug Report', icon: Bug, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  { value: 'training_feedback' as FeedbackCategory, label: 'Training Feedback', icon: Dumbbell, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  { value: 'general' as FeedbackCategory, label: 'General', icon: MessageCircle, color: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/30' },
];

export default function ReviewPage() {
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('general');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [athleteName, setAthleteName] = useState('');
  const [athleteEmail, setAthleteEmail] = useState('');
  const [athleteId, setAthleteId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athleteId,
          athleteName,
          athleteEmail,
          groupName,
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
      }
    } catch {
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#4338ff]/10 border border-[#4338ff]/20 mb-4">
          <MessageSquare className="h-7 w-7 text-[#4338ff]" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-white">Feedback & Suggestions</h1>
        <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
          Share your thoughts, ideas, or anything you&apos;d like to improve in the training experience.
        </p>
      </div>

      <div className="bg-slate-800/40 rounded-2xl border border-slate-700/30 p-5 sm:p-6">
        <div className="mb-4">
          <label className="text-xs font-semibold text-slate-400 mb-2.5 block">Category</label>
          <div className="grid grid-cols-2 gap-2">
            {categories.map(cat => {
              const Icon = cat.icon;
              const isSelected = category === cat.value;
              return (
                <button
                  key={cat.value}
                  onClick={() => setCategory(cat.value)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all',
                    isSelected
                      ? `${cat.bg} ${cat.border} ${cat.color}`
                      : 'bg-slate-900/30 border-slate-700/30 text-slate-500 hover:border-slate-600 hover:text-slate-400'
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="What's on your mind? Training feedback, feature ideas, anything..."
          rows={6}
          className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#4338ff]/50 focus:border-[#4338ff]/50 transition-all"
        />

        {imagePreview && (
          <div className="relative mt-3 inline-block">
            <img src={imagePreview} alt="Attached" className="max-h-32 rounded-lg border border-slate-700/50" />
            <button
              onClick={() => setImagePreview(null)}
              className="absolute -top-2 -right-2 w-5 h-5 bg-slate-700 hover:bg-red-500 rounded-full flex items-center justify-center transition-colors"
            >
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'mt-4 w-full flex flex-col items-center justify-center gap-2 px-5 py-6 rounded-xl border-2 border-dashed cursor-pointer transition-all',
            dragging
              ? 'border-[#4338ff] bg-[#4338ff]/10 text-[#4338ff]'
              : 'border-slate-500/60 hover:border-[#4338ff] text-slate-200 hover:text-[#4338ff] bg-slate-800/40 hover:bg-[#4338ff]/5'
          )}
        >
          <Camera className="h-8 w-8" />
          <span className="text-lg font-semibold">{imagePreview ? 'Change Screenshot' : 'Attach a Screenshot'}</span>
          <span className="text-xs text-slate-500">Drag & drop an image here or tap to browse</span>
        </div>
        <input
          ref={fileInputRef}
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
              <span className="text-slate-300 font-medium">{athleteName || 'Anonymous'}</span>
              {groupName && <span className="text-slate-500"> · {groupName}</span>}
            </p>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!message.trim() || sending}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all',
              message.trim() && !sending
                ? 'bg-[#4338ff] hover:bg-[#3730d4] text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            )}
          >
            {sending ? (
              <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send
          </button>
        </div>

        {sent && (
          <div className="mt-4 flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            <span>Thank you! Your feedback has been submitted.</span>
          </div>
        )}
      </div>
    </div>
  );
}
