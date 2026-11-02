import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseRows } from '../ratchet/table.mjs';

test('native Codex denial/allow is a required real Mac row in scratch HOME', () => {
  const doc = parseRows(JSON.parse(readFileSync(new URL('../ratchet/rows.json', import.meta.url))));
  const row = doc.rows.find(row => row.id === 'codex-native-hooks');
  expect(row).toBeDefined();
  expect(row).toMatchObject({ runner: 'mac', kind: 'real', direction: 'pass', ceiling: true });
  expect(row.command).toContain('GOLEMS_REQUIRE_CODEX=1');
  expect(row.command).toContain('HOME="${RATCHET_HOME:?}"');
  expect(row.command).toContain('CODEX_HOME="${RATCHET_HOME:?}/.codex"');
  expect(row.command).toContain('${RATCHET_CLONE:?}/scripts/tests/test_codex_hooks_native.py');
});
