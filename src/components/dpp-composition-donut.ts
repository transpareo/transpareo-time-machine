/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * <dpp-composition-donut data-key="...">
 * Renders one composition row (table + donut) from the
 * active version's flat presentation list, matched by
 * the `data-key` attribute. Formatting is generic: when the
 * row carries a `unit`, entry values render as "X <unit>"
 * and the donut centre shows the sum with the unit;
 * without a unit, values render as "X%" and the centre
 * reads "100%". The donut always normalises to the sum
 * of entries so the ring fills regardless of absolute
 * scale. Per-substance percentages tween between
 * versions; first paint snaps.
 */

import { LightElement } from '@/reactive/element'
import { el, SVG_NS } from '@/reactive/dom'
import { icon, iconForProperty } from '@/icons'
import { TrackedTween, type Track } from '@/reactive/tween'
import { renderedPresentation } from '@/state'
import { i18n, formatNumber } from '@/i18n'
import { selectedLibraryEntry } from './dpp-library-modal'
import { t } from '@/i18n/labels'
import { ratingIcon } from '@/rating'
import type {
  CompositionEntry, LocalizedText, PropertyValueOf,
} from '@/types'
import { tx } from '@/types'

// Narrowed alias for readability inside the render
// path; the donut keeps its 1:1 mapping to a row.
type Composition = PropertyValueOf<'composition'>

const RADIUS = 70
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

class DppCompositionDonut extends LightElement {
  private readonly colors = new Map<string, string>()
  private segGroup: SVGGElement | null = null
  private firstPaint = true
  private unit?: string

  private readonly tween = new TrackedTween<string>({
    tau: 110,
    onTick: () => {
      if (this.segGroup) this.paintSegments()
    },
  })

  protected setup(): void {
    this.effect(() => this.render())
  }

  disconnectedCallback(): void {
    // Stop any in-flight ring transition so a donut removed
    // mid-tween doesn't keep a RAF loop repainting a now
    // detached node.
    this.tween.clear()
    super.disconnectedCallback()
  }

  private render(): void {
    const key = this.dataset.key ?? ''
    const row = renderedPresentation().find(
      (p): p is Composition =>
        p.value.type === 'composition' && p.key === key,
    )
    if (!row || !row.value.entries.length) {
      this.replaceChildren()
      this.tween.clear()
      this.colors.clear()
      this.segGroup = null
      return
    }

    this.unit = row.value.unit
    this.renderShell(row)
    this.refreshTween(row.value.entries)
    if (this.segGroup) this.paintSegments()
  }

  private renderShell(row: Composition): void {
    const entries = row.value.entries
    const showDonut = entries.length > 1
    const title = tx(row.name, i18n.locale)

    this.innerHTML = `
      <div class="dpp-composition">
        <h2 class="dpp-section-title"></h2>
        <div class="dpp-composition-layout">
          <div class="dpp-composition-table"></div>
          ${showDonut ? donutShellHtml() : ''}
        </div>
      </div>
    `

    // The centre value carries the snapshot-supplied unit,
    // so it is written as text, never interpolated into the
    // shell markup above.
    if (showDonut) {
      const center = this.querySelector('.dpp-donut-center strong')
      if (center) center.textContent = donutCenterValue(this.unit, entries)
    }

    // Title prefixed with the row's sprite icon when the
    // external icon map has an entry for its key; falls
    // through to plain text otherwise.
    const heading = this.querySelector('.dpp-section-title')!
    const iconId = iconForProperty(row.key)
    if (iconId) {
      heading.appendChild(icon(iconId))
      heading.appendChild(document.createTextNode(' '))
    }
    heading.appendChild(document.createTextNode(title))

    const table = this.querySelector('.dpp-composition-table')!
    for (const entry of entries) {
      table.appendChild(buildRow(this.unit, entry))
    }

    this.segGroup = showDonut
      ? this.querySelector<SVGGElement>('.dpp-donut-segments')
      : null
  }

  private refreshTween(entries: ReadonlyArray<CompositionEntry>): void {
    // Refresh the colour map alongside the tween's
    // numeric targets so each substance carries the
    // block-specific colour through the next paint.
    this.colors.clear()
    const items = entries.map((c, i) => {
      const key = nameKey(c.name)
      this.colors.set(key, c.color ?? paletteColor(i))
      return { key, target: c.percent }
    })

    const moving = this.tween.apply(items, this.firstPaint)
    this.firstPaint = false
    if (moving) this.tween.start()
  }

  private paintSegments(): void {
    if (!this.segGroup) return

    // Always normalise the donut to the sum of present
    // entries so the ring fills 100%. For material
    // compositions (entries sum to 100 by design) this
    // gives identical output; for unit-bearing blocks
    // (e.g. kg CO2e/kWh) the visual still reads as the
    // breakdown of 100% of whatever the sum represents.
    let total = 0
    for (const tr of this.tween.tracks.values()) total += tr.current
    const scale = total > 0 ? total : 100
    paintSegments(this.segGroup, this.tween.tracks, this.colors, scale)
  }
}

// Segment colour when the snapshot omits one: cycle the
// donut palette defined in dpp-composition-donut.scss,
// which derives from the publisher accent so the segments
// stay on-theme.
const DONUT_PALETTE_SIZE = 6
function paletteColor(index: number): string {
  return `var(--dpp-donut-${(index % DONUT_PALETTE_SIZE) + 1})`
}

