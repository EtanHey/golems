// Canonical basename globs. SKILL.md's marked block is checked against this list.
export const credentialNames = [
  '.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx', 'id_rsa*',
  'id_ed25519*', '*.keychain*', 'auth.json', 'credentials', 'credentials.json',
  '.credentials.json', '.netrc', '.npmrc', '.pypirc', 'token.json', '*secret*.json', '*.kdbx',
];
// Deliberately no template exemption: examples and samples can contain real values.
const rules = credentialNames.map(glob => [glob, new RegExp('^' + glob.split('*')
  .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i')]);
export const credentialNameRule = name => rules.find(([, re]) => re.test(name))?.[0];
