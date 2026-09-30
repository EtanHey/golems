// Read-only existence preflight: names only, no field inspection or resolver.
export function itemNames(data: unknown): Set<string> {
  if (!Array.isArray(data)) throw new Error("invalid 1Password item metadata; nothing written");
  const names = new Set<string>();
  for (const item of data) {
    if (!item || typeof item.id !== "string" || typeof item.title !== "string") {
      throw new Error("invalid 1Password item metadata; nothing written");
    }
    names.add(item.id);
    names.add(item.title);
  }
  return names;
}

export function checkRefs(refs: string[], opBin: string, noPrompt = false): number {
  const groups = new Map<string, Map<string, string[]>>();
  for (const ref of refs) {
    const match = /^op:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(ref);
    if (!match) throw new Error("invalid op reference; preflight wrote nothing");
    const [, vault, item, field] = match;
    if (!groups.has(vault)) groups.set(vault, new Map());
    const items = groups.get(vault)!;
    if (!items.has(item)) items.set(item, []);
    items.get(item)!.push(field);
  }
  console.log("1Password ref names (vault/item existence only; fields are not read or checked):");
  for (const [vault, items] of groups) {
    console.log(`  ${vault}:`);
    for (const [item, fields] of items) for (const field of fields) console.log(`    ${item}/${field}`);
  }
  if (refs.length === 0) { console.log("No op refs; nothing written."); return 0; }

  const metadata = (args: string[], capture = false) => {
    try {
      return Bun.spawnSync([opBin, ...args], {
        // Interactive default permits Touch ID. Automation opts out explicitly.
        env: { ...process.env, OP_BIOMETRIC_UNLOCK_ENABLED: noPrompt ? "false" : "true" },
        stdin: "ignore", stdout: capture ? "pipe" : "ignore", stderr: "ignore",
        timeout: 15_000,
      });
    } catch { throw new Error("cannot run 1Password CLI for preflight; nothing written"); }
  };
  const unsigned = () => {
    console.error(noPrompt
      ? "1Password is not signed in for non-interactive access; sign in separately, then retry --check-refs --no-prompt. Nothing written."
      : "1Password is not signed in or desktop authorization is unavailable; unlock 1Password and retry --check-refs. Nothing written.");
    return 3;
  };
  if (metadata(["whoami", "--format", "json"]).exitCode !== 0) return unsigned();
  const listed = metadata(["vault", "list", "--format", "json"], true);
  if (listed.exitCode !== 0) {
    if (metadata(["whoami", "--format", "json"]).exitCode !== 0) return unsigned();
    throw new Error("cannot list 1Password vault metadata; nothing written");
  }
  let vaults: Set<string>;
  try {
    const data = JSON.parse(listed.stdout!.toString());
    if (!Array.isArray(data) || data.some(v => typeof v.name !== "string" || typeof v.id !== "string")) throw new Error();
    vaults = new Set(data.flatMap(v => [v.name, v.id]));
  } catch { throw new Error("invalid 1Password vault metadata; nothing written"); }
  const missing: string[] = [];
  for (const [vault, items] of groups) {
    if (!vaults.has(vault)) {
      missing.push(`missing vault: ${vault}`);
      for (const [item, fields] of items) for (const field of fields) missing.push(`  ${vault}/${item}/${field}`);
      continue;
    }
    // List metadata once per vault; never fetch/decrypt whole items with get.
    const listedItems = metadata(["item", "list", "--vault", vault, "--format", "json", "--include-archive"], true);
    if (listedItems.exitCode !== 0) {
      if (metadata(["whoami", "--format", "json"]).exitCode !== 0) return unsigned();
      throw new Error(`cannot list 1Password item metadata for vault ${vault}; nothing written`);
    }
    let names: Set<string>;
    try { names = itemNames(JSON.parse(listedItems.stdout!.toString())); }
    catch { throw new Error("invalid 1Password item metadata; nothing written"); }
    for (const [item, fields] of items) {
      if (names.has(item)) continue;
      missing.push(`missing item: ${vault}/${item} (or inaccessible)`);
      for (const field of fields) missing.push(`  ${vault}/${item}/${field}`);
    }
  }
  if (missing.length) { console.error(missing.join("\n")); return 2; }
  console.log(`${refs.length} ref(s): vaults/items present; nothing written.`);
  return 0;
}
