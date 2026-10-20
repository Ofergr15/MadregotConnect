// The circles' rings (mockup circles-seen, Ofer 10-20): a bright ring around the whole
// circle while anything in it is unseen; nothing around it once all of it was seen.

/** 'new' while any of the circle's items is not in `seen`. */
export function ringState(ids: string[], seen: readonly string[]): 'new' | 'seen' {
  return ids.some((id) => !seen.includes(id)) ? 'new' : 'seen';
}

/** Where a circle with several items opens: its first unseen one, else the first. */
export function firstUnseen(ids: string[], seen: readonly string[]): number {
  const i = ids.findIndex((id) => !seen.includes(id));
  return i < 0 ? 0 : i;
}
