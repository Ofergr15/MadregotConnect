'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { MapPin, Calendar, Route, Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Race {
  id: string;
  name: string;
  date: string;
  location: string;
  lat: number;
  lng: number;
  distances: string[];
  daysUntil: number;
  website?: string;
  type: 'marathon' | 'half' | 'ultra' | '10k' | '5k' | 'trail';
}

const UPCOMING_RACES: Race[] = [
  {
    id: '1', name: '5 ק"מ הרצליה', date: '2026-09-04',
    location: 'הרצליה פארק', lat: 32.1600, lng: 34.8100,
    distances: ['5km'], daysUntil: 0,
    type: '5k',
  },
  {
    id: '2', name: 'מרוץ פארק הירקון', date: '2026-10-09',
    location: 'תל אביב, פארק הירקון', lat: 32.0971, lng: 34.8072,
    distances: ['21.1km', '10km'], daysUntil: 0,
    type: 'half',
  },
  {
    id: '3', name: 'חצי מרתון עמק החולה', date: '2026-10-30',
    location: 'עמק החולה', lat: 33.0667, lng: 35.6000,
    distances: ['21.1km', '10km'], daysUntil: 0,
    type: 'half',
  },
  {
    id: '4', name: 'מרוץ אייל', date: '2026-11-14',
    location: 'אזור אייל, שרון', lat: 32.2100, lng: 34.9500,
    distances: ['21.1km', '10km'], daysUntil: 0,
    type: 'half',
  },
  {
    id: '5', name: 'מרתון ולנסיה \'26', date: '2026-12-06',
    location: 'Valencia, Spain', lat: 39.4699, lng: -0.3763,
    distances: ['42.2km', '21.1km', '10km'], daysUntil: 0,
    type: 'marathon', website: 'https://www.valenciaciudaddelrunning.com',
  },
];

const typeColors: Record<string, { bg: string; text: string; dot: string }> = {
  marathon: { bg: 'bg-purple-500/15', text: 'text-purple-400', dot: '#a855f7' },
  half: { bg: 'bg-blue-500/15', text: 'text-blue-400', dot: '#3b82f6' },
  ultra: { bg: 'bg-red-500/15', text: 'text-red-400', dot: '#ef4444' },
  '10k': { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: '#10b981' },
  '5k': { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: '#f59e0b' },
  trail: { bg: 'bg-green-500/15', text: 'text-green-400', dot: '#22c55e' },
};

const typeLabelKeys: Record<string, string> = {
  marathon: 'marathon', half: 'half', ultra: 'ultra',
  '10k': '10k', '5k': '5k', trail: 'trail',
};

function computeDaysUntil(dateStr: string): number {
  const raceDate = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((raceDate.getTime() - now.getTime()) / 86400000);
}

