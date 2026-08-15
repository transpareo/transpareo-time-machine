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
 *   4. Active snapshot's proof chain: the proof entries
 *      the renderer just verified, labelled with their
 *      cryptosuite and grouped by authority. Both suites
 *      group into an issuer row and a platform row: an
 *      eddsa-jcs proof set folds each authority's key
 *      aliases into one row, an ecdsa-sd credential carries
 *      one derived proof per authority. Each row shows the
 *      verificationMethod URL and a status badge (verified /
 *      unreachable / invalid / pending). Wrapped in a
 *      "Versions check" disclosure with the per-version
 *      aggregate verdicts so the visitor can browse the
 *      chain.
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
import {
  ensureVersionLoaded, retryFailedVersions, signatureIsAcceptable,
} from '@/actions'
import {
  attributeAuthorities, type AuthorityKind,
} from '@/verifier-verdict'
import { icon } from '@/icons'
import { i18n } from '@/i18n'
import { t, type LabelKey } from '@/i18n/labels'
import type {
  ChainStatusResult, DppManifest, ManifestSignature, VersionState,
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
    // feed carries one. Namespaced `transpareo:signature` on
    // current feeds; bare `signature` on older ones. Absent on
    // unsigned feeds, in which case there is nothing to show.
    const eventsSig = epcisDoc?.['transpareo:signature'] ?? epcisDoc?.signature
    if (eventsSig) {
      body.append(buildSignatureSection(
        eventsSig, 'cryptoProof.eventsSignature', eventsState,
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
// orb, an accepted 'verified' the green one. The tolerated-
// but-unproven states split: an unsigned artefact has no
// signature to judge (not applicable), a still-pending check
// and an unreachable key host have simply not produced an
// answer yet (unrun).
function buildSignatureBadge(state: SignatureProofState): HTMLElement {
  return buildCell(signatureCellState(state))
}

function signatureCellState(state: SignatureProofState): CellState {
  if (state === 'pending') return 'unrun'
  if (!signatureIsAcceptable(state)) return 'failed'
  if (state === 'absent') return 'not-applicable'
  return state.status === 'verified' ? 'ok' : 'unrun'
}

// ─── Proof chain (active snapshot) ───────────────────

// Exported for tests: the per-authority chain rows that
// label the issuer generically and the platform by name.
export function buildChainSection(
  state: VersionState | undefined,
): HTMLElement {
  const section = el('section', 'proof-section')
  if (!state || state.status === 'pending') {
    section.appendChild(
      el('p', 'proof-note', tr('cryptoProof.chainPending')),
    )
    return section
  }

  const suite = state.result.cryptosuite
  if (suite) section.appendChild(buildChainSuite(suite))

  const groups = groupByAuthority(state.result.entries)
  for (const group of groups) {
    section.appendChild(buildAuthorityRow(group))
  }

  return section
}

// The Data Integrity cryptosuite the active snapshot was
// verified under, shown so a reviewer can see which
// algorithm the key chips below were checked with (the
// platform's own manifest signature carries its suite in
// its own section).
function buildChainSuite(suite: string): HTMLElement {
  const row = el('p', 'proof-chain-suite')
  row.append(
    el('span', 'proof-chain-suite-label', tr('cryptoProof.cryptosuite')),
    el('code', undefined, suite),
  )
  return row
}

interface AuthorityGroup {
  readonly kind: AuthorityKind
  readonly name: string
  readonly entries: ReadonlyArray<ProofEntryResult>
  readonly verifiedHere: boolean
}

function buildAuthorityRow(group: AuthorityGroup): HTMLElement {
  const row = el(
    'div',
    `proof-authority ${group.verifiedHere ? 'is-ok' : 'is-bad'}`,
  )

  // The issuer row carries the generic "Issuer" label, not
  // the economic operator's own name: that name can run long
  // and is spelled out once in the subtitle above. The
  // platform keeps its short brand name, matching the
  // per-version table's column headers.
  const label = group.kind === 'issuer'
    ? tr('verifier.meta.issuer')
    : group.name
  row.append(
    buildVerdictBadge(group.verifiedHere),
    el('span', 'proof-authority-name', label),
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

// What one check says. A check that ran always gets an orb,
// so a failure reads as a red X and never as a neutral
// placeholder. The two neutral states are kept apart: 'unrun'
// is a check that has not produced an answer yet (the version
// was never verified, a chain walk that could not complete),
// 'not-applicable' is a check that cannot exist for the row
// (v1 has no prior version to chain to, a snapshot that
// carries no proof from one of the authorities).
type CellState = 'ok' | 'failed' | 'unrun' | 'not-applicable'

function buildCell(state: CellState): HTMLElement {
  if (state === 'ok') return buildVerdictBadge(true)
  if (state === 'failed') return buildVerdictBadge(false)
  if (state === 'unrun') return el('span', 'col-authority-unrun', '…')
  return el('span', 'col-authority-na', '-')
}

function chainCellState(chain: ChainStatusResult): CellState {
  if (chain.status === 'ok') return 'ok'
  if (chain.status === 'broken') return 'failed'
  if (chain.status === 'not-applicable') return 'not-applicable'

  // 'unknown': the manifest had not loaded, or a prior
  // snapshot was not retrievable, so the walk never ran to a
  // conclusion.
  return 'unrun'
}

// Group entries by resolved key (an authority's aliases
// all resolve to the same key), then attribute each group
// with the shared authorityKind rule: a key-path URL, as an
// eddsa-jcs proof set writes it, or the did:web method an
// ecdsa-sd credential names per authority. A group that
// matches neither carries the generic authority label.
// Entries that didn't resolve fall back to their own
// verificationMethod as the group key.
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

  // Attribution runs against the DIDs the active snapshot
  // declares, and over every group at once so its structural
  // rule can name the party opposite an identified one.
  const buckets = [...byKey.values()]
  const kinds = attributeAuthorities(buckets, {
    issuerDid: activeIssuer().did,
    platformDid: activePlatform().did,
  })
  const groups: AuthorityGroup[] = buckets.map((bucket, i) => {
    const kind = kinds[i]
    const name = kind === 'issuer'
      ? activeIssuer().name
      : kind === 'platform'
        ? activePlatform().name
        : tr('verifier.authority')
    return {
      kind, name, entries: bucket,
      verifiedHere: bucket.some((e) => e.status === 'verified'),
    }
  })

  // Issuer first, platform second, anything we can't
  // classify last, so the ordering carries the role
  // information visually.
  groups.sort((a, b) => orderForKind(a.kind) - orderForKind(b.kind))
  return groups
}

function orderForKind(kind: AuthorityKind): number {
  if (kind === 'issuer') return 0
  if (kind === 'platform') return 1
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

// Exported for tests: the choice between the pending
// notice, the generic count sentence, and the naming
// two-authorities wording is behaviour worth pinning
// without mounting the whole element.
export function buildDisclosureSubtitle(
  version: number, state: VersionState | undefined,
): HTMLElement {
  const p = el('p', 'proof-disclosure-subtitle')
  if (!state || state.status === 'pending') {
    p.textContent = tr('cryptoProof.chainPending')
    return p
  }

  const groups = groupByAuthority(state.result.entries)
  const issuerGroup = groups.find((g) => g.kind === 'issuer')
  const platformGroup = groups.find((g) => g.kind === 'platform')

  // When the proofs split cleanly into exactly the issuer and
  // the platform, break the key count down per authority and
  // name the issuer (its legal name can run long). Each group's
  // count folds its aliases: an eddsa proof set lists several
  // verification methods per authority, one key chip each.
  // Anything else (unknown authorities, a lone proof) keeps the
  // plain total.
  if (groups.length === 2 && issuerGroup && platformGroup) {
    const issuerCount = issuerGroup.entries.length
    const platformCount = platformGroup.entries.length
    p.textContent = t(
      i18n.labels, 'cryptoProof.versionsCheck.summary.twoAuthorities',
      {
        version,
        count: issuerCount + platformCount,
        issuerCount,
        issuer: activeIssuer().name,
        platformCount,
        platform: activePlatform().name,
      },
    )
    return p
  }

  const count = state.result.entries.length
  const key: LabelKey = count === 1
    ? 'cryptoProof.versionsCheck.summary.one'
    : 'cryptoProof.versionsCheck.summary'
  p.textContent = t(i18n.labels, key, { version, count })
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
  btn.addEventListener('click', () => retryFailedVersions())
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
    // Generic "Issuer" rather than the economic operator's
    // own name: that name can run much longer than a fixed
    // narrow table column comfortably holds (see the full
    // name spelled out in the subtitle above instead).
    el('th', 'col-authority', tr('verifier.meta.issuer')),
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

  // The nowrap authority columns can outgrow a narrow
  // viewport once an issuer's legal name is long (e.g.
  // "Volturra Energia"). Scope the scroll to the table
  // itself rather than letting it widen the whole modal
  // body, which would carry every other section along.
  const scroll = el('div', 'proof-versions-scroll')
  scroll.appendChild(table)
  wrap.appendChild(scroll)

  wrap.appendChild(
    el('p', 'proof-versions-note', tr('cryptoProof.chain.note')),
  )
  return wrap
}

// Exported for tests: which of the four cell states each of
// the three check columns lands in is how a visitor reads a
// version's verdict, and it has to hold across both
// cryptosuites.
export function buildVersionRow(
  versionNumber: number, s: VersionState | undefined,
  manifest: DppManifest,
): HTMLTableRowElement {
  const row = el('tr')
  if (s?.status === 'verified') row.classList.add('row-ok')
  if (s?.status === 'failed') row.classList.add('row-bad')

  const issuerTd = el('td', 'col-authority')
  const platformTd = el('td', 'col-authority')
  const chainTd = el('td', 'col-authority')
  if (s && (s.status === 'verified' || s.status === 'failed')) {
    const groups = groupByAuthority(s.result.entries)
    const blind = s.status === 'failed'
      && !groups.some((g) => g.kind !== 'other')
    issuerTd.appendChild(
      buildCell(authorityCellState(groups, 'issuer', blind)),
    )
    platformTd.appendChild(
      buildCell(authorityCellState(groups, 'platform', blind)),
    )
    chainTd.appendChild(buildCell(chainCellState(s.chain)))
    if (s.chain.status === 'broken') chainTd.title = s.chain.reason ?? ''
  } else {
    // Nothing has been checked for this version yet: either
    // its verify is still in flight, or it was never started
    // (the visitor has not scrubbed to it and the DPP is too
    // large to auto-verify). Neither is a verdict.
    for (const td of [issuerTd, platformTd, chainTd]) {
      td.appendChild(buildCell('unrun'))
    }
  }

  row.append(
    buildVersionCell(versionNumber, manifest),
    issuerTd, platformTd, chainTd,
  )
  return row
}

// An authority column's verdict. A snapshot that carries a
// proof from the other authority only has nothing to badge
// here, which is a property of the row rather than a failure,
// so it reads as not applicable.
//
// `blind` says the row failed and nothing in it could be
// attributed to either party: a verify that threw, a
// snapshot carrying no proof, a cryptosuite this build
// cannot read, or proofs under keys nothing identifies.
// Both columns then take the red X, since a dash would read
// as "nothing to check here" on a row that did fail.
function authorityCellState(
  groups: ReadonlyArray<AuthorityGroup>,
  kind: 'issuer' | 'platform',
  blind: boolean,
): CellState {
  const group = groups.find((g) => g.kind === kind)
  if (!group) return blind ? 'failed' : 'not-applicable'
  return group.verifiedHere ? 'ok' : 'failed'
}

// The row's leading cell: the version label plus its
// download button. The label navigates to the version's
// timeline event; when no event carries the version (older
// or partial feeds) there is nowhere to go, so it renders as
// plain text instead of a button that would silently no-op.
function buildVersionCell(
  versionNumber: number, manifest: DppManifest,
): HTMLTableCellElement {
  const versionTd = el('td')
  const label = t(i18n.labels, 'cryptoProof.versionRow',
    { version: versionNumber })

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
  return versionTd
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
