# opencode-alt-mouse

Quickly **toggle OpenCode TUI mouse capture on/off with one key**, so you can copy/paste in
terminals where the OpenCode TUI's own selection/copy doesn't work — without giving up mouse
features the rest of the time.

## Why this plugin exists

I run OpenCode inside **code-server**'s integrated terminal. There is a known bug there:
**mouse text-selection and any kind of copy inside the OpenCode TUI does not reach the
clipboard** — selecting with the mouse or using OpenCode's copy paths never lands in your real
clipboard (browser ↔ code-server clipboard plumbing breaks it).

The only documented workaround is turning off the mouse feature entirely:

```jsonc
// ~/.config/opencode/cli.json
{ "mouse": false }
```

…but that is all-or-nothing: you also lose **mouse wheel scrolling, clicking session tabs,
clicking files in the diff viewer, links**, everything.

This plugin makes it a **one-key toggle** instead of a config edit + restart:

- `"mouse": true` stays in your config — all OpenCode mouse features work normally.
- Press **Insert** → mouse capture is released to the terminal, so the browser's **native
  select → Ctrl+Shift+C / right-click copy** works on the transcript, and wheel scrolls the
  terminal's own scrollback.
- Press **Insert** again (or just start typing) → OpenCode gets the mouse back.

## Install

1. Register the plugin in `~/.config/opencode/cli.json`:

   ```jsonc
   {
     "mouse": true, // keep OpenCode mouse capture on; the plugin hands it to the terminal on demand
     "plugins": [
       {
         "package": "/home/toanvq/projects/opencode-mouse",
         "options": { "trigger": "insert", "toast": false }
       }
     ]
   }
   ```

2. Reload the TUI (`Ctrl+P` → reload config, or restart it). You should see a toast
   `alt-mouse ready: insert (...)` when `toast: true`.

## Usage

| Trigger | Semantics |
| --- | --- |
| `insert` (default), `menu` | **Press = toggle.** Mouse passes through to the terminal and stays there; press again — or type any key — to give it back to OpenCode. Great UX for "select a big region and copy". |
| `alt`, `ctrl`, `shift`, `super` | **Hold.** Mouse passes through only while the key is held, exact via kitty keyboard release events. |

Toggle keys are recommended because they conflict with nothing and work even in terminals
without kitty keyboard support.

### Why not Alt?

**VS Code / code-server hardcodes Alt+drag as rectangular/block selection** (crosshair "+"
cursor), so Alt is useless as a text-selection modifier there. Conflict scan (Nov 2026):

| Key | VS Code terminal | OpenCode | Linux desktop | Verdict |
| --- | --- | --- | --- | --- |
| Alt | Alt+drag = block select | — | — | ✗ |
| Ctrl | Ctrl+wheel = font zoom | Ctrl+click extends selection; many Ctrl chords | — | ⚠ |
| Super | free | free | Activities overlay grabs Super | ⚠ |
| **Insert** | **free** | **unbound** | free | ✅ recommended |
| Menu | free | unbound | free | ✅ if keyboard has it |

## How it works

The plugin toggles `renderer.useMouse` (the same switch the `"mouse"` setting controls) by
hooking raw input in `setup()`:

1. **Kitty keyboard protocol terminals** (VS Code/code-server ≥ 1.109 with
   `terminal.integrated.enableKittyKeyboardProtocol`, kitty, Ghostty, foot, WezTerm, …): the
   plugin pushes the *event-types* flag (`CSI > 3 u`) and watches CSI-u events — functional key
   codes report every trigger key (Insert = 57348, left/right Alt = 57443/57449, …) with press
   *and release* for hold triggers.
2. **Fallback** (no kitty keyboard): toggle triggers react to the legacy press sequence
   (`CSI 2~` / `CSI 29~`) — works even in code-server with the protocol off. Hold triggers wrap
   opentui's `processSingleMouseEvent` (opentui consumes mouse events before input handlers
   while capture is on) and disable on the first trigger-modified gesture. Plain keyboard input
   always restores capture as a safety net.

## Limitations

- If OpenCode itself turns mouse capture off (e.g. `"mouse": false`), the plugin shows a
  warning and stays out of the way.
- On kitty-capable terminals the toggle ignores key *release* events by design; typing restores
  capture even if you forget to toggle back.
- Clipboard in code-server still requires the browser's own copy (Ctrl+Shift+C / context menu)
  once the mouse is native — that is the point: OpenCode's broken copy path is bypassed
  entirely.

## Files

- `src/tui.ts` — the whole plugin (~190 lines).
- Loaded by OpenCode through `cli.json → plugins[].package`, entry point `exports["./tui"]`.
