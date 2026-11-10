# opencode-alt-mouse

An OpenCode **TUI plugin**: while you **hold a trigger key (Alt by default, configurable)**,
OpenCode's mouse capture is turned off (`renderer.useMouse = false`), so the terminal handles
the mouse natively — text selection, copy, scrollback — exactly like when `"mouse": false` is
set in `cli.json`. Release the key and OpenCode reclaims the mouse.

This gives you both worlds: OpenCode's clicks/drags/wheel normally, and native terminal
selection without editing config or restarting.

## Install

1. Register it in `~/.config/opencode/cli.json`:

   ```jsonc
   {
     "mouse": true, // keep OpenCode mouse capture on; the plugin pauses it while Alt is held
     "plugins": [
       {
         "package": "/home/toanvq/projects/opencode-mouse"
       }
     ]
   }
   ```

2. Restart the TUI (or press `Ctrl+P` → *Open settings* / `/reload` for a config reload;
   plugin list changes are picked up when `cli.json` reloads).

### Options

```jsonc
"plugins": [
  {
    "package": "/home/toanvq/projects/opencode-mouse",
    "options": {
      "trigger": "ctrl", // alt (default) | ctrl | shift | super
      "toast": false // toast on every capture toggle (debug aid)
    }
  }
]
```

## Which trigger key to use

Conflict scan (as of Nov 2026):

| Key | VS Code terminal | OpenCode | Linux desktop | Verdict |
| --- | --- | --- | --- | --- |
| Alt | **Alt+drag = block select, "+" cursor** (hardcoded) | — | — | ✗ your original problem |
| Ctrl | **Ctrl+wheel = font zoom**; Ctrl+click extends selection while captured | Ctrl shortcuts micro-toggle capture | — | ⚠ works but busiest key |
| Super | free | free | **Activities overlay grabs Super** on GNOME/KDE | ⚠ |
| **Insert** | free | **unbound** | free | ✅ **recommended** |
| Menu | free | unbound | free | ✅ if your keyboard has it (many laptops don't) |

`alt`/`ctrl`/`shift`/`super` are **hold** triggers: mouse passes through while held.
`insert`/`menu` are **toggle** triggers (terminals can't report their release): press once →
mouse goes to the terminal and *stays* there; press again — or just start typing — to give it
back to OpenCode. This is often nicer anyway: click Insert, drag-select as much as you want,
press Insert again when done.

### Recommended VS Code setting

Enable the kitty keyboard protocol so OpenCode gets exact press/release events (better kitty
path, and Insert/Menus keys report events too):

```jsonc
// VS Code settings.json
{ "terminal.integrated.enableKittyKeyboardProtocol": true }
```

Not required: the Insert toggle also works over the legacy `CSI 2~` sequence without it.

## How it works

The plugin toggles `renderer.useMouse` (the same switch the `"mouse"` setting controls):

1. **Kitty keyboard protocol terminals** (kitty, Ghostty, foot, WezTerm, VS Code, …):
   the plugin pushes the *event-types* flag (`CSI > 3 u`), so the terminal reports the trigger
   key itself being pressed/released as CSI-u events (functional codes, e.g. 57442/57448 for
   left/right Ctrl). Trigger down → capture off; trigger up → capture back. Exact and immediate.
2. **Fallback** (no kitty keyboard, or standalone modifier events unsupported):
   - *hold* triggers: the plugin wraps opentui's `processSingleMouseEvent`, so the first
     trigger+click/wheel turns capture off **from that gesture onward**; capture returns on the
     next keyboard input that isn't trigger-modified.
   - *toggle* triggers (insert/menu): the legacy press sequence (`CSI 2~` / `CSI 29~`) flips the
     mode directly — no first-gesture loss.

## Known limitations

- If your terminal **already bypasses mouse reporting on Alt/Option** (iTerm2's default
  *Option ⌥ bypasses Mouse Reporting*, xterm `Alt*Mouse` resources), native selection already
  works there; this plugin just makes the switch explicit and works in terminals where Alt is
  passed through (Ghostty, kitty, Windows Terminal, GNOME Terminal...).
- Inside `tmux`/`Zellij`, keyboard protocol support depends on multiplexer configuration
  (`set -s extended-keys on` for tmux); otherwise the fallback path applies.
- If a dialog or the `mouse: false` setting turns capture off on its own, the plugin defers to
  it on release (it only ever toggles what it disabled).
- The pushed kitty event-types flag is left enabled after the plugin unloads; stray key-release
  events are ignored by OpenCode.

## Files

- `src/tui.ts` — the whole plugin (~100 lines).
- Loaded by OpenCode through `cli.json → plugins[].package`, entry point `exports["./tui"]`.
