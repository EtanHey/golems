# Stream helper modules

Callers continue to source `scripts/lib/stream-helpers.sh`. That entry resolves
its own lib directory, sources `portable-stat.sh`, then loads these modules in
fixed order. `STREAM_HELPERS_DIR` still means `scripts/lib`, regardless of the
caller's working directory. Copy the whole library directory when deploying.

| Module | Owns |
|---|---|
| media.sh | Silence, chat counts, video metadata/encoding, tail detection, recording args |
| process.sh | Process identity/termination, file-growth watchdog, newest recording |
| scoring.sh | Circuit state/lock, ordered score merge, completion check |
| transcription.sh | Whisper transports, retries, fallback and failure log |
| notifications.sh | Telegram/WhatsApp payloads, transport and durable retry queues |
| stages.sh | Stage markers, interrupted-run reconciliation, quality and lurker checks |

All existing sourced names, including underscore helpers and portable-stat
functions, remain available. Functions resolve other functions and environment
variables at call time as before. There is no source guard, new function wrapper,
new shell option, or changed function body. Only the entry owns directory setup.

The base goldens and copied-tree tests are documented in
`../../tests/stream-helpers-contract.md`. Bash 3.2 remains supported.

After merge, the lead must restart the live stream watcher to load these
functions, and only when no stream is live. A local test does not prove that the
running watcher has reloaded the code.
