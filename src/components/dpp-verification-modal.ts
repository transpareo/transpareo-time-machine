/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-verification-modal>, proof drawer for the active
 * passport. Opens off the verification chip; closed via
 * Escape, X, or overlay-click.
 *
 * Blocks:
 *
 *   1. Aggregate summary: how many versions are
 *      authentic / unauthenticated / pending, plus the
 *      "you are on version X of Y" line. A proven-invalid
 *      events signature counts against the headline too.
 *   2. Manifest signature: the single platform proof
 *      bound to the whole manifest. Re-verified in the
 *      SPA (verifyManifestSignature Ed25519-checks the
 *      manifest body); the badge reflects the live
 *      verdict and a proven-invalid signature fails the
 *      version list in actions.ts.
 *   3. Events signature (only when the events sidecar
 *      carries one): the platform proof bound to the
 *      whole EPCIS document the timeline is built from,
 *      verified the same way and badged the same way.
 *   4. Active snapshot's proof chain: the five proof
 *      entries the renderer just verified, grouped by
 *      authority (issuer vs platform). Each
 *      row shows the verificationMethod URL and a
 *      status badge (verified / unreachable / invalid /
 *      pending). Followed by a "Versions check"
 *      disclosure with the per-version aggregate
 *      verdicts so the visitor can browse the chain.
 *
 * Versions verify lazily: the active version on scrub
 * (bootstrap.ts -> bootstrapVerify, plus a prefetch
 * window while the timeline is open), and the rest when
 * this modal opens: automatically up to
 * AUTO_VERIFY_LIMIT versions, via the "Verify all"
 * button beyond that. The disclosure stays closed by
 * default because the chain detail is the part visitors
 * actually want; the per-version breakdown is for the
 * curious.
 */

import { LightElement } from '@/reactive/element'
import { signal } from '@/reactive/signals'
import { el } from '@/reactive/dom'
import { safeLinkHref } from '@/safe-url'
import { bindModalChrome, buildModal } from '@/reactive/modal'
import {
  manifest as manifestSignal,
  versionStates, events, focusedEventId, timelineState,
  activeVersionNumber, activeIssuer, activePlatform,
  epcisDocument,
  manifestProofState, eventsProofState, type SignatureProofState,
} from '@/state'
import * as host from '@/host'
import { ensureVersionLoaded, signatureIsAcceptable } from '@/actions'
import { icon } from '@/icons'
import { i18n } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'
import type {
  DppManifest, ManifestSignature, VersionState,
} from '@/archive'
import type {
  ProofEntryResult, VerificationResult,
} from '@/crypto/verify'
import { downloadJson, slugForFilename } from '@/download'

// Above this many versions, auto-verifying all on modal
// open would burn a lot of CPU and bandwidth for someone
// who just wanted to peek at the proof. Show a button
// instead and let them ask.
const AUTO_VERIFY_LIMIT = 20

export const proofModalOpen = signal(false)

type StatesMap = Record<number, VersionState>

class DppVerificationModal extends LightElement {
  protected setup(): void {
    this.setAttribute('aria-labelledby', 'proof-title')

    bindModalChrome(this, this.effect.bind(this), {
      isOpen: () => proofModalOpen() && manifestSignal() != null,
      onClose: close,
    })

    this.effect(() => this.render())

    // When the modal opens, kick off the per-version
    // verification for the rest of the chain, but only
    // if the version count is small enough to be free.
    // Larger DPPs show a "Verify all N versions" button
    // inside the disclosure so the user can opt in.
    this.effect(() => {
      if (!proofModalOpen()) return
      const m = manifestSignal.peek()
      if (!m) return
      if (m.versions.length > AUTO_VERIFY_LIMIT) return
      for (const v of m.versions) ensureVersionLoaded(v.number)
    })
  }

