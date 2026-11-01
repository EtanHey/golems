import { test, expect } from 'bun:test';
import { parseRows, evaluate, renderTable, readVerdict, expectedReporting } from '../ratchet/table.mjs';
import { checkVerdict } from '../ratchet/check-comment.mjs';
import { checkLiveFreshness } from '../ratchet/live-freshness.mjs';
import { runRows } from '../ratchet/run-rows.mjs';
const until = '2026-11-09T00:00:00Z';
const before = Date.parse(until) - 1;
const head = 'a'.repeat(40);
const row = { id: 'installed-skill-parity', metric: 'parity', kind: 'real', runner: 'live', direction: 'pass', ceiling: true, command: 'exit 1', bug_sha: head, fix_sha: head, report_only: 'until-i5-run2', report_only_until: until };
const doc = r => ({ schema: 1, rows: [r] });
test('parity policy schema accepts only the scoped policy and exact expiry', () => {
  expect(parseRows(doc(row))).toEqual(doc(row));
  for (const patch of [{ id: 'other' }, { runner: 'mac' }, { kind: 'unit' }, { report_only: true }, { report_only_until: '2026-11-10T00:00:00Z' }, { report_only: undefined }]) {
    expect(() => parseRows(doc({ ...row, ...patch }))).toThrow();
  }
});
test('parity warning expires at the deadline across table, comment and freshness', () => {
  for (const now of [before, Date.parse(until), Date.parse(until) + 1]) {
    for (const value of [false, true]) {
      const active = now < Date.parse(until);
      const evaluation = evaluate({ rows: doc(row), baseRows: doc(row), results: { head_sha: head, results: { [row.id]: value } }, head, now });
      expect(evaluation.ok).toBe(active || value);
      const body = renderTable(evaluation, { marker: 'golems-ratchet-live' });
      expect(readVerdict(body, 'golems-ratchet-live').report_only).toEqual(active ? [{ id: row.id, until }] : undefined);
      if (active) expect(body).toContain('report-only, until 2026-11-09');
      const comments = [{ user: { login: 'EtanHey' }, body }];
      const expectedReportOnly = active ? [{ id: row.id, until }] : [];
      const args = { comments, head, marker: 'golems-ratchet-live', expectedReal: 1, authors: ['EtanHey'], baseHasRows: true, expectedReportOnly, now };
      expect(checkVerdict(args).ok).toBe(active || value);
      expect(checkLiveFreshness({ guardedHead: head, pulls: [{ merged_at: 'today', base: { ref: 'master' }, merge_commit_sha: head }], comments, expectedReal: 1, expectedReportOnly, now }).ok).toBe(active || value);
      if (active) {
        expect(checkVerdict({ ...args, now: Date.parse(until) }).ok).toBe(false);
        expect(checkVerdict({ ...args, expectedReportOnly: [{ id: row.id, until: '2026-11-10T00:00:00Z' }] }).ok).toBe(false);
      }
    }
  }
});
test('producer retains normal parity exit status and missing data stays blocking', () => {
  expect(runRows({ rows: doc(row), head }).results[row.id].value).toBe(false);
  expect(evaluate({ rows: doc(row), baseRows: doc(row), head, now: before, results: { head_sha: head, results: {} } }).ok).toBe(false);
});

test('live expectation derives only active live policy, and transition needs ruling', () => {
  expect(expectedReporting(doc(row), 'live', before)).toEqual([{ id: row.id, until }]);
  expect(expectedReporting(doc(row), 'live', Date.parse(until))).toEqual([]);
  expect(expectedReporting(doc(row), 'mac', before)).toEqual([]);
  const enforced = { ...row }; delete enforced.report_only; delete enforced.report_only_until;
  const args = { rows: doc(row), baseRows: doc(enforced), head, now: before, results: { head_sha: head, results: { [row.id]: false } } };
  expect(evaluate(args).ok).toBe(false);
  const ruled = evaluate({ ...args, prBody: 'ratchet-loosen: installed-skill-parity approved until run 1 or expiry' });
  expect(ruled.ok).toBe(true);
  expect(renderTable(ruled, { marker: 'live' })).toContain('temporary report-only');
});

test('base rows may carry the previous parity policy; current rows stay strict', () => {
  const old = { ...row, report_only: 'until-m1-run1', report_only_until: '2026-11-02T00:00:00Z' };
  expect(() => parseRows(doc(old))).toThrow();
  expect(parseRows(doc(old), { base: true })).toEqual(doc(old));
  for (const bad of [{ ...old, report_only_until: '2026-11-03T00:00:00Z' }, { ...old, report_only: 'until-anything' }, { ...old, id: 'other' }]) {
    expect(() => parseRows(doc(bad), { base: true })).toThrow();
  }
  // The real transition: base carries the old policy, head carries the new one, and the table renders both dates in full.
  const evaluation = evaluate({ rows: doc(row), baseRows: parseRows(doc(old), { base: true }), results: { head_sha: head, results: { [row.id]: false } }, head, now: before });
  expect(evaluation.ok).toBe(true);
  const body = renderTable(evaluation, { marker: 'golems-ratchet-live' });
  expect(body).toContain('2026-11-02T00:00:00Z');
  expect(body).toContain('2026-11-09T00:00:00Z');
});

test('freshness reads master rows in base mode: an old-pair master row parses and reporting is computed', () => {
  const old = { ...row, report_only: 'until-m1-run1', report_only_until: '2026-11-02T00:00:00Z' };
  const masterRows = parseRows(doc(old), { base: true });
  expect(() => expectedReporting(masterRows, 'live')).not.toThrow();
  expect(Array.isArray(expectedReporting(masterRows, 'live'))).toBe(true);
  expect(expectedReporting(parseRows(doc(row), { base: true }), 'live')).toEqual(expectedReporting(parseRows(doc(row)), 'live'));
});

test('a receipt written under the previous parity date stays valid only where master rows still expect it', () => {
  const old = { ...row, report_only: 'until-m1-run1', report_only_until: '2026-11-02T00:00:00Z' };
  const oldUntil = old.report_only_until;
  const evaluation = evaluate({ rows: doc(old), baseRows: doc(old), results: { head_sha: head, results: { [row.id]: false } }, head, now: Date.parse(oldUntil) - 1, base: true });
  const body = renderTable(evaluation, { marker: 'golems-ratchet-live' });
  const args = { comments: [{ user: { login: 'EtanHey' }, body }], head, marker: 'golems-ratchet-live', expectedReal: 1, authors: ['EtanHey'], baseHasRows: true, now: Date.parse(oldUntil) - 1 };
  expect(readVerdict(body, 'golems-ratchet-live').report_only).toEqual([{ id: row.id, until: oldUntil }]);
  expect(checkVerdict({ ...args, expectedReportOnly: [{ id: row.id, until: oldUntil }] }).ok).toBe(true);
  expect(checkVerdict({ ...args, expectedReportOnly: [{ id: row.id, until: until }] }).ok).toBe(false);
  // An arbitrary date that is neither current nor history still fails.
  const forged = body.replaceAll(oldUntil, '2026-11-05T00:00:00Z');
  expect(checkVerdict({ ...args, comments: [{ user: { login: 'EtanHey' }, body: forged }], expectedReportOnly: [{ id: row.id, until: '2026-11-05T00:00:00Z' }] }).ok).toBe(false);
});
