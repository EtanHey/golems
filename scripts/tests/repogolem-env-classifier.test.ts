import { expect, test } from 'bun:test';
import { classifyEnvKey } from '../repogolem/repogolem-env-classifier';
test('credential names are secrets; executable paths, hosts and flags are config', () => {
  for (const key of ['SVGMAKER_API_KEY','YOUTUBE_API_KEY','SUPABASE_ACCESS_TOKEN','LEUMI_PASSWORD','EXAMPLE_SECRET','PRIVATE_KEY']) expect(classifyEnvKey(key)).toBe('secret');
  for (const key of ['MCPLAYER_BRAINLAYER_FRONT','PUPPETEER_EXECUTABLE_PATH','CLAUDE_CODE_DISABLE_TERMINAL_TITLE','AGENT_HTML_HOST_REPO','AGENT_HTML_HOST_BASE_URL','TOKEN_ENDPOINT_URL','PUBLIC_KEY']) expect(classifyEnvKey(key)).toBe('config');
  for (const key of ['LEUMI_USERNAME','SESSION','EXAMPLE_SETTING']) expect(classifyEnvKey(key)).toBe('ambiguous');
});
