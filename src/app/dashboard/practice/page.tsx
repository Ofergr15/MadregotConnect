'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Dumbbell, Play, X, Pencil, Loader2, Check, Plus, Trash2 } from 'lucide-react';
import { Sheet, SegmentedControl, Button } from '@/components/ui';

interface Video {
  id: string;
  title: string;
  description: string;
  driveId: string;
  duration: string;
  category: string;
  thumbnail?: string;
}

// Seed list — mirrors the API DEFAULT. Shown instantly while the real list
// loads (and if the fetch fails). Coaches edit the live list, stored server-side.
const SEED: Video[] = [
  { id: '1', title: 'Leg Workout', description: 'Leg strengthening exercises for runners.', driveId: '1tIoIaxDizlgRsNL0H5VK5HdJ2Cw4YBlc', duration: '—', category: 'Strength' },
  { id: '2', title: 'Leg Strength - Squats & Lunges', description: 'Build running-specific leg strength with bodyweight squats, lunges, and single-leg exercises.', driveId: 'PLACEHOLDER_DRIVE_ID_2', duration: '12 min', category: 'Strength' },
  { id: '3', title: 'Calf Raises & Ankle Stability', description: 'Strengthen calves and improve ankle stability for better running form and injury prevention.', driveId: 'PLACEHOLDER_DRIVE_ID_3', duration: '8 min', category: 'Strength' },
  { id: '4', title: 'Hip & Glute Activation', description: 'Activate glutes and hip stabilizers. Essential for maintaining form during long runs.', driveId: 'PLACEHOLDER_DRIVE_ID_4', duration: '10 min', category: 'Activation' },
  { id: '5', title: 'Post-Run Recovery Stretch', description: 'Cool down routine targeting quads, hamstrings, hip flexors, and calves after a run.', driveId: 'PLACEHOLDER_DRIVE_ID_5', duration: '7 min', category: 'Recovery' },
  { id: '6', title: 'Plyometrics - Jump Training', description: 'Explosive jump exercises to build power and running speed. Box jumps, bounds, and hops.', driveId: 'PLACEHOLDER_DRIVE_ID_6', duration: '15 min', category: 'Power' },
];

const categoryKeys = ['All', 'Strength', 'Activation', 'Recovery', 'Power'];
const editableCategories = ['Strength', 'Activation', 'Recovery', 'Power'];

const isPlaceholder = (driveId: string) => !driveId || driveId.startsWith('PLACEHOLDER');

export default function PracticePage() {
  const t = useTranslations('practice');
  const [videos, setVideos] = useState<Video[]>(SEED);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [filter, setFilter] = useState('All');
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    // Coaches/approvers may edit the library. Gate uses the same client-side
    // signal as the Program page (a coach_email in localStorage); the actual
    // write is authorized server-side via canApprove.
    setCanEdit(!!localStorage.getItem('coach_email'));
    fetch('/api/practice-videos')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d?.videos) && d.videos.length) setVideos(d.videos); })
      .catch(() => {});
  }, []);

  const filtered = filter === 'All' ? videos : videos.filter(v => v.category === filter);

  if (editing) {
    return <VideoEditor initial={videos} onDone={(next) => { if (next) setVideos(next); setEditing(false); }} t={t} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Dumbbell className="h-6 w-6 text-primary-400" />
            {t('title')}
          </h1>
          <p className="text-slate-400 mt-1">{t('subtitle')}</p>
        </div>
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:text-white transition-colors shrink-0"
          >
            <Pencil className="h-4 w-4" /> {t('editVideos')}
          </button>
        )}
      </div>

      {/* Category Filter */}
      <SegmentedControl
        value={filter}
        onChange={setFilter}
        options={categoryKeys.map(cat => ({ value: cat, label: t(cat.toLowerCase() as any) }))}
      />

      {/* Video Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(video => (
          <div
            key={video.id}
            onClick={() => setSelectedVideo(video)}
            className="bg-slate-800/50 rounded-2xl border border-slate-700/30 overflow-hidden hover:border-slate-600 hover:shadow-lg active:scale-[0.98] transition-all group cursor-pointer"
          >
            {/* Thumbnail / Play area */}
            <div className="relative overflow-hidden bg-slate-900 aspect-video flex items-center justify-center">
              {isPlaceholder(video.driveId) ? (
                <>
                  <div className="absolute inset-0 bg-gradient-to-br from-slate-800/60 to-slate-900/90" />
                  <span className="relative text-2xs font-bold px-2.5 py-1 rounded-full bg-slate-700/70 text-slate-300 uppercase tracking-wider">
                    {t('videoComingSoon')}
                  </span>
                </>
              ) : (
                <>
                  <img
                    src={`https://drive.google.com/thumbnail?id=${video.driveId}&sz=w480`}
                    alt="" referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover opacity-70"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-br from-primary-900/40 to-slate-900/80" />
                  <div className="relative w-14 h-14 bg-primary-600/80 rounded-full flex items-center justify-center group-hover:scale-110 group-hover:bg-primary-600 transition-all shadow-lg">
                    <Play className="h-6 w-6 text-white ms-0.5" />
                  </div>
                </>
              )}
              <span className="absolute bottom-2 start-2 text-xs font-bold px-2 py-1 rounded bg-black/60 text-white">
                {video.duration}
              </span>
              <span className="absolute top-2 end-2 text-xs font-medium px-2 py-1 rounded bg-primary-600/80 text-white">
                {video.category}
              </span>
            </div>

            {/* Content */}
            <div className="p-4">
              <h3 className="text-sm font-bold text-white group-hover:text-primary-300 transition-colors line-clamp-2">
                {video.title}
              </h3>
              <p className="text-xs text-slate-400 mt-2 line-clamp-2">
                {video.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Video Player Sheet */}
      <Sheet
        open={!!selectedVideo}
        onOpenChange={(o) => { if (!o) setSelectedVideo(null); }}
        title={selectedVideo ? `${selectedVideo.title} · ${selectedVideo.duration}` : undefined}
        bodyClassName="px-0 pb-0"
      >
        {selectedVideo && (
          <>
            <div className="aspect-video bg-black">
              {isPlaceholder(selectedVideo.driveId) ? (
                <div className="w-full h-full flex items-center justify-center text-slate-500">
                  <div className="text-center">
                    <Dumbbell className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">{t('videoComingSoon')}</p>
                  </div>
                </div>
              ) : (
                <iframe
                  src={`https://drive.google.com/file/d/${selectedVideo.driveId}/preview`}
                  className="w-full h-full"
                  allow="autoplay; encrypted-media"
                  allowFullScreen
                />
              )}
            </div>
            <div className="p-4">
              <p className="text-sm text-slate-300">{selectedVideo.description}</p>
            </div>
          </>
        )}
      </Sheet>
    </div>
  );
}

