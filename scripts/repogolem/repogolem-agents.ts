// Templates are public instructions; only declared non-sensitive values may render.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, isAbsolute } from 'node:path';
import { parseCache, privatePath } from './runtime-reader';
import { collectRefs, secretKey } from './repogolem-secrets';
type Input = { name: string; text: string; names: string[]; templateSha: string; manifestSha: string };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const reject = (): never => { throw new Error('agent templates: invalid, undeclared or sensitive placeholder; nothing written'); };
export function prepareAgents(config: any): Input[] {
  const result: Input[] = [];
  const sensitiveSources = new Set([...collectRefs(config).filter(ref=>ref.startsWith('op://')), ...Object.values(config.values ?? {}).filter((value:any)=>value.sensitive !== false).map((value:any)=>value.source).filter(Boolean)]);
  for (const [name, path] of Object.entries(config.agentTemplates ?? {})) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) || typeof path !== 'string' || !isAbsolute(path) || !path.endsWith('.md')) reject();
    let text: string, raw: string, manifest: any;
    try { text = readFileSync(path, 'utf8'); raw = readFileSync(join(dirname(path), basename(path, '.md')+'.values.json'), 'utf8'); manifest = JSON.parse(raw); } catch { reject(); }
    if (manifest?.template !== basename(path) || !Array.isArray(manifest.values)) reject();
    const names: string[] = [];
    for (const value of manifest.values) {
      if (!value || typeof value.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.name) || names.includes(value.name) || value.sensitive !== false || config.values?.[value.name]?.sensitive !== false) reject();
      if (sensitiveSources.has(config.values[value.name].source)) reject();
      names.push(value.name);
    }
    const remaining = text.replace(/{{([A-Za-z_][A-Za-z0-9_]*)}}/g, (_, key) => { if (!names.includes(key)) reject(); return ''; });
    if (remaining.includes('{{') || remaining.includes('}}')) reject();
    result.push({name,text,names,templateSha:hash(text),manifestSha:hash(raw)});
  }
  return result;
}
export function renderAgents(inputs: Input[], values: Map<string,string>, configSha: string, machine: string|null, config: any) {
  const files: Record<string,string> = {}, entries: Record<string,unknown> = {};
  const sensitive = collectRefs(config).filter(ref=>ref.startsWith('op://') || config.values?.[ref.slice(10)]?.sensitive !== false).map(ref=>{const value=values.get(ref);if(!value)reject();return value;});
  for (const input of inputs) {
    for (const name of input.names) if (!values.get('varlock://'+name)) reject();
    for (const name of input.names) if (/[\x00-\x1f\x7f]/.test(values.get('varlock://'+name)!)) reject();
    const text = input.text.replace(/{{([A-Za-z_][A-Za-z0-9_]*)}}/g, (_, name) => values.get('varlock://'+name)!);
    if (sensitive.some(value=>text.includes(value))) reject();
    files[input.name+'.md'] = text;
    entries[input.name] = {templateSha:input.templateSha,manifestSha:input.manifestSha,contentSha:hash(text)};
  }
  return {files,receipt:JSON.stringify({configSha,machine,entries},null,2)+'\n'};
}
// Cache-only verification, shared by --check and installer. Never invokes a provider.
export function cachedAgents(config: any, configText: string, out: string) {
  const inputs = prepareAgents(config);
  if (!inputs.length && !existsSync(join(out,'agents.json'))) return null;
  privatePath(out,true); privatePath(join(out,'agents'),true); privatePath(join(out,'agents.json')); privatePath(join(out,'secrets.env'));
  const receiptText = readFileSync(join(out,'agents.json'),'utf8');
  let receipt: any; try { receipt = JSON.parse(receiptText); } catch { reject(); }
  if (receipt.machine !== null && typeof receipt.machine !== 'string') reject();
  const cache = parseCache(readFileSync(join(out,'secrets.env'),'utf8'));
  const values = new Map(collectRefs(config).map(ref=>[ref,cache[secretKey(ref)]] as [string,string]));
  const expected = renderAgents(inputs,values,hash(configText),receipt.machine,config);
  if (expected.receipt !== receiptText) reject();
  if (readdirSync(join(out,'agents')).sort().join('\0') !== Object.keys(expected.files).sort().join('\0')) reject();
  for (const [name,text] of Object.entries(expected.files)) {
    const path = join(out,'agents',name); privatePath(path);
    if (readFileSync(path,'utf8') !== text) reject();
  }
  return expected;
}
