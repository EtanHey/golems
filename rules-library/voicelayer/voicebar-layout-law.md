---
paths:
  - "flow-bar/Sources/VoiceBarUI/**"
---

# VoiceBar Layout Law

> Path-scoped rule for `flow-bar/Sources/VoiceBarUI/**`. Born: the 2026-06-11 v9 incident — the rejected build looked wrong because this geometry was re-litigated instead of obeyed. Promoted from voicelayer `docs.local/design/v9-incident-rules-drafts.md` via the skills-ctx rules-promotion path (PLAN §9).

---

- Content **FLANKS the camera island on the SIDES** at menu-bar height (wraps around it): **sides = CTAs (stop ◼ / cancel ✕) / timer / waveform / state dots.**
- **UNDER (drops below the band+island) = menus + teleprompter ONLY.**
- Panel corners: "90° like v8, curved a bit" — a few-px inverse-radius softening where panel meets band. **NOT a funnel, NOT growing-out-of-the-notch.**
- Band height = the notch height, **flush AS the camera island** — never a slab hanging below, never an anchored floating pill, never fused-underside.
- Geometry is DECIDED (built-in, wraps around the island, MediaMate north star) — do not re-ask, do not show options.
