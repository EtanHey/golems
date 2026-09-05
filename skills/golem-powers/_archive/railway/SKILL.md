---
name: railway
description: "Deploy and manage the golems cloud-worker on Railway. Use when deploying backend changes, checking logs, managing env vars, or restarting services. Wraps `railway` CLI. Covers railway, deploy, cloud-worker, redeploy, logs, variables. NOT for: Vercel deployments, frontend, Supabase."
paths:
  - "railway.toml"
  - "railway.json"
  - "Procfile"
  - "Dockerfile"
---

# Railway Operations

> Manages the golems cloud-worker service on Railway. The cloud-worker runs email poller, job scraper, briefing, and soltome learner.

## Working Directory

Railway CLI commands can be run directly — no `cd` required. The `railway` CLI uses the linked project config, not the working directory.

If you do get a "Could not find root directory" error, it means `railway link` has not been run yet for this project.

---

## Project Info

| Key | Value |
|-----|-------|
| Project | `helpful-empathy` |
| Service | `golems` |
| Environment | `production` |
| Entry point | `bun run src/cloud-worker.ts` |
| Health check | `/health` |

---

## Quick Actions

| What you want to do | Workflow |
|---------------------|----------|
| Deploy latest code | [workflows/deploy.md](workflows/deploy.md) |
| Check logs | [workflows/logs.md](workflows/logs.md) |
| Manage env vars | [workflows/variables.md](workflows/variables.md) |
| Restart without rebuilding | [workflows/restart.md](workflows/restart.md) |
| Check status | [workflows/status.md](workflows/status.md) |

---

## When to Deploy

Deploy to Railway after merging PRs that change:
- `packages/services/src/cloud-worker.ts` (schedules, worker config)
- `packages/shared/src/email/` (email processing)
- `packages/jobs/src/` (job scraping)
- `packages/shared/src/lib/cloud-llm.ts` (Haiku backend)
- `railway.json`

Do NOT forget to deploy after backend PRs merge. Use the CLI — no "manual redeploy" needed.
