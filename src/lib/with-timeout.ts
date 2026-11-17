// A promise that gives up. Used where the app used to wait forever: auth-js's
// getSession() sits behind a Web Lock that can be held indefinitely (a stuck
// refresh, another tab), and a fetch with no signal never settles on a dead
// connection — either one left /dashboard/academy on its skeleton for good.

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
