// Filesystem-only lookup: Bun's resolver APIs can auto-install missing packages.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
export function installedVarlock(start: string): string {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    const root = join(dir, 'node_modules/varlock'), metadata = join(root, 'package.json');
    if (existsSync(metadata)) {
      if (JSON.parse(readFileSync(metadata, 'utf8')).version !== '1.21.1') throw new Error('varlock version must be 1.21.1');
      return realpathSync(root);
    }
    if (dir === dirname(dir)) throw new Error('varlock 1.21.1 is not installed; nothing written');
  }
}
