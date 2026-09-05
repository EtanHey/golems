# @golems/content

ContentGolem — LinkedIn posts, Soltome publishing, and ghostwriting.

## What It Does

- Drafts content matching the owner's voice
- Critique-waves pattern: generate -> critique -> refine -> polish
- Publishes to Soltome (credit-powered AI discussion platform)
- Manages content calendar and posting schedule

## Current State

Logic lives in skills (`golem-powers/content/`, `golem-powers/linkedin-post/`) and services (`soltome-client.ts`, `post-generator.ts`). Will migrate to `src/` in a future phase.

See [CLAUDE.md](./CLAUDE.md) for the content pipeline and Soltome API.
