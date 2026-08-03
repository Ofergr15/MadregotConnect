'use client';

import { useState, useEffect, useRef } from 'react';
import { Image, Upload, Search, Eye, Loader2, CheckCircle2, AlertCircle, X, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { authedFetch } from '@/lib/auth/authed-fetch';
import { getSupabase } from '@/lib/supabase/client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DetectedFace {
  id: string;
  crop_url: string | null;
  confidence: number | null;
  source: string;
  run_photos?: {
    id: string;
    drive_url: string;
    thumbnail_url: string | null;
    run_date: string;
    taken_at: string | null;
  } | null;
  athletes?: { id: string; name: string; email: string } | null;
}

interface UnidentifiedFace {
  id: string;
  crop_url: string | null;
  bounding_box: object | null;
  run_photos?: {
    id: string;
    drive_url: string;
    thumbnail_url: string | null;
    run_date: string;
  } | null;
}

interface Athlete {
  id: string;
  name: string;
  email: string;
}

const STAFF_ROLES = ['admin', 'coach', 'academy_coach'];

export default function PhotosPage() {
  const [userEmail, setUserEmail] = useState('');
  const [userRole, setUserRole] = useState<string | null>(null);
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);

  // Tab state — deep-link via ?tab=
  const isStaff = userRole ? STAFF_ROLES.includes(userRole) : false;
  type Tab = 'import' | 'unknown' | 'browse' | 'my';
  const [tab, setTab] = useState<Tab>('my');

  useEffect(() => {
    // Get email from session (Google OAuth)
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const email = session?.user?.email || localStorage.getItem('athlete_email') || '';
      if (email) setUserEmail(email);
      const id = session?.user?.id || localStorage.getItem('athlete_id') || '';
      if (id) setAthleteId(id);
    });

    const paramTab = new URLSearchParams(window.location.search).get('tab');
    const valid: Tab[] = ['import', 'unknown', 'browse', 'my'];
    if (paramTab && valid.includes(paramTab as Tab)) setTab(paramTab as Tab);
  }, []);

  useEffect(() => {
    if (!userEmail) return;
    fetch('/api/auth/me', { headers: { 'x-user-email': userEmail } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.role) setUserRole(d.role); })
      .catch(() => {})
      .finally(() => setRoleLoaded(true));
  }, [userEmail]);

  // Get the athleteId from the DB too (localStorage id may be Supabase auth UUID, not our athletes.id)
  useEffect(() => {
    if (!userEmail) return;
    const supabase = getSupabase();
    supabase.from('athletes').select('id').ilike('email', userEmail).maybeSingle()
      .then(({ data }) => { if (data?.id) setAthleteId(data.id); });
  }, [userEmail]);

  if (!roleLoaded) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  const staffTabs = [
    { key: 'import' as Tab, label: 'Import', icon: Upload },
    { key: 'unknown' as Tab, label: 'Unknown Faces', icon: Search },
    { key: 'browse' as Tab, label: 'Browse', icon: Eye },
    { key: 'my' as Tab, label: 'My Photos', icon: Image },
  ];
  const athleteTabs = [
    { key: 'my' as Tab, label: 'My Photos', icon: Image },
  ];
  const tabs = isStaff ? staffTabs : athleteTabs;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Image className="w-6 h-6 text-indigo-400" />
        <h1 className="text-2xl font-bold text-white">Photos</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-white/10 pb-0">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors',
              tab === key
                ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10'
                : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
            )}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'import' && isStaff && <ImportTab />}
      {tab === 'unknown' && isStaff && <UnknownFacesTab />}
      {tab === 'browse' && isStaff && <BrowseTab />}
      {tab === 'my' && <MyPhotosTab athleteId={athleteId} />}
    </div>
  );
}

// ─── Import Tab ───────────────────────────────────────────────────────────────

interface RunFolder { id: string; name: string; date: string }

