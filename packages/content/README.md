# @golems/content

ContentGolem — LinkedIn posts, Soltome publishing, and ghostwriting.

## What It Does

- Drafts content matching the owner's voice
- Critique-waves pattern: generate -> critique -> refine -> polish
- Publishes to Soltome (credit-powered AI discussion platform)
- Manages content calendar and posting schedule

## Current State

Code lives in `src/` (content pipeline, brand schema, ComfyUI image generation, data-viz, quality scoring, Remotion rendering, HTTP service), with CLI entry points in `scripts/`, n8n workflows in `workflows/`, and the `draft` / `publish` skills in `skills/`.

See [CLAUDE.md](./CLAUDE.md) for the content pipeline and Soltome API.
