/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Builds the README demo loop. Drives the dev page through
 * a passport's history the way a visitor would - open the
 * timeline, fan out every event, read one event's record
 * down to its EPCIS fields, scrub back to the launch
 * version, return to today - while a CDP screencast
 * collects frames, then encodes those frames to an
 * animated image.
 *
 * The loop is choreographed as BEATS below: each beat is
 * one optional gesture plus the rest that follows it, so
 * the pacing is readable as a list and needs no code change
 * to retime. Rests are nearly free in the output, since
 * identical frames compress to nothing; every byte is in
 * the transitions.
 *
 * Frames are captured at twice the display size and scaled
 * down at encode time, which is what keeps the type crisp:
 * the browser renders text at 2x and the downscale does the
 * antialiasing.
 *
 * Written against the nordic-wear seed that `npm run dev`
 * serves by default: the event ids in BEATS are that
 * fixture's. Point it at another seed and the beats need
 * their own ids.
 *
 * Needs ffmpeg on PATH, a seeded public/ (npm run seed),
 * and network access for the fixture's webfont. Reuses a
 * dev server already listening on the port, otherwise
 * starts one and stops it again on the way out.
 *
 * Run: npm run demo
 */
import { chromium } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ORIGIN = 'http://localhost:5173'
const ROOT = fileURLToPath(new URL('..', import.meta.url))

// Capture size in CSS pixels. Tall enough that the card's
// brand bar, verification chip and hero stay in frame while
// the events overview occupies the top half.
const VIEWPORT = { width: 1000, height: 820 }

// Display width of the encoded loop. Half the captured
// pixels, GitHub renders README images up to ~890px wide.
const OUT_WIDTH = 900

const FPS = 20

// Retuning the encode means re-running a two-minute
// capture, so --keep-frames leaves the captured frames and
// their concat list on disk to encode again by hand.
const KEEP_FRAMES = process.argv.includes('--keep-frames')

// Committed asset. Animated WebP: the frame is dominated by
// a product photograph, which a 256-colour GIF palette
// would band, and WebP's inter-frame compression is what
// keeps a ten-second loop down to a few hundred KB. The
// budget is a regression tripwire, not a target - it is
// several times the size the loop encodes to today.
const OUT_FILE = join(ROOT, 'docs/demo.webp')
const BUDGET_BYTES = 1_200_000

interface Beat {
  // Element to click, as a CSS selector. Playwright pierces
  // the shadow root, so these are the renderer's own class
  // names. Omitted for a beat that only rests.
  readonly click?: string

  // Pixels to scroll under the pointer, for a beat that
  // reads further down a panel instead of clicking.
  readonly wheel?: number

  // Milliseconds to hold after the gesture, i.e. how long
  // the resulting state stays on screen.
  readonly hold: number
}

// The loop: open the timeline, fan out every event, stop on
// the recall, open that event's record and scroll into its
// EPCIS fields, then jump back to the launch version and
// hide the timeline again. It ends where it starts - history
// hidden, current version on screen - so the seam is
// invisible.
//
// Every rest is long enough to read what changed on screen
// before the next gesture moves it.
const BEATS: ReadonlyArray<Beat> = [
  { hold: 1600 },
  { click: '.versions-toggle', hold: 1800 },
  { click: '.open-full-btn', hold: 2800 },
  { click: '.open-full-btn', hold: 1400 },
  { click: '[data-event-id="evt-6"]', hold: 2400 },
  { click: '.event-details-card', hold: 2200 },
  { click: '.event-modal-disclosure-summary', hold: 2200 },
  { wheel: 320, hold: 2600 },
  { click: '.modal-close', hold: 1600 },
  { click: '[data-event-id="evt-1"]', hold: 2600 },
  { click: '.versions-toggle', hold: 2000 }
]

interface Frame {
  readonly file: string
  readonly at: number
}

async function main(): Promise<void> {
  requireFfmpeg()
  const stopServer = await devServer()
  const dir = await mkdtemp(join(tmpdir(), 'ttm-demo-'))
  const browser = await chromium.launch({
    executablePath: chromiumPath()
  })
  try {
    const frames = await capture(browser, dir)
    console.log(`captured ${frames.length} frames`)
    await encode(frames, dir)
  } finally {
    await browser.close()
    stopServer()
    if (KEEP_FRAMES) console.log(`frames kept in ${dir}`)
    else await rm(dir, { recursive: true, force: true })
  }
  report()
}

// Local developers usually have a system Chromium instead
// of Playwright's download, same as playwright.config.ts.
function chromiumPath(): string | undefined {
  const pinned = process.env.PLAYWRIGHT_CHROMIUM_PATH
  if (pinned) return pinned
  return existing('/usr/bin/chromium') ?? undefined
}

function existing(path: string): string | undefined {
  try {
    return statSync(path).isFile() ? path : undefined
  } catch (_) {
    return undefined
  }
}

function requireFfmpeg(): void {
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  if (probe.status === 0) return
  throw new Error('ffmpeg is not on PATH; install it and re-run')
}

