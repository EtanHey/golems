---
name: deploy
description: Deploy latest code to Railway
---

# Deploy to Railway

## Steps

1. **Verify you're on the right branch with latest code:**
```bash
git branch --show-current
git log --oneline -3
```

2. **Deploy:**
```bash
railway up --detach
```

The `--detach` flag returns immediately with a build log URL. The build takes 1-3 minutes.

3. **Verify deployment:**
```bash
railway logs --num 20
```

Look for the health check passing and "Cloud worker started" message.

## Troubleshooting

- **"Could not find root directory"** — Run `railway link` to link the CLI to your project.
- **Build fails** — Check `railway logs` for errors. Common: missing env vars, Dockerfile issues.
- **Health check fails** — The `/health` endpoint must respond within 300s. Check if `cloud-worker.ts` starts correctly.
