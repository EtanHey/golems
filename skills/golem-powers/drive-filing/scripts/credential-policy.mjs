import { basename } from 'node:path';
// Canonical always-held basename globs. SKILL.md checks this list for drift.
export const credentialNames = [
  '.env', '.env.*', '.envrc', '*.pem', '*.key', '*.p12', '*.pfx', 'id_rsa*',
  'id_ed25519*', '*.keychain*', 'auth.json', 'credentials', 'credentials.json',
  '.credentials.json', '.netrc', '.npmrc', '.pypirc', 'token.json', '*secret*.json', '*.kdbx',
  '.git-credentials', 'application_default_credentials.json', 'service-account*.json',
  '*.p8', '*.keystore', '*.jks', '.pgpass', 'Login Data', 'Login Data For Account',
  'Cookies', 'Cookies-journal', 'Local State', 'Web Data', '*.ovpn', 'wallet.dat',
  '*_rsa', '*_ed25519', '*_ecdsa',
];
export const templateName = name => /^\.env\.(example|sample)$/i.test(name);
const rules = credentialNames.map(glob => [glob, new RegExp('^' + glob.split('*')
  .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')]);
export const credentialNameRule = name => templateName(name) ? undefined : rules.find(([, re]) =>
  re.test(name) || re.test(name.replace(/^20\d{2}-\d{2}-\d{2}[-_]/, '')))?.[0];
export const wordName = name => /credential|secret|token|env/i.test(name);
export const packageTree = path => /(?:^|[/\\])(?:node_modules|site-packages|vendor|\.venv)(?:[/\\]|$)/i.test(path);
export function credentialPathRule(path) {
  const contextual = /(?:^|[/\\])(\.docker[/\\]config\.json|\.kube[/\\]config|\.aws[/\\]credentials)$/i.exec(path);
  return contextual?.[1].replaceAll('\\', '/') ?? credentialNameRule(basename(path));
}