// Coach-only editor: swap in real Google Drive file IDs, edit titles/durations,
// add or remove videos. Saves the whole list to the server (canApprove-gated).
function VideoEditor({ initial, onDone, t }: { initial: Video[]; onDone: (next: Video[] | null) => void; t: (k: string) => string }) {
  const [rows, setRows] = useState<Video[]>(initial.map(v => ({ ...v })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setRow = (i: number, patch: Partial<Video>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => setRows(rows.filter((_, j) => j !== i));
  const add = () =>
    setRows([...rows, { id: `new-${rows.length + 1}`, title: '', description: '', driveId: '', duration: '—', category: 'Strength' }]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const actorEmail = localStorage.getItem('coach_email') || localStorage.getItem('athlete_email') || '';
      const res = await fetch('/api/practice-videos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videos: rows, actorEmail }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error || 'Save failed'); return; }
      onDone(data.videos as Video[]);
    } catch {
      setError('Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Pencil className="h-5 w-5 text-primary-400" /> {t('editVideos')}
        </h1>
        <Button variant="ghost" size="md" onClick={() => onDone(null)}>
          <X className="h-5 w-5" />
        </Button>
      </div>
      <p className="text-sm text-slate-400">{t('editVideosHint')}</p>

      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border border-slate-700 bg-slate-800/50 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={r.title} onChange={e => setRow(i, { title: e.target.value })}
                placeholder={t('videoTitle')}
                className="flex-1 bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
              />
              <Button variant="danger" size="md" onClick={() => remove(i)} className="shrink-0">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <input
              value={r.driveId} onChange={e => setRow(i, { driveId: e.target.value.trim() })}
              placeholder={t('driveIdPlaceholder')}
              dir="ltr"
              className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 font-mono"
            />
            <SegmentedControl
              value={editableCategories.includes(r.category) ? r.category : 'Strength'}
              onChange={(v) => setRow(i, { category: v })}
              options={editableCategories.map(c => ({ value: c, label: t(c.toLowerCase()) }))}
            />
            <div className="flex items-center gap-2">
              <input
                value={r.duration} onChange={e => setRow(i, { duration: e.target.value })}
                placeholder={t('duration')}
                className="w-24 bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
              />
              {!isPlaceholder(r.driveId) && <span className="flex items-center text-xs text-emerald-400 gap-1"><Check className="h-3.5 w-3.5" /> Drive</span>}
            </div>
            <textarea
              value={r.description} onChange={e => setRow(i, { description: e.target.value })}
              placeholder={t('videoDescription')} rows={2}
              className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
            />
          </div>
        ))}
      </div>

      <Button variant="ghost" size="md" onClick={add} className="self-start">
        <Plus className="h-4 w-4" /> {t('addVideo')}
      </Button>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2 pt-2">
        <Button variant="primary" size="lg" onClick={save} disabled={saving} className="flex-1">
          {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />} {t('saveVideos')}
        </Button>
        <Button variant="secondary" size="lg" onClick={() => onDone(null)}>{t('cancel')}</Button>
      </div>
    </div>
  );
}