function ImportTab() {
  const [folders, setFolders] = useState<RunFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [selectedFolder, setSelectedFolder] = useState<RunFolder | null>(null);
  const [status, setStatus] = useState<'idle' | 'importing' | 'processing' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    authedFetch('/api/photos/drive-dates')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.folders) setFolders(d.folders); })
      .catch(() => {})
      .finally(() => setFoldersLoading(false));
  }, []);

  const run = async () => {
    if (!selectedFolder) return;
    setStatus('importing');
    setErrorMsg('');
    setProgress({ done: 0, total: 0 });

    try {
      // 1. Import metadata from Drive
      const importRes = await authedFetch('/api/photos/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: selectedFolder.id, folderName: selectedFolder.name }),
      });
      const importData = await importRes.json();
      if (!importRes.ok) throw new Error(importData.error || 'Import failed');

      const { photoIds } = importData as { photoIds: string[] };
      if (photoIds.length === 0) {
        setStatus('done');
        return;
      }

      // 2. Process one photo at a time (Vercel 300s ceiling)
      setStatus('processing');
      setProgress({ done: 0, total: photoIds.length });

      for (let i = 0; i < photoIds.length; i++) {
        await authedFetch('/api/photos/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photoId: photoIds[i] }),
        });
        setProgress({ done: i + 1, total: photoIds.length });
      }

      setStatus('done');
    } catch (err: unknown) {
      setErrorMsg(String(err));
      setStatus('error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white/5 rounded-xl p-6 border border-white/10">
        <h2 className="text-lg font-semibold text-white mb-4">Import from Google Drive</h2>

        {foldersLoading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading runs...
          </div>
        ) : folders.length === 0 ? (
          <p className="text-slate-400">No run folders found in Drive.</p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-2">Select run</label>
              <select
                value={selectedFolder?.id ?? ''}
                onChange={e => {
                  const f = folders.find(x => x.id === e.target.value) ?? null;
                  setSelectedFolder(f);
                  setStatus('idle');
                }}
                className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm min-w-[260px]"
              >
                <option value="">Choose a run...</option>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>{f.name} ({f.date})</option>
                ))}
              </select>
            </div>

            <button
              onClick={run}
              disabled={!selectedFolder || status === 'importing' || status === 'processing'}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors',
                status === 'idle' || status === 'done' || status === 'error'
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  : 'bg-white/10 text-slate-400 cursor-not-allowed'
              )}
            >
              {(status === 'importing' || status === 'processing') ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {status === 'importing' && 'Importing...'}
              {status === 'processing' && `Processing ${progress.done}/${progress.total}...`}
              {(status === 'idle' || status === 'done' || status === 'error') && 'Import & Process'}
            </button>

            {/* Progress bar */}
            {status === 'processing' && progress.total > 0 && (
              <div className="space-y-1">
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all duration-300"
                    style={{ width: `${(progress.done / progress.total) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400">
                  {progress.done} of {progress.total} photos processed
                </p>
              </div>
            )}

            {status === 'done' && (
              <div className="flex items-center gap-2 text-green-400 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                Done! {progress.total} photos processed.
              </div>
            )}

            {status === 'error' && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                {errorMsg}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Unknown Faces Tab ────────────────────────────────────────────────────────

function UnknownFacesTab() {
  const [faces, setFaces] = useState<UnidentifiedFace[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [labeling, setLabeling] = useState<string | null>(null);
  const [athleteSearch, setAthleteSearch] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      authedFetch('/api/photos').then(r => r.ok ? r.json() : { unidentified: [] }),
      fetch('/api/athletes').then(r => r.ok ? r.json() : { athletes: [] }),
    ]).then(([photosData, athletesData]) => {
      setFaces(photosData.unidentified || []);
      setAthletes(athletesData.athletes || []);
    }).finally(() => setLoading(false));
  }, []);

  const label = async (faceId: string, selectedAthleteId: string) => {
    if (!selectedAthleteId) return;
    setLabeling(faceId);
    try {
      const res = await authedFetch('/api/photos/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faceId, athleteId: selectedAthleteId }),
      });
      if (res.ok) {
        setFaces(prev => prev.filter(f => f.id !== faceId));
        setSaved(s => new Set([...s, faceId]));
      }
    } finally {
      setLabeling(null);
    }
  };

  const filteredAthletes = (faceId: string) => {
    const q = (athleteSearch[faceId] || '').toLowerCase();
    return athletes.filter(a =>
      !q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)
    );
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-indigo-400" /></div>;

  if (faces.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-400/60" />
        <p>No unidentified faces — everyone is tagged!</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-slate-400 text-sm mb-4">{faces.length} unidentified face{faces.length !== 1 ? 's' : ''}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {faces.map(face => (
          <div key={face.id} className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
            <div className="aspect-square relative">
              {face.crop_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={face.crop_url} alt="Unknown face" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/5">
                  <Search className="w-8 h-8 text-slate-600" />
                </div>
              )}
              {face.run_photos?.run_date && (
                <span className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                  {face.run_photos.run_date}
                </span>
              )}
            </div>
            <div className="p-2 space-y-1.5">
              <input
                type="text"
                placeholder="Search athlete..."
                value={athleteSearch[face.id] || ''}
                onChange={e => setAthleteSearch(s => ({ ...s, [face.id]: e.target.value }))}
                className="w-full bg-white/10 border border-white/20 rounded text-xs px-2 py-1 text-white placeholder-slate-500"
              />
              <select
                onChange={e => label(face.id, e.target.value)}
                defaultValue=""
                disabled={labeling === face.id}
                className="w-full bg-white/10 border border-white/20 rounded text-xs px-2 py-1 text-white"
              >
                <option value="">Tag as...</option>
                {filteredAthletes(face.id).slice(0, 20).map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
              {labeling === face.id && (
                <div className="flex justify-center"><Loader2 className="w-3 h-3 animate-spin text-indigo-400" /></div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Browse Tab ───────────────────────────────────────────────────────────────

function BrowseTab() {
  const [runDate, setRunDate] = useState('');
  const [folders, setFolders] = useState<RunFolder[]>([]);
  const [photos, setPhotos] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    authedFetch('/api/photos/drive-dates')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.folders) setFolders(d.folders); })
      .catch(() => {});
  }, []);

  // Unique imported run_dates from DB
  const [importedDates, setImportedDates] = useState<string[]>([]);
  useEffect(() => {
    authedFetch('/api/photos?importedDates=1')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.dates) setImportedDates(d.dates); })
      .catch(() => {});
  }, []);

  const load = async (d: string) => {
    if (!d) return;
    setRunDate(d);
    setLoading(true);
    try {
      const res = await authedFetch(`/api/photos?date=${d}`);
      const data = await res.json();
      setPhotos(data.photos || []);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-slate-300 mb-2">Select imported run</label>
        <select
          value={runDate}
          onChange={e => load(e.target.value)}
          className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm min-w-[200px]"
        >
          <option value="">Choose a run date...</option>
          {importedDates.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-400" /></div>}

      {!loading && runDate && photos.length === 0 && (
        <p className="text-slate-400">No photos imported for this date.</p>
      )}

      {!loading && photos.length > 0 && (
        <PhotoGrid photos={photos as PhotoItem[]} showTags />
      )}
    </div>
  );
}

// ─── My Photos Tab ────────────────────────────────────────────────────────────

function MyPhotosTab({ athleteId }: { athleteId: string | null }) {
  const [faces, setFaces] = useState<DetectedFace[]>([]);
  const [loading, setLoading] = useState(false);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [uploadError, setUploadError] = useState('');

  const loadMyPhotos = async (id: string) => {
    setLoading(true);
    try {
      const res = await authedFetch(`/api/photos?athleteId=${id}`);
      const data = await res.json();
      setFaces(data.faces || []);
    } finally {
      setLoading(false);
    }
  };

  const loadSelfie = async (id: string) => {
    // Try to get the signed URL for the reference face photo
    try {
      const res = await authedFetch(`/api/photos/selfie-url?athleteId=${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelfieUrl(data.url || null);
      }
    } catch { /* no selfie */ }
  };

  useEffect(() => {
    if (athleteId) {
      loadMyPhotos(athleteId);
      loadSelfie(athleteId);
    }
  }, [athleteId]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg('');
    setUploadError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await authedFetch('/api/photos/enroll-selfie', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || 'Upload failed');
      } else {
        setUploadMsg(`Selfie enrolled! Found ${data.photosFound ?? 0} photo${data.photosFound !== 1 ? 's' : ''} of you.`);
        if (athleteId) {
          loadMyPhotos(athleteId);
          loadSelfie(athleteId);
        }
      }
    } catch (err: unknown) {
      setUploadError(String(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Selfie section */}
      <div className="bg-white/5 rounded-xl border border-white/10 p-5">
        <h2 className="text-base font-semibold text-white mb-1">Your Reference Photo</h2>
        <p className="text-sm text-slate-400 mb-4">
          Upload a clear front-facing photo. We&apos;ll use it to find you in run photos automatically.
        </p>
        <div className="flex items-start gap-4">
          {selfieUrl ? (
            <img
              src={selfieUrl}
              alt="Your selfie"
              className="w-20 h-20 rounded-full object-cover border-2 border-indigo-500/50"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center border-2 border-dashed border-white/20">
              <Image className="w-8 h-8 text-slate-500" />
            </div>
          )}
          <div className="flex-1 space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Uploading...' : selfieUrl ? 'Replace selfie' : 'Upload selfie'}
            </button>
            {uploadMsg && (
              <p className="text-green-400 text-sm flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> {uploadMsg}
              </p>
            )}
            {uploadError && (
              <p className="text-red-400 text-sm flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" /> {uploadError}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* My photos grid */}
      <div>
        <h2 className="text-base font-semibold text-white mb-3">
          My Photos {faces.length > 0 && <span className="text-slate-400 font-normal text-sm">({faces.length})</span>}
        </h2>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-indigo-400" /></div>
        ) : faces.length === 0 ? (
          <div className="text-center py-10 text-slate-400 bg-white/3 rounded-xl border border-white/10">
            <Image className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>No photos of you yet.</p>
            <p className="text-sm mt-1">Upload a selfie above to find your photos automatically.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {faces.map(face => (
              <a
                key={face.id}
                href={face.run_photos?.drive_url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative bg-white/5 rounded-xl overflow-hidden border border-white/10 hover:border-indigo-500/40 transition-colors"
              >
                {face.crop_url ? (
                  <img
                    src={face.crop_url}
                    alt="You in a run photo"
                    className="w-full aspect-square object-cover"
                  />
                ) : (
                  <div className="w-full aspect-square bg-white/5 flex items-center justify-center">
                    <Image className="w-8 h-8 text-slate-600" />
                  </div>
                )}
                <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1">
                  <p className="text-xs text-white/80">{face.run_photos?.run_date}</p>
                  {face.confidence && (
                    <p className="text-xs text-indigo-300">{Math.round(face.confidence)}% match</p>
                  )}
                </div>
                {face.source === 'manual' && (
                  <span className="absolute top-1.5 left-1.5 bg-indigo-600/80 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                    <Tag className="w-2.5 h-2.5" /> Tagged
                  </span>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PhotoGrid ────────────────────────────────────────────────────────────────

interface PhotoItem {
  id: string;
  drive_url: string;
  thumbnail_url: string | null;
  run_date: string;
  faces_detected: number | null;
  processed_at: string | null;
  detected_faces?: Array<{
    id: string;
    athlete_id: string | null;
    crop_url: string | null;
    athletes?: { name: string } | null;
  }>;
}

function PhotoGrid({ photos, showTags }: { photos: PhotoItem[]; showTags?: boolean }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {photos.map(photo => {
        const tags = (photo.detected_faces || []).filter(f => f.athlete_id);
        return (
          <a
            key={photo.id}
            href={photo.drive_url}
            target="_blank"
            rel="noopener noreferrer"
            className="group relative block bg-white/5 rounded-xl overflow-hidden border border-white/10 hover:border-indigo-500/40 transition-colors"
          >
            <div className="aspect-square">
              {photo.thumbnail_url ? (
                <img src={photo.thumbnail_url} alt="Run photo" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-white/5">
                  <Image className="w-8 h-8 text-slate-600" />
                </div>
              )}
            </div>
            {/* Status overlay */}
            <div className="absolute bottom-0 inset-x-0 bg-black/60 px-2 py-1.5">
              <p className="text-xs text-white/70">{photo.run_date}</p>
              {photo.processed_at ? (
                <p className="text-xs text-indigo-300">
                  {photo.faces_detected ?? 0} face{photo.faces_detected !== 1 ? 's' : ''}
                </p>
              ) : (
                <p className="text-xs text-slate-500">Not processed</p>
              )}
            </div>
            {/* Tag chips */}
            {showTags && tags.length > 0 && (
              <div className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
                {tags.slice(0, 3).map(f => (
                  <span key={f.id} className="bg-indigo-600/80 text-white text-xs px-1.5 py-0.5 rounded">
                    {f.athletes?.name?.split(' ')[0] ?? '?'}
                  </span>
                ))}
                {tags.length > 3 && (
                  <span className="bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                    +{tags.length - 3}
                  </span>
                )}
              </div>
            )}
          </a>
        );
      })}
    </div>
  );
}
