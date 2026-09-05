---
name: mac-systems
description: "macOS systems specialist. Triggers: menu-bar apps, LaunchAgents, Gatekeeper/TCC, UDS/MCP bridges, 10Hz+ SwiftUI."
---

# mac-systems

macOS systems specialist for low-level AppKit, launchd, security policy, resilient networking, and SwiftUI dashboard architecture.

## Scope

Covers AppKit NSPanel architecture, launchd services, socket activation, MCP bridge resilience, syspolicyd, and high-frequency SwiftUI dashboards.

## When to Use

- Building or fixing menu bar apps (NSStatusItem, NSPanel, NSPopover migration)
- Configuring LaunchAgents/LaunchDaemons
- Debugging syspolicyd, Gatekeeper, TCC, or codesigning issues
- Implementing resilient Unix Domain Socket bridges (especially for MCP)
- Architecting high-frequency SwiftUI dashboards (10Hz+) on macOS
- Working with launchd socket activation for zero-downtime restarts

## Mechanical Environment Truths (hard-won — gen-12 weave E14)

One-liners every worker and launchd plist author must internalize:

1. **Tailnet IP bind ban** — NEVER hardcode tailnet IPs in launchd plists or worker-prompt URLs. Bind `127.0.0.1` / loopback or resolve at start. Three live catches: Phoenix phantom listener (two eras), W10 dead `:8852` URL.
2. **Codex detached-child reap** — Codex `exec` reaps detached children (`&` / `nohup` die). **`launchctl submit`** is the surviving detach path; clean up leftover runners after.
3. **pipefail + early-exit consumer** — Under `set -o pipefail`, piping into an early-exit consumer (`awk '{exit}'`) SIGPIPE-kills the producer (exit 141). Buffer first, then consume. See `/shell-hardening`.
4. **zsh read-only specials** — Never use zsh read-only specials (`status`, etc.) as variable names.
5. **nvm FUNCNEST in profiles** — `voicelayer-profile` `node` hits nvm `_lazy_nvm` FUNCNEST recursion — use **bun** for profile scripts.
6. **CloudStorage read bounds** — Bound any read of `~/Library/CloudStorage` — cloud-only placeholders hang naive `tar`/`read`.
7. **Host-identity check first** — Machine-named tasks: verify **current-host vs target-host** identity BEFORE acting ("What you're on is the M4 Max. I was asking about the M1 Pro.").
8. **Computer-use fallback ladder** — When CU fails on a UI element: element click → coords → `osascript` System Events AX → keystroke.
9. **footprint, not RSS, for leak watches** — RSS is a liar under the macOS memory compressor: a leak sampler showed RSS bouncing 444–760MB while footprint sat at 5.1G. Leak watches and escalation thresholds MUST read phys_footprint (`/usr/bin/footprint <PID>`), never `ps -o rss`. Recipe in Core Knowledge §10.

## Core Knowledge

### 1. Menu Bar App Architecture (NSPopover → NSPanel)

**NSPopover is wrong for dashboard-class UIs.** It causes:
- White flash on Sonoma/Sequoia/Tahoe (Apple regression in popover composition)
- No resize persistence
- View hierarchy teardown on every dismiss (kills @State)
- No right-click, drag, modifier-click, or programmatic show/hide

**The correct primitive:** `NSStatusItem` + custom `NSPanel` + `NSHostingView`.

Every serious menu-bar app uses this: Ice, Stats, Raycast, 1Password mini, Bartender, iStatMenus, CleanShot X, Alfred, MonitorControl.

#### NSPanel Recipe

```swift
final class DashboardPanel: NSPanel {
    init<V: View>(rootView: V) {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 620),
            styleMask: [.titled, .closable, .resizable, .fullSizeContentView,
                        .nonactivatingPanel, .utilityWindow],
            backing: .buffered, defer: false
        )
        titlebarAppearsTransparent = true
        titleVisibility = .hidden
        isFloatingPanel = true
        level = .statusBar
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        animationBehavior = .utilityWindow   // THE flash fix
        isMovableByWindowBackground = false
        hasShadow = true
        isOpaque = false
        backgroundColor = .clear

        let effect = NSVisualEffectView()
        effect.material = .menu
        effect.state = .active
        effect.blendingMode = .behindWindow
        effect.wantsLayer = true
        effect.layer?.cornerRadius = 10
        effect.layer?.masksToBounds = true

        let host = NSHostingView(rootView: rootView)
        host.sizingOptions = [.preferredContentSize]
        host.translatesAutoresizingMaskIntoConstraints = false
        effect.addSubview(host)
        NSLayoutConstraint.activate([
            host.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            host.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            host.topAnchor.constraint(equalTo: effect.topAnchor),
            host.bottomAnchor.constraint(equalTo: effect.bottomAnchor),
        ])
        contentView = effect
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}
```

