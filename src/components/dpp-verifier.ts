/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-verifier>, standalone verification widget for a
 * marketing / verification surface. Renders a form whose
 * input takes a passport page link (what QR codes and
 * shared links carry) or a manifest URL; an HTML answer
 * is resolved to the manifest the page references (see
 * manifest-discovery.ts). The widget then fetches the
 * manifest + current snapshot and runs the same gates as
 * the SPA chip in the browser: verifySnapshot (strict),
 * the manifest's own platform signature, and the
 * priorVersionHash chain walk down to v1. Shows the
 * 5-entry proof chain plus the aggregate verdict.
 *
 * Attributes:
 *
 *   src                    Optional. Pre-fills the input
 *                          and verifies on connect; takes
 *                          a passport page or manifest
 *                          URL, like the input.
 *
 *   pinned-platform-key    Optional, one or more
 *                          multibase Ed25519 public keys
 *                          (z-prefixed), whitespace-
 *                          separated; rotation keeps
 *                          retired-but-sound keys in the
 *                          set. When set, proof entries
 *                          whose resolved key matches a
 *                          pin are flagged "platform" in
 *                          the UI and elevate the
 *                          identity tier. Without pins
 *                          the widget treats every
 *                          fetched key as equally
 *                          trusted and groups entries by
 *                          signature value (the default
 *                          2-of-2 rule).
 *
 * Independent of the SPA's state.ts / host.ts / actions
 * stack: has its own fetch + state machinery so the
 * widget bundles cleanly into its own dpp-verifier.js
 * lib output.
 */

import { BaseElement } from '@/reactive/element'
import { el } from '@/reactive/dom'
import { signal } from '@/reactive/signals'
import { icon } from '@/icons'
import {
  verifySnapshot,
  verifyManifestSignature,
  type VerificationResult,
  type ProofEntryResult,
} from '@/crypto/verify'
import {
  combinedVerdict,
  verdictIdentity,
  type AggregateVerdict,
  type ArtefactSignatureState,
  type VerdictIdentity,
} from '@/verifier-verdict'
import {
  verifyChainFromHead, type ChainCheckResult,
} from '@/verifier-chain'
import { readTextResponse } from '@/fetch-json'
import { looksLikeHtml, discoverManifestUrl } from '@/manifest-discovery'
import { parseKeySet } from '@/config'
import {
  i18n, locale, setHostLocale, detectLocale, UI_LOCALES,
} from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'
import type { DppManifest, SignedSnapshot } from '@/archive'
import css from '@/styles/dpp-verifier.scss?inline'

const tr = (key: LabelKey, vars?: Record<string, string | number>): string =>
  t(i18n.labels, key, vars)

type WidgetState =
  | { status: 'idle' }
  | { status: 'loading'; url: string }
  | { status: 'error'; url: string; message: string }
  | {
      status: 'ready'
      url: string
      manifestUrl: string
      manifest: DppManifest
      snapshot: SignedSnapshot
      result: VerificationResult
      manifestSignature: ArtefactSignatureState
      chain: ChainCheckResult
    }

class DppVerifier extends BaseElement {
  private state = signal<WidgetState>({ status: 'idle' })
  private input!: HTMLInputElement
  private resultMount!: HTMLDivElement

  protected setup(root: ShadowRoot): void {
    // Pin the widget's locale from the host page's `lang`. The
    // verifier has no DPP available-locales to auto-detect from,
    // so without this it sits on English. Falls back to the
    // browser preference, then English (UI_LOCALES is en-first).
    setHostLocale(this.getAttribute('lang'))
    locale.set(detectLocale(UI_LOCALES))

    this.addStyle(css)

    const wrap = el('div', 'verifier')
    wrap.appendChild(this.buildForm())
    this.resultMount = el('div', 'verifier-result')
    wrap.appendChild(this.resultMount)
    root.appendChild(wrap)

    const pins = parseKeySet(this, 'pinned-platform-key')
    const initial = this.getAttribute('src')
    if (initial) {
      this.input.value = initial
      void this.run(initial, pins)
    }

    this.effect(() => this.render(this.state(), pins))
  }

