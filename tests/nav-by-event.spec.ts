/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * navByEventId's drag bookkeeping. The release tween that
 * fans the deck back to rest is RAF-driven; a no-op nav
 * (re-selecting the focused version, a boundary prev/next,
 * or back/forward landing on the focused event) must still
 * settle an in-flight tween rather than cancel it mid-dim,
 * which froze the live card at a partial blur/opacity.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as host from '../src/host';
import {
  focusedEventId, hoveredEventId,
  dragProgress, dragActive, isResidualNav,
} from '../src/state';
import { navByEventId, cancelReleaseAnim } from '../src/actions';
import type { EpcisDocument } from '../src/epcis';

function ev(
  id: string, occurredAt: string, versionNumber?: number,
): Record<string, unknown> {
  return {
    type: 'ObjectEvent',
    eventTime: occurredAt,
    'transpareo:dppEventId': id,
    'transpareo:eventType':
      versionNumber != null ? 'published' : 'inspection',
    ...(versionNumber != null
      ? { 'transpareo:versionNumber': versionNumber }
      : {}),
  };
}

function feed(events: Record<string, unknown>[]): EpcisDocument {
  return { epcisBody: { eventList: events } } as unknown as EpcisDocument;
}

// pub-1, insp-a, pub-2, insp-b in time order -> indices 0..3.
const FEED = feed([
  ev('pub-1', '2024-01-01T00:00:00Z', 1),
  ev('insp-a', '2024-06-01T00:00:00Z'),
  ev('pub-2', '2025-01-01T00:00:00Z', 2),
  ev('insp-b', '2025-06-01T00:00:00Z'),
]);

// Drive requestAnimationFrame synchronously against a virtual
// clock so the release tween in animateDragTo runs to its end
// in-band. cancelAnimationFrame drops the frame so a cancelled
// tween can't keep stepping.
let now = 0;
let nextId = 1;
let pending = new Map<number, FrameRequestCallback>();

function flushRaf(): void {
  let guard = 0;
  while (pending.size && guard++ < 1000) {
    const [id, cb] = pending.entries().next().value as
      [number, FrameRequestCallback];
    pending.delete(id);
    now += 16;
    cb(now);
  }
}

beforeEach(() => {
  now = 0;
  nextId = 1;
  pending = new Map();
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pending.delete(id);
  });

  cancelReleaseAnim();
  host.epcisDocument.set(FEED);
  host.currentVersion.set(2);
  focusedEventId.set(null);
  hoveredEventId.set(null);
  dragProgress.set(0);
  dragActive.set(false);
  isResidualNav.set(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('navByEventId: no-op nav settles in-flight drag', () => {
  it('eases a mid-tween deck home when re-selecting the focus', () => {
    focusedEventId.set('pub-2');
    // An interrupted release tween: deck part-way through its
    // dim, still flagged active.
    dragProgress.set(-3);
    dragActive.set(true);
    isResidualNav.set(true);

    navByEventId('pub-2');
    flushRaf();

    expect(dragProgress()).toBe(0);
    expect(dragActive()).toBe(false);
    expect(isResidualNav()).toBe(false);
  });

  it('clears a stuck active flag even when progress is at rest', () => {
    focusedEventId.set('pub-2');
    dragProgress.set(0);
    dragActive.set(true);

    navByEventId('pub-2');
    flushRaf();

    expect(dragProgress()).toBe(0);
    expect(dragActive()).toBe(false);
  });

  it('leaves an already-resting deck untouched (no spurious tween)', () => {
    focusedEventId.set('pub-2');

    navByEventId('pub-2');

    expect(pending.size).toBe(0);
    expect(dragProgress()).toBe(0);
    expect(dragActive()).toBe(false);
  });
});

describe('navByEventId: real move still animates and settles', () => {
  it('kicks the deck then resolves to rest at the target', () => {
    focusedEventId.set('insp-b');

    navByEventId('pub-1');
    // The kick is applied before the tween eases back.
    expect(dragProgress()).not.toBe(0);
    expect(dragActive()).toBe(true);

    flushRaf();
    expect(focusedEventId()).toBe('pub-1');
    expect(dragProgress()).toBe(0);
    expect(dragActive()).toBe(false);
    expect(isResidualNav()).toBe(false);
  });
});
