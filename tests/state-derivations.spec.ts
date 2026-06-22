/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * activeVersionNumber's walk-back: a focused event that
 * carries no versionNumber resolves to the most recent
 * publication AT or before its timestamp (the DPP state as
 * it stood when the event happened), falling back to the
 * latest version. Plus displayedEvent's hover > focus >
 * latest precedence. Driven through the real host signals.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as host from '../src/host';
import {
  activeVersionNumber, displayedEvent, focusedEventId, hoveredEventId,
  verifyResult, versionStates, timelineState,
} from '../src/state';
import type { EpcisDocument } from '../src/epcis';
import type { DppSnapshot } from '../src/types';
import type { VersionState } from '../src/archive';

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

const FEED = feed([
  ev('pub-1', '2024-01-01T00:00:00Z', 1),
  ev('insp-a', '2024-06-01T00:00:00Z'),
  ev('pub-2', '2025-01-01T00:00:00Z', 2),
  ev('insp-b', '2025-06-01T00:00:00Z'),
]);

beforeEach(() => {
  host.epcisDocument.set(FEED);
  host.currentVersion.set(2);
  focusedEventId.set(null);
  hoveredEventId.set(null);
});

describe('activeVersionNumber', () => {
  it('uses the focused event versionNumber directly', () => {
    focusedEventId.set('pub-1');
    expect(activeVersionNumber()).toBe(1);
  });

  it('walks back to the publication at-or-before the focus', () => {
    focusedEventId.set('insp-a');
    expect(activeVersionNumber()).toBe(1);
    focusedEventId.set('insp-b');
    expect(activeVersionNumber()).toBe(2);
  });

  it('falls back to the latest version with no focus', () => {
    expect(activeVersionNumber()).toBe(2);
  });

  it('falls back to the latest version when nothing precedes', () => {
    host.epcisDocument.set(feed([
      ev('insp-early', '2023-01-01T00:00:00Z'),
      ev('pub-1', '2024-01-01T00:00:00Z', 1),
    ]));
    focusedEventId.set('insp-early');
    expect(activeVersionNumber()).toBe(2);
  });
});

describe('displayedEvent', () => {
  it('prefers hover over focus over the latest event', () => {
    expect(displayedEvent()?.id).toBe('insp-b');
    focusedEventId.set('pub-1');
    expect(displayedEvent()?.id).toBe('pub-1');
    hoveredEventId.set('insp-a');
    expect(displayedEvent()?.id).toBe('insp-a');
  });
});

function snap(
  version: number, status: string, signed = false,
): DppSnapshot {
  const proof = signed ? [{ proofValue: 'z1' }] : [];
  return { version, status, proof } as unknown as DppSnapshot;
}

describe('verifyResult', () => {
  beforeEach(() => {
    timelineState.set('hidden');
    versionStates.set({});
  });

  it('reports an unsigned draft snapshot as draft, not pending', () => {
    host.snapshots.set({ 2: snap(2, 'draft') });
    expect(verifyResult()).toBe('draft');
  });

  it('does not short-circuit a published snapshot to draft', () => {
    host.snapshots.set({ 2: snap(2, 'in_use') });
    expect(verifyResult()).toBe('pending');
    versionStates.set({ 2: { status: 'verified' } as VersionState });
    expect(verifyResult()).toBe('verified');
  });

  // canonicalStatus falls back to 'draft' for an unknown
  // dppStatus; a signed snapshot must still verify, never read
  // as a draft just because its status didn't map.
  it('verifies a signed snapshot even when status reads draft', () => {
    host.snapshots.set({ 2: snap(2, 'draft', true) });
    expect(verifyResult()).toBe('pending');
    versionStates.set({ 2: { status: 'verified' } as VersionState });
    expect(verifyResult()).toBe('verified');
  });
});
