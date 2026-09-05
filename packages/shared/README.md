# @golems/shared

Shared infrastructure for the Golems ecosystem.

## What's Inside

- **Supabase** — client factory, DB queries
- **LLM** — multi-backend abstraction (Haiku, Ollama)
- **Email** — Gmail API, scoring, routing, MCP server
- **State** — file/Supabase state store, event log
- **Notifications** — Telegram direct sender
- **Types** — GolemStatus, TopicStyle, shared interfaces

## Usage

```typescript
import { createSupabaseClient } from "@golems/shared/lib/supabase-factory";
import { sendNotification } from "@golems/shared/lib/telegram-direct";
import { logEvent } from "@golems/shared/lib/event-log";
```

See [CLAUDE.md](./CLAUDE.md) for architecture and module documentation.
