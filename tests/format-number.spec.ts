/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * formatNumber renders bare wire numbers in the active
 * locale's convention (decimal separator + grouping), which
 * is what makes a German consumer see 87,3 instead of 87.3.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { formatNumber, locale } from '../src/i18n';

afterEach(() => locale.set('en'));

describe('formatNumber', () => {
  it('uses the active locale decimal separator', () => {
    locale.set('de');
    expect(formatNumber(87.3)).toBe('87,3');
    locale.set('en');
    expect(formatNumber(87.3)).toBe('87.3');
  });

  it('applies locale grouping separators', () => {
    locale.set('de');
    expect(formatNumber(2048)).toBe('2.048');
    locale.set('en');
    expect(formatNumber(2048)).toBe('2,048');
  });
});
