// Single source of truth for "is this a touch-primary device" — used by
// both game engines (to decide whether to read from the on-screen
// joystick instead of keyboard/mouse) and the React layer (to decide
// whether to render that joystick at all). Keeping it in one place means
// the two checks can never drift apart — previously the CSS/markup for
// touch controls existed but nothing ever called setTouch(true), so the
// engines silently never used it regardless of what was on screen.
//
// matchMedia('pointer: coarse') is the right signal here, not
// 'ontouchstart' in window — the latter also reports true on touch-capable
// laptops that people normally drive with a mouse, which would show a
// touch joystick to someone using a trackpad.
export function isTouchDevice() {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
}
