'use client';

import { useState, useEffect } from 'react';
import { Send, CheckCircle2, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ReviewPage() {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [athleteName, setAthleteName] = useState('');
  const [athleteEmail, setAthleteEmail] = useState('');
  const [athleteId, setAthleteId] = useState('');
  const [groupName, setGroupName] = useState('');

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
        }),
      });
      if (res.ok) {
        setSent(true);
        setMessage('');
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
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="What's on your mind? Training feedback, feature ideas, anything..."
          rows={6}
          className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#4338ff]/50 focus:border-[#4338ff]/50 transition-all"
        />

        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-slate-500">
            Submitting as <span className="text-slate-300 font-medium">{athleteName || 'Anonymous'}</span>
            {groupName && <span className="text-slate-500"> · {groupName}</span>}
          </p>
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
