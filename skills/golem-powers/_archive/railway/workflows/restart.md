---
name: restart
description: Restart Railway service without rebuilding
---

# Restart Service

```bash
# Restart (no rebuild, just restart the process)
railway restart

# Redeploy (rebuild from latest uploaded code)
railway redeploy
```

Use `restart` when env vars changed. Use `redeploy` when you want to rebuild without re-uploading code. Use `railway up` when you have new code to deploy.
