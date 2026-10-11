#!/usr/bin/env node
// PR prose is data: passed through env, never interpolated into a shell command.
const { PR_BODY = '', PR_AUTHOR = '' } = process.env;
if (PR_AUTHOR === 'dependabot[bot]') {
  console.log('Loop-record: Dependabot exempt');
} else {
  const lines = PR_BODY.split(/\r?\n/).filter(line => /^Loop-record:/.test(line));
  const token = '[A-Za-z0-9][A-Za-z0-9._+-]*';
  const record = new RegExp(`^Loop-record: implementer=${token}/${token}/${token} reviewer=(?:${token}/${token}|none) rounds=[0-9]+/[0-9]+ defects=[0-9]+ role=(?:lead|worker)$`);
  if (lines.length !== 1 || !record.test(lines[0])) {
    console.error(lines.length === 0
      ? 'missing Loop-record: add the pr-loop PR-body template with observed values'
      : 'malformed Loop-record: require exactly one line with implementer=vendor/model/effort reviewer=vendor/model|none rounds=inner/remote defects=n role=lead|worker');
    process.exitCode = 1;
  } else {
    console.log('Loop-record: valid');
  }
}
