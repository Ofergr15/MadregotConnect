import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { validate, type ContractFile } from '@/lib/contracts/json-schema';

/** docs/contracts/ios-routes.json — the response contracts of the routes the iOS app calls. */
export const IOS_CONTRACT: ContractFile = JSON.parse(readFileSync(join(process.cwd(), 'docs/contracts/ios-routes.json'), 'utf8'));

/** Fail when a real handler's 2xx body does not fit the iOS contract for `routeId`. */
export function expectIosContract(routeId: keyof typeof IOS_CONTRACT.routes | string, body: unknown): void {
  const route = IOS_CONTRACT.routes[routeId];
  if (!route) throw new Error(`no iOS contract "${routeId}" in docs/contracts/ios-routes.json`);
  expect(validate(route.response, body, IOS_CONTRACT.$defs), `${route.method} ${route.path} body breaks the iOS contract`).toEqual([]);
}
