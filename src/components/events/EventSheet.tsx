'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BookOpen, Camera, Check, Dumbbell, Gift, PartyPopper, Tent, Trophy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { authedFetch } from '@/lib/auth/authed-fetch';
import { EVENT_KINDS, type EventKind } from '@/lib/events';
import { isShortMapLink, parseMapLink, type MapPoint } from '@/lib/events/map-link';
import { Button, Sheet, InsetSection, InsetRow } from '@/components/ui';

/**
 * The staff form for an event, used for BOTH creating and editing one.
 *
 * It started as `AddEventSheet` inside the calendar page. Editing was then asked
 * for — "admin should be allowed to change the races and others" — and the
 * natural place to put that is the event's own page, not the calendar. Rather
 * than a second form with the same eight fields drifting out of step with this
 * one, the form moved here and learned a second mode: pass `event` and it PATCHes,
 * omit it and it POSTs.
 *
 * The API needed nothing new. `/api/events/[id]` has accepted a staff-gated PATCH
 * (and DELETE) all along — 18 updatable fields — so all that was ever missing was
 * a way to reach it.
 *
 * ── The one field that behaves differently between the two modes ─────────────
 * The map link. Only the resolved lat/lng is stored, never the URL that produced
 * it, so an edit cannot pre-fill this box. Empty therefore has to mean "leave the
 * pin exactly as it is" — not "clear it" — and the hint line shows the coordinates
 * already on file so that "empty" does not read as "there is no pin". Pasting a
 * new link replaces it; that is the only way this field ever writes.
 */

export const KIND_COLOR: Record<EventKind, string> = {
  race: 'bg-brand-600',
  camp: 'bg-accent-600',
  lecture: 'bg-band-3',
  social: 'bg-pink-400',
  photo_shoot: 'bg-band-2',
  sponsor: 'bg-band-3',
  workout: 'bg-ink-300',
};

export const KIND_ICON: Record<EventKind, React.ComponentType<{ className?: string }>> = {
  race: Trophy,
  camp: Tent,
  lecture: BookOpen,
  social: PartyPopper,
  photo_shoot: Camera,
  sponsor: Gift,
  workout: Dumbbell,
};

/** The subset of an event row this form edits. */
export interface EditableEvent {
  id: string;
  kind: EventKind;
  name: string;
  date: string;
  location: string;
  description?: string | null;
  capacity?: number | null;
  lat?: number | null;
  lng?: number | null;
}

