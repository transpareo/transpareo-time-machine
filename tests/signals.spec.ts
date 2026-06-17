/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Behavioural contract for the pull-based reactive
 * runtime at src/reactive/signals.ts. Every component
 * in the SPA leans on these primitives, and the
 * failure modes (effect not re-running, double-firing,
 * disposed effects still firing, computed not
 * invalidating) are silent at the type level. Tests
 * pin down the contract so refactors of the runtime
 * are safe.
 */

import { describe, it, expect } from 'vitest';
import { signal, computed, effect, untrack }
  from '../src/reactive/signals';

describe('signal: basic read/write', () => {
  it('returns the initial value on read', () => {
    expect(signal(42)()).toBe(42);
  });

  it('returns the latest value after set()', () => {
    const s = signal(1);
    s.set(2);
    expect(s()).toBe(2);
  });

  it('peek() returns the value without subscribing', () => {
    const s = signal('hi');
    expect(s.peek()).toBe('hi');
    s.set('bye');
    expect(s.peek()).toBe('bye');
  });

  it('update() applies a function to the current value', () => {
    const s = signal(10);
    s.update((v) => v + 5);
    expect(s()).toBe(15);
  });
});

describe('signal: change detection', () => {
  it('re-runs an effect when the value changes', () => {
    const s = signal(0);
    let runs = 0;
    effect(() => {
      s();
      runs++;
    });
    expect(runs).toBe(1);
    s.set(1);
    expect(runs).toBe(2);
  });

  it('does NOT re-run an effect when set with the same value', () => {
    const s = signal(7);
    let runs = 0;
    effect(() => {
      s();
      runs++;
    });
    expect(runs).toBe(1);
    s.set(7);
    expect(runs).toBe(1);
  });

  it('uses Object.is, so set(NaN) after NaN does not re-run', () => {
    const s = signal<number>(NaN);
    let runs = 0;
    effect(() => {
      s();
      runs++;
    });
    expect(runs).toBe(1);
    s.set(NaN);
    expect(runs).toBe(1);
  });

  it('uses Object.is, so set(0) after -0 DOES re-run', () => {
    // Object.is(-0, 0) === false, so they count as
    // different. This is the documented contract of
    // notify().
    const s = signal(-0);
    let runs = 0;
    effect(() => {
      s();
      runs++;
    });
    expect(runs).toBe(1);
    s.set(0);
    expect(runs).toBe(2);
  });
});

describe('effect: dependency tracking', () => {
  it('tracks multiple signal reads and re-runs on either', () => {
    const a = signal(1);
    const b = signal(10);
    let sum = 0;
    effect(() => {
      sum = a() + b();
    });
    expect(sum).toBe(11);
    a.set(2);
    expect(sum).toBe(12);
    b.set(20);
    expect(sum).toBe(22);
  });

});

describe('effect: cleanup', () => {
  it('runs the cleanup function before re-running', () => {
    const s = signal(0);
    const trace: string[] = [];
    effect(() => {
      const v = s();
      trace.push(`run(${v})`);
      return () => trace.push(`cleanup(${v})`);
    });
    s.set(1);
    s.set(2);
    expect(trace).toEqual([
      'run(0)', 'cleanup(0)', 'run(1)', 'cleanup(1)', 'run(2)',
    ]);
  });

  it('runs the cleanup function on dispose', () => {
    const s = signal(0);
    let cleanupCalls = 0;
    const dispose = effect(() => {
      s();
      return () => { cleanupCalls++; };
    });
    expect(cleanupCalls).toBe(0);
    dispose();
    expect(cleanupCalls).toBe(1);
  });
});

describe('effect: disposal', () => {
  it('a disposed effect does not re-run on subsequent writes', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      s();
      runs++;
    });
    expect(runs).toBe(1);
    dispose();
    s.set(1);
    s.set(2);
    expect(runs).toBe(1);
  });

  it('redundant dispose() calls are safe', () => {
    const s = signal(0);
    const dispose = effect(() => { s(); });
    dispose();
    expect(() => dispose()).not.toThrow();
  });
});

describe('computed: laziness and caching', () => {
  it('does not call its function until read', () => {
    let calls = 0;
    computed(() => { calls++; return 1; });
    expect(calls).toBe(0);
  });

  it('caches its result across reads when deps are unchanged', () => {
    const s = signal(10);
    let calls = 0;
    const doubled = computed(() => {
      calls++;
      return s() * 2;
    });
    expect(doubled()).toBe(20);
    expect(doubled()).toBe(20);
    expect(doubled()).toBe(20);
    expect(calls).toBe(1);
  });

  it('recomputes when a dependency changes', () => {
    const s = signal(10);
    const doubled = computed(() => s() * 2);
    expect(doubled()).toBe(20);
    s.set(50);
    expect(doubled()).toBe(100);
  });

  it('propagates through computed-of-computed', () => {
    const s = signal(2);
    const doubled = computed(() => s() * 2);
    const quadrupled = computed(() => doubled() * 2);
    expect(quadrupled()).toBe(8);
    s.set(5);
    expect(quadrupled()).toBe(20);
  });

  it('triggers an effect when a computed it reads invalidates', () => {
    const s = signal(1);
    const doubled = computed(() => s() * 2);
    let observed = 0;
    effect(() => { observed = doubled(); });
    expect(observed).toBe(2);
    s.set(7);
    expect(observed).toBe(14);
  });
});

describe('untrack', () => {
  it('reads without subscribing', () => {
    const tracked = signal(0);
    const untracked = signal(0);
    let runs = 0;
    effect(() => {
      tracked();
      untrack(() => { untracked(); });
      runs++;
    });
    expect(runs).toBe(1);

    // untracked write should NOT trigger the effect.
    untracked.set(99);
    expect(runs).toBe(1);

    // tracked write should still trigger.
    tracked.set(1);
    expect(runs).toBe(2);
  });

  it('returns the inner function value', () => {
    const s = signal(42);
    expect(untrack(() => s())).toBe(42);
  });
});