  private render(): void {
    const open = proofModalOpen()
    const m = manifestSignal()
    if (!open || !m) {
      this.classList.remove('open')
      this.replaceChildren()
      return
    }

    const states = versionStates()
    const activeVersion = activeVersionNumber()
    const activeState = states[activeVersion]

    const eventsState = eventsProofState()
    const epcisDoc = epcisDocument()

    const body = document.createDocumentFragment()
    body.append(
      buildSummary(m, states, eventsState, epcisDoc != null, activeVersion),
    )

    // The manifest's platform signature, when it carries one.
    // A stripped/unsigned manifest has no fields to show; on
    // a pinned build its absence already fails every version
    // row and the summary headline.
    if (m.signature) {
      body.append(buildSignatureSection(
        m.signature, 'cryptoProof.manifestSignature', manifestProofState(),
      ))
    }
    // The events sidecar's document-level signature, when the
    // feed carries one. Absent on older / unsigned feeds, in
    // which case there is nothing to show.
    if (epcisDoc?.signature) {
      body.append(buildSignatureSection(
        epcisDoc.signature, 'cryptoProof.eventsSignature', eventsState,
      ))
    }
    body.append(
      buildVerificationDisclosure(m, states, activeVersion, activeState),
    )

    const dialog = buildModal({
      title: tr('cryptoProof.title'),
      titleId: 'proof-title',
      body,
      onClose: close,
    })
    this.replaceChildren(dialog)
    this.classList.add('open')
  }
}

function close(): void {
  proofModalOpen.set(false)
}

function tr(key: LabelKey): string {
  return t(i18n.labels, key)
}

// ─── Summary ─────────────────────────────────────────

function buildSummary(
  manifest: DppManifest, states: StatesMap,
  eventsState: SignatureProofState,
  hasEvents: boolean,
  activeVersion: number,
): HTMLElement {
  const counts = tally(manifest, states)
  const { verified, failed, pending, untouched } = counts

  // An events signature that fails the shared acceptance gate
  // counts against the headline so "all valid" can never sit
  // above a red events badge. Unpinned builds tolerate a
  // missing signature or an unreachable key host; a pinned
  // build fails closed on both (a CDN that strips the events
  // signature must not get a clean headline). A still-pending
  // check does not count, mirroring how the version tally
  // treats unchecked snapshots, and a feed with no events
  // document at all has no signature to judge.
  const eventsBad = hasEvents
    && eventsState !== 'pending'
    && !signatureIsAcceptable(eventsState)
  const allChecked = untouched === 0 && pending === 0
  const allOk = allChecked && failed === 0 && verified > 0 && !eventsBad

  const positive = failed === 0 && verified > 0 && !eventsBad
  const cls = `proof-summary${positive ? ' verified' : ''}`
    + `${failed > 0 || eventsBad ? ' failed' : ''}`
  const summary = el('section', cls)

  summary.appendChild(buildSummaryStatus(counts, allOk, eventsBad))
  summary.appendChild(buildSummaryMeta(manifest))

  // Download what the visitor is looking at: while
  // scrubbed to an older version the button offers that
  // version, not the manifest's current one.
  summary.appendChild(buildSummaryDownload(manifest, activeVersion))
  return summary
}

function buildSummaryStatus(
  counts: ReturnType<typeof tally>, allOk: boolean, eventsBad: boolean,
): HTMLSpanElement {
  const { verified, failed } = counts
  const wrap = el('span', 'proof-status')

  let text: string
  let orbColor: 'verified' | 'failed' | null = null
  let iconName: 'ok' | 'cancel' | null = null

  if (failed > 0 || eventsBad) {
    text = tr('cryptoProof.mismatch')
    orbColor = 'failed'
    iconName = 'cancel'
  } else if (allOk) {
    text = tr('cryptoProof.allValid')
    orbColor = 'verified'
    iconName = 'ok'
  } else {
    const key = verified === 1
      ? 'cryptoProof.snapshotsVerified'
      : 'cryptoProof.snapshotsVerifiedPlural'
    text = t(i18n.labels, key, { count: verified })
    if (verified > 0) {
      orbColor = 'verified'
      iconName = 'ok'
    }
  }

  if (orbColor && iconName) {
    const orb = el('span', `orb orb-${orbColor}`)
    orb.appendChild(icon(iconName))
    wrap.appendChild(orb)
  }
  wrap.appendChild(document.createTextNode(text))
  return wrap
}

function buildSummaryMeta(manifest: DppManifest): HTMLSpanElement {
  const meta = el('span', 'proof-meta')
  meta.textContent = t(i18n.labels, 'cryptoProof.versionOf', {
    current: manifest.currentVersion,
    total: manifest.versions.length,
  })
  return meta
}