#### Seven Anti-Flash Measures

1. `animationBehavior = .utilityWindow` — subtle fade instead of scale-in
2. Pre-create panel at launch, not on first click
3. `setContentSize(...)` before first `makeKeyAndOrderFront`
4. `isOpaque = false` + `backgroundColor = .clear` + `NSVisualEffectView`
5. `wantsLayer = true` on hosting view
6. `clipsToBounds = true` on Sonoma+
7. `NSHostingView.sizingOptions = [.preferredContentSize]` (macOS 13.3+)

#### Style Mask Configurations

| Role | styleMask | level | collectionBehavior |
|------|-----------|-------|--------------------|
| Inspector panel (default) | `.nonactivatingPanel, .utilityWindow, .titled, .closable, .resizable, .fullSizeContentView` | `.statusBar` | `.canJoinAllSpaces, .fullScreenAuxiliary, .transient` |
| Tear-off floating window | Same minus `.utilityWindow` | `.floating` | `.canJoinAllSpaces, .fullScreenAuxiliary` (no `.transient`) |
| Search HUD (Cmd+K global) | `.nonactivatingPanel, .hudWindow, .fullSizeContentView` | `.floating` | `.canJoinAllSpaces, .stationary` |

#### MenuBarExtra Verdict

- `.menu` style blocks the runloop — timers pause, Combine freezes. Ruinous for live data.
- `.window` style is backed by NSPopover with all its problems.
- **Use MenuBarExtra only for the Settings scene.**

### 2. State Architecture for Live Dashboards

#### @Observable Over ObservableObject (Mandatory for 10Hz+)

`ObservableObject` + `@Published` invalidates every observing view on any property change. `@Observable` (macOS 14+) tracks per-property reads — only views reading the changed property re-evaluate.

Split state by update frequency:

```swift
@Observable @MainActor final class DashboardStats {
    var writesPerMinute: Double = 0
    var enrichmentsPerMinute: Double = 0
    var backlog: Int = 0
}

@Observable @MainActor final class ListModel {
    var items: [Item] = []
    var selection: Item.ID?
    var scrollID: Item.ID?
}

@Observable @MainActor final class AppState {
    static let shared = AppState()
    let stats = DashboardStats()
    let list = ListModel()
}
```

#### Update Coalescing (Cap UI Writes at 20 Mutations/Second)

```swift
actor UpdatePump<Event: Sendable> {
    private var pending: [Event] = []
    private var scheduledFlush: Task<Void, Never>?
    private let apply: @MainActor @Sendable ([Event]) -> Void

    init(apply: @escaping @MainActor @Sendable ([Event]) -> Void) {
        self.apply = apply
    }

    func enqueue(_ event: Event) {
        pending.append(event)
        guard scheduledFlush == nil else { return }
        scheduledFlush = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(50))
            await self?.flush()
        }
    }

    private func flush() async {
        let batch = pending
        pending.removeAll(keepingCapacity: true)
        scheduledFlush = nil
        guard !batch.isEmpty else { return }
        await apply(batch)
    }
}
```

Make `apply` perform one MainActor mutation per batch (for example, reduce the
events into one dashboard snapshot before assigning it). The single scheduled
task bounds flushes to one every 50 ms; merely buffering events and exposing an
unthrottled `flush()` does not enforce a rate cap.

#### Persistence Primitives

| What | How |
|------|-----|
| Window frame | `panel.setFrameAutosaveName("PanelName")` |
| Tab selection | `@AppStorage("selectedTab")` with `RawRepresentable` enum |
| Complex prefs | `sindresorhus/Defaults` with `@ObservableDefaults` |
| Scroll position | `@Observable` model owns `scrollID`, bind via `.scrollPosition(id:)` |

### 3. LaunchAgents & LaunchDaemons

#### Key Differences

| | LaunchAgent | LaunchDaemon |
|---|---|---|
| Runs as | Current user | root (or specified user) |
| Plist location | `~/Library/LaunchAgents/` | `/Library/LaunchDaemons/` |
| GUI access | Yes | No |
| Loaded by | `launchctl bootstrap gui/<uid>` | `launchctl bootstrap system/` |