function donutShellHtml(): string {
  // The centre <strong> is left empty here; renderShell
  // fills its textContent so the snapshot-supplied unit
  // never reaches innerHTML.
  return `
    <div class="dpp-donut">
      <svg class="dpp-donut-svg" viewBox="0 0 200 200" aria-hidden="true">
        <circle class="dpp-donut-bg" cx="100" cy="100" r="${RADIUS}"/>
        <g class="dpp-donut-segments" transform="rotate(-90 100 100)"></g>
      </svg>
      <div class="dpp-donut-center"><strong></strong></div>
    </div>
  `
}

function donutCenterValue(
  unit: string | undefined,
  entries: ReadonlyArray<CompositionEntry>,
): string {
  const sum = entries.reduce((a, c) => a + c.percent, 0)

  // Round to one decimal, then localize: a German viewer
  // reads "87,3", matching every other number on the card.
  const rounded = Math.round(sum * 10) / 10
  const text = formatNumber(rounded)
  return unit ? `${text} ${unit}` : `${text}%`
}

function buildRow(
  unit: string | undefined,
  entry: CompositionEntry,
): HTMLDivElement {
  const row = el('div', 'dpp-comp-row')
  row.append(buildNameCell(entry), buildPctCell(unit, entry))
  return row
}

function buildNameCell(entry: CompositionEntry): HTMLDivElement {
  const cell = el('div', 'dpp-comp-name-cell')

  const baseName = tx(entry.name, i18n.locale)

  // When the snapshot carries a `libraryRef`, the donut
  // name becomes an in-app trigger that opens the library
  // modal with the locale-resolved versioned data object
  // from the public bucket. Otherwise the name is plain
  // text; the snapshot offers no further drill-down.
  //
  // The two surfaces are deliberately *visually* distinct
  // (button picks up --action-color + underline-on-hover;
  // plain text stays in --font-color). The DPP backend
  // doc describes them as "identical … but without a click
  // target", which would have us style the plain row to
  // mimic interactivity. We diverge intentionally: a row
  // that looks like a button but isn't is a worse UX cue
  // than a row that signals its non-interactivity through
  // colour alone. See dpp.scss `.dpp-comp-name` /
  // `.dpp-comp-name-trigger` for the rule pair.
  //
  // The rating smiley (if any) is prepended as a sibling
  // node so screen readers still see the bare name as
  // the accessible label.
  let host: HTMLElement
  if (entry.libraryRef) {
    const btn = el('button', 'dpp-comp-name dpp-comp-name-trigger')
    btn.type = 'button'
    btn.setAttribute(
      'aria-label',
      `${baseName} ${t(i18n.labels, 'component.details.aria')}`,
    )
    btn.addEventListener('click', () => selectedLibraryEntry.set(entry))
    host = btn
  } else {
    host = el('span', 'dpp-comp-name')
  }
  if (entry.rating) host.appendChild(ratingIcon(entry.rating))
  host.appendChild(document.createTextNode(baseName))
  cell.appendChild(host)
  return cell
}

function buildPctCell(
  unit: string | undefined,
  entry: CompositionEntry,
): HTMLSpanElement {
  const cell = el('span')
  const text = unit
    ? `${formatNumber(entry.percent)} ${unit}`
    : `${formatNumber(entry.percent)}%`
  cell.appendChild(el('span', 'dpp-comp-pct', text))
  return cell
}

function paintSegments(
  group: SVGGElement,
  tracks: ReadonlyMap<string, Track>,
  colors: ReadonlyMap<string, string>,
  scale: number,
): void {
  const frag = document.createDocumentFragment()
  let cum = 0

  // Sub-threshold cutoff scales with the normalisation
  // base so a tiny absolute value doesn't paint as a
  // visible sliver when the scale is small.
  const cutoff = scale / 10000
  for (const [key, t] of tracks) {
    if (t.current <= cutoff) continue
    frag.appendChild(buildSegment(key, t.current, cum, colors, scale))
    cum += t.current
  }
  group.replaceChildren(frag)
}

function buildSegment(
  key: string,
  current: number,
  cumStart: number,
  colors: ReadonlyMap<string, string>,
  scale: number,
): SVGCircleElement {
  const seg = document.createElementNS(SVG_NS, 'circle')
  seg.setAttribute('class', 'dpp-donut-segment')
  seg.setAttribute('cx', '100')
  seg.setAttribute('cy', '100')
  seg.setAttribute('r', String(RADIUS))
  seg.setAttribute('stroke', colors.get(key) ?? 'currentColor')

  const arc = (current / scale) * CIRCUMFERENCE
  const offset = -(cumStart / scale) * CIRCUMFERENCE
  seg.setAttribute('stroke-dasharray', `${arc} ${CIRCUMFERENCE}`)
  seg.setAttribute('stroke-dashoffset', String(offset))
  return seg
}

function nameKey(name: LocalizedText | string): string {
  if (typeof name === 'string') return name
  return name?.en ?? Object.values(name ?? {})[0] ?? ''
}

customElements.define('dpp-composition-donut', DppCompositionDonut)
