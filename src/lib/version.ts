// Displayed app version — bump alongside the git tag for each release
// (see the versioning workflow: git tag + Vercel deployment history for
// rollback).
//
// It must equal package.json's "version", and for eight releases it did not: this
// said 2.39.87 while the package said 2.39.95, so the number at the foot of the
// Profile screen — the only version an athlete or a coach can actually see —
// answered "did the fix ship?" with a stale yes. versionSync.test.ts now fails
// the build on any drift, because a version you can't trust is worse than none.
export const APP_VERSION = '2.39.114';