  private buildForm(): HTMLFormElement {
    const form = document.createElement('form')
    form.className = 'verifier-form'

    const label = el('label', 'verifier-label')
    label.htmlFor = 'verifier-input'
    this.effect(() => { label.textContent = tr('verifier.url') })
    form.appendChild(label)

    const row = el('div', 'verifier-row')
    this.input = document.createElement('input')
    this.input.type = 'url'
    this.input.id = 'verifier-input'
    this.input.className = 'verifier-input'
    this.input.required = true
    this.effect(() => {
      this.input.placeholder = tr('verifier.placeholder')
    })
    row.appendChild(this.input)

    const submit = el('button', 'verifier-submit')
    submit.type = 'submit'
    this.effect(() => { submit.textContent = tr('verifier.verify') })
    row.appendChild(submit)

    form.appendChild(row)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const url = this.input.value.trim()
      if (!url) return
      const pins = parseKeySet(this, 'pinned-platform-key')
      void this.run(url, pins)
    })
    return form
  }

  // Monotonic submit counter: a slow earlier run that
  // resolves after a newer submit must not clobber the
  // newer run's state.
  private runSeq = 0

  private async run(
    url: string, pins: ReadonlyArray<string> | undefined,
  ): Promise<void> {
    const seq = ++this.runSeq
    this.state.set({ status: 'loading', url })
    try {
      const { manifest, manifestUrl } = await loadManifest(
        new URL(url, window.location.href).toString(),
      )
      const currentEntry = manifest.versions.find(
        (v) => v.number === manifest.currentVersion,
      )
      if (!currentEntry?.url) {
        throw new Error('manifest is missing the current version URL')
      }
      const snapUrl = new URL(currentEntry.url, manifestUrl).toString()
      const snapshot = await fetchJson<SignedSnapshot>(snapUrl)
      const result = await verifySnapshot(snapshot, {
        mode: 'strict',
        pinnedPlatformKeys: pins,
      })

      // The widget shows manifest-derived claims (version
      // count, issuer/platform names), so it runs the same
      // gates the SPA chip does: the manifest's own platform
      // signature and the priorVersionHash chain walk down
      // to v1.
      const manifestSignature = await verifyManifestSignature(
        manifest as unknown as Record<string, unknown>, pins,
      ).then((res) => res ?? ('absent' as const))
      const chain = await verifyChainFromHead(
        manifest, manifestUrl, snapshot,
        (u) => fetchJson<SignedSnapshot>(u),
      )
      if (seq !== this.runSeq) return
      this.state.set({
        status: 'ready', url, manifestUrl, manifest, snapshot, result,
        manifestSignature, chain,
      })
    } catch (err) {
      if (seq !== this.runSeq) return
      const message = err instanceof Error ? err.message : String(err)
      this.state.set({ status: 'error', url, message })
    }
  }

  private render(
    s: WidgetState, pins: ReadonlyArray<string> | undefined,
  ): void {
    const mount = this.resultMount
    if (s.status === 'idle') {
      mount.replaceChildren()
      return
    }
    if (s.status === 'loading') {
      mount.replaceChildren(
        el('p', 'verifier-status', tr('verifier.verifying')),
      )
      return
    }
    if (s.status === 'error') {
      const wrap = el('div', 'verifier-error')
      wrap.append(
        buildOrb(false),
        el('span', undefined, tr('verifier.couldNotVerify', { message: s.message })),
      )
      mount.replaceChildren(wrap)
      return
    }

    // status === 'ready'
    mount.replaceChildren(buildResultCard(s, pins))
  }
}

// ─── Fetch helpers ────────────────────────────────

