# VoiceBar — Ground-Truth Visual Reference (Gate 0)

> Authoritative Gate-0 reference for a VoiceBar mimic-demo. Every value below is transcribed
> DIRECTLY from the real shipping Swift source (read 2026-05-29 by skillCreatorClaude), with the
> IDLE state cross-checked against a real running-app frame.
> - Source: `~/Gits/voicelayer/flow-bar/Sources/VoiceBar/` — `Theme.swift`, `BarView.swift`,
>   `WaveformView.swift`, `VoiceBarPresentation.swift`, `VoiceState.swift`, `PillResizePlan.swift`.
> - Idle frame: `$ORCHESTRATOR_ROOT/docs.local/qa-sessions/2026-05-29-etan-setup-ref/ref_pill_closeup.png`.
>
> ⚠️ Source = what ships → authoritative for ALL states. The frame only captured IDLE (silent session),
> so recording/transcribing/speaking/error visuals come from source. This file was REWRITTEN after a
> first draft drifted from source (wrong colors/dims) — itself proof of why Gate 0 exists. Trust THIS version.

## What it is
A compact **floating capsule (pill)** — a dark "Dynamic Island"-style chip that floats over all apps.
Not a panel, not a card, not a pipeline diagram. It shrink-wraps its content and changes per voice state.

## Position (per real frame — authoritative for what Etan sees)
- Floats in the **top-right**, just below the menu bar, right end ≈ right screen edge. Its own floating window.
- (Source note: `Theme.horizontalOffset = 0.5` implies centered; the real frame shows top-right — treat the
  FRAME as truth for position. Likely a version/config difference; do not "correct" the frame to match source.)
- Idle auto-collapses to just a dot after **5s** (`Theme.collapseDelay`); expands on hover/activity.

## Pill chrome (Theme.swift + BarView.swift)
- Background: **`Color.black.opacity(0.82)`** (near-black, flat — no gradient). Clipped to a **Capsule** (fully rounded, radius = half height).
- Compact height: **42pt** (`pillCompactHeight`). Panel envelope 420×74.
- Inner edge: `white.opacity(0.08)`, 0.5pt — barely-visible depth line. **No drop shadow** ("clean edges like Wispr Flow").
- Per-state **border glow** overlay (strokeBorder): recording red@0.50 / 1.5pt · transcribing blue@0.48 / 1.0pt · speaking blue@0.3 / 1.0pt · error red@0.5 / 1.5pt · disconnected red@0.35 / 1.5pt · idle none.
- Per-state **wash** overlay: recording red@0.12 · transcribing blue@0.10 · else clear.
- Main label font: **SF system, size 12, weight .medium, `white.opacity(0.9)`** (NOT rounded). Small badges/captions use `.rounded`.
- Horizontal padding 14pt; HStack spacing 8pt.

## The 6 voice states (VoiceState.swift `VoiceMode`) — there is NO "listening" voice state
| State | Leading indicator | Center content | Status text | Icon (when shown) | Accent color |
|---|---|---|---|---|---|
| **idle** | small **green** dot (6pt) | mic icon + label | `"F5 to talk"` (or "Enable hotkey") | `mic.fill` | idle gray `#AEAEB2` |
| **recording** | **PulsingDot** (red 8pt, pulses 1.0→1.3 / 0.75s) | **7-bar waveform** (red), NO text | `""` | `waveform` | recording red `#E54D4D` |
| **transcribing** | **ProcessingSpinner** (blue arc, 14pt, spins) | **7-bar waveform** `.processing` (blue, mechanical), NO text | `""` | `waveform` | transcribing **`#E5A84D` (yellow/orange)** |
| **speaking** | small green dot | shimmer waveform + **TeleprompterView** scrolling transcript (or queue viz if >1) | `"Speaking..."` / live transcript | `speaker.wave.2.fill` | speaking **`#4A90D9` (blue)** |
| **error** | small green dot | icon + message | `errorMessage` ?? `"Error"` | `exclamationmark.triangle.fill` | `Color.red` |
| **disconnected** | small **red** dot | icon + label | `"Disconnected"` | `bolt.horizontal.circle.fill` | idle gray |

Exact Theme colors: speaking `#4A90D9` · recording `#E54D4D` · idle `#AEAEB2` · transcribing `#E5A84D` · error system red. Background `black@0.82`.

## Pill width by state (Theme.pillContentWidth)
idle: content-hugs (~190 min) · **recording 154** · **transcribing 102** · **speaking 340** (412 if queue>1) · **error 210**. Width animates between states (spring 0.38 / bounce 0.12).

## Waveform (WaveformView.swift) — used in recording / transcribing / speaking
- **7 bars**, each **4pt wide**, **3pt spacing**, corner radius 2 → total width **46pt**. Height range **3–24pt**, level-driven.
- Bar color by waveform mode: idle→gray, **processing→blue** (transcribing), **listening/speechDetected→red** (recording). Subtle per-mode glow.
- recording = organic/audio-driven; transcribing `.processing` = symmetrical inward-outward (reads as compute, not speech); speaking = shimmer.

## Idle layout, left → right (matches ref_pill_closeup.png)
`[● green 6pt dot] [🎤 mic.fill gray] [ "F5 to talk" white ] [🕐 history] [📄 vocab]`
Trailing icon buttons (26pt circles, white@0.8 on white@0.06) appear only when there's recent-transcription history / vocab / replay available.

## Collapsed pill
After 5s idle → shrinks to a single **green** dot (10pt, "always alive") in a tiny capsule, + queue badge if depth>1. Hover/tap re-expands.

## Mimic-demo scoring checklist (does the render match THIS?)
- [ ] Small floating **black@0.82 capsule** (42pt tall, fully-rounded), top-right, clean edges, no shadow — NOT a big card/diagram.
- [ ] **Idle** = green dot + gray `mic.fill` + white "F5 to talk" (+ trailing clock/doc icons). Pixel-match `ref_pill_closeup.png`.
- [ ] **Recording** = red **PulsingDot** + red 7-bar waveform, no text, red border glow + red wash; width ~154.
- [ ] **Transcribing** = blue spinner + blue `.processing` 7-bar waveform, no text, blue border; width ~102.
- [ ] **Speaking** = shimmer waveform + scrolling teleprompter transcript, blue accent; width ~340.
- [ ] Correct accent per state (recording RED, transcribing YELLOW/ORANGE `#E5A84D`, speaking BLUE `#4A90D9`, idle GRAY).
- [ ] Pill **width animates** between states; idle auto-collapses to a green dot after 5s.
- [ ] SF system 12pt medium white text (NOT a serif/rounded display face for the main label).

## Common mistakes to avoid (caught in prior drafts/renders)
- ❌ Inventing a "listening" voice state — it doesn't exist as a VoiceMode (it's a waveform sub-mode).
- ❌ transcribing = green / speaking = purple — WRONG. transcribing = yellow/orange, speaking = blue.
- ❌ A 28pt pill with a 14pt fixed radius — it's 42pt tall, Capsule (radius = half height).
- ❌ Rendering the marketing pipeline.tsx / a blueprint — that is NOT the VoiceBar (Gate 0 hard-fail).
