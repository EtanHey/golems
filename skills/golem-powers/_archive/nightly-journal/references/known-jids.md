# Known Chat JIDs

> WhatsApp MCP can't search Hebrew+emoji group names. Use JIDs directly.
> Update this file when new client/project chats are created.

**NOTE:** Real JIDs are stored in BrainLayer (search: "whatsapp jids known contacts").
This file contains placeholders only — do NOT commit real JIDs to git.

## WhatsApp Business

| Chat | JID | Type |
|------|-----|------|
| Client Dev Group | `<brain_search: client dev group jid>` | Client group |
| Job Lead | `<brain_search: job lead jid>` | Job lead |
| Client Contact | `<brain_search: client contact jid>` | Client contact |

## WhatsApp Personal

| Chat | JID | Type |
|------|-----|------|
| Project Group | `<brain_search: project group jid>` | Project group |

## How to Find JIDs

```bash
# List recent chats to find JIDs
mcp__whatsapp__list_chats(limit=20, sort_by="last_active")
```

If Hebrew name search fails, browse recent chats and match by last_message content.

To populate real JIDs: `brain_search("whatsapp jids known contacts")` — stored there to avoid committing to git.
