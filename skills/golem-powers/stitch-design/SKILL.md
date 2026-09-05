---
name: stitch-design
description: "Use Google Stitch for design-to-code prototypes/tokens, then implement. Triggers: Stitch, screen prototypes."
version: 0.3.0
type: encoded-preference
triggers:
  - stitch
  - implement this design
  - implement the design
  - match this design
  - generate a screen
  - design system
  - design tokens
  - the product team's design
  - warning screen
  - extract colors from stitch
---

# Stitch Design — Read, Prompt, Grill, Implement

> Claude = **prompt engineer** for Stitch. Stitch = **design generator**.
> Claude understands the flow, the design system, the user's intent — then writes a detailed prompt that Stitch executes. Claude does NOT design. Stitch does.

## The Flow

```
SYNC     →  Push app's theme (colors.ts, typography.ts) into Stitch's designMd field
READ     →  Pull existing admin designs (get_screen → screenshot URL + htmlCode, list_design_systems)
PROMPT   →  Craft detailed prompts for Stitch to generate new screens WITHIN the design system
GRILL    →  Ask user about behavior, flow, states, edge cases (Stitch = static, app = dynamic)
IMPLEMENT → Build in React Native, matching Stitch visuals + wired behavior
```

## When This Skill Activates

- Product/design teammates share a new design (screenshot or Stitch URL)
- User says "implement this design" or "match this screen"
- User wants to generate a new screen prototype in Stitch
- User wants to extract design tokens for app theme sync
- User asks about a specific Stitch screen's layout/colors/fonts

## Key Constraint

**Always use the existing design system.** The target project has established colors, fonts, and theme tokens. When generating new screens:
- Read the reference screen with the configured Stitch MCP's supported tools FIRST
- Manually carry its colors, typography, spacing, and component patterns into `generate_screen_from_text`
- Never invent new colors, fonts, or styles outside the system

**The `designMd` field is the bridge.** This free-text field in the design system tells Stitch HOW to generate. Claude writes `designMd` from the target codebase (existing colors, fonts, components, and layout patterns) and pushes it to Stitch via `update_design_system`. This makes Stitch generations match the app automatically.

## Example Design Context

- **App:** ExampleApp (fictional React Native/Expo consumer app)
- **Designers:** Product owner + visual designer
- **Design tool:** Google Stitch (stitch.withgoogle.com)
- **Two Stitch projects:**
  - **Shared:** `$STITCH_SHARED_PROJECT_ID` — source of truth, READ from here
  - **Ours (remixed):** `$STITCH_REMIX_PROJECT_ID` — experiment/generate here
  - Project IDs are deployment values and live only in gitignored env; never commit them.
