# Vercel deployment policy

Etan, verbatim: "we also need to see how we make sure work doesn't deploy endlessly, maybe only have vercel deploy after review rounds are approved or something? Idk how we avoid the limit from here on out when vercel allows so we dont get here again"

## Phase 1

1. Every Git-linked project gets `"git": { "deploymentEnabled": { "*": false, "<production branch>": true } }` in the vercel.json at its root directory
   (voicelayer `site/vercel.json`, cmuxlayer `site/vercel.json`, etanheyman.com root, songscript root (`master`), casona_diez_diez root, 100-days-css root).
   Effect: branch/PR pushes create NO deployment; merges to the default branch still deploy production. Expected: ~72/day of previews gone → ~48/day,
   under the 60 soft budget, with no human needed.
2. No manual deploys: agents never run `vercel deploy` / `vercel --prod` / `npx vercel`. Only the deploy agent (deploy-local-prod) may, and only for a
   default-branch SHA or an explicit `deploy-preview` request, after a read-only budget check (point 4). brainlayer (no Git link, CLI only) is governed by this rule.
3. The policy text lives in ONE place: golems `standards/vercel-deploys.md`. skill-creator points /pr-loop and the deploy-local-prod agent at it.
4. A budget check: `scripts/vercel-budget.mjs` (golems) reads the team's deployments in the last 24 h (read-only GET, existing CLI auth on the M4 Max) and prints
   count / soft limit 60 / hard cap 100. The deploy agent and any preview request must run it first, and refuse above 60 (production merges still deploy via Git).


## Phase 2

pending Etan: needs a Vercel token secret

On-demand approved/labelled previews once per PR head, production site-path gating for VoiceLayer/cmuxlayer, and scheduled budget alerts remain pending. Credentials require Etan.

## Project inventory

Observed 2026-10-27; configuration changes land in separate repo PRs.

| Project | Project ID | Root directory | Production branch |
| --- | --- | --- | --- |
| casona-diez-diez | `prj_TkwtWK5LSSrUOooMfsZjDQJ7sg8W` | repo root (API null) | `main` |
| etanheyman-com | `prj_MENW0pjOGKxmZjzJj6hcxKL29hxK` | repo root (API null) | `main` |
| voicelayer | `prj_MlGdvWXcTCdNE6dKXvDyi6jprTB8` | `site` | `main` |
| cmuxlayer | `prj_eApdZ9ZUZ5hUcUxhjXsyu5ZHyE2e` | `site` | `main` |
| songscript | `prj_8iZdoVNAcROVn4OMMzO0m0FGcBBV` | repo root (API null) | `master` |
| brainlayer | `prj_AEJ9PibcOrQRLYoh6HwSrvxERlxz` | repo root (API null) | no Git link (CLI only) |
| 100-days-css | `prj_fqsVmEFaYqShLhSOpGHfAEHcZruz` | repo root (API null) | `main` |

Ignored/cancelled builds still use deployment quota. `ignoreCommand` does not save quota; disable deployment creation with `git.deploymentEnabled`. See [Vercel project settings](https://vercel.com/docs/project-configuration/project-settings).

## Read-only budget check

Run `node scripts/vercel-budget.mjs`. Uses `VERCEL_TOKEN` when set, otherwise the existing macOS CLI auth file at `~/Library/Application Support/com.vercel.cli/auth.json`. Never print or commit that file.

Counts all team deployment records (including errors/cancellations) in a fixed rolling 24-hour window using paginated `GET /v6/deployments`; this is an observed API count, not a billing ledger or rejected attempts. Exit 0 below 60, 3 at 60–99, 4 at 100+, 2 on error. Error means unknown budget, never permission to deploy. Refuse discretionary deploys at 60 or above. Production Git merges still deploy.
