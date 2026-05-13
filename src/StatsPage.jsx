import React, { useEffect, useState, useMemo } from 'react'
import { ref, get } from 'firebase/database'
import { db } from './firebase'

// Internal-only operator dashboard. Not linked from anywhere public.
// Shows aggregate-only metrics — never individual race names, scorekeeper
// names, or car names — so it stays safe to leave at an unlinked URL.

const C = {
  navy: '#1a2744',
  navyDark: '#0f1a30',
  navyMid: '#243454',
  parchment: '#f5e6c8',
  parchmentEdge: '#c9b78a',
  gold: '#ffd700',
  goldDark: '#b89400',
  green: '#2d6a4f',
  red: '#a8322a',
  inkDim: 'rgba(245,230,200,0.7)',
  inkLight: 'rgba(245,230,200,0.45)',
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function formatDay(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function aggregate(racesById) {
  const races = Object.entries(racesById || {}).map(([id, r]) => ({ id, ...(r || {}) }))
  const now = Date.now()

  const stats = {
    total: races.length,
    created7d: 0,
    created30d: 0,
    pastSetup: 0,
    everHadScorekeeper: 0,
    withResults: 0,
    completed: 0,
    totalCars: 0,
    totalHeats: 0,
    totalLaneResults: 0,
    totalDnfs: 0,
    laneHistogram: {},
    runsHistogram: {},
    carsBuckets: { '0': 0, '1–4': 0, '5–8': 0, '9–16': 0, '17–32': 0, '33+': 0 },
    daily: {},      // ts(startOfDay) -> count
    phaseCounts: { setup: 0, racing: 0, ended: 0, unknown: 0 },
    recent: [],     // last 20: {id, created, phase, numCars, numLanes, runsPerCar, resultsRecorded, totalHeats}
  }

  // Seed last 30 days with zeros so the chart shows a continuous axis.
  for (let i = 29; i >= 0; i--) {
    stats.daily[startOfDay(now - i * DAY_MS)] = 0
  }

  for (const r of races) {
    const meta = r.meta || {}
    const created = meta.created || 0
    const phase = meta.phase || 'unknown'
    const numCars = meta.numCars ?? 0
    const numLanes = meta.numLanes || 0
    const runsPerCar = meta.runsPerCar || 0

    // Recency buckets.
    if (created > 0) {
      const age = now - created
      if (age <= 7 * DAY_MS) stats.created7d++
      if (age <= 30 * DAY_MS) stats.created30d++
      const day = startOfDay(created)
      if (day >= startOfDay(now - 29 * DAY_MS)) {
        stats.daily[day] = (stats.daily[day] || 0) + 1
      }
    }

    // Phase / funnel.
    if (phase === 'racing' || phase === 'ended') stats.pastSetup++
    if (meta.everHadScorekeeper) stats.everHadScorekeeper++
    stats.phaseCounts[phase] = (stats.phaseCounts[phase] || 0) + 1

    // Schedule / cars / heats / results.
    const carsCount = r.cars ? Object.keys(r.cars).length : 0
    stats.totalCars += carsCount

    // Bucket cars.
    if (numCars === 0) stats.carsBuckets['0']++
    else if (numCars <= 4) stats.carsBuckets['1–4']++
    else if (numCars <= 8) stats.carsBuckets['5–8']++
    else if (numCars <= 16) stats.carsBuckets['9–16']++
    else if (numCars <= 32) stats.carsBuckets['17–32']++
    else stats.carsBuckets['33+']++

    if (numLanes > 0) {
      stats.laneHistogram[numLanes] = (stats.laneHistogram[numLanes] || 0) + 1
    }
    if (runsPerCar > 0) {
      stats.runsHistogram[runsPerCar] = (stats.runsHistogram[runsPerCar] || 0) + 1
    }

    const schedule = Array.isArray(r.schedule) ? r.schedule : []
    const heatCount = schedule.length
    stats.totalHeats += heatCount

    const results = r.results || {}
    let laneResultCount = 0
    let dnfCount = 0
    let completedHeats = 0
    Object.values(results).forEach((heatRes, hi) => {
      if (!heatRes) return
      const laneKeys = Object.keys(heatRes).filter(k => !k.startsWith('_'))
      laneResultCount += laneKeys.length
      laneKeys.forEach(k => { if (heatRes[k] === 'DNF') dnfCount++ })
      const expectedLanes = schedule[hi]?.length || numLanes
      if (laneKeys.length >= expectedLanes && expectedLanes > 0) completedHeats++
    })
    stats.totalLaneResults += laneResultCount
    stats.totalDnfs += dnfCount

    if (laneResultCount > 0) stats.withResults++
    if (heatCount > 0 && completedHeats >= heatCount) stats.completed++

    stats.recent.push({
      id: r.id,
      created,
      phase,
      numCars,
      numLanes,
      runsPerCar,
      heatCount,
      completedHeats,
      laneResultCount,
    })
  }

  stats.recent.sort((a, b) => b.created - a.created)
  stats.recent = stats.recent.slice(0, 20)

  return stats
}

// Tiny SVG bar-chart sparkline. Each value gets its own bar.
function Sparkline({ data, labels, height = 80, color = C.gold }) {
  const max = Math.max(1, ...data)
  const w = 800
  const barW = w / data.length
  return (
    <svg viewBox={`0 0 ${w} ${height + 24}`} width="100%" height={height + 24} preserveAspectRatio="none" style={{ display: 'block' }}>
      {data.map((v, i) => {
        const h = (v / max) * height
        const x = i * barW + 1
        const y = height - h
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={Math.max(1, barW - 2)}
              height={h}
              fill={v > 0 ? color : 'rgba(255,215,0,0.1)'}
              rx={1}
            >
              <title>{`${labels[i]}: ${v} race${v === 1 ? '' : 's'}`}</title>
            </rect>
            {v > 0 && (
              <text
                x={x + barW / 2}
                y={y - 3}
                textAnchor="middle"
                fontSize="10"
                fill={C.parchment}
                fontFamily="Inter, system-ui, sans-serif"
              >{v}</text>
            )}
          </g>
        )
      })}
      {/* Day-of-week axis labels every 5 days */}
      {labels.map((l, i) => i % 5 === 0 && (
        <text
          key={`l-${i}`}
          x={i * barW + barW / 2}
          y={height + 16}
          textAnchor="middle"
          fontSize="10"
          fill={C.inkLight}
          fontFamily="Inter, system-ui, sans-serif"
        >{l}</text>
      ))}
    </svg>
  )
}

function HBar({ label, value, max, color = C.gold }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
      <div style={{ width: 90, fontSize: 12, color: C.inkDim, fontFamily: '"Inter", system-ui, sans-serif', textAlign: 'right', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ flex: 1, height: 18, background: 'rgba(0,0,0,0.25)', border: `1px solid ${C.navyMid}`, borderRadius: 2, position: 'relative' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          paddingLeft: 8, fontSize: 11, fontWeight: 700, color: C.navy,
          fontFamily: '"Inter", system-ui, sans-serif',
          textShadow: '0 0 4px rgba(255,255,255,0.4)',
        }}>{value}</div>
      </div>
    </div>
  )
}

