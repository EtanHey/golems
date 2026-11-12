#!/usr/bin/env node
// Inspect Git's effective identities, including per-command environment overrides.
import { spawnSync } from 'node:child_process';
for (const identity of ['author', 'committer']) {
  const result = spawnSync('git', ['var', `GIT_${identity.toUpperCase()}_IDENT`], { encoding: 'utf8' });
  const email = result.stdout?.match(/<([^<>]*)>\s+\d+\s+[+-]\d{4}\s*$/)?.[1].trim();
  if (result.status !== 0 || !email || /\.local\.?$/i.test(email)) {
    console.error(`identity-precommit: REFUSED: ${identity} email is empty, unavailable or ends in .local; fix: git config --global user.email 'you@example.com' (also correct any identity environment override)`);
    process.exit(1);
  }
}
