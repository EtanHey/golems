---
name: code
description: Future stub — live code review with voice commentary
---

# Code Review (Live) — Future

> Stub. Vision: Claude watches a file, chimes in with voice when it spots issues or has suggestions.

## Idea

- Watch a file or directory for changes
- On save: analyze diff, speak observations via voice_speak
- User can ask questions back via voice_ask
- Think log captures review notes silently

## Not Yet Implemented

This needs:
- File watcher integration (fs.watch or chokidar)
- Debounce logic (don't speak on every keystroke)
- Context window management (don't re-review unchanged code)
- Priority system (only speak on HIGH severity, log the rest)
