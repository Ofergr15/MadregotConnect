'use client';

import { useState } from 'react';
import { Dumbbell, Play, X, ChevronDown } from 'lucide-react';

interface Video {
  id: string;
  title: string;
  description: string;
  driveId: string;
  duration: string;
  category: string;
  thumbnail?: string;
}

const videos: Video[] = [
  {
    id: '1',
    title: 'Warm Up - Dynamic Stretching',
    description: 'Full body dynamic warm-up routine before running. Focuses on hip mobility, leg swings, and activation.',
    driveId: 'PLACEHOLDER_DRIVE_ID_1',
    duration: '5 min',
    category: 'Warm Up',
  },
  {
    id: '2',
    title: 'Leg Strength - Squats & Lunges',
    description: 'Build running-specific leg strength with bodyweight squats, lunges, and single-leg exercises.',
    driveId: 'PLACEHOLDER_DRIVE_ID_2',
    duration: '12 min',
    category: 'Strength',
  },
  {
    id: '3',
    title: 'Calf Raises & Ankle Stability',
    description: 'Strengthen calves and improve ankle stability for better running form and injury prevention.',
    driveId: 'PLACEHOLDER_DRIVE_ID_3',
    duration: '8 min',
    category: 'Strength',
  },
  {
    id: '4',
    title: 'Hip & Glute Activation',
    description: 'Activate glutes and hip stabilizers. Essential for maintaining form during long runs.',
    driveId: 'PLACEHOLDER_DRIVE_ID_4',
    duration: '10 min',
    category: 'Activation',
  },
  {
    id: '5',
    title: 'Post-Run Recovery Stretch',
    description: 'Cool down routine targeting quads, hamstrings, hip flexors, and calves after a run.',
    driveId: 'PLACEHOLDER_DRIVE_ID_5',
    duration: '7 min',
    category: 'Recovery',
  },
  {
    id: '6',
    title: 'Plyometrics - Jump Training',
    description: 'Explosive jump exercises to build power and running speed. Box jumps, bounds, and hops.',
    driveId: 'PLACEHOLDER_DRIVE_ID_6',
    duration: '15 min',
    category: 'Power',
  },
];

const categories = ['All', ...Array.from(new Set(videos.map(v => v.category)))];

export default function PracticePage() {
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [filter, setFilter] = useState('All');

  const filtered = filter === 'All' ? videos : videos.filter(v => v.category === filter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Dumbbell className="h-6 w-6 text-primary-400" />
            Practice
          </h1>
          <p className="text-slate-400 mt-1">Leg workouts and exercises to complement your running</p>
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex gap-2 flex-wrap">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === cat
                ? 'bg-primary-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Video Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(video => (
          <div
            key={video.id}
            onClick={() => setSelectedVideo(video)}
            className="bg-slate-800/50 rounded-2xl border border-slate-700/30 overflow-hidden hover:border-slate-600 hover:shadow-lg transition-all group cursor-pointer"
          >
            {/* Thumbnail / Play area */}
            <div className="relative overflow-hidden bg-slate-900 aspect-video flex items-center justify-center">
              <div className="absolute inset-0 bg-gradient-to-br from-primary-900/40 to-slate-900/80" />
              <div className="relative w-14 h-14 bg-primary-600/80 rounded-full flex items-center justify-center group-hover:scale-110 group-hover:bg-primary-600 transition-all shadow-lg">
                <Play className="h-6 w-6 text-white ml-0.5" />
              </div>
              <span className="absolute bottom-2 left-2 text-xs font-bold px-2 py-1 rounded bg-black/60 text-white">
                {video.duration}
              </span>
              <span className="absolute top-2 right-2 text-xs font-medium px-2 py-1 rounded bg-primary-600/80 text-white">
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

      {/* Video Player Modal */}
      {selectedVideo && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-4xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700">
              <div>
                <h2 className="text-lg font-bold text-white">{selectedVideo.title}</h2>
                <p className="text-sm text-slate-400 mt-0.5">{selectedVideo.category} &middot; {selectedVideo.duration}</p>
              </div>
              <button
                onClick={() => setSelectedVideo(null)}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X className="h-5 w-5 text-slate-400" />
              </button>
            </div>

            {/* Video Embed */}
            <div className="aspect-video bg-black">
              {selectedVideo.driveId.startsWith('PLACEHOLDER') ? (
                <div className="w-full h-full flex items-center justify-center text-slate-500">
                  <div className="text-center">
                    <Dumbbell className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">Video coming soon</p>
                    <p className="text-xs mt-1 text-slate-600">Replace driveId with Google Drive file ID</p>
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

            {/* Description */}
            <div className="p-4 border-t border-slate-700">
              <p className="text-sm text-slate-300">{selectedVideo.description}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
