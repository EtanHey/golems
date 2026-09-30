// Migration aid, never an authorization or a promise that arbitrary env is safe.
// Unknown names need a human ruling; do not turn them into op refs implicitly.
export function classifyEnvKey(key: string): 'secret' | 'config' | 'ambiguous' {
  if (key === 'MCPLAYER_BRAINLAYER_FRONT' || key === 'PUBLIC_KEY' || /(?:^|_)(?:PATH|DIR|BIN|URL|HOST|PORT|REPO|ENABLED|DISABLED)$/.test(key) || /(?:^|_)(?:DISABLE|ENABLE)(?:_|$)/.test(key)) return 'config';
  if (/(?:^|_)(?:API_KEY|ACCESS_KEY|PRIVATE_KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)$/.test(key)) return 'secret';
  return 'ambiguous';
}