// Download the active version's signed snapshot. The
// summary block places this immediately under the
// status/meta row so the headline action stays above
// the per-version table; the in-memory bytes are the
// same ones the renderer just verified.
function buildSummaryDownload(
  manifest: DppManifest, activeVersion: number,
): HTMLButtonElement {
  const btn = el('button', 'proof-download proof-download-current')
  btn.type = 'button'
  btn.appendChild(icon('download'))
  btn.append(
    document.createTextNode(' '),
    document.createTextNode(t(i18n.labels, 'cryptoProof.download', {
      version: activeVersion,
    })),
  )
  btn.addEventListener('click', () => {
    void triggerSnapshotDownload(manifest, activeVersion)
  })
  return btn
}

// Common download path used by both the summary button
// and the per-row icon button. Emits the raw signed bytes
// (not the adapted render model) so the downloaded file
// re-verifies. Reads the raw cache when warm; falls back
// to a fresh fetch for cold versions (the large-DPP case
// where auto-verify is off). Errors are swallowed by
// design: the affordance is best-effort and a failed
// download is recoverable via a retry click.
async function triggerSnapshotDownload(
  manifest: DppManifest, versionNumber: number,
): Promise<void> {
  let snapshot = host.rawSnapshots.peek()[versionNumber]
  if (!snapshot) {
    await host.fetchSnapshot(versionNumber)
    snapshot = host.rawSnapshots.peek()[versionNumber]
    if (!snapshot) return
  }
  const slug = slugForFilename(manifest.code)
  downloadJson(snapshot, `${slug}-snapshot-v${versionNumber}.json`)
}

// Compact icon-only download button used inside the
// per-version table row. Bordered text would crowd the
// row; the chevron-style download glyph reads as an
// action without competing with the version-name link.
function buildRowDownload(
  manifest: DppManifest, versionNumber: number,
): HTMLButtonElement {
  const btn = el('button', 'proof-download proof-download-row')
  btn.type = 'button'
  btn.setAttribute('aria-label', t(i18n.labels, 'cryptoProof.downloadRowAria', {
    version: versionNumber,
  }))
  btn.title = t(i18n.labels, 'cryptoProof.download', { version: versionNumber })
  btn.appendChild(icon('download'))
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    void triggerSnapshotDownload(manifest, versionNumber)
  })
  return btn
}

// ─── Manifest signature ──────────────────────────────

// One platform-signature block (the manifest version-list
// signature or the events sidecar signature), rendered as a
// field grid under a header that carries the live verdict
// badge. Both signatures share the single-signature scheme,
// so they share this builder.
function buildSignatureSection(
  sig: ManifestSignature,
  headerKey: LabelKey,
  proofState: SignatureProofState,
): HTMLElement {
  const section = el('section', 'proof-section')
  const dl = el('dl', 'proof-grid')

  const addRow = (key: LabelKey, value: Node | string): void => {
    const dt = el('dt', undefined, tr(key))
    const dd = el('dd')
    if (typeof value === 'string') dd.textContent = value
    else dd.appendChild(value)
    dl.append(dt, dd)
  }

  addRow('cryptoProof.type', sig.type)
  addRow('cryptoProof.cryptosuite', el('code', undefined, sig.cryptosuite))
  addRow('cryptoProof.created', sig.created)
  addRow(
    'cryptoProof.verificationMethod',
    el('code', undefined, sig.verificationMethod),
  )
  addRow('cryptoProof.proofValue', el('code', 'proof-value', sig.proofValue))

  const h3 = el('h3', undefined, tr(headerKey))
  h3.appendChild(buildSignatureBadge(proofState))
  section.append(h3, dl)
  return section
}

// Verification status for a platform signature, judged by
// the same acceptance gate that drives the verdict. A state
// the gate rejects (invalid; or absent / unreachable / a
// non-pinned key when this build pins one) gets the failed
// orb. An accepted 'verified' gets the green orb; the
// remaining tolerated-but-unproven states ('pending', and
// 'absent'/'unreachable' on unpinned builds) render a muted
// dash (no claim either way), matching buildChainBadge.
function buildSignatureBadge(state: SignatureProofState): HTMLElement {
  if (state === 'pending') return el('span', 'col-authority-na', '-')
  if (!signatureIsAcceptable(state)) return buildVerdictBadge(false)
  if (state !== 'absent' && state.status === 'verified') {
    return buildVerdictBadge(true)
  }
  return el('span', 'col-authority-na', '-')
}