export default function RacesPage() {
  const t = useTranslations('races');
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [selectedRace, setSelectedRace] = useState<string | null>(null);
  const [expandedRace, setExpandedRace] = useState<string | null>(null);

  const [dbRaces, setDbRaces] = useState<Race[] | null>(null);

  useEffect(() => {
    fetch('/api/races')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.races?.length > 0) {
          setDbRaces(data.races.map((r: any) => ({
            id: r.id,
            name: r.name,
            date: r.date,
            location: r.location,
            lat: r.lat,
            lng: r.lng,
            distances: r.distances || [],
            daysUntil: 0,
            type: r.type || 'half',
            website: r.website,
          })));
        }
      })
      .catch(() => {});
  }, []);

  const racesSource = dbRaces || UPCOMING_RACES;
  const races = racesSource.map(r => ({
    ...r,
    daysUntil: computeDaysUntil(r.date),
  })).filter(r => r.daysUntil >= 0).sort((a, b) => a.daysUntil - b.daysUntil);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => {
      const L = (window as any).L;
      if (!L || !mapRef.current) return;

      const map = L.map(mapRef.current, {
        center: [31.5, 34.8],
        zoom: 7,
        zoomControl: false,
        attributionControl: false,
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map);

      races.forEach((race) => {
        const color = typeColors[race.type]?.dot || '#6366f1';
        const icon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        const marker = L.marker([race.lat, race.lng], { icon }).addTo(map);
        marker.bindTooltip(race.name, {
          permanent: false,
          direction: 'top',
          offset: [0, -10],
          className: 'race-tooltip',
        });
        marker.on('click', () => {
          setSelectedRace(race.id);
          setExpandedRace(race.id);
        });
        markersRef.current.push({ id: race.id, marker });
      });

      mapInstanceRef.current = map;
    };
    document.body.appendChild(script);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current || !selectedRace) return;
    const race = races.find(r => r.id === selectedRace);
    if (race) {
      mapInstanceRef.current.flyTo([race.lat, race.lng], 10, { duration: 0.8 });
    }
  }, [selectedRace]);

  const goalRace = races[0];

  return (
    <div className="min-h-[calc(100vh-6rem)] flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-700 bg-slate-900/50 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Trophy className="h-5 w-5 text-amber-400" />
            <h1 className="text-lg font-semibold text-white">{t('upcomingRaces')}</h1>
          </div>
          <span className="text-sm text-slate-400">{races.length} {t('races')}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Map */}
        <div className="lg:flex-1 h-[250px] sm:h-[350px] lg:h-auto relative" style={{ zIndex: 0 }}>
          <div ref={mapRef} className="absolute inset-0" style={{ zIndex: 0 }} />
          {/* Goal race overlay */}
          {goalRace && (
            <div className="absolute top-4 start-4 z-10 bg-slate-900/90 backdrop-blur border border-slate-700 rounded-xl p-4 max-w-[280px]">
              <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">{t('goalRace')}</p>
              <p className="text-sm font-bold text-white">{goalRace.name}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-2xl font-black text-white tabular-nums">{goalRace.daysUntil}</span>
                <span className="text-xs text-slate-400">{t('daysToGo')}</span>
              </div>
            </div>
          )}
        </div>

        {/* Race List */}
        <div className="lg:w-[380px] border-t lg:border-t-0 lg:border-l border-slate-700 overflow-y-auto max-h-[calc(100vh-10rem)]">
          <div className="p-4 space-y-2">
            {races.map((race) => {
              const style = typeColors[race.type] || typeColors['marathon'];
              const isExpanded = expandedRace === race.id;
              const isSelected = selectedRace === race.id;
              const dateObj = new Date(race.date + 'T00:00:00');
              const dateLabel = dateObj.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
              const weekday = dateObj.toLocaleDateString('he-IL', { weekday: 'long' });

              return (
                <div
                  key={race.id}
                  className={cn(
                    'rounded-xl border transition-all cursor-pointer',
                    isSelected ? 'border-[#4338ff]/50 bg-[#4338ff]/5' : 'border-slate-700/40 bg-slate-800/40 hover:bg-slate-800/60'
                  )}
                  onClick={() => { setSelectedRace(race.id); setExpandedRace(isExpanded ? null : race.id); }}
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', style.bg, style.text)}>
                            {t(typeLabelKeys[race.type])}
                          </span>
                          <span className="text-[10px] text-slate-500">{weekday}</span>
                        </div>
                        <p className="text-sm font-bold text-white truncate">{race.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <MapPin className="h-3 w-3 text-slate-500" />
                          <span className="text-xs text-slate-400">{race.location}</span>
                        </div>
                      </div>
                      <div className="text-end shrink-0 ms-3">
                        <p className="text-lg font-black text-white tabular-nums leading-none">{race.daysUntil}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{t('days')}</p>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-slate-700/40 space-y-2">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5 text-slate-500" />
                          <span className="text-xs text-slate-300">{dateLabel}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Route className="h-3.5 w-3.5 text-slate-500" />
                          <div className="flex flex-wrap gap-1">
                            {race.distances.map((d, i) => (
                              <span key={i} className="text-[10px] font-medium text-white bg-slate-700/60 px-2 py-0.5 rounded">
                                {d}
                              </span>
                            ))}
                          </div>
                        </div>
                        {race.website && (
                          <a
                            href={race.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="inline-block text-xs text-[#4338ff] hover:text-[#5b54ff] font-medium mt-1"
                          >
                            {t('website')} →
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style jsx global>{`
        .race-tooltip {
          background: #1e293b !important;
          border: 1px solid #334155 !important;
          border-radius: 8px !important;
          color: white !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          padding: 4px 10px !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
        }
        .race-tooltip::before {
          border-top-color: #334155 !important;
        }
      `}</style>
    </div>
  );
}
