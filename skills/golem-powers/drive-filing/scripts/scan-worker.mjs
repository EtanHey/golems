import { parentPort } from 'node:worker_threads';
import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { scanFile, scanData } from './scan-content.mjs';

parentPort.on('message', async ({ path, cached, blob, hashOnly, gitRef }) => {
  try {
    if (blob) {
      parentPort.postMessage(await scanData(Buffer.from(blob)));
      return;
    }
    const before = lstatSync(path);
    if (!before.isFile() || !(before.mode & 0o444)) throw new Error();
    if (gitRef && before.size < 8192 && /^(?:[a-f0-9]{40}(?:[a-f0-9]{24})?|ref: refs\/[A-Za-z0-9_./-]+)\n?$/.test(readFileSync(path,'utf8'))) hashOnly = true;
    let receipt;
    if (cached && cached.size === before.size && cached.mtime === before.mtimeMs) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      if (hash.digest('hex') === cached.receipt.sha256) receipt = { ...cached.receipt, reused: true };
    }
    receipt ??= hashOnly ? {shapes: []} : await scanFile(path);
    if (!receipt.sha256) {
      const hash = createHash('sha256'); let bytes = 0;
      for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
      receipt.sha256 = hash.digest('hex'); receipt.bytes = bytes;
    }
    const after = lstatSync(path);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.ino !== before.ino) {
      receipt = { shapes: ['scan-source-changed'] };
    }
    parentPort.postMessage(receipt);
  } catch { parentPort.postMessage({ shapes: ['scan-unreadable'] }); }
});