// Same tolerances as the SPA's artefact fetches: a 15s
// timeout so a hung socket rejects into the error state,
// and readTextResponse so header-less gzip objects (older
// CDN uploads) still parse. Returns the final
// post-redirect URL alongside the body, so relative
// references resolve against where the bytes actually
// came from (share-link shorteners redirect).
async function fetchText(
  url: string,
): Promise<{ body: string; url: string }> {
  const res = await fetch(url, {
    credentials: 'omit',
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`)
  }
  return { body: await readTextResponse(res), url: res.url || url }
}

async function fetchJson<T>(url: string): Promise<T> {
  const { body } = await fetchText(url)
  return JSON.parse(body) as T
}

// The pasted URL is either the manifest itself or the
// passport page a QR code / shared link points at. Fetch
// it once and sniff the body: JSON is taken as the
// manifest, HTML as the page, whose declared manifest
// reference is then followed.
async function loadManifest(
  url: string,
): Promise<{ manifest: DppManifest; manifestUrl: string }> {
  const { body, url: finalUrl } = await fetchText(url)
  if (!looksLikeHtml(body)) {
    return { manifest: asManifest(JSON.parse(body)), manifestUrl: finalUrl }
  }
  const manifestUrl = discoverManifestUrl(body, finalUrl)
  if (!manifestUrl) {
    throw new Error(tr('verifier.noManifestOnPage'))
  }
  return { manifest: asManifest(await fetchJson(manifestUrl)), manifestUrl }
}

// Minimal shape gate so a snapshot URL or arbitrary JSON
// fails with a readable message instead of a TypeError
// deeper in the run.
function asManifest(data: unknown): DppManifest {
  const m = data as DppManifest | null
  if (!m || !Array.isArray(m.versions)) {
    throw new Error('fetched JSON is not a DPP manifest')
  }
  return m
}

// ─── Result card ─────────────────────────────────

interface ReadyState {
  readonly url: string
  readonly manifestUrl: string
  readonly manifest: DppManifest
  readonly snapshot: SignedSnapshot
  readonly result: VerificationResult
  readonly manifestSignature: ArtefactSignatureState
  readonly chain: ChainCheckResult
}

function buildResultCard(
  s: ReadyState, pins: ReadonlyArray<string> | undefined,
): HTMLElement {
  const verdict = combinedVerdict(s.result, s.manifestSignature, s.chain)
  const identity = verdictIdentity(
    s.result, pins, s.manifestSignature,
    s.manifest.platform.did, s.manifestUrl,
  )
  const wrap = el('section',
    `verifier-card verdict-${verdict.outcome} identity-${identity}`)

  wrap.appendChild(buildBanner(verdict, identity, s))
  wrap.appendChild(buildMeta(s))
  wrap.appendChild(buildChain(
    s.result, pins, s.manifest.issuer.name, s.manifest.platform.name,
  ))
  return wrap
}

function buildBanner(
  verdict: AggregateVerdict, identity: VerdictIdentity, s: ReadyState,
): HTMLElement {
  const banner = el('div', 'verifier-banner')
  banner.appendChild(buildOrb(verdict.outcome === 'authentic'))
  banner.appendChild(el(
    'strong', 'verifier-verdict', bannerText(verdict, identity, s),
  ))
  banner.appendChild(el(
    'span', 'verifier-version',
    `v${s.manifest.currentVersion} / ${s.manifest.versions.length}`,
  ))
  return banner
}

// An authentic verdict carries the platform's name only
// when the identity tier earned it: 'pinned' (key matched
// the caller's pin) or 'bound' (keys resolve from the
// domain platform.did declares). 'unconfirmed' renders the
// neutral signatures-valid wording, since the name in the
// manifest is then just a claim.
function bannerText(
  verdict: AggregateVerdict, identity: VerdictIdentity, s: ReadyState,
): string {
  if (verdict.outcome !== 'authentic') return verdictText(verdict)
  if (identity === 'unconfirmed') {
    return tr('verifier.verdict.consistentOnly')
  }
  return tr('verifiedByPlatform', { name: s.manifest.platform.name })
}

function buildMeta(s: ReadyState): HTMLElement {
  const meta = el('dl', 'verifier-meta')
  addRow(meta, tr('verifier.meta.issuer'), s.manifest.issuer.name)
  addRow(meta, tr('verifier.meta.platform'), s.manifest.platform.name)
  addRow(meta, tr('verifier.meta.dppCode'), s.manifest.code)
  addRow(meta, tr('verifier.meta.published'), s.snapshot.publishedAt)
  return meta
}

function addRow(dl: HTMLElement, key: string, value: string): void {
  dl.append(
    el('dt', undefined, key),
    el('dd', undefined, value),
  )
}

// ─── Proof chain (5 entries grouped by authority) ──

function buildChain(
  result: VerificationResult,
  pins: ReadonlyArray<string> | undefined,
  issuerName: string,
  platformName: string,
): HTMLElement {
  const groups = groupEntries(result.entries, pins)
  const wrap = el('div', 'verifier-chain')
  wrap.appendChild(el('h3', 'verifier-section-title', tr('verifier.proofChain')))
  for (const g of groups) {
    wrap.appendChild(buildGroup(g, issuerName, platformName))
  }
  return wrap
}

interface AuthorityGroup {
  readonly label: 'platform' | 'issuer' | 'other'
  readonly entries: ReadonlyArray<ProofEntryResult>
}

// When pins are set: split into "platform" (entries
// whose resolved key matches a pin) vs "issuer"
// (everything else). When unpinned: group by resolved
// key (an authority's aliases all resolve to one key);
// the first group is labelled "issuer" and the second
// "platform" by URL heuristic.
function groupEntries(
  entries: ReadonlyArray<ProofEntryResult>,
  pins: ReadonlyArray<string> | undefined,
): AuthorityGroup[] {
  if (pins?.length) {
    const platform = entries.filter((e) => e.pinned)
    const issuer = entries.filter((e) => !e.pinned)
    return [
      { label: 'issuer', entries: issuer },
      { label: 'platform', entries: platform },
    ].filter((g) => g.entries.length > 0) as AuthorityGroup[]
  }

  // Unpinned: group by resolved key (an authority's
  // aliases share one key); entries that didn't resolve
  // fall back to their own verificationMethod.
  const byAuthority = new Map<string, ProofEntryResult[]>()
  for (const e of entries) {
    const key = e.keyMultibase ?? e.verificationMethod
    const bucket = byAuthority.get(key) ?? []
    bucket.push(e)
    byAuthority.set(key, bucket)
  }
  const groups: AuthorityGroup[] = []
  for (const bucket of byAuthority.values()) {
    groups.push({ label: labelFromUrls(bucket), entries: bucket })
  }
  groups.sort((a, b) => order(a.label) - order(b.label))
  return groups
}

function labelFromUrls(
  bucket: ReadonlyArray<ProofEntryResult>,
): AuthorityGroup['label'] {
  for (const e of bucket) {
    if (/\/keys\/issuer\b/.test(e.verificationMethod)) return 'issuer'
    if (/\/keys\/platform\b/.test(e.verificationMethod)) return 'platform'
  }
  return 'other'
}

function order(label: AuthorityGroup['label']): number {
  if (label === 'issuer') return 0
  if (label === 'platform') return 1
  return 2
}

function buildGroup(
  g: AuthorityGroup, issuerName: string, platformName: string,
): HTMLElement {
  const ok = g.entries.some((e) => e.status === 'verified')
  const card = el('div', `verifier-authority is-${ok ? 'ok' : 'bad'}`)
  const head = el('div', 'verifier-authority-head')
  head.append(
    buildOrb(ok),
    el('span', 'verifier-authority-label',
      g.label === 'issuer' ? issuerName
        : g.label === 'platform' ? platformName
          : tr('verifier.authority')),
  )
  card.appendChild(head)

  const list = el('div', 'verifier-entries')
  for (const e of g.entries) list.appendChild(buildEntry(e))
  card.appendChild(list)
  return card
}

function buildEntry(entry: ProofEntryResult): HTMLElement {
  const row = el('div', `verifier-entry status-${entry.status}`)
  row.appendChild(buildOrb(entry.status === 'verified', entry.status))
  row.appendChild(el('code', 'verifier-entry-vm', entry.verificationMethod))
  if (entry.status !== 'verified') {
    row.appendChild(el('span', 'verifier-entry-status',
      entryStatusLabel(entry.status)))
  }
  if (entry.reason) {
    row.appendChild(el('span', 'verifier-entry-reason', entry.reason))
  }
  return row
}

function entryStatusLabel(s: ProofEntryResult['status']): string {
  switch (s) {
    case 'verified': return tr('verifier.entry.verified')
    case 'pending': return tr('verifier.entry.pending')
    case 'unreachable': return tr('verifier.entry.unreachable')
    case 'invalid': return tr('verifier.entry.invalid')
  }
}

// Map the verdict reason code to a localized string.
function verdictText(v: AggregateVerdict): string {
  if (v.reason === 'partial') {
    return tr('verifier.verdict.partial', {
      verified: v.verifiedEntryCount, total: v.totalEntryCount,
    })
  }
  return tr(`verifier.verdict.${v.reason}` as LabelKey)
}

function buildOrb(
  ok: boolean, status?: ProofEntryResult['status'],
): HTMLElement {
  const color = ok ? 'verified'
    : status === 'pending' ? 'pending'
      : 'failed'
  const orb = el('span', `orb orb-${color}`)
  if (ok) orb.appendChild(icon('ok'))
  else if (status !== 'pending') orb.appendChild(icon('cancel'))
  return orb
}

customElements.define('dpp-verifier', DppVerifier)
