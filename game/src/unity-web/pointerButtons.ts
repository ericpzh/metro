// The one table for DOM mouse button numbers and their `MouseEvent.buttons` held bits
// (plan 30 §1). The two are **not** the same number, and the shell is the boundary where
// they are easy to confuse:
//
//   button 0 (left)   ↔ `buttons` bit 1
//   button 1 (middle) ↔ `buttons` bit 4
//   button 2 (right)  ↔ `buttons` bit 2
//
// A press event names the changed button (0/1/2); a move event names **no** button —
// `MouseEvent.button` is 0 or −1 for a motion — so it must be encoded with the
// unchanged-button sentinel and its `buttons` mask is what says which button is held.
// Mixing those two up is what made a held right erase cancel on its first move (the
// move was encoded as button 0, the router read it as the left button's release) and
// what made a middle drag fail the camera's `buttons & button` test (`1` is the left
// bit, the middle bit is `4`).

/** A DOM press event's changed-button number. */
export const DOM_BUTTON = { left: 0, middle: 1, right: 2 } as const

/** A `buttons` mask bit, by DOM button. */
export const BUTTON_BIT = { left: 1, middle: 4, right: 2 } as const

/** The mask both build buttons make when held together (`pointerInput.ts`'s chord). */
export const BUILD_BUTTON_BITS = BUTTON_BIT.left | BUTTON_BIT.right

/** The `button` value an event sends when no button changed (a move). */
export const MOVE_BUTTON = -1

/** The held-mask bit of one DOM button, or `0` for a button the shell does not track. */
export function bitForButton(button: number): number {
  switch (button) {
    case DOM_BUTTON.left: return BUTTON_BIT.left
    case DOM_BUTTON.middle: return BUTTON_BIT.middle
    case DOM_BUTTON.right: return BUTTON_BIT.right
    default: return 0
  }
}

/** True for the two buttons the build tools share (a right press owned by a pan/tap is not one). */
export function isBuildButton(button: number): boolean {
  return button === DOM_BUTTON.left || button === DOM_BUTTON.right
}

/** True when a held mask still carries a DOM button. */
export function holdsButton(buttons: number, button: number): boolean {
  const bit = bitForButton(button)
  return bit !== 0 && (buttons & bit) !== 0
}

/** True while both build buttons are held (the chord that cancels a press). */
export function hasBuildChord(buttons: number): boolean {
  return (buttons & BUILD_BUTTON_BITS) === BUILD_BUTTON_BITS
}
