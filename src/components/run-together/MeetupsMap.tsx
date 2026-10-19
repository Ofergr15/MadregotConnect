'use client';

import { useEffect, useRef } from 'react';
import { loadLeaflet } from '@/lib/leaflet';
import { BASEMAP_ATTRIBUTION, BASEMAP_MAX_ZOOM, BASEMAP_URL_TEMPLATE } from '@/lib/basemap';
import type { RunMeetup } from '@/lib/runs/meetups';
import { packHex } from './parts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * The board as a map (mockup screen 2): every run a pin in its pack's colour with the
 * host's face, the time and how many are going. Tapping one selects it; the page
 * shows its card. Runs without a meeting point are not on the map.
 */
export function MeetupsMap({ meetups, selected, onSelect, className }: {
  meetups: RunMeetup[]; selected: string | null; onSelect: (id: string) => void; className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const lib = useRef<any>(null);
  const fitted = useRef(false);

  useEffect(() => {
    let dead = false;
    loadLeaflet().then((L) => {
      if (dead || !el.current || map.current) return;
      lib.current = L;
      map.current = L.map(el.current, { center: [32.1, 34.79], zoom: 12, zoomControl: false, attributionControl: true });
      L.tileLayer(BASEMAP_URL_TEMPLATE, { maxZoom: BASEMAP_MAX_ZOOM, attribution: BASEMAP_ATTRIBUTION }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      // Fit only once the container has its size: fitted on a 0×0 box, the view lands
      // somewhere else and the plate never loads.
      const settle = (tries = 0) => {
        if (!map.current || !el.current) return;
        map.current.invalidateSize();
        if (el.current.clientHeight > 0 || tries > 20) draw();
        else setTimeout(() => settle(tries + 1), 100);
      };
      setTimeout(() => settle(), 60);
    }).catch(() => {});
    return () => { dead = true; map.current?.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = () => {
    const L = lib.current;
    if (!L || !map.current || !layer.current) return;
    layer.current.clearLayers();
    const points: Array<[number, number]> = [];
    // Two runs from the same spot (Gordon at 06:30 and at 19:00) stack upward instead
    // of hiding one under the other.
    const atSpot = new Map<string, number>();
    for (const m of meetups) {
      if (m.lat == null || m.lng == null) continue;
      points.push([m.lat, m.lng]);
      const c = packHex(m.pack);
      const on = m.id === selected;
      const face = m.host.avatarUrl
        ? `<img src="${esc(m.host.avatarUrl)}" referrerpolicy="no-referrer" style="width:24px;height:24px;border-radius:50%;object-fit:cover" />`
        : `<span style="width:24px;height:24px;border-radius:50%;background:#E6E8FF;color:#1525FF;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px">${esc((m.host.name[0] || '?').toUpperCase())}</span>`;
      // A 100×46 box anchored at its bottom centre — the tap area — with the pill inside it.
      const html = `<div style="width:100px;height:46px;display:flex;align-items:flex-end;justify-content:center"><div dir="rtl" style="display:flex;align-items:center;gap:5px;white-space:nowrap;background:${on ? c : '#fff'};color:${on ? '#fff' : '#111218'};border:2.5px solid ${c};border-radius:99px;padding:2px 8px 2px 2px;box-shadow:0 4px 12px rgba(0,0,0,.22);font:900 13px -apple-system,system-ui,sans-serif;${on ? 'transform:scale(1.12);transform-origin:bottom center;' : ''}">
        ${face}<span>${esc(m.startTime)}</span><span style="font-size:11px;border-radius:99px;padding:1px 6px;background:${on ? '#fff' : c};color:${on ? c : '#fff'}">${m.going.length}</span></div></div>`;
      const key = `${m.lat!.toFixed(3)},${m.lng!.toFixed(3)}`;
      const k = atSpot.get(key) ?? 0;
      atSpot.set(key, k + 1);
      const icon = L.divIcon({ className: 'rt-pin', html, iconSize: [100, 46], iconAnchor: [50, 46 + k * 36] });
      L.marker([m.lat, m.lng], { icon, zIndexOffset: on ? 1000 : 0 }).on('click', () => onSelect(m.id)).addTo(layer.current);
    }
    if (!fitted.current && points.length) {
      fitted.current = true;
      // The bottom ~170px is the selected run's card: fit the pins above it.
      if (points.length === 1) map.current.setView(points[0], 14);
      else map.current.fitBounds(points, { paddingTopLeft: [50, 60], paddingBottomRight: [50, 200], maxZoom: 14 });
    }
  };

  useEffect(() => { draw(); }); // eslint-disable-line react-hooks/exhaustive-deps

  // Pan to the run a card swipe or a pin tap selected.
  useEffect(() => {
    const m = meetups.find((x) => x.id === selected);
    if (m?.lat == null || m.lng == null || !map.current || !fitted.current) return;
    // Centre it in the part of the map the card does not cover.
    const pt = map.current.project([m.lat, m.lng]).add([0, 85]);
    map.current.panTo(map.current.unproject(pt), { animate: true });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className={className} />;
}
