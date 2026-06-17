/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * `TrackedTween<K>`, a keyed bag of numeric values
 * that ease toward their targets via a single RAF
 * loop. New targets that match the current value are
 * a no-op; targets that don't, animate.
 *
 * Usage (per-substance percentages on the composition
 * donut):
 *
 *   const tween = new TrackedTween<string>({
 *     tau: 110,
 *     onTick: () => paintSegments(group, tween.tracks),
 *   })
 *
 *   const moving = tween.apply([
 *     { key: 'cotton',   target: 92 },
 *     { key: 'elastane', target: 5 },
 *   ], snap)
 *   if (moving) tween.start()
 *
 * Snap-on-first-paint: pass `snap: true` and current
 * jumps to target immediately. Useful for the very
 * first render so the chart paints with the right
 * shape rather than animating up from zero.
 */

export interface Track {
  current: number
  target: number
}

export interface TweenInput<K> {
  readonly key: K
  readonly target: number
}

interface TweenOptions {
  // Time constant for the exponential ease toward
  // target. ~110ms feels close to a 600ms cubic-out
  // without the bookkeeping.
  readonly tau?: number
  // Called after each frame's tick. The owner reads
  // `tween.tracks` and renders.
  readonly onTick: () => void
}

const SETTLE_EPSILON = 0.05

export class TrackedTween<K> {
  readonly tracks = new Map<K, Track>()
  private raf: number | null = null
  private lastTick = 0
  private readonly tau: number
  private readonly onTick: () => void

  constructor(opts: TweenOptions) {
    this.tau = opts.tau ?? 110
    this.onTick = opts.onTick
  }

  /**
   * Set new targets for every key in `items`. Any
   * track not in `items` fades to 0 (or is removed
   * if it's already at 0). Returns `true` if at
   * least one track needs animation; the caller
   * should `start()` if so.
   */
  apply(items: ReadonlyArray<TweenInput<K>>, snap = false): boolean {
    let changed = false
    const seen = new Set<K>()
    for (const it of items) {
      seen.add(it.key)
      const existing = this.tracks.get(it.key)
      if (!existing) {
        this.tracks.set(it.key, { current: it.target, target: it.target })
        continue
      }
      if (existing.target !== it.target) {
        existing.target = it.target
        if (snap) existing.current = it.target
        else changed = true
      }
    }
    for (const [k, t] of this.tracks) {
      if (seen.has(k)) continue
      if (t.target !== 0) {
        t.target = 0
        if (snap) this.tracks.delete(k)
        else changed = true
      } else if (t.current === 0) {
        this.tracks.delete(k)
      }
    }
    return changed
  }

  /** Reset to empty state. */
  clear(): void {
    this.stop()
    this.tracks.clear()
  }

  start(): void {
    if (this.raf != null) return
    this.lastTick = performance.now()
    const step = (now: number): void => {
      const dt = now - this.lastTick
      this.lastTick = now
      const more = this.tick(dt)
      this.onTick()
      if (more) {
        this.raf = requestAnimationFrame(step)
      } else {
        this.raf = null
      }
    }
    this.raf = requestAnimationFrame(step)
  }

  stop(): void {
    if (this.raf != null) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
  }

  private tick(dt: number): boolean {
    const k = 1 - Math.exp(-dt / this.tau)
    let stillMoving = false
    for (const [key, t] of this.tracks) {
      const diff = t.target - t.current
      if (Math.abs(diff) < SETTLE_EPSILON) {
        t.current = t.target
        if (t.target === 0) this.tracks.delete(key)
      } else {
        t.current += diff * k
        stillMoving = true
      }
    }
    return stillMoving
  }
}