function Card({ children, span = 1, accent }) {
  return (
    <div style={{
      gridColumn: `span ${span}`,
      background: C.navyDark,
      border: `1px solid ${accent || 'rgba(255,215,0,0.25)'}`,
      borderRadius: 6, padding: 18,
    }}>{children}</div>
  )
}

function StatNum({ label, value, sub, accent = C.gold }) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.inkDim, fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 36, fontWeight: 800, color: accent, lineHeight: 1, fontFamily: '"Inter", system-ui, sans-serif' }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: C.inkLight, marginTop: 6 }}>{sub}</div>
      )}
    </div>
  )
}

export default function StatsPage() {
  const [racesData, setRacesData] = useState(null)
  const [error, setError] = useState(null)
  const [loadedAt, setLoadedAt] = useState(null)

  async function loadData() {
    setError(null)
    try {
      const snap = await get(ref(db, 'races'))
      setRacesData(snap.val() || {})
      setLoadedAt(Date.now())
    } catch (e) {
      setError(String(e?.message || e))
    }
  }

  useEffect(() => { loadData() }, [])

  const stats = useMemo(() => racesData == null ? null : aggregate(racesData), [racesData])

  const dailyData = useMemo(() => {
    if (!stats) return { values: [], labels: [] }
    const sortedKeys = Object.keys(stats.daily).map(Number).sort((a, b) => a - b)
    return {
      values: sortedKeys.map(k => stats.daily[k]),
      labels: sortedKeys.map(formatDay),
    }
  }, [stats])

  return (
    <div style={{
      minHeight: '100vh', background: C.navy, color: C.parchment,
      fontFamily: '"Inter", system-ui, sans-serif',
      padding: '40px 24px 80px',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
          <h1 style={{ fontSize: 28, margin: 0, color: C.gold, fontWeight: 800, letterSpacing: '0.01em' }}>
            Derby usage stats
          </h1>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {loadedAt && (
              <span style={{ fontSize: 11, color: C.inkLight }}>
                Loaded {new Date(loadedAt).toLocaleString()}
              </span>
            )}
            <button
              onClick={loadData}
              style={{
                background: 'transparent', color: C.gold, border: `1px solid ${C.gold}`,
                padding: '6px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                fontFamily: 'inherit', fontWeight: 600,
              }}
            >Refresh</button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: C.inkLight, marginTop: 0, marginBottom: 28 }}>
          Internal dashboard · aggregate data only · not linked from anywhere public
        </p>

        {error && (
          <div style={{ background: 'rgba(168,50,42,0.15)', border: `1px solid ${C.red}`, padding: 16, borderRadius: 4, color: C.red, marginBottom: 24 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Failed to load: {error}</div>
            {/permission|denied/i.test(error) && (
              <div style={{ fontSize: 13, color: C.parchment, opacity: 0.85, lineHeight: 1.5 }}>
                Heads up: the production Firebase rules block listing all races for privacy. To bring this page back, build a Cloud Function that maintains an /aggregates/stats summary node and read from that here. Until then, check usage via the Firebase console's Data tab.
              </div>
            )}
          </div>
        )}

        {!stats && !error && (
          <div style={{ padding: 40, textAlign: 'center', color: C.inkDim }}>
            Loading races…
          </div>
        )}

        {stats && (
          <>
            {/* Top-line numbers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 18 }}>
              <Card>
                <StatNum
                  label="Total races"
                  value={stats.total.toLocaleString()}
                  sub={`${stats.created7d} in last 7 days · ${stats.created30d} in last 30`}
                />
              </Card>
              <Card>
                <StatNum
                  label="Past setup"
                  value={stats.pastSetup.toLocaleString()}
                  sub={stats.total > 0 ? `${Math.round((stats.pastSetup / stats.total) * 100)}% of races` : '—'}
                />
              </Card>
              <Card>
                <StatNum
                  label="Recorded ≥1 result"
                  value={stats.withResults.toLocaleString()}
                  sub={stats.total > 0 ? `${Math.round((stats.withResults / stats.total) * 100)}% used`: '—'}
                />
              </Card>
              <Card>
                <StatNum
                  label="Completed"
                  value={stats.completed.toLocaleString()}
                  sub={stats.total > 0 ? `${Math.round((stats.completed / stats.total) * 100)}% finished` : '—'}
                  accent={C.green}
                />
              </Card>
            </div>

            {/* Daily chart */}
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 4, letterSpacing: '0.02em' }}>
                Races created — last 30 days
              </div>
              <div style={{ fontSize: 11, color: C.inkLight, marginBottom: 12 }}>
                Hover bars for daily counts
              </div>
              <Sparkline data={dailyData.values} labels={dailyData.labels} />
            </Card>

            <div style={{ height: 14 }} />

            {/* Funnel + activity totals */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 14 }}>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 14, letterSpacing: '0.02em' }}>
                  Activation funnel
                </div>
                {(() => {
                  const max = Math.max(1, stats.total)
                  return (
                    <>
                      <HBar label="Created" value={stats.total} max={max} />
                      <HBar label="Had SK" value={stats.everHadScorekeeper} max={max} color={C.gold} />
                      <HBar label="≥1 result" value={stats.withResults} max={max} color={C.gold} />
                      <HBar label="Completed" value={stats.completed} max={max} color={C.green} />
                    </>
                  )
                })()}
              </Card>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 14, letterSpacing: '0.02em' }}>
                  Activity totals
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <Mini label="Cars registered" value={stats.totalCars.toLocaleString()} />
                  <Mini label="Heats scheduled" value={stats.totalHeats.toLocaleString()} />
                  <Mini label="Lane results" value={stats.totalLaneResults.toLocaleString()} />
                  <Mini label="DNFs recorded" value={stats.totalDnfs.toLocaleString()} accent={C.red} />
                </div>
              </Card>
            </div>

            {/* Setup-choice histograms */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 14 }}>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 14, letterSpacing: '0.02em' }}>
                  Cars per race
                </div>
                {(() => {
                  const max = Math.max(1, ...Object.values(stats.carsBuckets))
                  return Object.entries(stats.carsBuckets).map(([k, v]) => (
                    <HBar key={k} label={k} value={v} max={max} />
                  ))
                })()}
              </Card>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 14, letterSpacing: '0.02em' }}>
                  Lanes
                </div>
                {(() => {
                  const entries = Object.entries(stats.laneHistogram).sort((a, b) => Number(a[0]) - Number(b[0]))
                  if (entries.length === 0) return <div style={{ fontSize: 12, color: C.inkLight }}>No data yet.</div>
                  const max = Math.max(...entries.map(([, v]) => v), 1)
                  return entries.map(([k, v]) => (
                    <HBar key={k} label={`${k} lane${k === '1' ? '' : 's'}`} value={v} max={max} />
                  ))
                })()}
              </Card>
              <Card>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 14, letterSpacing: '0.02em' }}>
                  Runs per car
                </div>
                {(() => {
                  const entries = Object.entries(stats.runsHistogram).sort((a, b) => Number(a[0]) - Number(b[0]))
                  if (entries.length === 0) return <div style={{ fontSize: 12, color: C.inkLight }}>No data yet.</div>
                  const max = Math.max(...entries.map(([, v]) => v), 1)
                  return entries.map(([k, v]) => (
                    <HBar key={k} label={`${k} run${k === '1' ? '' : 's'}`} value={v} max={max} />
                  ))
                })()}
              </Card>
            </div>

            {/* Recent races — aggregate-friendly, no names */}
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.gold, marginBottom: 14, letterSpacing: '0.02em' }}>
                Recent races (last 20)
              </div>
              <div style={{ fontSize: 11, color: C.inkLight, marginBottom: 10 }}>
                Shape & status only — names not displayed.
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: C.inkDim, textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px', fontWeight: 600 }}>When</th>
                      <th style={{ padding: '6px 8px', fontWeight: 600 }}>Phase</th>
                      <th style={{ padding: '6px 8px', fontWeight: 600 }}>Cars</th>
                      <th style={{ padding: '6px 8px', fontWeight: 600 }}>Lanes</th>
                      <th style={{ padding: '6px 8px', fontWeight: 600 }}>Runs/car</th>
                      <th style={{ padding: '6px 8px', fontWeight: 600 }}>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recent.map(r => {
                      const pct = r.heatCount > 0 ? Math.round((r.completedHeats / r.heatCount) * 100) : 0
                      const phaseColor = r.phase === 'ended' ? C.green : r.phase === 'racing' ? C.gold : C.inkLight
                      return (
                        <tr key={r.id} style={{ borderTop: `1px dashed ${C.navyMid}` }}>
                          <td style={{ padding: '8px' }}>{r.created ? new Date(r.created).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                          <td style={{ padding: '8px', color: phaseColor, fontWeight: 600 }}>{r.phase}</td>
                          <td style={{ padding: '8px' }}>{r.numCars || '—'}</td>
                          <td style={{ padding: '8px' }}>{r.numLanes || '—'}</td>
                          <td style={{ padding: '8px' }}>{r.runsPerCar || '—'}</td>
                          <td style={{ padding: '8px', minWidth: 140 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, height: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 2 }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? C.green : C.gold, borderRadius: 2 }} />
                              </div>
                              <span style={{ fontSize: 11, color: C.inkDim, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                    {stats.recent.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center', color: C.inkLight }}>No races yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

function Mini({ label, value, accent = C.parchment }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.inkDim, fontWeight: 600, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  )
}