// ─── Proof chain (active snapshot) ───────────────────

function buildChainSection(
  state: VersionState | undefined,
): HTMLElement {
  const section = el('section', 'proof-section')
  if (!state || state.status === 'pending') {
    section.appendChild(
      el('p', 'proof-note', tr('cryptoProof.chainPending')),
    )
    return section
  }

  const groups = groupByAuthority(state.result.entries)
  for (const group of groups) {
    section.appendChild(buildAuthorityRow(group))
  }
  return section
}

interface AuthorityGroup {
  readonly name: string
  readonly entries: ReadonlyArray<ProofEntryResult>
  readonly verifiedHere: boolean
}

function buildAuthorityRow(group: AuthorityGroup): HTMLElement {
  const row = el(
    'div',
    `proof-authority ${group.verifiedHere ? 'is-ok' : 'is-bad'}`,
  )
  row.append(
    buildVerdictBadge(group.verifiedHere),
    el('span', 'proof-authority-name', group.name),
    buildKeyChips(group.entries),
  )
  return row
}

function buildKeyChips(
  entries: ReadonlyArray<ProofEntryResult>,
): HTMLElement {
  const wrap = el('span', 'proof-key-chips')
  for (const entry of entries) {
    const a = el('a', `proof-key-chip status-${entry.status}`)
    const safe = safeLinkHref(entry.verificationMethod)
    if (safe) {
      a.href = safe
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
    }
    a.setAttribute('aria-label', methodLabel(entry.verificationMethod))
    a.title = entry.reason
      ? `${methodLabel(entry.verificationMethod)} · ${entry.reason}`
      : methodLabel(entry.verificationMethod)
    a.appendChild(icon('key'))
    wrap.appendChild(a)
  }
  return wrap
}

// Pull a short, human-readable label out of a
// verification-method URL for the link's title /
// aria-label. The seeded keys use the URL fragment to
// discriminate between resolution methods (`#did-web`,
// `#cdn`); unfragmented URLs are the canonical HTTPS
// endpoint.
function methodLabel(url: string): string {
  const hashIdx = url.indexOf('#')
  if (hashIdx >= 0) return url.slice(hashIdx + 1)
  return tr('cryptoProof.method.https')
}

function buildVerdictBadge(ok: boolean): HTMLElement {
  const orb = el('span', `orb orb-${ok ? 'verified' : 'failed'}`)
  orb.appendChild(icon(ok ? 'ok' : 'cancel'))
  return orb
}

function buildChainBadge(chain: { status: string }): HTMLElement {
  if (chain.status === 'ok') return buildVerdictBadge(true)
  if (chain.status === 'broken') return buildVerdictBadge(false)

  // 'not-applicable' (v1, the chain root) and 'unknown'
  // (manifest hadn't loaded when the check ran). Render
  // a muted dash so the column visually aligns.
  const span = el('span', 'col-authority-na', '-')
  return span
}

// Group entries by resolved key (an authority's aliases
// all resolve to the same key) and label the group from
// the verificationMethod URL of any entry in it. The
// seeder writes keys/issuer.json and keys/platform.json
// paths, which is what we pattern-match on; entries that
// don't match either pattern fall through to a generic
// label. Entries that didn't resolve fall back to their
// own verificationMethod as the group key.
function groupByAuthority(
  entries: ReadonlyArray<ProofEntryResult>,
): AuthorityGroup[] {
  const byKey = new Map<string, ProofEntryResult[]>()
  for (const e of entries) {
    const key = e.keyMultibase ?? e.verificationMethod
    const bucket = byKey.get(key) ?? []
    bucket.push(e)
    byKey.set(key, bucket)
  }
  const groups: AuthorityGroup[] = []
  for (const bucket of byKey.values()) {
    const kind = kindForGroup(bucket)
    const name = kind === 'issuer'
      ? activeIssuer().name
      : kind === 'platform'
        ? activePlatform().name
        : ''
    const verifiedHere = bucket.some((e) => e.status === 'verified')
    groups.push({ name, entries: bucket, verifiedHere })
  }

  // Issuer first, platform second, anything we can't
  // classify last, so the ordering carries the role
  // information visually.
  groups.sort((a, b) => orderForName(a.name) - orderForName(b.name))
  return groups
}

