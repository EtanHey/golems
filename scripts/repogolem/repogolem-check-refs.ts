// Preflight projects decrypted items to field names only; never retain values.
export function itemNames(data: unknown): Set<string> {
  if (!Array.isArray(data)) throw new Error('invalid 1Password item metadata; nothing written');
  const names = new Set<string>();
  for (const item of data) {
    if (!item || typeof item.id !== 'string' || typeof item.title !== 'string') {
      throw new Error('invalid 1Password item metadata; nothing written');
    }
    names.add(item.id); names.add(item.title);
  }
  return names;
}

const lower = (name: string) => name.toLowerCase();
export function fieldNames(data: unknown): Set<string> {
  if (!data || typeof data !== 'object' || !Array.isArray((data as any).fields)) throw new Error('invalid 1Password field metadata; nothing written');
  const names = new Set<string>();
  for (const field of (data as any).fields) {
    if (!field || typeof field.id !== 'string') throw new Error('invalid 1Password field metadata; nothing written');
    const fields = [field.id, ...(typeof field.label === 'string' ? [field.label] : [])].map(lower);
    for (const name of fields) names.add(name);
    if (field.section) {
      if (typeof field.section.id !== 'string') throw new Error('invalid 1Password field metadata; nothing written');
      for (const section of [field.section.id, ...(typeof field.section.label === 'string' ? [field.section.label] : [])].map(lower)) for (const name of fields) names.add(`${section}/${name}`);
    }
  }
  return names;
}

export const OP_SESSION_CONFIG = new Set(['OP_SESSION_TIMEOUT', 'OP_SESSION_DELEGATION_ENABLED']);
export const isOpCredential = (key: string) => key === 'OP_SERVICE_ACCOUNT_TOKEN' || key === 'OP_SESSION' || (key.startsWith('OP_SESSION_') && !OP_SESSION_CONFIG.has(key));

// Shared child-only env: captured sessions never enter process.env or files.
export function opEnvironment(noPrompt = false): Record<string, string | undefined> {
  const session = Object.entries(process.env).some(([key, value]) => value && isOpCredential(key));
  return { ...process.env, OP_BIOMETRIC_UNLOCK_ENABLED: noPrompt || !process.stdin.isTTY || session ? 'false' : 'true', OP_CACHE: 'false', OP_DEBUG: 'false' };
}

