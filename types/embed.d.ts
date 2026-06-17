/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Types for the `transpareo-time-machine/embed` entry: the
 * single-file delivery registers the same elements as the
 * main entry (CSS delivery is the only difference), so the
 * declarations are shared via ./index.d.ts.
 */

import './index'

export type {
  DppVerifierElement,
  ModalHandle,
  ModalOpenOptions,
  TimeMachineStateDetail,
  TranspareoTimeMachineElement,
} from './index'
