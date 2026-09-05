#!/usr/bin/env bun
/**
 * Generate plain-text guardian art for iTerm2 badge watermark.
 * Called by repoGolem hook to set badge with guardian art + title.
 *
 * Uses a badge-optimized variant: short lines that tolerate
 * proportional badge fonts. Key guardian elements preserved:
 * clay head (▄█▀), Hebrew אמת, diamond eyes ◆, code mouth {··}.
 *
 * Usage: bun scripts/guardian-badge.ts [title]
 * Output: title + guardian art (for base64 → SetBadgeFormat)
 */

// Badge-optimized guardian — short lines, works in proportional fonts
// Source of truth for full art: @golems/shared/lib/ascii-mascots.ts
const BADGE_ART = `  ▄████▄
 █░אמת░█
 █ ◆  ◆ █
 █ {··} █
  ▀████▀
 ╔══════╗
 ╚══════╝`;

const title = Bun.argv[2] || "Golems";
process.stdout.write(`${title}\n\n${BADGE_ART}\n`);