#### Essential Plist Keys

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.example.myservice</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/myservice</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/myservice.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/myservice.stderr.log</string>
</dict>
</plist>
```

See mechanical truth #1 (loopback bind) and #2 (`launchctl submit` for Codex detach).

#### Bun Environment Loading

launchd starts jobs from `/`, not the package directory. Bun entry points that
depend on a repository environment loader must make it their first import
(adjust the relative path as needed):

```typescript
import "../lib/load-env";
```

#### launchctl Commands (macOS 10.10+)

```bash
# Load
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.myservice.plist

# Unload (the persistent stop for the current domain session)
launchctl bootout gui/$(id -u)/com.example.myservice

# Status
launchctl print gui/$(id -u)/com.example.myservice

# Start or cycle without unloading
launchctl kickstart gui/$(id -u)/com.example.myservice
launchctl kickstart -k gui/$(id -u)/com.example.myservice

# Send SIGTERM. With KeepAlive=true, launchd relaunches it; this cycles, not stops, the job.
launchctl kill SIGTERM gui/$(id -u)/com.example.myservice

# Detached one-shot (survives Codex exec reap — preferred over bare nohup &)
launchctl submit -l com.example.oneshot -- /path/to/script.sh
```

### 4. Socket Activation via launchd

The kernel mechanism:
1. launchd creates and holds the socket (not the daemon)
2. When a connection arrives, launchd starts the daemon
3. If daemon crashes, launchd keeps the socket open — connections queue until new daemon starts
4. API: `launch_activate_socket()` (XPC framework)

```xml
<!-- LaunchAgent example: replace __USER_HOME__ with the absolute user home first. -->
<key>Sockets</key>
<dict>
    <key>MySocket</key>
    <dict>
        <key>SockPathName</key>
        <string>__USER_HOME__/Library/Application Support/MyService/myservice.sock</string>
        <key>SockPathMode</key>
        <integer>384</integer>
    </dict>
</dict>
```

Property lists encode the mode in decimal: `384` is `0600`. Do not put an
unauthenticated world-writable socket (`438` / `0666`) in shared `/tmp`. A plist
does not expand `$HOME`; replace `__USER_HOME__` with the absolute LaunchAgent
user home before loading it. For a LaunchDaemon, use a pre-created,
service-owned protected directory such as `/var/run/myservice/`; broaden the
mode only for an explicit, authenticated cross-user protocol.

Swift side:

```swift
import Darwin

func getActivatedSocket(name: String) -> Int32? {
    var fds: UnsafeMutablePointer<Int32>?
    var count: Int = 0
    let result = launch_activate_socket(name, &fds, &count)
    guard result == 0, let fds = fds, count > 0 else { return nil }
    let fd = fds[0]
    free(fds)
    return fd
}
```

### 5. Resilient MCP Bridge Patterns

**Problem:** MCP over stdio is session-scoped. When the stdio process dies, Claude Code marks it "failed" and never retries. No upstream fix exists (issues #43177, #36308, #15232).

#### Option A: Resilient Adapter (Recommended)

Replace `socat STDIO UNIX-CONNECT:/path.sock` with a bridge that reconnects:

```javascript
import { homedir } from "node:os";
import { join } from "node:path";

const SOCK_PATH = join(homedir(), "Library", "Application Support", "MyService", "myservice.sock");
let socket = null;
let buffer = [];
let retryDelay = 500;

async function connect() {
    while (true) {
        try {
            socket = await Bun.connect({ unix: SOCK_PATH, socket: handlers });
            for (const msg of buffer) socket.write(msg);
            buffer = [];
            retryDelay = 500;
            return;
        } catch {
            await Bun.sleep(Math.min(retryDelay *= 2, 30000));
        }
    }
}

// On socket error: buffer pending, reconnect
// On reconnect: replay MCP initialize handshake, then flush buffer
```

#### Option B: launchd Socket Activation

OS holds the socket — zero-downtime restarts. See section 4.

#### Option C: mcpmon Proxy

Transparent stdio proxy that buffers during restart. Designed for hot-reload but adaptable.

### 6. Security — syspolicyd, Gatekeeper, TCC

#### syspolicyd Troubleshooting

```bash
# Check if binary is allowed
spctl --assess --verbose /path/to/binary

# Check codesign
codesign -dvvv /path/to/binary

# Watch syspolicyd in real time
/usr/bin/log stream --predicate 'subsystem == "com.apple.syspolicy"' --level debug
# ⚠️ In scripted zsh, ALWAYS invoke /usr/bin/log absolutely — zsh has a `log` builtin that
# shadows it and exits 0 with no output, silently fabricating "no log entries" conclusions.

