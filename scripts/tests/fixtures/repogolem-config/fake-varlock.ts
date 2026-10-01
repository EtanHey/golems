// Real varlock load --format json success: flat KEY -> scalar object.
import { readFileSync } from 'node:fs';
const path = process.argv[process.argv.indexOf('--path') + 1];
const keys = [...readFileSync(path, 'utf8').matchAll(/^(REPOGOLEM_SECRET_[a-f0-9]{32})=/gm)].map(m => m[1]);
if (process.env.FAKE_VARLOCK_MODE === 'unreadable') process.stdout.write('PRIVATE_VARLOCK_CANARY');
else if (process.env.FAKE_VARLOCK_MODE === 'extra') console.log(JSON.stringify({ ...Object.fromEntries(keys.map(k => [k, 'value'])), EXTRA: 'PRIVATE_VARLOCK_CANARY' }));
else console.log(JSON.stringify(Object.fromEntries(keys.map(k => [k, null]))));