function kindForGroup(
  bucket: ReadonlyArray<ProofEntryResult>,
): 'issuer' | 'platform' | 'other' {
  for (const e of bucket) {
    if (/\/keys\/issuer\b/.test(e.verificationMethod)) return 'issuer'
    if (/\/keys\/platform\b/.test(e.verificationMethod)) return 'platform'
  }
  return 'other'
}

function orderForName(name: string): number {
  if (name === activeIssuer().name) return 0
  if (name === activePlatform().name) return 1
  return 2
}

// ─── Unified verification details ────────────────────
// One disclosure covers every verification artefact:
// per-authority chain rows for the active version,
// per-version aggregate table, and the manifest
// signature block. The visible subtitle on the summary
// row carries the one-line "Version vN verified against
// K keys in your browser." statement, so consumers know
// the headline result without expanding.
function buildVerificationDisclosure(
  manifest: DppManifest,
  states: StatesMap,
  activeVersion: number,
  activeState: VersionState | undefined,
): HTMLElement {
  const section = el('section', 'proof-section')
  const details = el('details', 'proof-disclosure')
  const summary = el('summary', 'proof-disclosure-summary')
  summary.append(
    el('span', 'proof-disclosure-label', tr('cryptoProof.versionsCheck')),
    el('span', 'chevron'),
  )
  details.appendChild(summary)

  details.appendChild(buildDisclosureSubtitle(activeVersion, activeState))
  details.appendChild(buildChainSection(activeState))
  if (manifest.versions.length > AUTO_VERIFY_LIMIT) {
    details.appendChild(buildVerifyAllButton(manifest, states))
  }
  details.appendChild(buildVersionsList(manifest, states))
  section.appendChild(details)
  return section
}

function buildDisclosureSubtitle(
  version: number, state: VersionState | undefined,
): HTMLElement {
  const p = el('p', 'proof-disclosure-subtitle')
  if (!state || state.status === 'pending') {
    p.textContent = tr('cryptoProof.chainPending')
  } else {
    p.textContent = t(i18n.labels, 'cryptoProof.versionsCheck.summary',
      { version, count: state.result.entries.length })
  }
  return p
}

function buildVerifyAllButton(
  manifest: DppManifest, states: StatesMap,
): HTMLButtonElement {
  const btn = el('button', 'proof-verify-all')
  btn.type = 'button'
  btn.textContent = t(i18n.labels, 'cryptoProof.verifyAll',
    { count: manifest.versions.length })

  // Disabled only while a check is in flight or when every
  // version verified. With failures present the button
  // stays live and acts as a retry: a failed verdict may
  // be transient (key host briefly unreachable), so the
  // click drops failed entries and re-runs them rather
  // than silently no-opping on the cached state.
  const anyPending = manifest.versions.some(
    (v) => states[v.number]?.status === 'pending',
  )
  const allVerified = manifest.versions.every(
    (v) => states[v.number]?.status === 'verified',
  )
  if (anyPending || allVerified) btn.disabled = true
  btn.addEventListener('click', () => {
    versionStates.update((m) => {
      let changed = false
      const next: StatesMap = { ...m }
      for (const [k, s] of Object.entries(next)) {
        if (s.status !== 'failed') continue
        delete next[Number(k)]
        changed = true
      }
      return changed ? next : m
    })
    for (const v of manifest.versions) ensureVersionLoaded(v.number)
  })
  return btn
}

