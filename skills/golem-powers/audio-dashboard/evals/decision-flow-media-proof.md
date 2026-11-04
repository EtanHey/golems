# Sticky media transport proof
Status: source implementation; review pending.

The browser test is discovered by `bun run test:spine-gates` through the audio-dashboard eval directory. CI installs Chromium and sets ADASH_LAYOUT_REQUIRED=1. Missing Playwright is a failure, not a skip.

Run: `ADASH_MEDIA_PROOF=docs.local/sticky-player/proof bun test skills/golem-powers/audio-dashboard/evals/decision-flow-media-browser.test.mjs`.

Native ten-second silent PCM media, delayed native play invocation, one injected NotAllowedError. No synthetic play/pause/ended events or mocked paused property. Completion uses a native seek near the end. Existing replay icon/action is retained after completion. Section-control handlers are invoked programmatically in story view; sticky start uses keyboard and subsequent sticky actions use browser clicks. This isolates media synchronization from idle list scroll-follow. All Chromium instances use --mute-audio and close in finally.

Old template reproduced ▶ while native audio was playing. Fixed template synchronizes via native play/pause events and restarts media-time ticking when delayed playback starts. Current card is resolved at event time, so a noncurrent event cannot select its own label.

Private 0300 candidate, preservation receipt, scripts, screenshots/video and maintenance logs live under the parent sticky-player folder, outside this public repo. No live runtime/account or deployment acceptance is claimed.

R2: external pause must synchronize the filled sticky, Resume accessible action and section Resume. Pending operation identity protects seek/handoff pause events and stale promise rejection. Tests assert native seek followed by delayed start, highlight and progress. Synthetic indexed B1 before/after proof is in proof/sticky-r2/ (baseline 9dbb9c02); interaction.gif shows pause/resume. No private dashboard content is included. N2 pending Next hidden playback is pre-existing and queued separately; not fixed here.
