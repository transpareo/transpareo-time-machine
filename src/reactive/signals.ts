/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Tiny pull-based reactive primitives. Three functions:
 *
 *   signal(initial)      -> readable + writable cell.
 *   computed(fn)         -> derived value, lazy + cached.
 *   effect(fn)           -> side effect that re-runs when
 *                          any signal/computed it read
 *                          changes; returns a disposer.
 *
 * No batching, no transactions, no proxies. Subscribers
 * are tracked via the `currentSubscriber` global while
 * a tracked function executes; `signal()` reads add the
 * subscriber to their dependents, `signal.set()` writes
 * notify them.
 */

interface Subscriber {
  run(): void
  active: boolean
  // Every signal/computed subscriber-set this subscriber
  // has joined, tracked so it can detach itself before a
  // re-run (dropping stale dependencies from a previous
  // branch) and on dispose (so a torn-down effect leaves
  // no entry behind in long-lived module-level signals).
  deps: Set<Set<Subscriber>>
}

let currentSubscriber: Subscriber | null = null

// Link the running subscriber and a signal's subscriber
// set both ways, so the subscriber can later detach.
function track(subs: Set<Subscriber>): void {
  const sub = currentSubscriber
  if (!sub) return
  subs.add(sub)
  sub.deps.add(subs)
}

// Remove a subscriber from every set it joined.
function clearDeps(sub: Subscriber): void {
  for (const subs of sub.deps) subs.delete(sub)
  sub.deps.clear()
}

function notify(subs: Set<Subscriber>): void {
  // Snapshot first so an effect that re-subscribes
  // mid-loop doesn't get called twice for the same write.
  for (const s of [...subs]) {
    if (s.active) s.run()
  }
}

export interface Signal<T> {
  (): T
  set(next: T): void
  update(fn: (prev: T) => T): void
  peek(): T
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial
  const subs = new Set<Subscriber>()

  const read = (() => {
    track(subs)
    return value
  }) as Signal<T>

  read.set = (next: T) => {
    if (Object.is(value, next)) return
    value = next
    notify(subs)
  }
  read.update = (fn) => read.set(fn(value))
  read.peek = () => value

  return read
}

export function computed<T>(fn: () => T): () => T {
  let cached: T
  let stale = true
  const subs = new Set<Subscriber>()
  const owner: Subscriber = {
    run: () => {
      if (!stale) {
        stale = true
        notify(subs)
      }
    },
    active: true,
    deps: new Set(),
  }

  return () => {
    track(subs)
    if (stale) {
      clearDeps(owner)
      const prev = currentSubscriber
      currentSubscriber = owner
      try {
        cached = fn()
      } finally {
        currentSubscriber = prev
      }
      stale = false
    }
    return cached
  }
}

export function effect(
  fn: () => void | (() => void),
): () => void {
  let cleanup: void | (() => void)
  const sub: Subscriber = {
    run: () => {
      if (!sub.active) return
      if (cleanup) {
        try { cleanup(); } catch (_) { /* noop */ }
        cleanup = undefined
      }
      // Drop the previous run's dependencies so a branch no
      // longer read this run stops triggering re-runs.
      clearDeps(sub)
      const prev = currentSubscriber
      currentSubscriber = sub
      try {
        cleanup = fn()
      } finally {
        currentSubscriber = prev
      }
    },
    active: true,
    deps: new Set(),
  }
  sub.run()

  return () => {
    sub.active = false
    clearDeps(sub)
    if (cleanup) {
      try { cleanup(); } catch (_) { /* noop */ }
      cleanup = undefined
    }
  }
}

// Run a function with subscriber tracking suppressed,
// useful inside effects when you want to read a signal
// without subscribing to it.
export function untrack<T>(fn: () => T): T {
  const prev = currentSubscriber
  currentSubscriber = null
  try {
    return fn()
  } finally {
    currentSubscriber = prev
  }
}
