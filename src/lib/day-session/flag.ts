// The one switch for "אימון ליום אחד" (mockup manual-day-workout). Its own module with no
// 'use client', so a route can read it too.
//
// OFF: the super user alone — the coach-tools row, the form, the writes, the feed card and
// the push all reach nobody else ("can you push it only to me?").
// ON: coaches and admins create, every member sees the card and gets the push.
export const DAY_SESSION_FOR_ALL = false;
