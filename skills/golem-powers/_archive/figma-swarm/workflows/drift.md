# Drift Detection — Re-check Figma for Changes

> Re-run decomposition on previously mapped screens. Compare against stored component map to detect design changes.

## When to Run

- Periodically (weekly, or before a sprint starts)
- After a designer says "I updated the screens"
- Before building screens that were mapped a while ago

## Process

1. **Re-screenshot** each screen using the same node IDs from the original mapping
2. **Re-extract** component specs (dimensions, colors, spacing)
3. **Compare** against the stored decomposition in `screens/<screen>.md`:
   - **New components** — in Figma but not in our map
   - **Removed components** — in our map but gone from Figma
   - **Changed specs** — dimensions, colors, spacing, or typography differ
   - **Repositioned** — same component but moved to different location
4. **Report** drift as a summary:

```markdown
# Drift Report — <project> — <date>

## Changes Detected

| Screen | Component | Change | Old | New |
|--------|-----------|--------|-----|-----|
| Personal Details | AvatarUpload | SIZE | 80x80 | 96x96 |
| Link Accounts | GoogleButton | NEW | — | 358x48, white bg, Google icon |
| Search Prefs | PriceSlider | REMOVED | existed | gone |

## Impact

- 1 new component needs building
- 1 component needs resize
- 1 component can be removed from inventory
```

5. **Update** the component map and registry with changes
6. **Notify** via Telegram or mailbox if significant drift detected
