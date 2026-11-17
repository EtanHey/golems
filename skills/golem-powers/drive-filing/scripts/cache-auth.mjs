import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, fstatSync, constants, realpathSync } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

const inside = (root, path) => path === root || path.startsWith(root.endsWith(sep)?root:root+sep);
export function cacheAuthenticator(root, receiptDir) {
  const dir = join(homedir(), '.local/state/golems');
  const filename = 'drive-scan-cache.key';
  // Never create/read the key under the scanned source or the receipt directory.
  if (inside(root,dir) || inside(receiptDir,dir)) throw new Error('cache-key-location');
  mkdirSync(dir,{recursive:true,mode:0o700});
  const actual = realpathSync(dir);
  if (inside(root,actual) || inside(receiptDir,actual)) throw new Error('cache-key-location');
  const path=join(actual,filename);
  let fd;
  try {
    fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    writeFileSync(fd,randomBytes(32));
  } catch(error) { if(error.code!=='EEXIST') throw error; }
  finally { if(fd!==undefined) closeSync(fd); }
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  let key;
  try {
    const stat=fstatSync(fd);
    if(!stat.isFile() || stat.size!==32 || stat.nlink!==1 || (stat.mode&0o777)!==0o600 || stat.uid!==process.getuid()) throw new Error('cache-key-permissions');
    key=readFileSync(fd);
  } finally {closeSync(fd);}
  const sign = payload => createHmac('sha256',key).update(JSON.stringify(payload)).digest('hex');
  return {
    seal: payload => ({...payload,hmac:sign(payload)}),
    valid: saved => {
      if(!saved || !/^[a-f0-9]{64}$/.test(saved.hmac)) return false;
      const {hmac,...payload}=saved;
      return timingSafeEqual(Buffer.from(hmac,'hex'),Buffer.from(sign(payload),'hex'));
    },
  };
}