function buildVersionsList(
  manifest: DppManifest, states: StatesMap,
): HTMLElement {
  const wrap = el('div', 'proof-versions-wrap')
  wrap.appendChild(
    el('h4', 'proof-versions-caption',
      tr('cryptoProof.versionsTable.caption')),
  )

  const table = el('table', 'proof-versions-list')
  const thead = el('thead')
  const headRow = el('tr')
  headRow.append(
    el('th'),
    el('th', 'col-authority', activeIssuer().name),
    el('th', 'col-authority', activePlatform().name),
    el('th', 'col-authority', tr('cryptoProof.chain.header')),
  )
  thead.appendChild(headRow)

  // Newest-first ordering: the active version sits at
  // the top of the table, with the older snapshots
  // beneath it, matching the timeline's right-to-left
  // reading flow.
  const ordered = [...manifest.versions]
    .sort((a, b) => b.number - a.number)

  const tbody = el('tbody')
  for (const v of ordered) {
    tbody.appendChild(buildVersionRow(v.number, states[v.number], manifest))
  }
  table.append(thead, tbody)
  wrap.appendChild(table)
  wrap.appendChild(
    el('p', 'proof-versions-note', tr('cryptoProof.chain.note')),
  )
  return wrap
}

function buildVersionRow(
  versionNumber: number, s: VersionState | undefined,
  manifest: DppManifest,
): HTMLTableRowElement {
  const row = el('tr')
  if (s?.status === 'verified') row.classList.add('row-ok')
  if (s?.status === 'failed') row.classList.add('row-bad')

  const versionTd = el('td')
  const label = t(i18n.labels, 'cryptoProof.versionRow',
    { version: versionNumber })

  // The row label navigates to the version's timeline
  // event. When no event carries the version (older or
  // partial feeds) there is nowhere to go, so render
  // plain text instead of a button that would silently
  // no-op.
  if (events().some((e) => e.versionNumber === versionNumber)) {
    const versionBtn = el('button', 'proof-version-link')
    versionBtn.type = 'button'
    versionBtn.textContent = label
    versionBtn.addEventListener(
      'click', () => navigateToVersion(versionNumber),
    )
    versionTd.appendChild(versionBtn)
  } else {
    versionTd.appendChild(
      el('span', 'proof-version-link is-static', label),
    )
  }
  versionTd.appendChild(buildRowDownload(manifest, versionNumber))

  const issuerTd = el('td', 'col-authority')
  const platformTd = el('td', 'col-authority')
  const chainTd = el('td', 'col-authority')
  if (s && (s.status === 'verified' || s.status === 'failed')) {
    const groups = groupByAuthority(s.result.entries)
    for (const g of groups) {
      const td = matchesAuthority(g, 'issuer') ? issuerTd
        : matchesAuthority(g, 'platform') ? platformTd : null
      if (td) td.appendChild(buildVerdictBadge(g.verifiedHere))
    }
    chainTd.appendChild(buildChainBadge(s.chain))
    if (s.status === 'failed' && s.chain.status === 'broken') {
      chainTd.title = s.chain.reason ?? ''
    }
  } else if (s?.status === 'pending') {
    issuerTd.textContent = '…'
    platformTd.textContent = '…'
    chainTd.textContent = '…'
  } else {
    issuerTd.textContent = '-'
    platformTd.textContent = '-'
    chainTd.textContent = '-'
  }

  row.append(versionTd, issuerTd, platformTd, chainTd)
  return row
}

function matchesAuthority(
  group: AuthorityGroup, kind: 'issuer' | 'platform',
): boolean {
  return group.entries.some(
    (e) => new RegExp(`/keys/${kind}\\b`).test(e.verificationMethod),
  )
}

// ─── Helpers ─────────────────────────────────────────

function navigateToVersion(versionNumber: number): void {
  const ev = events().find((e) => e.versionNumber === versionNumber)
  if (!ev) return
  close()
  if (timelineState() === 'hidden') timelineState.set('expanded')
  focusedEventId.set(ev.id)
}

function tally(
  manifest: DppManifest, states: StatesMap,
): { verified: number; failed: number; pending: number; untouched: number } {
  let verified = 0, failed = 0, pending = 0, untouched = 0
  for (const v of manifest.versions) {
    const s = states[v.number]
    if (!s) untouched++
    else if (s.status === 'verified') verified++
    else if (s.status === 'failed') failed++
    else pending++
  }
  return { verified, failed, pending, untouched }
}

// Re-export for tests / debugging interactions; not
// part of the consumer-facing surface.
export type { VerificationResult }

customElements.define('dpp-verification-modal', DppVerificationModal)
