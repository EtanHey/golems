import { expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Bun 1.4.2 RuntimeTranspilerCache.rs:615-624: "0" disables the runtime cache.
// https://github.com/oven-sh/bun/blob/bun-v1.4.2/src/jsc/RuntimeTranspilerCache.rs#L615-L624
export function isolatedBunTestEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0' };
}

export function assertNoBunInstallCache(home: string) {
  expect(existsSync(join(home, '.bun/install/cache'))).toBe(false);
}
