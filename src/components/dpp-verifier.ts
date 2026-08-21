/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-verifier>, standalone verification widget for a
 * marketing / verification surface. Renders a form whose
 * input takes a passport page link (what QR codes and
 * shared links carry) or a signed artefact URL; an HTML
 * answer is resolved to the artefact the page references
 * (see manifest-discovery.ts). The artefact is classified
 * by the shared detector (artefact-detect.ts, the same
 * rule the SPA host layer boots by). A manifest runs the
 * same gates as the SPA chip in the browser: the snapshot
 * proof under whichever cryptosuite it declares (strict),
 * the manifest's own platform signature, and the
 * priorVersionHash chain walk down to v1. A lone signed
 * snapshot (a DPP published without a manifest, matching
 * the SPA's single-snapshot mode) is judged on its own
 * proof set alone. A page exposing nothing signed renders
 * a neutral nothing-to-verify notice rather than a
 * failure. Shows the proof chain plus the aggregate
 * verdict.
 *
 * Attributes:
 *
 *   src                    Optional. Pre-fills the input
 *                          and verifies on connect; takes
 *                          a passport page or manifest
 *                          URL, like the input.
 *
 *   pinned-platform-key    Optional, one or more
 *                          multibase public keys
 *                          (z-prefixed), whitespace-
 *                          separated: Ed25519 for
 *                          eddsa-jcs-2022 snapshots, P-256
 *                          for ecdsa-sd-2023 ones, and a
 *                          publisher's history can span
 *                          both. Rotation keeps
 *                          retired-but-sound keys in the
 *                          set. Entries are grouped by
 *                          resolved key and attributed to
 *                          the issuer or the platform from
 *                          the key's own method either way;
 *                          a matching pin names that group
 *                          this platform's outright and
 *                          elevates the identity tier. A
 *                          foreign passport matches no pin
 *                          and still shows both of its
 *                          authorities. Without pins every
 *                          fetched key is equally trusted
 *                          (the default 2-of-2 rule).
 *
 *   locale                 Optional. `de` renders the widget
 *                          in German (region stripped, and
 *                          only locales with a shipped label
 *                          bundle apply); `inherit` follows
 *                          whatever language surrounds the
 *                          element; `auto`, or no attribute
 *                          at all, detects from the visitor's
 *                          browser. Outranks `lang`, which is
 *                          still read where no `locale` is
 *                          given.
 *
 * Independent of the SPA's state.ts / host.ts / actions
 * stack: has its own fetch + state machinery so the
 * widget bundles cleanly into its own dpp-verifier.js
 * lib output.
 */

import { BaseElement } from '@/reactive/element'
import { el } from '@/reactive/dom'
import { signal } from '@/reactive/signals'
import { icon, installFunctionalIcons } from '@/icons'
import {
  verifyManifestSignature,
  type VerificationResult,
  type ProofEntryResult,
} from '@/crypto/verify'
import { verifySnapshotAnySuite } from '@/crypto/dispatch'
import {
  attributeAuthorities,
  combinedVerdict,
  verdictIdentity,
  type AggregateVerdict,
  type ArtefactSignatureState,
  type AuthorityKind,
  type VerdictIdentity,
} from '@/verifier-verdict'
import {
  verifyChainFromHead, type ChainCheckResult,
} from '@/verifier-chain'
import { readTextResponse } from '@/fetch-json'
import { detectArtefact, snapshotBody } from '@/artefact-detect'
import { looksLikeHtml, discoverManifestUrl } from '@/manifest-discovery'
import { parseKeySet } from '@/config'
import {
  i18n, locale, hostLocaleOf, setHostLocale, detectLocale, UI_LOCALES,
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

  // The URL led to something real but unsigned (a page
  // with no signed reference, or JSON that is no DPP
  // artefact): nothing to verify, which is a statement
  // about the DPP, not a failed verification.
  | { status: 'unverifiable'; url: string; message: string }
  | {
      status: 'ready'
      url: string
      artefactUrl: string
      manifest: DppManifest | null
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
    // Pin the widget's locale from the host page's markup (see
    // hostLocaleOf). The verifier has no DPP available-locales
    // to auto-detect from, so without a pin it falls back to
    // the browser preference, then English (UI_LOCALES is
    // en-first).
    setHostLocale(hostLocaleOf(this))
    locale.set(detectLocale(UI_LOCALES))

    this.addStyle(css)

    // The verdict orbs render `<use href="#icon-ok">`, which
    // resolves only inside the root the sprite lives in, so
    // this root needs its own copy. Mounted inside the SPA
    // it is a nested shadow root, so the host's install does
    // not reach it either.
    installFunctionalIcons(root)

    const wrap = el('div', 'verifier')
    wrap.appendChild(this.buildForm())
    this.resultMount = el('div', 'verifier-result')
    wrap.appendChild(this.resultMount)
    root.appendChild(wrap)

    // Declare the language settled on above, the same way
    // the passport renderer does: inside the widget's own
    // tree, never on the element hostLocaleOf reads back or
    // on a document the embedding page owns.
    this.effect(() => {
      wrap.lang = i18n.locale
    })

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
      const { kind, artefact, artefactUrl } = await loadArtefact(
        new URL(url, window.location.href).toString(),
      )
      const verified = kind === 'manifest'
        ? await verifyFromManifest(artefact as DppManifest, artefactUrl, pins)
        : await verifyLoneSnapshot(artefact as SignedSnapshot, pins)
      if (seq !== this.runSeq) return
      this.state.set({ status: 'ready', url, artefactUrl, ...verified })
    } catch (err) {
      if (seq !== this.runSeq) return
      const message = err instanceof Error ? err.message : String(err)
      if (err instanceof UnverifiableError) {
        this.state.set({ status: 'unverifiable', url, message })
      } else {
        this.state.set({ status: 'error', url, message })
      }
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
    if (s.status === 'unverifiable') {
      const wrap = el('div', 'verifier-unverifiable')
      const orb = el('span', 'orb')
      orb.appendChild(icon('help'))
      wrap.append(orb, el('span', undefined, s.message))
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
//
// Every artefact is revalidated: this widget exists to say
// what the origin serves right now, and a publisher may
// republish an artefact under the URL it already used. A
// verdict read off a copy the browser kept would describe an
// earlier publish while naming the current URL.
async function fetchText(
  url: string,
): Promise<{ body: string; url: string }> {
  const res = await fetch(url, {
    credentials: 'omit',
    cache: 'no-cache',
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

// Routes to the neutral nothing-to-verify state instead
// of the red failure card.
class UnverifiableError extends Error {}

interface LoadedArtefact {
  readonly kind: 'manifest' | 'snapshot'
  readonly artefact: DppManifest | SignedSnapshot
  readonly artefactUrl: string
}

// The pasted URL is either a signed artefact itself (a
// manifest or a lone snapshot) or the passport page a QR
// code / shared link points at. Fetch it once and sniff
// the body: JSON is classified by shape, HTML as the
// page, whose declared reference is followed and
// classified the same way (a foreign page may embed the
// renderer in single-snapshot mode, so the reference is
// not assumed to be a manifest either).
async function loadArtefact(url: string): Promise<LoadedArtefact> {
  const { body, url: finalUrl } = await fetchText(url)
  if (!looksLikeHtml(body)) {
    return classify(JSON.parse(body), finalUrl)
  }
  const refUrl = discoverManifestUrl(body, finalUrl)
  if (!refUrl) {
    throw new UnverifiableError(tr('verifier.noSignedData'))
  }
  return classify(await fetchJson(refUrl), refUrl)
}

// Shape gate on the shared detector, so JSON that is no
// DPP artefact lands in the nothing-to-verify state
// instead of a TypeError deeper in the run.
function classify(data: unknown, artefactUrl: string): LoadedArtefact {
  const kind = detectArtefact(data)
  if (kind === 'unknown') {
    throw new UnverifiableError(tr('verifier.notSignedArtefact'))
  }
  return {
    kind, artefact: data as DppManifest | SignedSnapshot, artefactUrl,
  }
}

// ─── Verification paths ───────────────────────────

interface VerifiedArtefact {
  readonly manifest: DppManifest | null
  readonly snapshot: SignedSnapshot
  readonly result: VerificationResult
  readonly manifestSignature: ArtefactSignatureState
  readonly chain: ChainCheckResult
}

async function verifyFromManifest(
  manifest: DppManifest, manifestUrl: string,
  pins: ReadonlyArray<string> | undefined,
): Promise<VerifiedArtefact> {
  const currentEntry = manifest.versions.find(
    (v) => v.number === manifest.currentVersion,
  )
  if (!currentEntry?.url) {
    throw new Error(tr('verifier.missingVersionUrl'))
  }
  const snapUrl = new URL(currentEntry.url, manifestUrl).toString()
  const snapshot = await fetchJson<SignedSnapshot>(snapUrl)

  // Whichever cryptosuite the snapshot's proof declares:
  // the widget verifies foreign DPPs, so it cannot assume
  // the suite this platform happens to publish. Its pins
  // travel as arguments rather than through the SPA's
  // element config, which is unpopulated here.
  const result = await verifySnapshotAnySuite(
    snapshot as unknown as Record<string, unknown>,
    { mode: 'strict', pinnedPlatformKeys: pins },
  )
  requireVerifiableProof(result)

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
  return { manifest, snapshot, result, manifestSignature, chain }
}

// A lone snapshot has no manifest to gate and no version
// list to walk: the verdict rests on the document's own
// proof set, matching the SPA's single-snapshot mode. The
// null manifest signature marks "no artefact to gate", so
// combinedVerdict passes it, and the identity tier still
// resolves from pins and the snapshot's own DIDs.
async function verifyLoneSnapshot(
  snapshot: SignedSnapshot,
  pins: ReadonlyArray<string> | undefined,
): Promise<VerifiedArtefact> {
  const result = await verifySnapshotAnySuite(
    snapshot as unknown as Record<string, unknown>,
    { mode: 'strict', pinnedPlatformKeys: pins },
  )
  requireVerifiableProof(result)
  return {
    manifest: null, snapshot, result,
    manifestSignature: null, chain: { status: 'not-applicable' },
  }
}

// A result with nothing judged either way must not render
// as a red unauthenticated card ("Only 0 of 0 entries
// verified") - that would defame a possibly sound DPP.
// Two ways to get one: the proof names a suite this build
// does not ship, or a manifest's snapshot carries no
// proof at all (a pasted snapshot always has one, the
// detector requires it). Both route to the neutral
// notice, so the verdict card only ever renders judged
// entries.
function requireVerifiableProof(result: VerificationResult): void {
  if (result.unsupportedSuite) {
    throw new UnverifiableError(
      tr('verifier.unsupportedSuite', { suite: result.unsupportedSuite }),
    )
  }
  if (result.totalEntryCount === 0) {
    throw new UnverifiableError(tr('verifier.noProof'))
  }
}

// ─── Result card ─────────────────────────────────

interface ReadyState {
  readonly url: string
  readonly artefactUrl: string
  readonly manifest: DppManifest | null
  readonly snapshot: SignedSnapshot
  readonly result: VerificationResult
  readonly manifestSignature: ArtefactSignatureState
  readonly chain: ChainCheckResult
}

// What the card prints, resolved once from whichever
// artefact carries it: the manifest when there is one,
// else the (unwrapped) snapshot body. A foreign lone
// snapshot may omit any of these, so all but the version
// label are optional and their rows drop out.
interface CardFacts {
  readonly issuerName?: string
  readonly issuerDid?: string
  readonly platformName?: string
  readonly platformDid?: string
  readonly code?: string
  readonly publishedAt?: string
  readonly versionLabel: string
}

function cardFacts(s: ReadyState): CardFacts {
  const body = snapshotBody(s.snapshot as unknown as Record<string, unknown>)
  const publishedAt = str(body.publishedAt)
  if (s.manifest) {
    return {
      issuerName: s.manifest.issuer.name,
      issuerDid: s.manifest.issuer.did,
      platformName: s.manifest.platform.name,
      platformDid: s.manifest.platform.did,
      code: s.manifest.code,
      publishedAt,
      versionLabel:
        `v${s.manifest.currentVersion} / ${s.manifest.versions.length}`,
    }
  }
  const issuer = orgOf(body.issuer)
  const platform = orgOf(body.platform)
  const ids = body.identifiers as Record<string, unknown> | undefined
  return {
    issuerName: issuer.name,
    issuerDid: issuer.did,
    platformName: platform.name,
    platformDid: platform.did,
    code: str(body.passportAlias) ?? str(ids?.code) ?? str(body.code),
    publishedAt,
    versionLabel:
      typeof body.version === 'number' ? `v${body.version}` : '',
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function orgOf(v: unknown): { name?: string; did?: string } {
  if (v === null || typeof v !== 'object') return {}
  const o = v as Record<string, unknown>
  return { name: str(o.name), did: str(o.did) }
}

function buildResultCard(
  s: ReadyState, pins: ReadonlyArray<string> | undefined,
): HTMLElement {
  const facts = cardFacts(s)
  const verdict = combinedVerdict(s.result, s.manifestSignature, s.chain)
  const identity = verdictIdentity(
    s.result, pins, s.manifestSignature,
    facts.platformDid, s.artefactUrl,
  )
  const wrap = el('section',
    `verifier-card verdict-${verdict.outcome} identity-${identity}`)

  wrap.appendChild(buildBanner(verdict, identity, facts))
  if (!s.manifest) {
    wrap.appendChild(el('p', 'verifier-note', tr('verifier.singleSnapshot')))
  }
  wrap.appendChild(buildMeta(facts))
  wrap.appendChild(buildChain(s, facts))
  return wrap
}

function buildBanner(
  verdict: AggregateVerdict, identity: VerdictIdentity, facts: CardFacts,
): HTMLElement {
  const banner = el('div', 'verifier-banner')
  banner.appendChild(buildOrb(verdict.outcome === 'authentic'))
  banner.appendChild(el(
    'strong', 'verifier-verdict', bannerText(verdict, identity, facts),
  ))
  banner.appendChild(el('span', 'verifier-version', facts.versionLabel))
  return banner
}

// An authentic verdict carries the platform's name only
// when the identity tier earned it: 'pinned' (key matched
// the caller's pin) or 'bound' (keys resolve from the
// domain platform.did declares). 'unconfirmed' renders the
// neutral signatures-valid wording, since the name in the
// artefact is then just a claim; so does an artefact that
// declares no platform name at all (a foreign lone
// snapshot may carry none).
function bannerText(
  verdict: AggregateVerdict, identity: VerdictIdentity, facts: CardFacts,
): string {
  if (verdict.outcome !== 'authentic') return verdictText(verdict)
  if (identity === 'unconfirmed' || !facts.platformName) {
    return tr('verifier.verdict.consistentOnly')
  }
  return tr('verifiedByPlatform', { name: facts.platformName })
}

function buildMeta(facts: CardFacts): HTMLElement {
  const meta = el('dl', 'verifier-meta')
  addRow(meta, tr('verifier.meta.issuer'), facts.issuerName)
  addRow(meta, tr('verifier.meta.platform'), facts.platformName)
  addRow(meta, tr('verifier.meta.dppCode'), facts.code)
  addRow(meta, tr('verifier.meta.published'), facts.publishedAt)
  return meta
}

function addRow(
  dl: HTMLElement, key: string, value: string | undefined,
): void {
  if (!value) return
  dl.append(
    el('dt', undefined, key),
    el('dd', undefined, value),
  )
}

// ─── Proof chain (entries grouped by authority) ────

function buildChain(s: ReadyState, facts: CardFacts): HTMLElement {
  const groups = groupEntries(s.result.entries, facts)
  const wrap = el('div', 'verifier-chain')
  wrap.appendChild(el('h3', 'verifier-section-title', tr('verifier.proofChain')))
  for (const g of groups) {
    wrap.appendChild(buildGroup(g, facts))
  }
  return wrap
}

interface AuthorityGroup {
  readonly label: AuthorityKind
  readonly entries: ReadonlyArray<ProofEntryResult>
}

// Group by resolved key (an authority's aliases all resolve
// to one key; entries that didn't resolve fall back to their
// own verificationMethod), then attribute the groups with the
// shared rule, which reads a matching pin, an eddsa-jcs key
// path, or an ecdsa-sd credential's did:web method against
// the DIDs the artefact declares.
function groupEntries(
  entries: ReadonlyArray<ProofEntryResult>,
  facts: CardFacts,
): AuthorityGroup[] {
  const byAuthority = new Map<string, ProofEntryResult[]>()
  for (const e of entries) {
    const key = e.keyMultibase ?? e.verificationMethod
    const bucket = byAuthority.get(key) ?? []
    bucket.push(e)
    byAuthority.set(key, bucket)
  }
  const buckets = [...byAuthority.values()]
  const kinds = attributeAuthorities(buckets, {
    issuerDid: facts.issuerDid,
    platformDid: facts.platformDid,
  })
  const groups = buckets.map((bucket, i): AuthorityGroup => (
    { label: kinds[i], entries: bucket }
  ))
  groups.sort((a, b) => order(a.label) - order(b.label))
  return groups
}

function order(label: AuthorityKind): number {
  if (label === 'issuer') return 0
  if (label === 'platform') return 1
  return 2
}

function buildGroup(
  g: AuthorityGroup, facts: CardFacts,
): HTMLElement {
  const ok = g.entries.some((e) => e.status === 'verified')
  const card = el('div', `verifier-authority is-${ok ? 'ok' : 'bad'}`)
  const head = el('div', 'verifier-authority-head')
  const label = (g.label === 'issuer' ? facts.issuerName
    : g.label === 'platform' ? facts.platformName
      : undefined) ?? tr('verifier.authority')
  head.append(
    buildOrb(ok),
    el('span', 'verifier-authority-label', label),
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
