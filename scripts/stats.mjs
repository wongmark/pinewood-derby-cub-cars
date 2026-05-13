#!/usr/bin/env node
// Operator-only usage dashboard. Authenticates as the project owner via
// the locally-installed Firebase CLI (no service account, no embedded
// credentials — uses your `firebase login` session).
//
// Usage:
//   node scripts/stats.mjs
//
// Or, after `chmod +x scripts/stats.mjs`:
//   ./scripts/stats.mjs

import { execSync } from 'node:child_process'

const PROJECT = 'pinewood-derby-ed016'
const DAY_MS = 24 * 60 * 60 * 1000

// ── ANSI colors ───────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  gold: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
}

function fail(msg) {
  console.error(`${c.red}${c.bold}error:${c.reset} ${msg}`)
  process.exit(1)
}

function fetchRaces() {
  process.stdout.write(`${c.dim}Fetching /races from project ${PROJECT}…${c.reset} `)
  try {
    const stdout = execSync(`npx firebase database:get / --project ${PROJECT}`, {
      maxBuffer: 256 * 1024 * 1024, // 256MB — far more than we'll ever hit
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    process.stdout.write(`${c.green}✓${c.reset}\n`)
    const root = JSON.parse(stdout.toString('utf8'))
    return root?.races || {}
  } catch (e) {
    process.stdout.write(`${c.red}✗${c.reset}\n`)
    const stderr = e.stderr?.toString() || e.message || String(e)
    if (/not authenticated|please login/i.test(stderr)) {
      fail('Firebase CLI is not logged in. Run `firebase login` first.')
    }
    if (/permission|denied|403/i.test(stderr)) {
      fail(`Firebase CLI is logged in, but the account doesn't have access to ${PROJECT}.\n${stderr}`)
    }
    fail(`Failed to fetch from Firebase:\n${stderr}`)
  }
}

function startOfDay(ts) { const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime() }

function aggregate(racesById) {
  const races = Object.entries(racesById || {}).map(([id, r]) => ({ id, ...(r || {}) }))
  const now = Date.now()

  const s = {
    total: races.length,
    created7d: 0, created30d: 0,
    pastSetup: 0, everHadScorekeeper: 0, withResults: 0, completed: 0,
    totalCars: 0, totalHeats: 0, totalLaneResults: 0, totalDnfs: 0,
    laneHistogram: {}, runsHistogram: {},
    carsBuckets: { '0': 0, '1–4': 0, '5–8': 0, '9–16': 0, '17–32': 0, '33+': 0 },
    daily: {},
    phaseCounts: { setup: 0, racing: 0, ended: 0, unknown: 0 },
    recent: [],
  }

  for (let i = 29; i >= 0; i--) s.daily[startOfDay(now - i * DAY_MS)] = 0

  for (const r of races) {
    const meta = r.meta || {}
    const created = meta.created || 0
    const phase = meta.phase || 'unknown'
    const numCars = meta.numCars ?? 0
    const numLanes = meta.numLanes || 0
    const runsPerCar = meta.runsPerCar || 0

    if (created > 0) {
      const age = now - created
      if (age <= 7 * DAY_MS) s.created7d++
      if (age <= 30 * DAY_MS) s.created30d++
      const day = startOfDay(created)
      if (day >= startOfDay(now - 29 * DAY_MS)) s.daily[day] = (s.daily[day] || 0) + 1
    }

    if (phase === 'racing' || phase === 'ended') s.pastSetup++
    if (meta.everHadScorekeeper) s.everHadScorekeeper++
    s.phaseCounts[phase] = (s.phaseCounts[phase] || 0) + 1

    s.totalCars += r.cars ? Object.keys(r.cars).length : 0

    if (numCars === 0) s.carsBuckets['0']++
    else if (numCars <= 4) s.carsBuckets['1–4']++
    else if (numCars <= 8) s.carsBuckets['5–8']++
    else if (numCars <= 16) s.carsBuckets['9–16']++
    else if (numCars <= 32) s.carsBuckets['17–32']++
    else s.carsBuckets['33+']++

    if (numLanes > 0) s.laneHistogram[numLanes] = (s.laneHistogram[numLanes] || 0) + 1
    if (runsPerCar > 0) s.runsHistogram[runsPerCar] = (s.runsHistogram[runsPerCar] || 0) + 1

    const schedule = Array.isArray(r.schedule) ? r.schedule : []
    const heatCount = schedule.length
    s.totalHeats += heatCount

    const results = r.results || {}
    let laneResultCount = 0, dnfCount = 0, completedHeats = 0
    Object.values(results).forEach((heatRes, hi) => {
      if (!heatRes) return
      const laneKeys = Object.keys(heatRes).filter(k => !k.startsWith('_'))
      laneResultCount += laneKeys.length
      laneKeys.forEach(k => { if (heatRes[k] === 'DNF') dnfCount++ })
      const expected = schedule[hi]?.length || numLanes
      if (laneKeys.length >= expected && expected > 0) completedHeats++
    })
    s.totalLaneResults += laneResultCount
    s.totalDnfs += dnfCount
    if (laneResultCount > 0) s.withResults++
    if (heatCount > 0 && completedHeats >= heatCount) s.completed++

    s.recent.push({
      id: r.id, created, phase, numCars, numLanes, runsPerCar,
      heatCount, completedHeats, laneResultCount,
    })
  }

  s.recent.sort((a, b) => b.created - a.created)
  s.recent = s.recent.slice(0, 20)
  return s
}

// ── Output helpers ────────────────────────────────────────────────────────
function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) + '%' : '—' }

