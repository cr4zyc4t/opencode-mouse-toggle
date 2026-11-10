import { Plugin } from "@opencode/plugin/tui"

/**
 * mouse-toggle: hands mouse capture (renderer.useMouse) to the terminal while a trigger key is
 * active, so clicks/drags/wheel do native selection & scrollback; the trigger hands the mouse
 * back to OpenCode.
 *
 * Hold triggers (alt/ctrl/shift/super): passthrough while held. Toggle triggers (insert/menu,
 * recommended — zero conflicts): each press flips the mode, since terminals can't report their
 * release; typing anything also restores capture.
 *
 * Tip for VS Code's integrated terminal: Alt+drag is hardcoded there as rectangular/block
 * selection (crosshair cursor) — that's why insert is the default recommendation there.
 *
 * How trigger press/release is detected:
 *  1. Kitty keyboard protocol "event types" flag (pushed by this plugin): the terminal reports
 *     standalone press/release for any key (functional codes, e.g. 57443 left alt, 57348 insert).
 *  2. Fallback: hold triggers watch opentui's processSingleMouseEvent for the modifier bit on the
 *     first gesture; toggle triggers react to the legacy press sequence (CSI 2~ / CSI 29~);
 *     plain keyboard input always restores capture.
 */

const KITTY_EVENT_TYPES = 0b011 // disambiguate (already active) + report event types
const KEY_PRESS = 1
const KEY_RELEASE = 3

// hold=true keys are modifiers (hold to pass the mouse through); hold=false keys toggle on each
// press because legacy terminals cannot report their release. sgr: legacy SGR mouse modifier
// bit, kitty: kitty keyboard modifier bit, mod: opentui mouse-event modifier name, legacy:
// legacy press sequence for toggle keys.
const TRIGGERS: Record<string, { name: string; codes: number[]; sgr: number; kitty: number; mod: string; hold: boolean; legacy?: string }> = {
  alt: { name: "alt", codes: [57443, 57449], sgr: 0b1000, kitty: 0b010, mod: "alt", hold: true },
  ctrl: { name: "ctrl", codes: [57442, 57448], sgr: 0b10000, kitty: 0b100, mod: "ctrl", hold: true },
  shift: { name: "shift", codes: [57441, 57447], sgr: 0b0100, kitty: 0b001, mod: "shift", hold: true },
  super: { name: "super", codes: [57444, 57450], sgr: 0, kitty: 0b1000, mod: "meta", hold: true }, // legacy SGR has no super bit
  insert: { name: "insert", codes: [57348], sgr: 0, kitty: 0, mod: "", hold: false, legacy: "\x1b[2~" },
  menu: { name: "menu", codes: [57363], sgr: 0, kitty: 0, mod: "", hold: false, legacy: "\x1b[29~" },
}
type Trigger = keyof typeof TRIGGERS