export function checkRefs(refs: string[], opBin: string, noPrompt = false, env = opEnvironment(noPrompt)): number {
  const groups = new Map<string, Map<string, string[]>>();
  for (const ref of refs) {
    const match = /^op:\/\/([^/]+)\/([^/]+)\/([^/]+(?:\/[^/]+)?)$/.exec(ref.split('?')[0]);
    if (!match) throw new Error('invalid op reference; preflight wrote nothing');
    const [, vault, item, field] = match;
    if (!groups.has(vault)) groups.set(vault, new Map());
    const items = groups.get(vault)!;
    if (!items.has(item)) items.set(item, []);
    items.get(item)!.push(field);
  }
  console.log('1Password ref names (vault/item/field preflight):');
  for (const [vault, items] of groups) {
    console.log(`  ${vault}:`);
    for (const [item, fields] of items) for (const field of fields) console.log(`    ${item}/${field}`);
  }
  if (refs.length === 0) { console.log('No op refs; nothing written.'); return 0; }
  const metadata = (args: string[], capture = false) => {
    try { return Bun.spawnSync([opBin, ...args], { env, stdin: 'ignore', stdout: capture ? 'pipe' : 'ignore', stderr: 'ignore', timeout: 15_000 }); }
    catch { throw new Error('cannot run 1Password CLI for preflight; nothing written'); }
  };
  const unsigned = () => {
    console.error(noPrompt
      ? '1Password is not signed in for non-interactive access (desktop integration is disabled); export a CLI session (eval $(op signin) on a manually added account) or OP_SERVICE_ACCOUNT_TOKEN, then retry --check-refs --no-prompt. Nothing written.'
      : '1Password sign-in failed, was cancelled, or authorization is unavailable. Nothing written.');
    return 3;
  };
  if (metadata(['whoami', '--format', 'json']).exitCode !== 0) {
    if (noPrompt) return unsigned();
    if (!process.stdin.isTTY) { console.error('1Password needs an interactive terminal; use --no-prompt with a CLI session or OP_SERVICE_ACCOUNT_TOKEN. Nothing written.'); return 3; }
    // Capture both desktop (empty output) and account export protocols.
    env.OP_BIOMETRIC_UNLOCK_ENABLED = 'true';
    const accounts = metadata(['account', 'list', '--format', 'json'], true);
    accounts.stdout?.fill(0);
    const testTimeout = process.env.REPOGOLEM_OP_BIN && Number(process.env.REPOGOLEM_TEST_SIGNIN_TIMEOUT_MS);
    const timeout = testTimeout && testTimeout > 0 && testTimeout < 120_000 ? testTimeout : 120_000;
    try {
      const signed = Bun.spawnSync([opBin, 'signin'], {
        env, stdin: 'inherit', stdout: 'pipe', stderr: 'inherit', timeout,
      });
      try {
        if (signed.exitCode !== 0 || signed.signal) return unsigned();
        const output = signed.stdout.toString().replace(/\r?\n$/, '');
        if (output) {
          const match = /^export (OP_SESSION_[A-Za-z0-9_]+)="([^"\s]+)"$/.exec(output);
          if (!match || OP_SESSION_CONFIG.has(match[1])) return unsigned();
          env[match[1]] = match[2];
          env.OP_BIOMETRIC_UNLOCK_ENABLED = 'false';
        }
      } finally { signed.stdout.fill(0); }
    } catch { return unsigned(); }
    if (metadata(['whoami', '--format', 'json']).exitCode !== 0) return unsigned();
  }
  const listed = metadata(['vault', 'list', '--format', 'json'], true);
  if (listed.exitCode !== 0) {
    if (metadata(['whoami', '--format', 'json']).exitCode !== 0) return unsigned();
    throw new Error('cannot list 1Password vault metadata; nothing written');
  }
  const aliases = (data: unknown, label: string) => {
    if (!Array.isArray(data)) throw new Error();
    const result = new Map<string, string>();
    for (const entry of data) {
      if (!entry || typeof entry.id !== 'string' || typeof entry[label] !== 'string') throw new Error();
      result.set(lower(entry.id), entry.id); result.set(lower(entry[label]), entry.id);
    }
    return result;
  };
  let vaults: Map<string, string>;
  try { vaults = aliases(JSON.parse(listed.stdout!.toString()), 'name'); }
  catch { throw new Error('invalid 1Password vault metadata; nothing written'); }
  const missing: string[] = [], itemLists = new Map<string, Map<string, string>>(), fieldsByItem = new Map<string, Set<string>>();
  for (const [vault, items] of groups) {
    const vaultId = vaults.get(lower(vault));
    if (!vaultId) {
      missing.push(`missing vault: ${vault}`);
      for (const [item, fields] of items) for (const field of fields) missing.push(`  ${vault}/${item}/${field}`);
      continue;
    }
    if (!itemLists.has(vaultId)) {
      const listedItems = metadata(['item', 'list', '--vault', vault, '--format', 'json'], true);
      if (listedItems.exitCode !== 0) {
        if (metadata(['whoami', '--format', 'json']).exitCode !== 0) return unsigned();
        throw new Error(`cannot list 1Password item metadata for vault ${vault}; nothing written`);
      }
      try { itemLists.set(vaultId, aliases(JSON.parse(listedItems.stdout!.toString()), 'title')); }
      catch { throw new Error('invalid 1Password item metadata; nothing written'); }
    }
    for (const [item, fields] of items) {
      const itemId = itemLists.get(vaultId)!.get(lower(item));
      if (!itemId) {
        missing.push(`missing item: ${vault}/${item} (or inaccessible)`);
        for (const field of fields) missing.push(`  ${vault}/${item}/${field}`);
        continue;
      }
      const key = `${vaultId}/${itemId}`;
      if (!fieldsByItem.has(key)) {
        const fetched = metadata(['item', 'get', itemId, '--vault', vaultId, '--format', 'json'], true);
        if (fetched.exitCode !== 0) {
          if (metadata(['whoami', '--format', 'json']).exitCode !== 0) return unsigned();
          throw new Error(`cannot inspect 1Password fields for ${vault}/${item}; nothing written`);
        }
        try { fieldsByItem.set(key, fieldNames(JSON.parse(fetched.stdout!.toString()))); }
        catch { throw new Error('invalid 1Password field metadata; nothing written'); }
        finally { fetched.stdout!.fill(0); }
      }
      for (const field of fields) if (!fieldsByItem.get(key)!.has(lower(field))) missing.push(`missing field: ${vault}/${item}/${field}`);
    }
  }
  if (missing.length) { console.error(missing.join('\n')); return 2; }
  console.log(`${refs.length} ref(s): vaults/items/fields present; nothing written.`);
  return 0;
}
