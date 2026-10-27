#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function runBudget({ token, now = Date.now(), fetch = globalThis.fetch, log = console.log } = {}) {
  try {
    token ??= process.env.VERCEL_TOKEN || JSON.parse(await readFile(resolve(homedir(), 'Library/Application Support/com.vercel.cli/auth.json'), 'utf8')).token;
    if (typeof token !== 'string' || !token.trim()) throw new Error();
    let until = now;
    const seen = new Set(), projects = new Map();
    for (;;) {
      const url = new URL('https://api.vercel.com/v6/deployments');
      url.search = new URLSearchParams({teamId:'team_QUz2CYVyqnNzeuj3h9lfY3tF',limit:'100',since:String(now-86400000),until:String(until)});
      const response = await fetch(url, {method:'GET',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000),redirect:'error'});
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!Array.isArray(data.deployments) || !data.pagination || !Object.hasOwn(data.pagination,'next')) throw new Error();
      for (const deployment of data.deployments) {
        if (typeof deployment.uid !== 'string' || typeof deployment.name !== 'string') throw new Error();
        if (seen.has(deployment.uid)) continue;
        seen.add(deployment.uid);
        projects.set(deployment.name, (projects.get(deployment.name) || 0) + 1);
      }
      const next = data.pagination.next;
      if (next === null) break;
      if (!Number.isSafeInteger(next) || next >= until || next <= 0) throw new Error();
      until = next;
    }
    const count = seen.size;
    log(`vercel-budget: ${count}/100 (soft 60) ${count>=100?'AT-CAP':count>=60?'SOFT-LIMIT':'OK'}`);
    for (const [name, count] of [...projects].sort(([a],[b])=>a.localeCompare(b))) log(`  ${name}: ${count}`);
    return count>=100?4:count>=60?3:0;
  } catch {
    // Never include API bodies or exception messages: either can expose credentials.
    log('vercel-budget: ERROR (authentication, network, or invalid API response; budget unknown)');
    return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await runBudget();