const KITTY_KEY = /^\x1b\[(\d+);(\d+)(?::(\d+))?u$/
const SGR_MOUSE = /^\x1b\[<(\d+);\d+;\d+([Mm])$/

type RawMouseEvent = { type: string; modifiers?: Record<string, boolean> }

// CliRenderer surface this plugin touches. useMouse / prependInputHandler / removeInputHandler
// and enableKittyKeyboard are public; processSingleMouseEvent is private but the only place raw
// mouse modifiers are visible while capture is on (opentui consumes mouse events before they
// reach sequence handlers).
interface RendererLike {
  useMouse: boolean
  capabilities?: { kitty_keyboard?: boolean } | null
  on?: (event: "capabilities", listener: (caps: { kitty_keyboard?: boolean }) => void) => unknown
  enableKittyKeyboard?: (flags?: number) => void
  prependInputHandler: (handler: (sequence: string) => boolean) => void
  removeInputHandler: (handler: (sequence: string) => boolean) => void
  processSingleMouseEvent?: (event: RawMouseEvent) => boolean
}

export default Plugin.define({
  id: "vq.mouse-toggle",
  setup(context) {
    const options = (context.options ?? {}) as { toast?: boolean; trigger?: Trigger }
    const trigger = TRIGGERS[options.trigger ?? "alt"] ?? TRIGGERS.alt
    const renderer = context.renderer as unknown as RendererLike
    const show = (message: string) => {
      if (options.toast) context.ui.toast.show({ message, duration: 1200 })
    }

    let usingKitty = false
    let armed = false
    let passThrough = false
    let disposed = false

    if (renderer.useMouse === false) {
      context.ui.toast.show({
        title: "mouse-toggle",
        message: 'cli.json has "mouse": false — set it to true so OpenCode keeps the mouse, handing it to the terminal only while the trigger key is active',
        variant: "warning",
        duration: 8000,
      })
      return
    }

    const setCapture = (capture: boolean) => {
      if (disposed || passThrough === !capture) return
      passThrough = !capture
      renderer.useMouse = capture
      show(capture ? "mouse: opencode" : trigger.hold ? `mouse: terminal (${trigger.name})` : `mouse: terminal — press ${trigger.name} to restore`)
    }

    const handler = (sequence: string): boolean => {
      const key = KITTY_KEY.exec(sequence)
      if (key) {
        const code = Number(key[1])
        const mods = Number(key[2])
        const event = Number(key[3] ?? KEY_PRESS)
        if (trigger.codes.includes(code)) {
          if (trigger.hold) {
            if (event === KEY_PRESS) setCapture(false)
            else if (event === KEY_RELEASE) setCapture(true)
          } else if (event === KEY_PRESS) {
            setCapture(passThrough) // toggle keys (insert/menu): press flips the mode, release ignored
          }
        } else if (passThrough && event === KEY_PRESS && (trigger.kitty === 0 || (mods & trigger.kitty) === 0)) {
          // A key press without the trigger modifier means the trigger is no longer held
          // (kitty terminals that ignore the event-types flag get caught here too, since
          // trigger+key carries the trigger's kitty modifier bit).
          setCapture(true)
        }
        return false
      }

      // Toggle keys (insert/menu) have no legacy release event: each legacy press flips the mode.
      if (trigger.legacy && sequence === trigger.legacy) {
        setCapture(passThrough)
        return false
      }

      const mouse = SGR_MOUSE.exec(sequence)
      if (mouse) {
        // Fallback path: a trigger-modified press disables capture starting from the next gesture.
        if (trigger.sgr !== 0 && mouse[2] === "M" && (Number(mouse[1]) & trigger.sgr) !== 0) setCapture(false)
        return false
      }

      // Plain keyboard input (no ESC prefix) cannot be Alt-modified under the kitty
      // disambiguate flag OpenCode already enables; legacy Alt input always starts with ESC.
      // Legacy Ctrl+letter arrives as bare control codes 1..26, so those are not proof of
      // release for the ctrl trigger either.
      if (passThrough && !sequence.startsWith("\x1b")) {
        const legacyCtrlChar = trigger.name === "ctrl" && sequence.length === 1 && sequence.charCodeAt(0) <= 26
        if (!legacyCtrlChar) setCapture(true)
      }
      return false
    }

    // Fallback hook: while capture is on, opentui hands mouse events to renderables and never
    // to sequence handlers, so observe processSingleMouseEvent to catch trigger-modified gestures.
    let restoreMousePatch: (() => void) | undefined
    const patchMouseEvent = () => {
      const original = renderer.processSingleMouseEvent
      if (typeof original !== "function") return
      const wrapped = function (this: RendererLike, event: RawMouseEvent) {
        try {
          if ((event.type === "down" || event.type === "scroll") && event.modifiers?.[trigger.mod]) setCapture(false)
        } catch {
          // never break the host's mouse handling
        }
        return original.call(renderer, event)
      }
      renderer.processSingleMouseEvent = wrapped
      restoreMousePatch = () => {
        renderer.processSingleMouseEvent = original
      }
    }

    const arm = (kittyKeyboard: boolean) => {
      if (disposed || armed) return
      armed = true
      if (kittyKeyboard) {
        try {
          renderer.enableKittyKeyboard?.(KITTY_EVENT_TYPES)
          usingKitty = true
        } catch {
          // terminal did not like it; stay on the fallback path
        }
      }
      patchMouseEvent()
      renderer.prependInputHandler(handler)
      show(`mouse-toggle ready: ${trigger.name} (${usingKitty ? "kitty" : "fallback"})`)
    }

    const initial = renderer.capabilities
    if (initial) {
      arm(initial.kitty_keyboard === true)
    } else {
      renderer.on?.("capabilities", (caps) => arm(caps?.kitty_keyboard === true))
    }

    return () => {
      disposed = true
      renderer.removeInputHandler(handler)
      restoreMousePatch?.()
      // The pushed kitty event-types flag is intentionally left in place: popping risks
      // tearing down the host's own protocol state, and stray release events are ignored.
      if (passThrough) renderer.useMouse = true
    }
  },
})
