'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { AcademyImportFlow, ImportEntry } from '@/components/academy/AcademyImportFlow';

// "מעבר לאפליקציה" (the academy's file into the app) on a stubbed fetch, made-up people only.
// ?s=board — the "מי מוזמן" board with every stage; ?s=empty — the first visit (upload);
// ?entry=1 — the People-tab entry row. The upload screen parses a real .xlsx in the browser;
// the preview answer below is made up from whatever rows it was sent.
// Development only. In production the route does not exist.

const COACHES = [{ id: 'cy', name: 'Yair Gabbay' }, { id: 'cs', name: 'Sahar Azar' }, { id: 'ce', name: 'Eldar Pardo' }];
const BANDS = [4, 5, 6, 7, 8, 9].map((n) => ({ id: `b${n}`, name: `דבוקה ${n}`, n }));
const H = 3_600_000;
const card = (cardId: string, name: string, stage: string, o: Record<string, unknown> = {}) => ({
  cardId, athleteId: null, name, email: `${cardId}@example.com`, hasPhone: true, coachIds: ['cy'], coachNames: ['Yair Gabbay'], requestedBand: 5,
  marked: true, linked: false, stage, stuck: false, invitedAt: null, hasResults: false, staffNote: null, ...o,
});
const BOARD_ROWS = [
  card('k1', 'יואב שמיר', 'invited', { stuck: true, invitedAt: new Date(Date.now() - 60 * H).toISOString(), coachIds: ['cs'], coachNames: ['Sahar Azar'], requestedBand: 7 }),
  card('k2', 'מיכל אורן', 'not_invited', { requestedBand: 8, hasResults: true }),
  card('k3', 'אלון ברק', 'not_invited', { requestedBand: 4 }),
  card('k4', 'נועה פז', 'not_invited', { coachIds: ['cs'], coachNames: ['Sahar Azar'], requestedBand: 7 }),
  card('k5', 'עידן רז', 'not_invited', { coachIds: ['cs'], coachNames: ['Sahar Azar'], requestedBand: 6, marked: false }),
  card('k6', 'רותם לב', 'not_invited', { email: null, requestedBand: 5 }),
  card('k7', 'שי גל', 'not_invited', { linked: true, coachIds: ['ce'], coachNames: ['Eldar Pardo'], requestedBand: 9 }),
  card('k8', 'דנה מור', 'invited', { invitedAt: new Date(Date.now() - 5 * H).toISOString() }),
  card('k9', 'אורי טל', 'confirmed', { coachIds: ['cs'], coachNames: ['Sahar Azar'] }),
  card('k10', 'ליאת חן', 'in_app', { requestedBand: 6 }),
];

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });

if (typeof window !== 'undefined' && !(window as { __impStub?: boolean }).__impStub) {
  (window as { __impStub?: boolean }).__impStub = true;
  const empty = new URLSearchParams(window.location.search).get('s') === 'empty';
  const original = window.fetch;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (url.startsWith('/api/academy/import')) {
      if (!init?.method || init.method === 'GET') return json({ coaches: COACHES, bands: BANDS, rows: empty ? [] : BOARD_ROWS });
      const body = JSON.parse(String(init.body || '{}'));
      if (body.action === 'preview') {
        const rows = (body.rows || []) as Array<{ key: string; email: string | null }>;
        const needs = rows.filter((r) => !r.email).map((r) => ({ key: r.key, kind: 'no_email' }));
        if (rows[1]) needs.push({ key: rows[1].key, kind: 'club_member', athleteId: 'm1', athleteName: 'Avi Barak', member: true, why: 'אותו שם, בעברית ובאנגלית' } as never);
        return json({ needs, ready: rows.filter((r, i) => r.email && i !== 1).map((r) => r.key), coaches: COACHES, bands: BANDS });
      }
      if (body.action === 'invite') return json({ results: (body.cardIds || []).map((id: string) => ({ cardId: id, ok: true, emailed: true })) });
      return json({ ok: true, created: 0, reminded: 1 });
    }
    if (url.startsWith('/api/')) return json({});
    return original(input as RequestInfo, init);
  }) as typeof window.fetch;
}

export default function PreviewAcademyImport() {
  const [entry, setEntry] = useState<boolean | null>(null);
  useEffect(() => { setEntry(new URLSearchParams(window.location.search).get('entry') === '1'); }, []);
  if (process.env.NODE_ENV === 'production') notFound();
  if (entry === null) return null;
  return entry
    ? <div className="min-h-screen bg-page p-4" dir="rtl"><ImportEntry onOpen={() => {}} /></div>
    : <AcademyImportFlow onClose={() => {}} />;
}
