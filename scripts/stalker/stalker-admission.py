"""Source-only admission ledger; no caller liveness or capture observations."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import sys

TABLE = "CREATE TABLE jobs (job TEXT PRIMARY KEY, request_hash TEXT NOT NULL, resource TEXT NOT NULL, work TEXT NOT NULL, state TEXT NOT NULL, device INTEGER, reserved INTEGER NOT NULL, claim TEXT UNIQUE, receipt TEXT NOT NULL)"
INDEX = "CREATE UNIQUE INDEX active_resource ON jobs(resource) WHERE state='active'"


class Invalid(ValueError):
    pass


def result(reason, **fields):
    return dict(schemaVersion=1, authorized=False, reason=reason,
                utc=datetime.now(timezone.utc).isoformat(), **fields)


def normalized(request):
    if not isinstance(request, dict):
        raise Invalid('INVALID_REQUEST')
    r = request.copy()
    common = {'schemaVersion', 'kind', 'jobKey', 'spool', 'expectedBytes', 'temporaryBytes', 'derivedBytes'}
    identity = {'capture': {'platform', 'channel', 'broadcastId'}, 'ingest': {'sourceSha256', 'configSha256'}}
    if not isinstance(r.get('kind'), str) or r['kind'] not in identity:
        raise Invalid('INVALID_IDENTITY')
    required = common | identity[r['kind']]
    if not required <= r.keys() or r.keys() - (required | {'reserveBytes'}):
        raise Invalid('INVALID_REQUEST')
    if type(r['schemaVersion']) is not int or r['schemaVersion'] != 1:
        raise Invalid('INVALID_SCHEMA')
    for key in {'jobKey', 'spool'} | identity[r['kind']]:
        if not isinstance(r[key], str) or not r[key].strip() or r[key] != r[key].strip():
            raise Invalid('INVALID_IDENTITY')
    try:
        spool = Path(r['spool']).resolve(strict=True)
    except (OSError, ValueError):
        raise Invalid('INVALID_SPOOL') from None
    if not spool.is_dir() or str(spool) != r['spool']:
        raise Invalid('INVALID_SPOOL')
    r.setdefault('reserveBytes', 20 * 1024**3)
    terms = [r[k] for k in ('expectedBytes', 'temporaryBytes', 'derivedBytes', 'reserveBytes')]
    if any(type(n) is not int or n < 0 for n in terms) or sum(terms) > 2**63 - 1:
        raise Invalid('INVALID_BUDGET')
    if r['kind'] == 'capture':
        if not re.fullmatch(r'[a-z][a-z0-9_-]*', r['platform']) or not re.fullmatch(r'[A-Za-z0-9_-]+', r['channel']):
            raise Invalid('INVALID_IDENTITY')
        r['channel'] = r['channel'].lower()
        resource = 'capture:' + r['channel']
        work = json.dumps([r['platform'], r['broadcastId']])
    else:
        if any(not re.fullmatch(r'[0-9a-f]{64}', r[k]) for k in identity['ingest']):
            raise Invalid('INVALID_IDENTITY')
        resource = 'ingest:' + r['sourceSha256'] + ':' + r['configSha256']
        work = resource
    return r, resource, work, sum(terms)


def observe_spool(spool):
    return Path(spool).stat().st_dev, shutil.disk_usage(spool).free


def transact(path, action, data, observe=observe_spool):
    db = None
    bootstrap_lock = None
    affected = {'jobKey': data} if action == 'inspect' else {}
    try:
        if action == 'admit':
            if isinstance(data, dict) and isinstance(data.get('jobKey'), str):
                affected = dict(jobKey=data['jobKey'])
            r, resource, work, required = normalized(data)
            affected = dict(jobKey=r['jobKey'], resourceKey=resource, workIdentity=work)
        path = Path(path).resolve()
        if path.is_dir():
            raise OSError('ledger is a directory')
        bootstrap_lock = path.with_name(path.name + '.init.lock').open('a')
        fcntl.flock(bootstrap_lock, fcntl.LOCK_EX)
        exists = path.exists()
        if not exists and action != 'admit':
            raise OSError('missing ledger')
        db = sqlite3.connect(path, timeout=10, isolation_level=None)
        db.execute('BEGIN IMMEDIATE')
        schema = {row[0]: row[1] for row in db.execute("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL")}
        version = db.execute('PRAGMA user_version').fetchone()[0]
        if not exists and not schema and version == 0:
            db.execute(TABLE)
            db.execute(INDEX)
            db.execute('PRAGMA user_version=1')
        elif version != 1 or schema != {'jobs': TABLE, 'active_resource': INDEX}:
            raise Invalid('INVALID_SCHEMA')
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise sqlite3.DatabaseError('corrupt ledger')
        bootstrap_lock.close()  # SQLite now owns the transaction, including first schema creation.
        if action == 'admit':
            digest = hashlib.sha256(json.dumps(r, sort_keys=True).encode()).hexdigest()
            old = db.execute('SELECT request_hash, receipt FROM jobs WHERE job=?', (r['jobKey'],)).fetchone()
            if old:
                answer = (75, json.loads(old[1]) | {'authorized': False, 'reason': 'REPLAY'}) if old[0] == digest else (64, result('IDENTITY_CONFLICT', **affected))
            elif db.execute("SELECT 1 FROM jobs WHERE work=? AND state='complete'", (work,)).fetchone():
                answer = 75, result('WORK_COMPLETE', **affected)
            elif db.execute("SELECT 1 FROM jobs WHERE work=? AND state='active'", (work,)).fetchone():
                answer = 75, result('RECOVERY_REQUIRED', **affected)
            elif db.execute("SELECT 1 FROM jobs WHERE resource=? AND state='active'", (resource,)).fetchone():
                answer = 75, result('BUSY', **affected)
            else:
                device, free = observe(r['spool'])
                outstanding = sum(row[0] for row in db.execute("SELECT reserved FROM jobs WHERE device=? AND state='active'", (device,)))
                allowed = free - outstanding >= required
                receipt = result('ADMITTED' if allowed else 'LOW_DISK', **affected,
                                 state='active' if allowed else 'refused', request=r, device=device,
                                 freeBytes=free, outstandingBytes=outstanding, requiredBytes=required)
                if r['kind'] == 'capture':
                    receipt.update(coverageStatus='unknown', coverageReason='capture_not_observed')
                claim = secrets.token_urlsafe(32) if allowed else None
                receipt.update(authorized=allowed, claim=claim)
                db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?)',
                           (r['jobKey'], digest, resource, work, receipt['state'], device,
                            required if allowed else 0, claim, json.dumps(receipt)))
                answer = (0 if allowed else 75), receipt
        elif action == 'finish':
            claim, outcome = data
            if outcome not in ('complete', 'failed') or not isinstance(claim, str) or not claim:
                raise Invalid('INVALID_FINISH')
            row = db.execute("SELECT receipt FROM jobs WHERE claim=? AND state='active'", (claim,)).fetchone()
            if row:
                receipt = json.loads(row[0]) | dict(authorized=False, state=outcome,
                                                  reason='FINISHED', finishedUtc=result('')['utc'])
                db.execute('UPDATE jobs SET state=?, reserved=0, receipt=? WHERE claim=?', (outcome, json.dumps(receipt), claim))
                answer = 0, receipt
            else:
                answer = 75, result('INVALID_CLAIM')
        else:
            affected = dict(jobKey=data)
            row = db.execute('SELECT receipt FROM jobs WHERE job=?', (data,)).fetchone()
            answer = (0, json.loads(row[0]) | {'authorized': False}) if row else (64, result('UNKNOWN_JOB', **affected))
        db.execute('COMMIT')
        return answer
    except Invalid as error:
        return 64, result(str(error), **affected)
    except (sqlite3.Error, OSError, ValueError, TypeError, OverflowError):
        return 73, result('STORAGE_ERROR', **affected)
    finally:
        if db is not None:
            db.close()
        if bootstrap_lock is not None:
            bootstrap_lock.close()


def admit(db, request, *, observe=observe_spool):
    return transact(db, 'admit', request, observe)


def finish(db, claim, outcome):
    return transact(db, 'finish', (claim, outcome))


def inspect(db, job_key):
    return transact(db, 'inspect', job_key)


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Invalid('INVALID_ARGUMENTS')


def main():
    try:
        parser = Parser(description=__doc__)
        commands = parser.add_subparsers(dest='action', required=True, parser_class=Parser)
        for name, flags in [('admit', ['request']), ('finish', ['claim', 'outcome']), ('inspect', ['job-key'])]:
            command = commands.add_parser(name)
            command.add_argument('--db', required=True)
            for flag in flags:
                command.add_argument('--' + flag, required=True)
        args = parser.parse_args()
        if args.action == 'admit':
            code, receipt = admit(args.db, json.loads(Path(args.request).read_text()))
        elif args.action == 'finish':
            code, receipt = finish(args.db, args.claim, args.outcome)
        else:
            code, receipt = inspect(args.db, args.job_key)
    except (Invalid, json.JSONDecodeError, UnicodeError) as error:
        code, receipt = 64, result(str(error) if isinstance(error, Invalid) else 'INVALID_JSON')
    except OSError:
        code, receipt = 73, result('STORAGE_ERROR')
    print(json.dumps(receipt), file=sys.stderr if code else sys.stdout)
    return code


if __name__ == '__main__':
    sys.exit(main())
