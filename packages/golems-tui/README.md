# golems-tui

> React Ink terminal dashboard for the Golems ecosystem.

## What it does

A terminal UI that shows the status of all golems and services at a glance. Built with React Ink for rich terminal rendering with keyboard navigation.

## Quick start

```bash
bun run packages/golems-tui/src/index.tsx
# or
golems-tui
```

## Components

| Component | Description |
|-----------|-------------|
| `Dashboard` | Main view — lists all golems with status indicators |
| `GolemCard` | Per-golem status card with emoji, name, and detail |

## Stack

- **React Ink** — React for the terminal (raw mode, keyboard input)
- **Bun** — Runtime
- **TypeScript** — Strict types for golem/service status

## Keyboard

- `q` / `Ctrl+C` — Quit
- Arrow keys — Navigate between golems