function bar(value, max, width = 28, color = c.gold) {
  const w = max > 0 ? Math.round((value / max) * width) : 0
  return color + '█'.repeat(w) + c.gray + '░'.repeat(width - w) + c.reset
}

function sparkBar(values, height = 6) {
  // Vertical bar chart in the terminal. Each column = 1 day. Height in rows.
  const max = Math.max(1, ...values)
  const rows = []
  for (let r = height; r >= 1; r--) {
    let line = ''
    for (const v of values) {
      const filled = (v / max) * height >= r
      line += filled ? `${c.gold}█${c.reset}` : ' '
    }
    rows.push(line)
  }
  return rows.join('\n')
}

function section(title) {
  return `\n${c.bold}${c.cyan}── ${title} ${'─'.repeat(Math.max(2, 60 - title.length))}${c.reset}\n`
}

// ── Main ──────────────────────────────────────────────────────────────────
const raw = fetchRaces()
const s = aggregate(raw)

console.log()
console.log(`${c.bold}${c.gold}DERBY USAGE STATS${c.reset}  ${c.dim}· project ${PROJECT} · ${new Date().toLocaleString()}${c.reset}`)

console.log(section('OVERVIEW'))
console.log(`  ${c.bold}Total races${c.reset}        ${c.gold}${s.total.toLocaleString()}${c.reset}    ${c.dim}(${s.created7d} this week · ${s.created30d} this month)${c.reset}`)
console.log(`  ${c.bold}Past setup${c.reset}         ${c.gold}${s.pastSetup.toLocaleString()}${c.reset}    ${c.dim}${pct(s.pastSetup, s.total)} of races${c.reset}`)
console.log(`  ${c.bold}≥1 result recorded${c.reset} ${c.gold}${s.withResults.toLocaleString()}${c.reset}    ${c.dim}${pct(s.withResults, s.total)} used${c.reset}`)
console.log(`  ${c.bold}Completed${c.reset}          ${c.green}${s.completed.toLocaleString()}${c.reset}    ${c.dim}${pct(s.completed, s.total)} finished${c.reset}`)

console.log(section('DAILY (last 30 days)'))
const dailyKeys = Object.keys(s.daily).map(Number).sort((a, b) => a - b)
const dailyValues = dailyKeys.map(k => s.daily[k])
console.log(sparkBar(dailyValues, 6))
// Date labels at the bottom (every 5 days)
let labels = ''
dailyKeys.forEach((k, i) => {
  if (i % 5 === 0) {
    const d = new Date(k)
    const label = `${d.getMonth() + 1}/${d.getDate()}`
    labels += label + ' '.repeat(Math.max(1, 5 - label.length))
  }
})
console.log(c.dim + labels + c.reset)
const peakDay = dailyValues.indexOf(Math.max(...dailyValues))
if (dailyValues[peakDay] > 0) {
  const d = new Date(dailyKeys[peakDay])
  console.log(`\n  ${c.dim}Peak: ${d.toLocaleDateString()} with ${dailyValues[peakDay]} race${dailyValues[peakDay] === 1 ? '' : 's'}${c.reset}`)
}

