import { readFileSync } from 'node:fs';
import { lintCardFormat } from '../src/card-format.mjs';

try {
  if (process.argv.length !== 3) throw new Error('Usage: bun scripts/lint-card-format.mjs <cards.json>');
  const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  if (!Array.isArray(spec.cards) || !spec.cards.length) throw new Error('Expected a non-empty cards array');
  const violations = spec.cards.flatMap((card, index) =>
    lintCardFormat(card).map(code => ({ card: index, code })));
  console.log(JSON.stringify({ verdict: violations.length ? 'REJECT' : 'PASS', violations }));
  process.exitCode = violations.length ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
