/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-auth-modal>, the X-Auth-Fields consumer. Renders
 * the form described by the current challenge (see
 * private-properties.ts), POSTs the values through
 * submitAuth(), and stays open across stepped-auth
 * rounds until the backend either accepts the
 * credentials or the visitor cancels.
 *
 * Form field semantics:
 *
 *   - `email`    -> <input type="email">
 *   - `password` -> <input type="password">
 *   - `text`     -> <input type="text">
 *   - `number`   -> <input type="number">
 *
 * Anything else is rendered as `text` so a backend
 * with a custom field type doesn't blank the form.
 *
 * Same-stage retry preserves the visitor's entered
 * values across re-renders (wrong-password feedback
 * shouldn't blank the form). private-properties.ts
 * exposes those values via getLastSubmittedValues();
 * the modal pre-fills inputs from that map on every
 * render and lets the module clear the buffer when the
 * stage advances or the user cancels.
 *
 * Closing the modal (Escape, outside-click, X button)
 * calls cancelAuth(), which drops both the in-flight
 * challenge and the pre-fill buffer. The next open
 * re-fetches privateProperties.url so the backend can
 * issue a fresh stage-1 challenge, avoiding stale OTP
 * state from a long-abandoned earlier round.
 */

import { LightElement } from '@/reactive/element'
import { signal } from '@/reactive/signals'
import { bindModalChrome, buildModal } from '@/reactive/modal'
import { activeVersionNumber } from '@/state'
import {
  challenge as challengeSignal,
  fetchStateByVersion,
  cancelAuth,
  submitAuth,
  getLastSubmittedValues,
  type AuthChallenge,
  type AuthFieldDescriptor,
} from '@/private-properties'
import { i18n } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'

const tr = (key: LabelKey): string => t(i18n.labels, key)

export const authModalOpen = signal(false)

const FIELD_TYPE_MAP: Record<string, string> = {
  email: 'email',
  password: 'password',
  text: 'text',
  number: 'number',
}

class DppAuthModal extends LightElement {
  protected setup(): void {
    this.className = 'dpp-auth-modal-overlay'
    this.style.display = 'none'

    bindModalChrome(this, this.effect.bind(this), {
      isOpen: () => authModalOpen(),
      onClose: () => close(),
    })

    this.effect(() => {
      const open = authModalOpen()
      const ch = challengeSignal()
      const ver = activeVersionNumber()
      const state = fetchStateByVersion()[ver]
      if (!open) {
        this.style.display = 'none'
        this.replaceChildren()
        return
      }

      // Authed in another tab, or a transient 5xx that
      // the renderer's retry affordance should own:
      // close the modal so the visitor isn't left
      // staring at "Connecting…" forever. cancelAuth
      // clears the (already empty) challenge buffer so
      // a future open re-runs the fetch cleanly.
      if (
        state?.status === 'ok'
        || state?.status === 'empty'
        || state?.status === 'error'
      ) {
        authModalOpen.set(false)
        cancelAuth()
        return
      }
      this.style.display = ''
      this.replaceChildren(buildContent(ch))
    })
  }
}

function close(): void {
  authModalOpen.set(false)
  cancelAuth()
}

function buildContent(ch: AuthChallenge | null): HTMLElement {
  const body = document.createElement('div')
  if (!ch) {
    body.appendChild(buildStatus(tr('auth.connecting')))
  } else {
    body.appendChild(buildForm(ch))
  }
  return buildModal({
    title: tr('auth.signIn'),
    body,
    onClose: close,
  })
}

function buildStatus(text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = 'dpp-auth-status'
  p.textContent = text
  return p
}

function buildForm(ch: AuthChallenge): HTMLFormElement {
  const form = document.createElement('form')
  form.className = 'dpp-auth-form'

  if (ch.error) {
    const err = document.createElement('p')
    err.className = 'dpp-auth-error'
    err.textContent = ch.error
    form.appendChild(err)
  }

  for (const field of ch.fields) {
    form.appendChild(buildField(field))
  }

  const submit = document.createElement('button')
  submit.type = 'submit'
  submit.className = 'dpp-auth-submit'
  submit.textContent = tr('auth.signIn')
  form.appendChild(submit)

  let submittingNow = false

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (submittingNow) return
    submittingNow = true
    submit.disabled = true
    const values = collectValues(form, ch.fields)

    // Reset the submitting lock on every settle path
    // (success, expected outcome variants, or a thrown
    // rejection). Without the .catch the form would stay
    // pinned in "Signing in..." after a network failure.
    const settle = (): void => {
      submittingNow = false
      submit.disabled = false
    }
    void submitAuth(values).then((outcome) => {
      settle()

      // 'ok' -> rows arrived; the parent effect will
      //         close the modal when fetchState flips to
      //         'ok' / 'empty'.
      // 'unauth' -> challenge updated (stepped auth or
      //             same-stage retry); parent effect
      //             re-renders the form, this time with
      //             the new X-Auth-Fields / error.
      // 'error' -> private-properties.ts wrote the error
      //             onto challenge; same re-render path.
      if (outcome === 'ok') {
        authModalOpen.set(false)
      }
    }).catch(() => settle())
  })

  return form
}

function buildField(field: AuthFieldDescriptor): HTMLElement {
  const wrap = document.createElement('label')
  wrap.className = 'dpp-auth-field'

  const labelText = field.label ?? field.name
  const label = document.createElement('span')
  label.className = 'dpp-auth-field-label'
  label.textContent = labelText
  wrap.appendChild(label)

  const input = document.createElement('input')
  input.name = field.name
  input.type = FIELD_TYPE_MAP[field.type] ?? 'text'
  if (field.required) input.required = true
  const prior = getLastSubmittedValues()[field.name]
  if (prior != null && field.type !== 'password') input.value = prior
  wrap.appendChild(input)

  if (field.hint) {
    const hint = document.createElement('span')
    hint.className = 'dpp-auth-field-hint'
    hint.textContent = field.hint
    wrap.appendChild(hint)
  }

  return wrap
}

function collectValues(
  form: HTMLFormElement,
  fields: ReadonlyArray<AuthFieldDescriptor>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of fields) {
    const el = form.elements.namedItem(field.name)
    if (el instanceof HTMLInputElement) out[field.name] = el.value
  }
  return out
}

customElements.define('dpp-auth-modal', DppAuthModal)
