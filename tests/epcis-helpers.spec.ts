/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The EPCIS label extractors: CBV CURIE -> local term,
 * GS1 Digital Link GLN extraction, and the compact EPC
 * label. All regex-driven, so the edge shapes (no match,
 * query strings, trailing segments) are pinned here.
 */

import { describe, it, expect } from 'vitest';
import { cbvLabel, glnFromUri, epcShortLabel } from '../src/epcis';

describe('cbvLabel', () => {
  it('extracts the local term and spaces underscores', () => {
    expect(cbvLabel('cbv:BizStep-repairing')).toBe('repairing');
    expect(cbvLabel('cbv:Disp-in_progress')).toBe('in progress');
  });

  it('handles every CBV prefix family', () => {
    expect(cbvLabel('cbv:BTT-po')).toBe('po');
    expect(cbvLabel('cbv:SDT-owning_party')).toBe('owning party');
    expect(cbvLabel('cbv:ER-incorrect_data')).toBe('incorrect data');
    expect(cbvLabel('cbv:Comp-x')).toBe('x');
  });

  it('falls through on non-CBV strings and empty input', () => {
    expect(cbvLabel('urn:something:else')).toBe('urn:something:else');
    expect(cbvLabel(undefined)).toBe('');
  });
});

describe('glnFromUri', () => {
  it('extracts the 13-digit GLN from a /414/ link', () => {
    expect(glnFromUri('https://id.gs1.org/414/5012345100111'))
      .toBe('5012345100111');
    expect(glnFromUri('https://id.gs1.org/414/5012345100111?ext=1'))
      .toBe('5012345100111');
  });

  it('keeps the original URI when not in 414 form', () => {
    expect(glnFromUri('https://example.test/location/9'))
      .toBe('https://example.test/location/9');
    expect(glnFromUri(undefined)).toBe('');
  });
});

describe('epcShortLabel', () => {
  it('prefers the /21/ serial over the /10/ lot', () => {
    expect(epcShortLabel(
      'https://id.gs1.org/01/04012345678901/10/LOT1/21/SER9',
    )).toBe('SER9');
  });

  it('falls back to the /10/ lot', () => {
    expect(epcShortLabel(
      'https://id.gs1.org/01/04012345678901/10/BATCH-8',
    )).toBe('BATCH-8');
  });

  it('keeps the full URI when no compact id is present', () => {
    expect(epcShortLabel('https://id.gs1.org/01/04012345678901'))
      .toBe('https://id.gs1.org/01/04012345678901');
  });
});
