// Only owned 0600 files outside git trees; parse values with varlock's env parser.
import { plugin } from 'varlock/plugin-lib';
import { closeSync, constants, existsSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { privatePath } from './runtime-reader';
plugin.name = 'repogolem-file';
plugin.registerResolverFunction({
  name: 'repoGolemFile',
  argsSchema: { type: 'array', arrayMinLength: 1, arrayMaxLength: 1 },
  process() { return Buffer.from(String(this.arrArgs[0].staticValue), 'base64').toString('utf8'); },
  resolve(path: string) {
    privatePath(path);
    for (let dir = realpathSync(dirname(path)); ; dir = dirname(dir)) {
      if (existsSync(join(dir, '.git'))) throw new Error('values file must be outside git trees');
      if (dir === dirname(dir)) break;
    }
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600) throw new Error('values file must be owned 0600');
      return readFileSync(fd, 'utf8');
    } finally { closeSync(fd); }
  },
});