// Reuse whatever is already serving the dev page, so a
// developer with `npm run dev` open keeps their session.
async function devServer(): Promise<() => void> {
  if (await reachable()) return () => {}

  // Its own process group, because npm runs vite as a
  // child: killing npm alone would leave the server
  // listening after this script exits.
  const proc = spawn('npm', ['run', 'dev'], {
    cwd: ROOT, stdio: 'ignore', detached: true
  })
  const stop = (): void => {
    if (proc.pid == null) return
    try { process.kill(-proc.pid, 'SIGTERM') } catch (_) { /* gone */ }
  }
  for (let tries = 0; tries < 60; tries++) {
    await sleep(500)
    if (await reachable()) return stop
  }
  stop()
  throw new Error(`dev server never came up on ${ORIGIN}`)
}

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(ORIGIN, { method: 'HEAD' })
    return res.ok
  } catch (_) {
    return false
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((res) => setTimeout(res, ms))

// Walks the beats with a screencast running. Frames arrive
// only when the page actually repaints, each stamped with
// the time it was composited; encode() turns those stamps
// back into durations.
async function capture(
  browser: Browser, dir: string
): Promise<ReadonlyArray<Frame>> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2
  })
  const page = await context.newPage()
  await boot(page)

  const frames: Frame[] = []
  const cdp = await context.newCDPSession(page)
  const writes: Array<Promise<void>> = []
  cdp.on('Page.screencastFrame', (ev) => {
    const file = join(dir, `f${String(frames.length).padStart(5, '0')}.png`)
    frames.push({ file, at: ev.metadata.timestamp ?? 0 })
    writes.push(writeFile(file, Buffer.from(ev.data, 'base64')))
    void cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId })
  })

  // Lossless frames, because a JPEG screencast re-quantises
  // every frame independently: the resting parts of the page
  // would differ pixel by pixel between frames and the
  // encoder's inter-frame diffing would have nothing to
  // collapse. Costs temp disk, saves a lot of output bytes.
  await cdp.send('Page.startScreencast', {
    format: 'png',
    maxWidth: VIEWPORT.width * 2,
    maxHeight: VIEWPORT.height * 2,
    everyNthFrame: 1
  })
  for (const beat of BEATS) {
    if (beat.click) await page.locator(beat.click).first().click()
    if (beat.wheel) await wheelBy(page, beat.wheel)
    await sleep(beat.hold)
  }
  await cdp.send('Page.stopScreencast')

  await Promise.all(writes)
  await context.close()
  return frames
}

// Scrolls in short bursts, so the frames carry a scroll
// rather than a jump cut. The pointer is left wherever the
// last click put it, which is what the wheel scrolls.
async function wheelBy(page: Page, px: number): Promise<void> {
  const bursts = 10
  for (let i = 0; i < bursts; i++) {
    await page.mouse.wheel(0, px / bursts)
    await sleep(35)
  }
}

// Waits for the card, its webfont and the verification
// verdict, so the loop opens on a settled page rather than
// on a spinner or a chip mid-flight.
async function boot(page: Page): Promise<void> {
  await page.goto(ORIGIN)
  await page.locator('dpp-deck > .card').first().waitFor()
  await page.locator('.chip.state-verified').first().waitFor()
  // As a string, because this script typechecks without
  // the DOM lib.
  await page.waitForFunction("document.fonts.status === 'loaded'")
  await sleep(1200)
}

// Feeds ffmpeg a concat list with one duration per frame, so
// the encode keeps the timing the browser actually painted,
// then resamples that to a constant frame rate.
async function encode(
  frames: ReadonlyArray<Frame>, dir: string
): Promise<void> {
  const last = frames[frames.length - 1]
  if (!last) throw new Error('the screencast delivered no frames')

  const lines = frames.map((frame, i) => {
    const next = frames[i + 1]?.at ?? frame.at + 1 / FPS
    const secs = Math.max(1 / 60, next - frame.at)
    return `file '${frame.file}'\nduration ${secs.toFixed(4)}`
  })

  // The concat demuxer drops the final entry's duration
  // unless the file is named once more.
  lines.push(`file '${last.file}'`)
  const list = join(dir, 'frames.txt')
  await writeFile(list, lines.join('\n') + '\n')

  // libwebp_anim by name: asked for the plain `libwebp`
  // encoder instead, ffmpeg encodes every frame whole and
  // the file comes out an order of magnitude larger.
  const scale = `scale=${OUT_WIDTH}:-1:flags=lanczos`
  run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `fps=${FPS},${scale}`,
    '-c:v', 'libwebp_anim', '-lossless', '0',
    '-quality', '88', '-preset', 'picture',
    '-loop', '0', '-an',
    OUT_FILE
  ])
}

function run(cmd: string, args: ReadonlyArray<string>): void {
  const res = spawnSync(cmd, [...args], { stdio: 'inherit' })
  if (res.status === 0) return
  throw new Error(`${cmd} exited with ${String(res.status)}`)
}

function report(): void {
  const bytes = statSync(OUT_FILE).size
  const kb = (bytes / 1024).toFixed(0)
  console.log(`wrote ${OUT_FILE} (${kb} KB)`)
  if (bytes <= BUDGET_BYTES) return
  const budget = (BUDGET_BYTES / 1024).toFixed(0)
  console.error(`over the ${budget} KB budget; shorten a beat or drop FPS`)
  process.exitCode = 1
}

await main()