// Local-date ISO, NOT toISOString() — that converts to UTC and shifts the day
// back in Israel (+2/+3), so a new event would default to yesterday.
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function EventSheet({
  open,
  onClose,
  onSaved,
  event,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** Present → edit that event. Absent → create a new one. */
  event?: EditableEvent;
  /** Only offered in edit mode, and only when the caller can handle it. */
  onDeleted?: () => void;
}) {
  const t = useTranslations('calendar');
  const editing = !!event;

  const [kind, setKind] = useState<EventKind>(event?.kind ?? 'race');
  const [kindPickerOpen, setKindPickerOpen] = useState(false);
  const [name, setName] = useState(event?.name ?? '');
  const [date, setDate] = useState(event?.date ?? todayIso());
  const [location, setLocation] = useState(event?.location ?? '');
  const [mapLink, setMapLink] = useState('');
  const [description, setDescription] = useState(event?.description ?? '');
  const [capacity, setCapacity] = useState(event?.capacity != null ? String(event.capacity) : '');
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  // Parsed as you type, so the row below the input can confirm the coordinates
  // BEFORE the event is saved. The paste either resolves to a point on the map or
  // it does not, and that is worth knowing while the link is still on the clipboard.
  const mapParse = mapLink.trim() ? parseMapLink(mapLink) : null;
  // A short link has no coordinates in it, so the server expands it (see
  // /api/events/resolve-map-link). Held separately from the local parse rather than
  // written back into the input: replacing what somebody just pasted with a
  // 150-character URL they did not type is startling, and it also destroys the
  // evidence if the resolution turns out to be wrong.
  const [resolved, setResolved] = useState<{ link: string; point: MapPoint } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [mapLinkError, setMapLinkError] = useState('');
  // A short link expands to a PLACE, not a point (see the route's docblock). Usually
  // that place geocodes and there is a pin; when it does not, the name is still the
  // useful half. Held so the event can be saved anyway — refusing to save because a
  // geocoder had never heard of the venue would be punishing the wrong person.
  const [placeOnly, setPlaceOnly] = useState<string | null>(null);
  const mapPoint = mapParse?.ok
    ? mapParse.point
    : resolved && resolved.link === mapLink.trim()
      ? resolved.point
      : null;
  /** The pin already on file, for the hint line in edit mode. */
  const currentPoint =
    event?.lat != null && event?.lng != null ? { lat: event.lat, lng: event.lng } : null;

  // Re-seed when the sheet is opened on a different event. The fields are plain
  // state so that typing stays local and instant; this is what keeps that state
  // from being the PREVIOUS event's when the same component is reused. Declared
  // after the map-link state because it clears that too.
  useEffect(() => {
    if (!open || !event) return;
    setKind(event.kind);
    setName(event.name);
    setDate(event.date);
    setLocation(event.location);
    setDescription(event.description ?? '');
    setCapacity(event.capacity != null ? String(event.capacity) : '');
    setMapLink('');
    setResolved(null);
    setMapLinkError('');
    setPlaceOnly(null);
    setError('');
  }, [open, event]);

  // Expands a short link as soon as one is in the box, so the confirmation line
  // behaves the same for both kinds of link. Keyed on the exact text that was
  // resolved, so an edit invalidates the answer instead of silently keeping a pin
  // from the previous paste.
  useEffect(() => {
    const value = mapLink.trim();
    setMapLinkError('');
    setPlaceOnly(null);
    if (!value || !isShortMapLink(value)) return;
    if (resolved?.link === value) return;

    let cancelled = false;
    setResolving(true);
    (async () => {
      try {
        const res = await authedFetch('/api/events/resolve-map-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: value }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        // The expanded link knows the venue's name, and whoever pasted it should not
        // have to retype it into the location field. Only when that field is still
        // empty: an address typed by hand beats one guessed from a link.
        if (typeof data.place === 'string' && data.place) {
          setLocation(prev => (prev.trim() ? prev : data.place));
        }
        if (res.ok && typeof data.lat === 'number' && typeof data.lng === 'number') {
          setResolved({ link: value, point: { lat: data.lat, lng: data.lng } });
        } else if (data.error === 'no_coords' && typeof data.place === 'string') {
          setPlaceOnly(data.place);
        } else {
          setMapLinkError(
            data.error === 'unreachable' ? t('addEvent.mapLinkUnreachable') : t('addEvent.mapLinkShort'),
          );
        }
      } catch {
        if (!cancelled) setMapLinkError(t('addEvent.mapLinkUnreachable'));
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mapLink, resolved, t]);

  const reset = () => {
    // Only meaningful for the create sheet, which is reused for the next event.
    // In edit mode the effect above re-seeds from the row instead.
    if (editing) return;
    setKind('race'); setName(''); setDate(todayIso()); setLocation(''); setMapLink('');
    setResolved(null); setMapLinkError(''); setPlaceOnly(null);
    setDescription(''); setCapacity(''); setError('');
  };

  const handleClose = () => {
    if (submitting || deleting) return;
    onClose();
    reset();
  };

  const handleSubmit = async () => {
    if (!name.trim() || !date || !location.trim()) {
      setError(t('addEvent.requiredError'));
      return;
    }
    // A link that was typed but cannot be read is a hard stop, not a silent drop:
    // somebody who pasted a location expects the pin to be there, and finding out
    // on race week that it never saved is worse than being told now. A short link
    // still in flight waits rather than failing — it is about to succeed.
    // `placeOnly` is the exception: the link WAS read, it just names a venue no
    // geocoder places. The location text is filled from it, so the event is complete
    // apart from the pin — blocking that would lose real information to gain none.
    if (mapLink.trim() && !mapPoint && !placeOnly) {
      if (resolving) {
        setError(t('addEvent.mapLinkResolving'));
        return;
      }
      setError(
        mapLinkError ||
          (mapParse && !mapParse.ok && mapParse.reason === 'shortLink'
            ? t('addEvent.mapLinkShort')
            : t('addEvent.mapLinkInvalid')),
      );
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        kind,
        name: name.trim(),
        date,
        location: location.trim(),
        // The route already accepted lat/lng — the migration has carried the
        // columns since 055 and the map plots them — nothing had ever sent them.
        lat: mapPoint?.lat,
        lng: mapPoint?.lng,
        description: description.trim() || undefined,
        capacity: capacity ? Number(capacity) : undefined,
      };
      if (editing) {
        // PATCH ignores undefined fields, so an untouched description stays put.
        // The exception that has to be explicit: clearing a description or a
        // capacity must actually clear it, which `undefined` would not do.
        payload.description = description.trim() || null;
        payload.capacity = capacity ? Number(capacity) : null;
        // No new link pasted → do not touch the pin. Sending undefined lat/lng
        // would be read as "no change" by the route anyway, but being explicit
        // here is what stops a future refactor from wiping a pin on a name edit.
        if (!mapPoint) { delete payload.lat; delete payload.lng; }
      }

      const res = await authedFetch(editing ? `/api/events/${event.id}` : '/api/events', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const responseData = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(responseData.error || t('addEvent.genericError'));
      onSaved();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('addEvent.genericError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!event || !onDeleted) return;
    // A deleted event takes its registrations with it (the FK cascades), so this
    // asks first. `confirm` and not a nested sheet: this is the destructive path,
    // it should feel like a stop, and a third stacked sheet on a phone does not.
    if (!window.confirm(t('editEvent.deleteConfirm', { name: event.name }))) return;
    setDeleting(true);
    setError('');
    try {
      const res = await authedFetch(`/api/events/${event.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('addEvent.genericError'));
      }
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('addEvent.genericError'));
      setDeleting(false);
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => { if (!o) handleClose(); }}
        title={editing ? t('editEvent.title') : t('addEvent.title')}
      >
        <div className="space-y-3.5 px-1 pb-2">
          {/* iOS Settings-style form: a tap-to-open row for the kind picker
              (opens the nested Sheet below) plus one labeled row per field,
              grouped in the same InsetSection/InsetRow chrome used across the
              app — replacing the raw <select>/<input> HTML form. */}
          <InsetSection>
            <InsetRow
              label={t('addEvent.kind')}
              value={t(`kinds.${kind}`)}
              onClick={() => setKindPickerOpen(true)}
            />
            <InsetRow
              label={t('addEvent.name')}
              trailing={
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('addEvent.namePlaceholder')}
                  dir="auto"
                  className="w-36 sm:w-48 bg-transparent text-sm text-ink-700 placeholder-ink-400 text-end focus:outline-none"
                />
              }
            />
            <InsetRow
              label={t('addEvent.date')}
              trailing={
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="bg-transparent text-sm text-ink-700 focus:outline-none"
                />
              }
            />
            <InsetRow
              label={t('addEvent.capacity')}
              trailing={
                <input
                  type="number"
                  min={1}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder={t('addEvent.capacityPlaceholder')}
                  className="w-24 bg-transparent text-sm text-ink-700 placeholder-ink-400 text-end focus:outline-none"
                />
              }
            />
            <InsetRow
              label={t('addEvent.location')}
              trailing={
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder={t('addEvent.locationPlaceholder')}
                  dir="auto"
                  className="w-36 sm:w-48 bg-transparent text-sm text-ink-700 placeholder-ink-400 text-end focus:outline-none"
                />
              }
            />
            {/* The map link. Full width and its own row rather than a trailing
                input, because a pasted Google Maps URL is 150 characters and would
                be invisible in a 48px trailing box. Optional: an event with no
                coordinates keeps working exactly as before — it just has no pin on
                the map above and no navigate button on its page. */}
            <div className="px-4 py-3">
              <label className="block text-xs font-bold text-ink-400 mb-1.5">{t('addEvent.mapLink')}</label>
              <input
                value={mapLink}
                onChange={(e) => setMapLink(e.target.value)}
                placeholder={t('addEvent.mapLinkPlaceholder')}
                dir="ltr"
                inputMode="url"
                className="w-full bg-transparent text-sm text-ink-700 placeholder-ink-400 focus:outline-none"
              />
              <p
                className={cn('mt-1 text-2xs', mapLinkError ? 'text-accent-red-ink' : 'text-ink-400')}
                dir="auto"
              >
                {mapLinkError
                  ? mapLinkError
                  : resolving
                    ? t('addEvent.mapLinkResolving')
                    : mapPoint
                      ? t('addEvent.mapLinkResolved', {
                          lat: mapPoint.lat.toFixed(4),
                          lng: mapPoint.lng.toFixed(4),
                        })
                      : placeOnly
                        ? t('addEvent.mapLinkNoCoords', { place: placeOnly })
                        : // Edit mode with a pin on file: say where it is and that an
                          // empty box keeps it, so nobody re-pastes a link to be safe.
                          currentPoint
                          ? t('editEvent.mapLinkCurrent', {
                              lat: currentPoint.lat.toFixed(4),
                              lng: currentPoint.lng.toFixed(4),
                            })
                          : t('addEvent.mapLinkHint')}
              </p>
            </div>
            <div className="px-4 py-3">
              <label className="block text-xs font-bold text-ink-400 mb-1.5">{t('addEvent.description')}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder={t('addEvent.descriptionPlaceholder')}
                dir="auto"
                className="w-full bg-transparent text-sm text-ink-700 placeholder-ink-400 focus:outline-none resize-none"
              />
            </div>
          </InsetSection>

          {error && <p className="text-sm text-accent-red">{error}</p>}

          <Button type="button" onClick={handleSubmit} disabled={submitting || deleting} className="w-full">
            {submitting ? t('addEvent.saving') : editing ? t('editEvent.save') : t('addEvent.create')}
          </Button>

          {editing && onDeleted && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={submitting || deleting}
              className="w-full py-2 text-sm font-semibold text-accent-red-ink disabled:opacity-50"
            >
              {deleting ? t('editEvent.deleting') : t('editEvent.delete')}
            </button>
          )}
        </div>
      </Sheet>

      {/* Kind picker — a nested option-picker Sheet listing the 7 kinds as
          InsetRow items, opened by tapping the "kind" row above. */}
      <Sheet open={kindPickerOpen} onOpenChange={setKindPickerOpen} title={t('addEvent.kind')}>
        <InsetSection>
          {EVENT_KINDS.map((k) => (
            <InsetRow
              key={k}
              icon={KIND_ICON[k]}
              iconBg={KIND_COLOR[k]}
              label={t(`kinds.${k}`)}
              onClick={() => { setKind(k); setKindPickerOpen(false); }}
              trailing={kind === k ? <Check className="h-4 w-4 text-brand-600" /> : <span className="w-4 h-4" />}
            />
          ))}
        </InsetSection>
      </Sheet>
    </>
  );
}