- **Screens (ours):** 4 — 3x "Warning Screen Protection Off" + 1x DNS setup mockup
- **Color discrepancy:** Shared and app tokens may differ. The SYNC workflow aligns the remix.
- **Theme:** Dark purple (#8B5CF6 primary, #0A0A1A background), DARK mode, system fonts (Inter/DM Sans in Stitch only), round-12 corners
- **Language:** Hebrew RTL
- **Communication:** Teammates share designs via screenshots or Stitch links

## Stitch MCP Config

Configure Stitch in `${APP_REPO_ROOT}/.mcp.json`. Run `/mcp` to connect. Tools appear as `mcp__stitch__*`.

## Stitch MCP Tools

### ACTUAL Stitch MCP Tools (verified live April 6)

**READ tools:**

| Tool | What | When |
|------|------|------|
| `list_projects` | List all Stitch projects | Boot — find project ID |
| `get_project` | Get project metadata | Verify project details |
| `list_screens` | List screens in a project | See what designs exist |
| `get_screen` | Get screen details + screenshot URL + htmlCode | **THE main read tool** — returns title, dimensions, downloadUrl, htmlCode |
| `list_design_systems` | Read current design system | Verify theme tokens |

**GENERATE tools (Claude = prompt engineer, Stitch = renderer):**

| Tool | What | When |
|------|------|------|
| `generate_screen_from_text` | Generate screen from Claude's prompt | New screens — always use design system context |
| `edit_screens` | Modify a screen with instructions | Iterate on a generated prototype |
| `generate_variants` | Produce design variations | Explore options within the design system |

**SYNC tools (bridge code ↔ design):**

| Tool | What | When |
|------|------|------|
| `create_design_system` | Create design system with designMd | First-time setup |
| `update_design_system` | Push updated designMd to Stitch | After app theme changes |
| `apply_design_system` | Apply design system to screens | Propagate style changes |

**Other:**

| Tool | What | When |
|------|------|------|
| `create_project` | Create a new Stitch project | Only if starting from scratch |

### Tools That DON'T Exist (corrected from research)

These were listed in community wrapper docs but are NOT in Google's official MCP:
- ~~`get_screen`~~ → use `get_screen` (returns screenshot.downloadUrl)
- ~~`get_screen_code`~~ → use `get_screen` (returns htmlCode)
- ~~`extract_design_context`~~ → NOT available upstream. Read colors manually from get_screen htmlCode.
- ~~`build_site`~~ → NOT in official MCP

---

## Workflow 0: SYNC — Bridge Code to Design System

**Run this FIRST in any new project or after theme changes.** This writes the app's design reality into Stitch's `designMd` field so all generations match the app.

```
1. Read app theme files:
   - app/theme/colors.ts → extract all color constants
   - app/theme/typography.ts → extract font families, sizes, weights
   - Scan components/ for common patterns (border radius, spacing, shadows)
2. Read RTL patterns:
   - Check I18nManager usage, writingDirection props
   - Note which components handle RTL explicitly
3. Craft designMd string from the ACTUAL app theme:
   "ExampleApp — fictional Hebrew RTL mobile app. Dark theme.
   Colors: primary #8B5CF6, secondary #6366F1, accent #A855F7.
   Backgrounds: #0A0A1A deepSpace (main), #150B2E midnight (secondary), #2A1B4E cosmic (cards).
   Text: #FFFFFF white, #94A3B8 gray secondary. Gradients: #8B5CF6→#6366F1→#4F46E5.
   Status: #10B981 green, #EF4444 red, #F59E0B amber. Blue borders #4F46E5.
   Layout: RTL-first, bottom-anchored CTAs, shield icon for protection states.
   Typography: sizes 12/14/16/20/28px, weights 400-700. Rank colors: green→blue progression."
4. Push to Stitch:
   update_design_system(projectId, { designSystem: { theme: { designMd: "..." } } })
5. Verify: list_design_systems → confirm designMd is set
```

**designMd is the single most important field.** It's free-text that Stitch reads before every generation. A good designMd = every generated screen matches the app without manual adjustment.

## Workflow 1: READ — Understand the Design

When a teammate shares a new design or points to a Stitch screen:

**READ from the shared source of truth. GENERATE in the remix project.**

```
1. list_screens(projectId: "projects/${STITCH_SHARED_PROJECT_ID}") → shared designs (source of truth)
2. get_screen(screenName) → returns:
   - title, width, height
   - screenshot.downloadUrl (Google CDN link to PNG)
   - htmlCode (the design's HTML/CSS)
3. Download the screenshot URL with WebFetch or save for visual reference
4. Parse htmlCode for colors, fonts, layout structure
5. list_design_systems → read current theme tokens (colorMode, fonts, roundness)

Output: You now know WHAT it looks like. You do NOT know HOW it behaves.
```

**If a teammate shared a screenshot instead of a Stitch link:**
1. Save the screenshot locally
2. `list_screens` → scan screen names for a match
3. `get_screen` for each candidate → compare title/dimensions
4. If no match in Stitch: implement directly from the screenshot

## Workflow 2: PROMPT — Generate New Screens via Stitch

Claude = prompt engineer. Stitch = design generator. Claude crafts detailed, context-rich prompts. Stitch renders them.

```
1. `get_screen(referenceScreenId)` → inspect screenshot and HTML for existing "design DNA"
2. Understand what the user wants: "I need a settings screen" or "add a premium paywall"
3. Craft a detailed prompt for Stitch:

   GOOD PROMPT:
   "Settings screen for a fictional Hebrew RTL mobile app. Dark background
   with subtle gradient. Inter font throughout. Cards for each setting group: 
   'הגדרות חשבון' (account), 'התראות' (notifications), 'פרטיות' (privacy).
   Toggle switches with purple active state. Bottom navigation bar visible.
   Shield icon in header. 12px border radius on all cards. Match the visual style
   of the existing warning screens."

   BAD PROMPT:
   "Make a settings page"

4. generate_screen_from_text(prompt) → Stitch renders the design
5. get_screen(generatedScreenName) → review screenshot.downloadUrl
6. If not right: edit_screens with specific corrections, or re-prompt
7. If exploring options: generate_variants for alternatives
```

**Prompt engineering tips for the example app:**
- Always specify "Hebrew RTL" and exact hex colors
- Reference existing screens by name for style consistency
- Include specific Hebrew text for realistic previews
- Describe layout in screen positions ("top", "bottom-anchored"), not DOM order
- Mention the shield icon, gradient backgrounds, and countdown timers as recurring elements

## Workflow 3: GRILL — Ask About Behavior

Stitch shows STATIC designs. The app has DYNAMIC behavior. You MUST ask:

**For every screen, ask these questions:**

```
FLOW QUESTIONS:
- "What happens when the user taps [button]?"
- "Where does this screen appear in the navigation flow?"
- "What screen comes before this? What comes after?"
- "Is there a countdown/timer? What happens when it ends?"

STATE QUESTIONS:
- "What does this screen look like in [other state]?" (loading, error, empty)
- "Can the user go back from here?"
- "What if the user is not premium?"
- "Does this need to work offline?"

DATA QUESTIONS:
- "Where does [this text/number] come from?" (hardcoded, API, local state)
- "Is this text translated or always Hebrew?"
- "Does this update in real-time?"

EDGE CASES:
- "What if the user rotates the phone?"
- "What if the text is longer than expected?"
- "What about accessibility — VoiceOver labels?"
```

### Synthetic Example: Confirmation Flow

The static design shows a confirmation screen. GRILL uncovers behavior the pixels cannot encode:
- a short countdown before the confirmation button activates
- a long press to confirm the action
- dynamic status data from the application state
- all copy is localized — never hardcode text

The Stitch design showed NONE of this — just a static screen. The GRILL workflow extracted the flow.

**Ask 2-3 at a time.** Don't dump all questions at once. Drill based on answers.

**Store answers:** `brain_store` the flow decisions with tags `["example-app", "design-flow", screenName]`. These persist across sessions — next time someone implements from this screen, the flow answers are already in BrainLayer.

## Workflow 4: IMPLEMENT — Build in React Native

Once you have the visual (from READ) and the behavior (from GRILL):

```
1. get_screen(screenName) → HTML/CSS reference
2. Map HTML structure to React Native:
   - div → View
   - p/span → Text
   - img → Image (or Expo Image)
   - button → Pressable/TouchableOpacity
   - CSS flexbox → RN flexbox (same API)
   - CSS colors → theme/colors.ts constants
   - CSS fonts → theme/typography.ts
   - px values → responsive units
3. RTL handling (CRITICAL for Hebrew):
   - flexDirection: 'row' is REVERSED in RTL
   - textAlign: 'right' for Hebrew content
   - writingDirection: 'rtl' on Text components
   - Mirror directional icons (arrows, chevrons)
   - I18nManager.isRTL for conditional logic
4. Wire behavior from GRILL answers:
   - Navigation (router.push/replace/back)
   - State management (useState, Convex queries)
   - Timers (useEffect + cleanup)
   - Animations (Reanimated or LayoutAnimation)
5. Screenshot implementation → compare side-by-side with Stitch
```

### HTML → React Native Cheat Sheet

```
STITCH HTML/CSS                     →  REACT NATIVE
──────────────────────────────────────────────────────
<div class="flex flex-col">         →  <View style={{ flexDirection: 'column' }}>
background: #8B5CF6                 →  backgroundColor: colors.primary
font-family: Inter                  →  fontFamily: typography.heading.fontFamily
border-radius: 12px                 →  borderRadius: 12
padding: 16px                       →  padding: 16
box-shadow: ...                     →  elevation: 4 (Android) / shadowColor (iOS)
background: linear-gradient(...)    →  <LinearGradient> (expo-linear-gradient)
position: fixed                     →  position: 'absolute' (RN has no fixed)
overflow: scroll                    →  <ScrollView>
```

## Design Token Mapping

```
STITCH DESIGN SYSTEM                →  APP CONSTANTS (constants/)
──────────────────────────────────────────────────────
customColor: "#8B5CF6"              →  colors.primary (#8B5CF6)
colorMode: "DARK"                   →  colors.background (#0A0A1A)
headlineFont: "INTER"               →  system default (no custom fonts in RN yet)
bodyFont: "INTER"                   →  system default
labelFont: "DM_SANS"               →  system default
roundness: "ROUND_TWELVE"          →  borderRadius: 12 (per component)
colorVariant: "EXPRESSIVE"         →  colors.gradient (#8B5CF6→#6366F1→#4F46E5)
designMd: (our crafted text)        →  THE BRIDGE — describes all of the above to Stitch
```

**Discrepancy:** Stitch uses Inter/DM Sans but the RN app uses system fonts.
Either install custom fonts in Expo (`expo-font`) or accept the difference.

When a supported screen/design-system read exposes values that differ from the app theme files, flag it:
"Stitch shows [X] but app/theme/colors.ts has [Y]. Should I update the app to match?"

## Integration Patterns

| Trigger | Action |
|---------|--------|
| Teammate sends screenshot | READ workflow → match in Stitch → GRILL about flow → IMPLEMENT |
| New Stitch screen appears | `list_screens` detects it → notify user → wait for implementation request |
| Theme change in Stitch | Read screen/design-system data → diff with app theme → flag discrepancies |
| PR review for UI changes | `get_screen` → compare with implementation screenshot |
| User says "does this match?" | `get_screen` + app screenshot → side-by-side comparison |

## i18n Rule (MANDATORY)

**ALL text is i18n.** Never hardcode Hebrew or English strings in components.
- Use translation keys: `t('warning.countdown')` not `"רוצה לחזור אחורה?"`
- Stitch designs show Hebrew text — treat it as placeholder for the i18n key
- Dynamic data comes from the application backend, not the design

## RTL Rules (example app is Hebrew-first)

1. **Flex order is reversed** in RTL — first child → RIGHT side of screen
2. **Text alignment** — Hebrew = `textAlign: 'right'`, `alignItems: 'flex-end'`
3. **Icons** — arrows/chevrons must mirror. Use `I18nManager.isRTL ? 'flip' : undefined`
4. **Padding/margin** — `paddingStart`/`paddingEnd` instead of `paddingLeft`/`paddingRight`
5. **Stitch designs may show LTR** — Stitch defaults LTR. Mentally mirror the layout for implementation.

## Gap Analysis

### Community wrapper (oogleyskr/stitch-mcp-server, 36 tools)
Read-only tools we'd benefit from:
- `compare_designs` — diff two Stitch screens after a teammate iterates
- `extract_components` — isolate reusable UI patterns from screens
- `analyze_accessibility` — WCAG 2.1 check on Stitch designs before implementing

### /yash candidates (things that don't exist anywhere)
| Gap | Impact | Fix |
|-----|--------|-----|
| `screen_to_react_native` | HIGH — manual HTML→RN every time | Fork oogleyskr's screen_to_react, add RN output |
| Theme.ts sync | MEDIUM — manual token copy | Build codegen from supported screen/design-system reads → theme.ts |
| Stitch↔implementation diff | MEDIUM — manual screenshot comparison | Build: overlay Stitch PNG on app screenshot, highlight differences |

## Files

```
${APP_REPO_ROOT}/
├── .mcp.json                       # Stitch MCP config (connected)
├── app/theme/colors.ts             # App colors (sync target)
├── app/theme/typography.ts         # Font definitions (sync target)
├── app/components/                 # Existing RN components
├── docs.local/stitch-mcp-reference.md  # MCP reference notes
└── ~/Desktop/Stitch screens/       # Local screenshots (5 files, Apr 6)
```