# Re-assess without reading or writing the assessment object cache
spctl --assess --verbose --ignore-cache --no-cache /path/to/binary
```

#### TCC (Transparency, Consent, and Control)

```bash
# Check the current TCC database (Requires Full Disk Access for the shell/terminal)
sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
    "SELECT service, client, auth_value FROM access"

# Reset TCC for an app
tccutil reset All com.example.myapp
```

#### Common Issues

- **"not valid for use in process" error:** Binary needs ad-hoc signing: `codesign -s - /path/to/binary`
- **Gatekeeper quarantine:** Remove with `xattr -d com.apple.quarantine /path/to/binary`
- **Sandboxed UDS access:** Socket must be in an accessible path (not inside another app's container)

### 7. Visual Effect Materials for Menu Bar Apps

| AppKit Material | SwiftUI Equiv | Use Case |
|-----------------|---------------|----------|
| `.menu` | `.thinMaterial` | Default panel background |
| `.popover` | `.regularMaterial` | Alt if `.menu` too light |
| `.hudWindow` | `.thickMaterial` | Ephemeral toasts |
| `.sidebar` | `.regularMaterial` | Left rail |

Always respect `@Environment(\.accessibilityReduceTransparency)` — swap effect for solid `Color("Surface")` when set.

### 8. Keyboard Shortcuts

Use `sindresorhus/KeyboardShortcuts` (2.6k+ stars, MAS-compatible) for global hotkeys:

```swift
import KeyboardShortcuts

extension KeyboardShortcuts.Name {
    static let togglePanel = Self("togglePanel",
        default: .init(.b, modifiers: [.command, .shift]))
}

// In AppDelegate:
KeyboardShortcuts.onKeyUp(for: .togglePanel) { [weak self] in
    self?.togglePanel()
}

// In Settings:
KeyboardShortcuts.Recorder("Toggle Panel", name: .togglePanel)
```

Use `.keyboardShortcut()` for in-panel shortcuts, `.onKeyPress()` (macOS 14+) for custom key handling.

### 9. Deployment Targets (2026)

- **Minimum:** macOS 14 Sonoma (Observation + .onKeyPress)
- **Compile against:** macOS 26 SDK
- **Gate Tahoe features:** `if #available(macOS 26, *)` for `NSGlassEffectView`, `.glassEffect()`, SF Symbols 7 Draw On/Off
- **Do not require Tahoe** — Sonoma/Sequoia users will be majority through 2027

### 10. Memory Leak Watches — footprint, not RSS

The macOS memory compressor masks leaks from RSS: compressed pages leave the
resident set but still count against the process's physical footprint (and its
jetsam limit). Observed divergence (2026-06-07 cmux leak watch): RSS bounced
444–760MB while footprint sat at **5.1G** — an RSS-based watch nearly suppressed
the escalation. The canonical metric is **phys_footprint**, read via
`/usr/bin/footprint` (summary line: `name [pid]: 64-bit    Footprint: NNNN KB`).

Watch-rebuild recipe — threshold on footprint bytes, never `ps -o rss`:

```bash
# Footprint-based leak watch (RSS under-reports under the compressor)
PID=12345; LIMIT_BYTES=$((4 * 1024 * 1024 * 1024))   # escalate at 4 GiB
while kill -0 "$PID" 2>/dev/null; do
  fp_bytes=$(/usr/bin/footprint --format bytes "$PID" 2>/dev/null \
    | sed -n 's/.*Footprint: \([0-9]*\) B.*/\1/p')
  if [ -n "$fp_bytes" ] && [ "$fp_bytes" -ge "$LIMIT_BYTES" ]; then
    echo "LEAK: phys_footprint=${fp_bytes}B >= ${LIMIT_BYTES}B" >&2
    # escalate here
  fi
  sleep 60
done
```

## References

- R1 BrainBar UX Research: `$ORCHESTRATOR_ROOT/docs.local/research/R1-claude-desktop-macos-menubar-ux-FULL.md`
- MCP Reconnection Research: `$ORCHESTRATOR_ROOT/docs.local/research/mcp-reconnection-research.md`
- Apple: `launch_activate_socket()` docs
- Community: `jordanbaird/Ice`, `exelban/stats`, `sindresorhus/KeyboardShortcuts`, `sindresorhus/Defaults`
- `/shell-hardening` — pipefail/SIGPIPE section pairs with mechanical truth #3