console.log(section('ACTIVATION FUNNEL'))
const max = Math.max(1, s.total)
console.log(`  Created      ${bar(s.total, max)}  ${c.gold}${s.total}${c.reset}`)
console.log(`  Had SK       ${bar(s.everHadScorekeeper, max)}  ${c.gold}${s.everHadScorekeeper}${c.reset}  ${c.dim}${pct(s.everHadScorekeeper, s.total)}${c.reset}`)
console.log(`  ≥1 result    ${bar(s.withResults, max)}  ${c.gold}${s.withResults}${c.reset}  ${c.dim}${pct(s.withResults, s.total)}${c.reset}`)
console.log(`  Completed    ${bar(s.completed, max, 28, c.green)}  ${c.green}${s.completed}${c.reset}  ${c.dim}${pct(s.completed, s.total)}${c.reset}`)

console.log(section('ACTIVITY TOTALS'))
console.log(`  ${c.bold}${s.totalCars.toLocaleString().padStart(8)}${c.reset}  cars registered`)
console.log(`  ${c.bold}${s.totalHeats.toLocaleString().padStart(8)}${c.reset}  heats scheduled`)
console.log(`  ${c.bold}${s.totalLaneResults.toLocaleString().padStart(8)}${c.reset}  individual lane results recorded`)
console.log(`  ${c.red}${s.totalDnfs.toLocaleString().padStart(8)}${c.reset}  DNFs`)

console.log(section('CARS PER RACE'))
const carsMax = Math.max(1, ...Object.values(s.carsBuckets))
Object.entries(s.carsBuckets).forEach(([k, v]) => {
  console.log(`  ${k.padStart(6)}  ${bar(v, carsMax)}  ${c.gold}${v}${c.reset}`)
})

console.log(section('LANES'))
const laneEntries = Object.entries(s.laneHistogram).sort((a, b) => Number(a[0]) - Number(b[0]))
if (laneEntries.length === 0) console.log(`  ${c.dim}No data yet.${c.reset}`)
const lanesMax = Math.max(1, ...laneEntries.map(([, v]) => v))
laneEntries.forEach(([k, v]) => {
  console.log(`  ${(k + ' lane' + (k === '1' ? '' : 's')).padStart(8)}  ${bar(v, lanesMax)}  ${c.gold}${v}${c.reset}`)
})

console.log(section('RUNS PER CAR'))
const runEntries = Object.entries(s.runsHistogram).sort((a, b) => Number(a[0]) - Number(b[0]))
if (runEntries.length === 0) console.log(`  ${c.dim}No data yet.${c.reset}`)
const runsMax = Math.max(1, ...runEntries.map(([, v]) => v))
runEntries.forEach(([k, v]) => {
  console.log(`  ${(k + ' run' + (k === '1' ? '' : 's')).padStart(8)}  ${bar(v, runsMax)}  ${c.gold}${v}${c.reset}`)
})

console.log(section('RECENT RACES (last 20)'))
console.log(`  ${c.dim}when                  phase    cars  lanes  runs  progress${c.reset}`)
s.recent.forEach(r => {
  const when = r.created
    ? new Date(r.created).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—'
  const phaseColor = r.phase === 'ended' ? c.green : r.phase === 'racing' ? c.gold : c.gray
  const progress = r.heatCount > 0 ? Math.round((r.completedHeats / r.heatCount) * 100) : 0
  const progBar = bar(progress, 100, 14, progress === 100 ? c.green : c.gold)
  console.log(
    `  ${when.padEnd(20)}  ${phaseColor}${(r.phase || '?').padEnd(7)}${c.reset}  ` +
    `${String(r.numCars || '—').padStart(4)}  ${String(r.numLanes || '—').padStart(5)}  ${String(r.runsPerCar || '—').padStart(4)}  ` +
    `${progBar} ${String(progress).padStart(3)}%`
  )
})
if (s.recent.length === 0) console.log(`  ${c.dim}No races yet.${c.reset}`)

console.log()
