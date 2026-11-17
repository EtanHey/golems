import { parentPort } from 'node:worker_threads';
import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { scanFile, scanData, scanner, MAX_SCAN_BYTES } from './scan-content.mjs';

parentPort.on('message', async ({ path, cached, blob, hashOnly, validatedIndex, expected, looseOid }) => {
  try {
    if (blob) {
      if (validatedIndex) {const scan=scanner();scan.push(blob);parentPort.postMessage({shapes:scan.result()});}
      else parentPort.postMessage(await scanData(Buffer.from(blob), '', {history:true}));
      return;
    }
    const before = lstatSync(path);
    if(expected && ['size','mtimeMs','ctimeMs','ino'].some(k=>before[k]!==expected[k])) {parentPort.postMessage({shapes:['scan-source-changed']});return;}
    if (!before.isFile() || !(before.mode & 0o444)) throw new Error();
    if(looseOid) {
      if(before.size>MAX_SCAN_BYTES)throw new Error();
      const raw=readFileSync(path), inflated=inflateSync(raw,{info:true,maxOutputLength:MAX_SCAN_BYTES+1024});
      if(inflated.engine.bytesWritten!==raw.length || createHash(looseOid.length===64?'sha256':'sha1').update(inflated.buffer).digest('hex')!==looseOid)throw new Error();
    }
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
