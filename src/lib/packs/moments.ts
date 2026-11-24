export interface Moment { id: string; kind: string; body: string; sendAt: string | null; sentAt: string | null; readyBy: string | null }

export function toMoment(r: { id: string; kind: string; body: string; send_at: string | null; sent_at: string | null; ready_by: string | null }): Moment {
  return { id: r.id, kind: r.kind, body: r.body, sendAt: r.send_at, sentAt: r.sent_at, readyBy: r.ready_by };
}
