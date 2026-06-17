/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Wheel + touch input bridged into the deck's
 * dragProgress signal. <dpp-deck> attaches these
 * handlers to its host; everything else here is
 * gesture-internal.
 *
 * One gesture = one commit. After a commit the
 * `gestureSpent` / `touchSpent` latches block further
 * drag until the user lifts and re-engages, keeps a
 * long swipe from racing through 5 versions.
 */
import {
  sortedEvents, focusIndex,
  dragProgress, dragActive, isResidualNav,
  outStartDrag, lastNavDir,
  focusedEventId, timelineState,
  isMobile,
  RELEASE_ANIM_MS,
} from '@/state'
import { animateDragTo, cancelReleaseAnim } from '@/actions'

const COMMIT_DISTANCE_PX = 140
const COMMIT_THRESHOLD = 0.45
const WHEEL_END_DEBOUNCE_MS = 110

// Wheel event delta-X axis-lock threshold in CSS pixels.
// Below this, treat the event as ambient noise from a
// vertically-scrolling trackpad. 4px clears the worst of
// the off-axis chatter physical wheel mice emit without
// dropping a deliberate flick. Re-tested on a Magic
// Trackpad + a Logitech mouse before any future change.
export const WHEEL_AXIS_LOCK_PX = 4

// Touch dead-zone in CSS pixels. A finger has to move
// more than this in either axis before the gesture
// engine picks an axis; below it we ignore the event so
// a tap doesn't accidentally scrub. The dpp-lightbox
// reuses this so the same threshold governs every drag
// surface in the SPA.
export const TOUCH_DEAD_ZONE_PX = 8

let dragAccumPx = 0
let wheelEndTimer: number | null = null
let gestureSpent = false

function clampedDrag(px: number): number {
  const idx = focusIndex()
  const len = sortedEvents().length
  const minDrag = -Math.min(1, idx)
  const maxDrag = Math.min(1, len - 1 - idx)
  const raw = px / COMMIT_DISTANCE_PX
  return Math.max(minDrag, Math.min(maxDrag, raw))
}

function commitNavByDelta(dirSign: -1 | 1): void {
  const list = sortedEvents()
  const idx = focusIndex()
  const target = idx + dirSign
  if (target < 0 || target >= list.length) {
    animateDragTo(0, RELEASE_ANIM_MS)
    return
  }
  outStartDrag.set(dragProgress.peek())
  isResidualNav.set(true)
  lastNavDir.set(dirSign < 0 ? 'l' : 'r')
  focusedEventId.set(list[target].id)
  dragProgress.set(outStartDrag.peek() - dirSign)
  dragAccumPx = dragProgress.peek() * COMMIT_DISTANCE_PX
  animateDragTo(0, RELEASE_ANIM_MS)
}

function endGesture(): void {
  if (wheelEndTimer != null) {
    clearTimeout(wheelEndTimer)
    wheelEndTimer = null
  }
  if (gestureSpent) {
    gestureSpent = false
    return
  }
  if (Math.abs(dragProgress.peek()) >= COMMIT_THRESHOLD) {
    commitNavByDelta(dragProgress.peek() > 0 ? 1 : -1)
  } else {
    animateDragTo(0, RELEASE_ANIM_MS)
  }
}

function scheduleWheelEnd(): void {
  if (wheelEndTimer != null) clearTimeout(wheelEndTimer)
  wheelEndTimer = window.setTimeout(endGesture, WHEEL_END_DEBOUNCE_MS)
}

function beginGesture(): void {
  cancelReleaseAnim()
  dragActive.set(true)
  dragAccumPx = dragProgress.peek() * COMMIT_DISTANCE_PX
  isResidualNav.set(false)
}

// ─── Wheel ────────────────────────────────────────────

export function deckWheel(e: WheelEvent): void {
  // Versioning is locked off while history is hidden.
  if (timelineState.peek() === 'hidden') return
  const ax = Math.abs(e.deltaX)
  const ay = Math.abs(e.deltaY)
  if (ax < WHEEL_AXIS_LOCK_PX || ax < ay) return
  e.preventDefault()
  if (gestureSpent) {
    scheduleWheelEnd()
    return
  }
  beginGesture()
  dragAccumPx += e.deltaX
  dragProgress.set(clampedDrag(dragAccumPx))
  dragAccumPx = dragProgress.peek() * COMMIT_DISTANCE_PX
  if (Math.abs(dragProgress.peek()) >= 1) {
    gestureSpent = true
    commitNavByDelta(dragProgress.peek() > 0 ? 1 : -1)
  }
  scheduleWheelEnd()
}

// ─── Touch ────────────────────────────────────────────

let touchStartX = 0
let touchStartY = 0
let touchStartDragPx = 0
let touchAxisLocked: 'x' | 'y' | null = null
let touchSpent = false

export function deckTouchStart(e: TouchEvent): void {
  if (timelineState.peek() === 'hidden') return
  touchStartX = e.touches[0].clientX
  touchStartY = e.touches[0].clientY
  touchStartDragPx = dragProgress.peek() * COMMIT_DISTANCE_PX
  touchAxisLocked = null
  touchSpent = false
}

export function deckTouchMove(e: TouchEvent): void {
  if (timelineState.peek() === 'hidden') return
  const t = e.touches[0]
  const dx = t.clientX - touchStartX
  const dy = t.clientY - touchStartY
  if (touchAxisLocked == null) {
    if (
      Math.abs(dx) < TOUCH_DEAD_ZONE_PX
      && Math.abs(dy) < TOUCH_DEAD_ZONE_PX
    ) return
    touchAxisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
  }
  if (touchAxisLocked !== 'x') return
  e.preventDefault()
  if (touchSpent) return
  beginGesture()

  // Mobile flips the gesture direction so a swipe-right
  // (finger to the right, content follows) commits to
  // the PREVIOUS version, the iOS swipe-back semantic.
  // Desktop keeps the wheel-driven "swipe right = newer"
  // convention.
  const signed = isMobile.peek() ? -dx : dx
  dragProgress.set(clampedDrag(touchStartDragPx + signed))
  dragAccumPx = dragProgress.peek() * COMMIT_DISTANCE_PX

  // Note: no auto-commit on full drag during touchmove.
  // Touch is deliberate; the user can drag to the clamp
  // (1.0), hold the card off-screen, and either release
  // (commit) or drag back (cancel). Auto-commit fired
  // mid-drag would lock the gesture and prevent the
  // hold/reverse. Wheel keeps its own auto-commit since
  // wheel deltas can overshoot in a single event.
}

export function deckTouchEnd(): void {
  if (touchAxisLocked !== 'x') {
    touchAxisLocked = null
    return
  }
  touchAxisLocked = null
  if (touchSpent) {
    touchSpent = false
    return
  }
  endGesture()
}

// Cancel a pending wheel-end debounce and clear the gesture
// latches. <dpp-deck> calls this on disconnect so a gesture
// still in flight when the deck is torn down (e.g. a `src`
// change reboots the SPA) doesn't fire endGesture against a
// detached tree.
export function cancelPendingGesture(): void {
  if (wheelEndTimer != null) {
    clearTimeout(wheelEndTimer)
    wheelEndTimer = null
  }
  gestureSpent = false
  touchSpent = false
  touchAxisLocked = null
}
