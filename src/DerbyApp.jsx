import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db } from './firebase'
import { ref, onValue, set, update } from 'firebase/database'
import * as XLSX from 'xlsx'
import { QRCodeSVG } from 'qrcode.react'

// ── Schedule + scoring ─────────────────────────────────────────────────────

function generateRaceId() { return Math.random().toString(36).slice(2, 8) }

function buildSchedule(cars, runsPerCar, numLanes) {
  const n = cars.length
  if (n < 2) return []
  const schedule = []
  const laneCounts = {}
  cars.forEach(c => { laneCounts[c.id] = Array(numLanes).fill(0) })

  const totalHeats = Math.ceil((n * runsPerCar) / numLanes)

  for (let h = 0; h < totalHeats; h++) {
    const sorted = [...cars].sort((a, b) => {
      const aRuns = laneCounts[a.id].reduce((s, x) => s + x, 0)
      const bRuns = laneCounts[b.id].reduce((s, x) => s + x, 0)
      return aRuns - bRuns
    })
    const heat = []
    const used = new Set()
    for (let lane = 0; lane < numLanes && sorted.length > 0; lane++) {
      const candidate = sorted.find(c => !used.has(c.id) &&
        laneCounts[c.id].reduce((s, x) => s + x, 0) < runsPerCar)
      if (!candidate) break
      used.add(candidate.id)
      heat.push({ carId: candidate.id, lane })
      laneCounts[candidate.id][lane]++
    }
    if (heat.length > 0) schedule.push(heat)
  }
  return schedule
}

function ordinalLabel(n) {
  const s = ['TH', 'ST', 'ND', 'RD']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

// Extended standings: points + per-place tallies + races + DNFs.
function calcStandings(cars, heats, results) {
  const tally = {}
  cars.forEach(c => {
    tally[c.id] = { points: 0, races: 0, firsts: 0, seconds: 0, thirds: 0, fourths: 0, dnfs: 0 }
  })

  heats.forEach((heat, hi) => {
    const res = results[hi]
    if (!res) return
    const active = heat.filter(slot => res[slot.lane] !== 'DNF' && res[slot.lane] != null)
    const n = active.length

    heat.forEach(slot => {
      const r = res[slot.lane]
      const t = tally[slot.carId]
      if (!t) return
      if (r === 'DNF') { t.races++; t.dnfs++; return }
      if (typeof r === 'number') {
        t.races++
        t.points += (n + 1 - r)
        if (r === 1) t.firsts++
        else if (r === 2) t.seconds++
        else if (r === 3) t.thirds++
        else if (r === 4) t.fourths++
      }
    })
  })

  const sorted = [...cars]
    .map(c => ({ ...c, ...tally[c.id] }))
    .sort((a, b) => b.points - a.points || b.firsts - a.firsts || b.seconds - a.seconds)

  // Assign places. Cars with identical `points` share a rank (standard
  // competition ranking — "1, 1, 3"). The next non-tied car gets a rank
  // equal to its index + 1 so ties create gaps.
  let lastPoints = null
  let lastPlace = 0
  sorted.forEach((c, i) => {
    if (c.points !== lastPoints) {
      lastPlace = i + 1
      lastPoints = c.points
    }
    c.place = lastPlace
  })
  return sorted
}

const CONFIDENCE_PRESETS = [
  { runs: 2, label: 'Quick', desc: 'Fast event, lower confidence' },
  { runs: 4, label: 'Balanced', desc: 'Good mix of speed and fairness' },
  { runs: 6, label: 'High', desc: 'Very fair, takes longer' },
  { runs: 8, label: 'Tournament', desc: 'Maximum confidence' },
]

// ── Color palette ──────────────────────────────────────────────────────────

const C = {
  navy: '#0a1f3d', navyDark: '#06152a', navyMid: '#143258',
  parchment: '#f5ecd7', parchmentDark: '#e8dcb8', parchmentEdge: '#c9b888',
  gold: '#FDB913', goldDark: '#c98e0a',
  red: '#a8322a', redDark: '#7a201a',
  ink: '#1a1a1a', inkDim: '#5a5145', inkLight: '#8a7f6e',
  green: '#2d6a4f', white: '#fafaf5',
}

const S = {
  app: {
    minHeight: '100vh',
    background: C.navy,
    backgroundImage: `
      radial-gradient(ellipse at top, ${C.navyMid} 0%, ${C.navy} 50%, ${C.navyDark} 100%),
      repeating-linear-gradient(45deg, transparent, transparent 40px, rgba(253,185,19,0.015) 40px, rgba(253,185,19,0.015) 41px)
    `,
    color: C.parchment,
    fontFamily: '"Inter", system-ui, sans-serif',
    padding: '0 0 80px 0',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '28px 40px 24px 40px', borderBottom: `3px double ${C.gold}`,
    flexWrap: 'wrap', gap: 16,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 18 },
  emblem: { filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))', flexShrink: 0 },
  homeLink: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    color: C.parchmentEdge, textDecoration: 'none',
    fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase',
    fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 600,
    cursor: 'pointer',
  },
  homeLinkArrow: { fontSize: 14, lineHeight: 1 },
  homeLinkBrand: { textDecoration: 'underline', textDecorationColor: C.parchmentEdge, textUnderlineOffset: 3 },
  raceNameRow: {
    display: 'flex', alignItems: 'center', gap: 14, marginTop: 4,
    flexWrap: 'wrap',
  },
  raceNameH1: {
    margin: 0, fontSize: 36, fontWeight: 800,
    fontFamily: '"Inter", system-ui, sans-serif',
    color: C.parchment, lineHeight: 1.05,
    letterSpacing: '0.005em',
  },
  raceNameShareBtn: {
    background: C.gold, border: `2px solid ${C.navy}`, color: C.navy,
    padding: '10px 18px', fontSize: 14,
    fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 700,
    cursor: 'pointer', letterSpacing: '0.02em',
    borderRadius: 2, boxShadow: `0 3px 0 ${C.goldDark}`,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  raceId: {
    fontSize: 10, color: C.parchmentEdge, letterSpacing: '0.1em',
    marginTop: 4, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  },
  nav: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' },
  userControls: {
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  identityGroup: {
    display: 'inline-flex', alignItems: 'center', gap: 0,
    border: `2px solid ${C.parchmentEdge}`, borderRadius: 4,
    padding: 4, background: 'rgba(0,0,0,0.18)',
  },
  identityName: {
    background: 'transparent', border: 'none',
    color: C.parchment, padding: '6px 10px', fontSize: 13,
    fontFamily: '"Inter", system-ui, sans-serif', cursor: 'pointer',
    letterSpacing: '0.01em', fontWeight: 700,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  identityGroupBtn: {
    background: 'transparent', border: 'none',
    color: C.parchment, padding: '6px 12px', fontSize: 13,
    fontFamily: '"Inter", system-ui, sans-serif', cursor: 'pointer',
    letterSpacing: '0.01em', fontWeight: 600,
    borderLeft: `1px solid ${C.parchmentEdge}`, marginLeft: 6,
  },
  identityGroupBtnPrimary: {
    background: C.gold, border: `2px solid ${C.navy}`, color: C.navy,
    padding: '6px 12px', fontSize: 13,
    fontFamily: '"Inter", system-ui, sans-serif', cursor: 'pointer',
    letterSpacing: '0.01em', fontWeight: 700,
    borderRadius: 2, marginLeft: 6,
  },
  tabStrip: {
    display: 'flex', alignItems: 'stretch', gap: 0, flexWrap: 'wrap',
    padding: '0 40px', background: C.navyDark,
    borderBottom: `2px solid ${C.gold}`,
  },
  tabBtn: {
    background: 'transparent', border: 'none',
    borderBottom: '3px solid transparent',
    color: C.parchmentEdge, padding: '14px 20px',
    fontSize: 14, fontFamily: '"Inter", system-ui, sans-serif',
    fontWeight: 600, cursor: 'pointer', letterSpacing: '0.01em',
  },
  tabBtnActive: {
    background: 'transparent', border: 'none',
    borderBottom: `3px solid ${C.gold}`,
    color: C.gold, padding: '14px 20px',
    fontSize: 14, fontFamily: '"Inter", system-ui, sans-serif',
    fontWeight: 700, cursor: 'pointer', letterSpacing: '0.01em',
  },
  navBtn: {
    background: C.parchment, border: `2px solid ${C.navy}`, color: C.navy,
    padding: '9px 16px', fontSize: 13, fontFamily: '"Inter", system-ui, sans-serif',
    cursor: 'pointer', letterSpacing: '0.01em',
    fontWeight: 600, borderRadius: 2, boxShadow: '0 2px 0 rgba(0,0,0,0.3)',
  },
  navBtnActive: {
    background: C.gold, border: `2px solid ${C.navy}`, color: C.navy,
    padding: '9px 16px', fontSize: 13, fontFamily: '"Inter", system-ui, sans-serif',
    cursor: 'pointer', letterSpacing: '0.01em',
    fontWeight: 700, borderRadius: 2, boxShadow: `0 2px 0 ${C.goldDark}`,
  },
  navBtnGhost: {
    background: 'transparent', border: `2px solid ${C.parchmentEdge}`,
    color: C.parchment, padding: '9px 16px', fontSize: 13,
    fontFamily: '"Inter", system-ui, sans-serif', cursor: 'pointer',
    letterSpacing: '0.01em', fontWeight: 600,
    borderRadius: 2,
  },
  syncBar: {
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    padding: '10px 40px', background: C.navyDark,
    borderBottom: `1px solid ${C.navyMid}`,
  },
  syncDot: (status) => ({
    width: 10, height: 10, borderRadius: '50%',
    background: status === 'live' ? C.green : status === 'connecting' ? C.gold : C.red,
    boxShadow: status === 'live' ? `0 0 8px ${C.green}` : 'none',
  }),
  roleBadge: (role) => ({
    fontFamily: '"Inter", system-ui, sans-serif', fontSize: 12, fontWeight: 700,
    letterSpacing: '0.02em',
    padding: '4px 10px', borderRadius: 2,
    background: role === 'scorekeeper' ? C.gold : 'transparent',
    color: role === 'scorekeeper' ? C.navy : C.parchmentEdge,
    border: role === 'scorekeeper' ? `2px solid ${C.gold}` : `2px solid ${C.parchmentEdge}`,
  }),
  syncText: { fontSize: 11, color: C.parchmentEdge, letterSpacing: '0.05em' },
  syncSpacer: { flex: 1 },
  syncInput: {
    background: C.navy, border: `1px solid ${C.gold}`, color: C.parchment,
    padding: '6px 10px', fontSize: 12, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    width: 140, borderRadius: 2,
  },
  setup: { maxWidth: 900, margin: '20px auto', padding: '0 40px' },
  banner: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: 16, background: C.gold, border: `2px solid ${C.navy}`,
    padding: '14px 20px', marginBottom: 24, borderRadius: 2,
    boxShadow: '0 3px 0 rgba(0,0,0,0.4)',
  },
  bannerTitle: {
    fontSize: 15, fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 700,
    color: C.navy, letterSpacing: '0.01em',
  },
  bannerSub: { fontSize: 11, color: C.navyDark, marginTop: 3, fontWeight: 500 },
  bannerBtn: {
    background: C.navy, border: `2px solid ${C.navy}`, color: C.gold,
    padding: '10px 18px', fontSize: 13, fontFamily: '"Inter", system-ui, sans-serif',
    cursor: 'pointer', letterSpacing: '0.01em',
    fontWeight: 700, borderRadius: 2, whiteSpace: 'nowrap',
  },
  setupGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  card: {
    background: C.parchment, border: `2px solid ${C.navy}`, padding: '14px 16px',
    borderRadius: 2, color: C.ink, boxShadow: '0 3px 0 rgba(0,0,0,0.4)',
    backgroundImage: `repeating-linear-gradient(0deg, rgba(139,115,85,0.02) 0px, rgba(139,115,85,0.02) 1px, transparent 1px, transparent 3px)`,
  },
  label: {
    display: 'block', fontSize: 12, letterSpacing: '0.01em', color: C.inkDim,
    marginBottom: 6, fontWeight: 700,
    fontFamily: '"Inter", system-ui, sans-serif',
  },
  bigSelect: {
    width: '100%', background: C.white, border: `2px solid ${C.navy}`,
    color: C.navy, fontSize: 22, fontFamily: '"Inter", system-ui, sans-serif',
    fontWeight: 700, padding: '6px 12px', boxSizing: 'border-box',
    borderRadius: 2, textAlign: 'center',
  },
  hint: { fontSize: 11, color: C.inkLight, marginTop: 6, fontStyle: 'italic' },
  presetGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 },
  preset: {
    background: C.white, border: `2px solid ${C.navy}`, color: C.ink,
    padding: '8px 10px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
    borderRadius: 2, boxShadow: '0 2px 0 rgba(0,0,0,0.2)',
  },
  presetActive: {
    background: C.gold, border: `2px solid ${C.navy}`, color: C.navy,
    boxShadow: `0 2px 0 ${C.goldDark}`,
  },
  presetRuns: {
    fontSize: 22, fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 700,
    lineHeight: 1, color: C.navy,
  },
  presetLabel: {
    fontSize: 12, fontWeight: 700, marginTop: 4, letterSpacing: '0.01em',
    fontFamily: '"Inter", system-ui, sans-serif',
  },
  presetDesc: { fontSize: 10, opacity: 0.75, marginTop: 4, lineHeight: 1.35 },
  presetCustomInput: {
    width: '100%', background: 'transparent', border: 'none',
    color: C.navy, fontSize: 22, fontWeight: 700,
    fontFamily: '"Inter", system-ui, sans-serif',
    padding: 0, textAlign: 'left', lineHeight: 1,
    outline: 'none', boxSizing: 'border-box',
  },
  summary: {
    gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
    gap: 12, padding: '14px 20px', background: C.navy, border: `2px solid ${C.gold}`,
    borderRadius: 2, boxShadow: '0 3px 0 rgba(0,0,0,0.4)',
  },
  summaryItem: { textAlign: 'center', padding: '0 8px', borderRight: `1px dashed ${C.gold}` },
  summaryNum: {
    fontSize: 32, fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 700,
    color: C.gold, lineHeight: 1,
  },
  summaryLabel: {
    fontSize: 11, color: C.parchmentEdge, letterSpacing: '0.02em',
    marginTop: 4, fontWeight: 600,
  },
  bigButton: {
    gridColumn: '1 / -1', background: C.green, border: `2px solid ${C.navy}`,
    color: C.parchment, padding: '20px 32px', fontSize: 20,
    fontFamily: '"Inter", system-ui, sans-serif', cursor: 'pointer',
    letterSpacing: '0.02em', fontWeight: 700,
    borderRadius: 2,
    boxShadow: `0 4px 0 #1f4a37, 0 6px 12px rgba(0,0,0,0.4)`,
  },
  carsCard: {
    gridColumn: '1 / -1', background: C.parchment, border: `2px solid ${C.navy}`,
    padding: 24, borderRadius: 2, color: C.ink,
    boxShadow: '0 3px 0 rgba(0,0,0,0.4)',
  },
  carsHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 14, paddingBottom: 10, borderBottom: `2px dashed ${C.parchmentEdge}`,
  },
  carRow: {
    display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8,
  },
  carNumBadge: {
    fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 700, fontSize: 14,
    color: C.navy, minWidth: 32,
  },
  carNameInput: {
    flex: 1, background: C.white, border: `1px solid ${C.parchmentEdge}`,
    color: C.ink, padding: '8px 12px', fontFamily: 'inherit', fontSize: 14,
    borderRadius: 2,
  },
  addCarBtn: {
    background: C.navy, border: `2px solid ${C.navy}`, color: C.gold,
    padding: '8px 16px', fontSize: 13, fontFamily: '"Inter", system-ui, sans-serif',
    cursor: 'pointer', letterSpacing: '0.01em',
    fontWeight: 700, borderRadius: 2,
  },
  addCarLink: {
    background: 'transparent', border: 'none', color: C.gold,
    padding: '8px 12px', fontSize: 14,
    fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 600,
    cursor: 'pointer', letterSpacing: '0.01em',
    textDecoration: 'underline', textDecorationStyle: 'dotted',
    textUnderlineOffset: 3,
  },
  passcodeGenLink: {
    background: 'transparent', border: 'none', color: C.navy,
    padding: '4px 8px', fontSize: 13,
    fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 600,
    cursor: 'pointer', letterSpacing: '0.01em',
    textDecoration: 'underline', textDecorationStyle: 'dotted',
    textUnderlineOffset: 3,
  },
  exportBtn: {
    background: C.navy, border: `2px solid ${C.navy}`, color: C.gold,
    padding: '6px 14px', fontSize: 12, fontFamily: '"Inter", system-ui, sans-serif',
    cursor: 'pointer', letterSpacing: '0.01em',
    fontWeight: 700, borderRadius: 2,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  exportBtnLight: {
    background: C.parchment, border: `2px solid ${C.navy}`, color: C.navy,
    padding: '6px 14px', fontSize: 12, fontFamily: '"Inter", system-ui, sans-serif',
    cursor: 'pointer', letterSpacing: '0.01em',
    fontWeight: 700, borderRadius: 2,
    display: 'inline-flex', alignItems: 'center', gap: 6,
  },
  removeCarBtn: {
    background: 'transparent', border: `1px solid ${C.red}`, color: C.red,
    padding: '6px 10px', fontSize: 13, fontFamily: '"Inter", system-ui, sans-serif',
    cursor: 'pointer', fontWeight: 700, borderRadius: 2,
  },

  raceMain: { maxWidth: 1100, margin: '32px auto', padding: '0 40px' },
  progressSticky: {
    position: 'sticky', top: 0, zIndex: 50,
    paddingTop: 12, paddingBottom: 16, marginBottom: 8,
    background: `linear-gradient(to bottom, ${C.navy} 0%, ${C.navy} 80%, transparent 100%)`,
  },
  progressBar: {
    position: 'relative', height: 34, background: C.navyDark,
    border: `2px solid ${C.gold}`, borderRadius: 2, overflow: 'hidden',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  progressFill: {
    height: '100%',
    backgroundImage: `repeating-linear-gradient(45deg, ${C.gold} 0, ${C.gold} 8px, ${C.goldDark} 8px, ${C.goldDark} 16px)`,
    transition: 'width 0.3s',
  },
  progressLabel: {
    position: 'absolute', inset: 0, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 700, letterSpacing: '0.01em',
    color: C.parchment, fontFamily: '"Inter", system-ui, sans-serif',
    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
  },
  heatList: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  heatCard: {
    background: C.parchment, border: `2px solid ${C.navy}`, padding: 18,
    borderRadius: 2, color: C.ink, boxShadow: '0 3px 0 rgba(0,0,0,0.3)',
    backgroundImage: `repeating-linear-gradient(0deg, rgba(139,115,85,0.025) 0px, rgba(139,115,85,0.025) 1px, transparent 1px, transparent 3px)`,
  },
  heatCardDone: {
    border: `2px solid ${C.green}`, background: C.parchmentDark, opacity: 0.85,
  },
  heatHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 14, paddingBottom: 10,
    borderBottom: `2px dashed ${C.parchmentEdge}`,
  },
  heatNum: {
    fontSize: 22, fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 700,
    letterSpacing: '0.01em', color: C.navy,
  },
  heatRun: {
    fontSize: 12, color: C.inkDim, letterSpacing: '0.01em',
    fontWeight: 600,
  },
  checkMark: {
    fontSize: 20, color: C.parchment, fontWeight: 700, background: C.green,
    width: 32, height: 32, display: 'flex', alignItems: 'center',
    justifyContent: 'center', borderRadius: '50%',
    boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
  },
  lanes: { display: 'flex', flexDirection: 'column', gap: 8 },
  lane: { display: 'flex', alignItems: 'center', gap: 8 },
  laneNum: {
    fontSize: 12, color: C.inkDim, letterSpacing: '0.01em', width: 26,
    fontWeight: 700, fontFamily: '"Inter", system-ui, sans-serif', flexShrink: 0,
  },
  carBadge: {
    background: C.navy, color: C.gold, border: `2px solid ${C.navy}`,
    padding: '6px 10px', fontSize: 13, fontWeight: 600,
    minWidth: 90, borderRadius: 2, fontFamily: '"Inter", system-ui, sans-serif',
    letterSpacing: '0.01em',
  },
  placeButtons: { display: 'flex', gap: 3, marginLeft: 'auto', flexWrap: 'nowrap' },
  placeBtn: {
    width: 28, height: 30, background: C.white, border: `2px solid ${C.navy}`,
    color: C.navy, fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 700,
    fontSize: 13, cursor: 'pointer', borderRadius: 2, padding: 0,
    boxShadow: '0 1px 0 rgba(0,0,0,0.2)', flexShrink: 0,
  },
  placeBtnSelected: {
    background: C.gold, color: C.navy, border: `2px solid ${C.navy}`,
    boxShadow: `0 2px 0 ${C.goldDark}`,
  },
  placeBtnMuted: {
    background: '#e8e2d0', color: '#a89f87', border: `2px solid #c9bfae`,
    boxShadow: 'none',
  },
  placeBtnDisabled: {
    opacity: 0.3, cursor: 'not-allowed', background: C.parchmentDark,
  },
  dnfBtn: {
    minWidth: 34, height: 30, padding: '0 6px', background: C.white,
    border: `2px solid ${C.red}`, color: C.red,
    fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 700, fontSize: 11,
    cursor: 'pointer', borderRadius: 2, letterSpacing: '0.01em',
    marginLeft: 4, boxShadow: '0 1px 0 rgba(0,0,0,0.2)', flexShrink: 0,
  },
  dnfBtnActive: {
    background: C.red, color: C.parchment, boxShadow: `0 1px 0 ${C.redDark}`,
  },
  laneDnf: { opacity: 0.65 },

  resultsMain: { maxWidth: 1100, margin: '32px auto', padding: '0 40px' },
  h2: {
    fontSize: 32, fontFamily: '"Inter", system-ui, sans-serif', letterSpacing: '0.01em',
    margin: '0 0 20px 0', color: C.gold,
    fontWeight: 800, borderBottom: `3px double ${C.gold}`, paddingBottom: 8,
  },
  podiumWrap: { marginBottom: 40 },
  podium: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 },
  podiumCard: {
    background: C.parchment, border: `3px solid ${C.navy}`, padding: 18,
    textAlign: 'center', borderRadius: 2, color: C.ink,
    boxShadow: '0 4px 0 rgba(0,0,0,0.4)', position: 'relative',
  },
  podiumPlace: {
    fontSize: 13, letterSpacing: '0.05em', color: C.inkDim, marginBottom: 8,
    fontWeight: 700, fontFamily: '"Inter", system-ui, sans-serif',
  },
  podiumCar: {
    fontSize: 28, fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 700,
    lineHeight: 1.1, color: C.navy,
  },
  podiumPts: {
    fontSize: 22, color: C.red, marginTop: 10, fontWeight: 700,
    fontFamily: '"Inter", system-ui, sans-serif',
  },
  podiumDetail: { fontSize: 10, color: C.inkLight, marginTop: 6 },
  fullStandings: {
    background: C.parchment, border: `2px solid ${C.navy}`, padding: 24,
    borderRadius: 2, color: C.ink, boxShadow: '0 3px 0 rgba(0,0,0,0.4)',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: {
    textAlign: 'left', padding: '10px 8px', fontSize: 12, letterSpacing: '0.01em',
    color: C.parchment, background: C.navy,
    fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 600,
  },
  td: {
    padding: '10px 8px', borderBottom: `1px dashed ${C.parchmentEdge}`,
    color: C.ink,
  },
  trTop: { background: 'rgba(253,185,19,0.18)' },
  nameInput: {
    background: C.white, border: `1px solid ${C.parchmentEdge}`, color: C.ink,
    padding: '4px 8px', fontFamily: 'inherit', fontSize: 13, width: '100%',
    borderRadius: 2,
  },
  share: {
    maxWidth: 1100, margin: '32px auto 0', padding: '16px 40px',
    fontSize: 12, color: C.parchmentEdge, letterSpacing: '0.05em',
  },
  shareUrl: {
    color: C.gold, fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    wordBreak: 'break-all',
  },
  modalBackdrop: {
    position: 'fixed', inset: 0, background: 'rgba(6,21,42,0.75)',
    backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center',
    justifyContent: 'center', zIndex: 1000, padding: 20,
  },
  modalDialog: {
    background: C.parchment, border: `3px solid ${C.navy}`, borderRadius: 2,
    padding: 28, maxWidth: 460, width: '100%', color: C.ink,
    boxShadow: '0 8px 0 rgba(0,0,0,0.4), 0 16px 32px rgba(0,0,0,0.5)',
    backgroundImage: `repeating-linear-gradient(0deg, rgba(139,115,85,0.03) 0px, rgba(139,115,85,0.03) 1px, transparent 1px, transparent 3px)`,
  },
  modalTitle: {
    fontSize: 22, fontFamily: '"Inter", system-ui, sans-serif', fontWeight: 700,
    color: C.navy, letterSpacing: '0.01em',
    marginBottom: 16, paddingBottom: 10,
    borderBottom: `2px dashed ${C.parchmentEdge}`,
  },
  modalBody: { marginBottom: 20 },
  modalInput: {
    width: '100%', boxSizing: 'border-box', background: C.white,
    border: `2px solid ${C.navy}`, color: C.navy, fontSize: 16,
    fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: 500,
    padding: '8px 12px', borderRadius: 2,
  },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  modalCancelBtn: {
    background: 'transparent', border: `2px solid ${C.navy}`, color: C.navy,
    padding: '10px 18px', fontSize: 13, fontFamily: '"Inter", system-ui, sans-serif',
    cursor: 'pointer', letterSpacing: '0.01em',
    fontWeight: 600, borderRadius: 2,
  },
  modalConfirmBtn: {
    background: C.navy, border: `2px solid ${C.navy}`, color: C.gold,
    padding: '10px 18px', fontSize: 13, fontFamily: '"Inter", system-ui, sans-serif',
    cursor: 'pointer', letterSpacing: '0.01em',
    fontWeight: 700, borderRadius: 2,
    boxShadow: '0 2px 0 rgba(0,0,0,0.4)',
  },
  toggleRow: {
    display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer',
    marginBottom: 8,
  },
  toggleCheckbox: { width: 20, height: 20, accentColor: C.red, cursor: 'pointer' },
  toggleLabel: {
    fontSize: 14, fontWeight: 600, color: C.ink,
    fontFamily: '"Inter", system-ui, sans-serif', letterSpacing: '0.01em',
  },
  toggleSwitch: (on) => ({
    position: 'relative', width: 44, height: 24, borderRadius: 12,
    background: on ? C.green : '#c9bfae',
    border: `2px solid ${C.navy}`, cursor: 'pointer', flexShrink: 0,
    transition: 'background 0.15s',
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.15)',
  }),
  toggleKnob: (on) => ({
    position: 'absolute', top: 2, left: on ? 22 : 2,
    width: 16, height: 16, borderRadius: '50%',
    background: C.white, transition: 'left 0.15s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  }),
}

const podiumStyles = [
  {
    borderColor: C.gold,
    background: `linear-gradient(180deg, ${C.gold} 0%, ${C.parchment} 25%)`,
    boxShadow: `0 4px 0 ${C.goldDark}, 0 0 24px rgba(253,185,19,0.3)`,
  },
  {
    borderColor: '#c0c0c0',
    background: `linear-gradient(180deg, #c0c0c0 0%, ${C.parchment} 25%)`,
  },
  {
    borderColor: '#cd7f32',
    background: `linear-gradient(180deg, #cd7f32 0%, ${C.parchment} 25%)`,
  },
  { borderColor: C.navy },
  { borderColor: C.navy },
]

function relTime(ts) {
  if (!ts) return ''
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return `${h}h ago`
}

// Name input that treats `Car N` as a placeholder: shown in gray, clears on focus.
function CarNameInput({ car, order, onChange, style, disabled }) {
  const defaultName = `Car ${order + 1}`
  const isDefault = !car.name || car.name.trim() === defaultName
  const [focused, setFocused] = useState(false)
  const displayValue = focused
    ? (isDefault ? '' : car.name)
    : (isDefault ? defaultName : car.name)
  return (
    <input
      type="text"
      value={displayValue}
      placeholder={defaultName}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={e => onChange(e.target.value)}
      style={{
        ...style,
        color: !focused && isDefault ? '#8a7f6e' : undefined,
        fontStyle: !focused && isDefault ? 'italic' : 'normal',
      }}
    />
  )
}

// ── HeatCard ───────────────────────────────────────────────────────────────

function HeatCard({ heat, idx, numLanes, results, cars, onUpdate, onRenameCar, readOnly, isMobile = false }) {
  const res = results[idx] || {}
  const laneToCar = {}
  heat.forEach(slot => { laneToCar[slot.lane] = slot.carId })

  const carById = {}
  cars.forEach(c => { carById[c.id] = c })

  const laneKeys = Object.keys(res).filter(k => !k.startsWith('_'))
  const dnfCount = laneKeys.filter(k => res[k] === 'DNF').length
  const activeRacers = heat.length - dnfCount
  const complete = laneKeys.length >= heat.length
  const editedBy = res._by
  const editedAt = res._at

  const mobileHeatCard = isMobile ? { padding: 12 } : {}
  const mobileHeatHeader = isMobile ? { marginBottom: 10, paddingBottom: 8 } : {}
  const mobileHeatNum = isMobile ? { fontSize: 18 } : {}
  const mobileLane = isMobile ? { gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch' } : {}
  const mobileLaneNum = isMobile ? { width: 22, fontSize: 11 } : {}
  const mobileCarBadge = isMobile ? { padding: '5px 8px', fontSize: 12, minWidth: 70 } : {}
  const mobilePlaceBtn = isMobile ? { width: 26, height: 28, fontSize: 12 } : {}
  const mobileDnfBtn = isMobile ? { minWidth: 30, height: 28, padding: '0 4px', fontSize: 10, marginLeft: 2 } : {}

  return (
    <div style={{ ...S.heatCard, ...mobileHeatCard, ...(complete ? S.heatCardDone : {}) }}>
      <div style={{ ...S.heatHeader, ...mobileHeatHeader }}>
        <div>
          <div style={{ ...S.heatNum, ...mobileHeatNum }}>Heat {idx + 1}</div>
          <div style={S.heatRun}>
            {heat.length} cars
            {dnfCount > 0 && <span style={{ color: C.red, marginLeft: 6 }}>· {dnfCount} DNF</span>}
          </div>
        </div>
        {complete && <div style={S.checkMark}>✓</div>}
      </div>
      <div style={S.lanes}>
        {Array.from({ length: numLanes }, (_, i) => i).map(lane => {
          const carId = laneToCar[lane]
          const result = res[lane]
          const isDnf = result === 'DNF'
          if (carId == null) {
            return (
              <div key={lane} style={{ ...S.lane, ...mobileLane, opacity: 0.4 }}>
                <div style={{ ...S.laneNum, ...mobileLaneNum }}>L{lane + 1}</div>
                <div style={{ fontSize: 11, color: C.inkLight, fontStyle: 'italic' }}>BYE</div>
              </div>
            )
          }
          const car = carById[carId]
          const carNum = (car?.order ?? 0) + 1
          const trimmedName = (car?.name || '').trim()
          const isDefaultName = trimmedName === '' || trimmedName === `Car ${carNum}`
          const label = isDefaultName ? `Car ${carNum}` : `Car ${carNum}: ${trimmedName}`
          return (
            <div key={lane} style={{ ...S.lane, ...mobileLane, ...(isDnf ? S.laneDnf : {}) }}>
              <div style={{ ...S.laneNum, ...mobileLaneNum }}>L{lane + 1}</div>
              <div
                style={{ ...S.carBadge, ...mobileCarBadge, cursor: readOnly ? 'default' : 'pointer' }}
                onDoubleClick={() => !readOnly && onRenameCar && onRenameCar(carId)}
                title={readOnly ? '' : 'Double-click to rename'}
              >{label}</div>
              <div style={S.placeButtons}>
                {Array.from({ length: Math.max(activeRacers, 1) }, (_, i) => i + 1).map(p => {
                  const selected = result === p
                  const hasResult = result != null || isDnf
                  let style = { ...S.placeBtn, ...mobilePlaceBtn }
                  if (selected) {
                    style = { ...style, ...S.placeBtnSelected }
                  } else if (hasResult) {
                    style = { ...style, ...S.placeBtnMuted }
                  }
                  if (readOnly) style = { ...style, cursor: 'default' }
                  return (
                    <button
                      key={p}
                      disabled={readOnly}
                      onClick={() => onUpdate(idx, lane, p)}
                      style={style}
                    >{p}</button>
                  )
                })}
                <button
                  disabled={readOnly}
                  onClick={() => onUpdate(idx, lane, 'DNF')}
                  style={{
                    ...S.dnfBtn,
                    ...mobileDnfBtn,
                    ...(isDnf ? S.dnfBtnActive : {}),
                    ...(!isDnf && result != null ? S.placeBtnMuted : {}),
                    ...(readOnly ? { cursor: 'default' } : {}),
                  }}
                  title={isDnf ? 'Clear DNF' : 'Did not finish'}
                >DNF</button>
              </div>
            </div>
          )
        })}
      </div>
      {editedBy && (
        <div style={{
          marginTop: 10, paddingTop: 8, borderTop: `1px dashed ${C.parchmentEdge}`,
          fontSize: 10, color: C.inkLight, letterSpacing: '0.05em',
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        }}>
          last edit by <strong style={{ color: C.navy }}>{editedBy}</strong> · {relTime(editedAt)}
        </div>
      )}
    </div>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────

const PASSCODE_WORDS = [
  'rocket', 'derby', 'lightning', 'turbo', 'comet', 'falcon', 'thunder',
  'blazing', 'speedy', 'silver', 'arrow', 'wolf', 'bolt', 'hawk', 'tiger',
  'wing', 'dash', 'pine', 'wood', 'track', 'sprint', 'flash', 'gear',
  'spark', 'lane', 'racer', 'sonic', 'rapid', 'blaze', 'storm',
].filter(w => w.length >= 4)
function generatePasscode() {
  return PASSCODE_WORDS[Math.floor(Math.random() * PASSCODE_WORDS.length)]
}

function useIsMobile(breakpoint = 720) {
  const get = () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${breakpoint}px)`).matches
  const [isMobile, setIsMobile] = React.useState(get)
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const onChange = () => setIsMobile(mql.matches)
    mql.addEventListener?.('change', onChange) ?? mql.addListener?.(onChange)
    return () => { mql.removeEventListener?.('change', onChange) ?? mql.removeListener?.(onChange) }
  }, [breakpoint])
  return isMobile
}

export default function DerbyApp() {
  const { raceId } = useParams()
  const navigate = useNavigate()
  const dbPath = `races/${raceId}`
  const lsKey = `derby:scorekeeper:${raceId}`
  const isMobile = useIsMobile()

  const [fbData, setFbData] = useState(null)
  const [connected, setConnected] = useState(false)
  const [view, setView] = useState('setup')
  const [initialViewApplied, setInitialViewApplied] = useState(false)
  const [scorekeeperName, setScorekeeperName] = useState(
    () => localStorage.getItem(lsKey) || ''
  )
  const [numCarsInput, setNumCarsInput] = useState('8')
  const [numLanesInput, setNumLanesInput] = useState('4')
  const [customRunsInput, setCustomRunsInput] = useState('')
  const customRunsRef = React.useRef(null)
  const [claimModal, setClaimModal] = useState(false)
  const [claimNameInput, setClaimNameInput] = useState('')
  const [claimCodeInput, setClaimCodeInput] = useState('')
  const [claimError, setClaimError] = useState('')
  const [splashName, setSplashName] = useState('')
  const [regenConfirm, setRegenConfirm] = useState(false)
  const [stepDownConfirm, setStepDownConfirm] = useState(false)
  const [addCarConfirm, setAddCarConfirm] = useState(false)
  const [renameCarId, setRenameCarId] = useState(null)
  const [renameInput, setRenameInput] = useState('')
  const [copied, setCopied] = useState(false)
  const [shareModal, setShareModal] = useState(false)
  const [renameMe, setRenameMe] = useState(false)
  const [renameMeInput, setRenameMeInput] = useState('')
  const [renameMeError, setRenameMeError] = useState('')
  const [raceNameFocused, setRaceNameFocused] = useState(false)

  function openRenameMe() {
    setRenameMeInput(scorekeeperName)
    setRenameMeError('')
    setRenameMe(true)
  }
  function submitRenameMe() {
    const next = renameMeInput.trim()
    if (!next || next === scorekeeperName) { setRenameMe(false); return }
    if (takenScorekeeperNames(true).has(next.toLowerCase())) {
      setRenameMeError('That name is already in use for this race. Pick a different name.')
      return
    }
    setMeta({ scorekeeper: next })
    setScorekeeperName(next)
    localStorage.setItem(lsKey, next)
    setRenameMe(false)
  }

  function copyShareLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  useEffect(() => {
    const r = ref(db, dbPath)
    const unsub = onValue(r, snap => {
      setFbData(snap.val() || {})
      setConnected(true)
    })
    return () => unsub()
  }, [dbPath])

  useEffect(() => {
    if (fbData?.meta?.numCars != null) {
      setNumCarsInput(String(fbData.meta.numCars))
    }
  }, [fbData?.meta?.numCars])

  useEffect(() => {
    if (fbData?.meta?.numLanes != null) {
      setNumLanesInput(String(fbData.meta.numLanes))
    }
  }, [fbData?.meta?.numLanes])

  // First time we connect: if there's already a schedule and this tab is a viewer,
  // land them on Heats instead of Setup.
  useEffect(() => {
    if (!fbData || initialViewApplied) return
    const hasSched = Array.isArray(fbData.schedule)
      ? fbData.schedule.length > 0
      : !!fbData.schedule
    const sk = fbData.meta?.scorekeeper
    const meIsScorekeeper = sk && sk === scorekeeperName
    if (hasSched && !meIsScorekeeper) {
      setView('race')
    }
    setInitialViewApplied(true)
  }, [fbData, initialViewApplied, scorekeeperName])

  const meta = fbData?.meta || {}
  const cars = Object.values(fbData?.cars || {}).sort((a, b) => a.order - b.order)
  const schedule = fbData?.schedule || []
  const results = fbData?.results || {}
  const defaultRaceName = `Derby · ${new Date(meta.created || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
  const raceName = (meta.raceName && meta.raceName.trim()) || defaultRaceName
  const numLanes = meta.numLanes || 4
  const runsPerCar = meta.runsPerCar || 4
  const numCars = meta.numCars ?? 8
  const phase = meta.phase || 'setup'
  const ended = phase === 'ended'
  const requirePasscode = !!meta.requirePasscode
  const passcode = meta.passcode || ''
  const singleScorekeeper = meta.scorekeeper || null

  // Bootstrap: free first claim if nobody has ever been a scorekeeper.
  // `meta.everHadScorekeeper` is a persistent flag so stepping down doesn't make the race look brand-new.
  const hasEverHadScorekeeper = !!meta.everHadScorekeeper || !!singleScorekeeper

  const iAmScorekeeper = !ended && !!scorekeeperName && singleScorekeeper === scorekeeperName
  const canEdit = iAmScorekeeper

  function setMeta(patch) { update(ref(db, `${dbPath}/meta`), patch) }

  function doAddCar() {
    const id = generateRaceId()
    const newCar = { id, name: `Car ${cars.length + 1}`, order: cars.length }
    const roster = [...cars, newCar]
    const obj = {}
    roster.forEach((c, i) => { obj[c.id] = { ...c, order: i } })
    set(ref(db, `${dbPath}/cars`), obj)
    // Rebuild schedule + clear results.
    const sched = buildSchedule(roster, runsPerCar, numLanes)
    set(ref(db, `${dbPath}/schedule`), sched)
    set(ref(db, `${dbPath}/results`), {})
    setMeta({ numCars: roster.length, phase: 'racing' })
  }

  function addCar() {
    if (hasAnyResults) setAddCarConfirm(true)
    else doAddCar()
  }

  function openRename(carId) {
    if (!canEdit) return
    const car = cars.find(c => c.id === carId)
    if (!car) return
    const defaultName = `Car ${(car.order ?? 0) + 1}`
    const isDefault = !car.name || car.name.trim() === defaultName
    setRenameCarId(carId)
    setRenameInput(isDefault ? '' : car.name)
  }

  function submitRename() {
    if (!renameCarId) return
    updateCarName(renameCarId, renameInput.trim())
    setRenameCarId(null)
    setRenameInput('')
  }
  function updateCarName(id, name) { set(ref(db, `${dbPath}/cars/${id}/name`), name) }

  function generateSchedule() {
    // Build car roster: keep existing cars by order, top up or trim to numCars.
    const existing = [...cars]
    const target = Math.max(2, numCars)
    let roster = existing.slice(0, target)
    while (roster.length < target) {
      const i = roster.length
      roster.push({ id: generateRaceId(), name: `Car ${i + 1}`, order: i })
    }
    const obj = {}
    roster.forEach((c, i) => { obj[c.id] = { ...c, order: i } })
    set(ref(db, `${dbPath}/cars`), obj)

    const sched = buildSchedule(roster, runsPerCar, numLanes)
    set(ref(db, `${dbPath}/schedule`), sched)
    set(ref(db, `${dbPath}/results`), {})
    setMeta({ phase: 'racing' })
    setView('race')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function openClaimModal() {
    setClaimNameInput(scorekeeperName || '')
    setClaimCodeInput('')
    setClaimError('')
    setClaimModal(true)
  }

  // Names that are not available for a new claimer / renamer.
  // Includes the current scorekeeper(s) and anyone who has ever stamped a result.
  function takenScorekeeperNames(excludeSelf = false) {
    const names = new Set()
    if (singleScorekeeper) names.add(singleScorekeeper.toLowerCase())
    Object.values(results).forEach(r => {
      if (r && r._by) names.add(String(r._by).toLowerCase())
    })
    if (excludeSelf && scorekeeperName) {
      names.delete(scorekeeperName.toLowerCase())
    }
    return names
  }

  function submitClaim() {
    const name = claimNameInput.trim()
    if (!name) { setClaimError('Name is required.'); return }
    if (takenScorekeeperNames().has(name.toLowerCase())) {
      setClaimError('That name is already in use for this race. Pick a different name.')
      return
    }
    // Passcode required only if set AND someone has already been a scorekeeper (bootstrap exemption).
    if (requirePasscode && hasEverHadScorekeeper) {
      const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (normalize(claimCodeInput) !== normalize(passcode)) {
        setClaimError('Incorrect passcode.')
        return
      }
    }
    setMeta({ scorekeeper: name, everHadScorekeeper: true })
    setScorekeeperName(name)
    localStorage.setItem(lsKey, name)
    setClaimModal(false)
  }

  function stepDown() {
    setStepDownConfirm(true)
  }

  function doStepDown() {
    setMeta({ scorekeeper: null })
    // Keep `scorekeeperName` in state + localStorage so we can pre-fill the
    // claim modal if they decide to come back. `iAmScorekeeper` already gates
    // edit access against the live Firebase slot, so retaining the name here
    // is safe.
  }

  function setResult(heatIdx, lane, pos) {
    if (!canEdit) return
    const cur = results[heatIdx] || {}
    // Strip audit fields; we'll rewrite them.
    const lanesObj = {}
    Object.keys(cur).forEach(l => {
      if (!isNaN(parseInt(l))) lanesObj[l] = cur[l]
    })

    const wasDnf = lanesObj[lane] === 'DNF'
    const becomingDnf = pos === 'DNF' && !wasDnf

    if (lanesObj[lane] === pos) {
      // Tapping the same value again clears it (toggle off).
      delete lanesObj[lane]
    } else {
      // Setting a numeric place: clear any other lane that had this place
      // (places are unique within a heat).
      if (typeof pos === 'number') {
        Object.keys(lanesObj).forEach(l => {
          if (lanesObj[l] === pos && parseInt(l) !== lane) delete lanesObj[l]
        })
      }
      lanesObj[lane] = pos
    }

    // If this DNF reduced the active field, compress any now-out-of-range
    // place values down so the place set stays {1..activeRacers}. Without
    // this, a stored place of "4" in a 3-active heat would render as no
    // selected button and score 0 points.
    const heat = schedule[heatIdx]
    if (becomingDnf && heat) {
      const dnfCount = Object.values(lanesObj).filter(v => v === 'DNF').length
      const activeRacers = heat.length - dnfCount
      // Repeatedly find the smallest place > activeRacers and pull it down
      // into the first vacant slot ≤ activeRacers. Loop until clean.
      let safety = heat.length + 1
      while (safety-- > 0) {
        const numericEntries = Object.entries(lanesObj)
          .filter(([, v]) => typeof v === 'number')
        const overflow = numericEntries
          .filter(([, v]) => v > activeRacers)
          .sort((a, b) => a[1] - b[1])
        if (overflow.length === 0) break
        const usedPlaces = new Set(numericEntries.map(([, v]) => v))
        let target = 0
        for (let p = 1; p <= activeRacers; p++) {
          if (!usedPlaces.has(p)) { target = p; break }
        }
        if (target === 0) {
          // No room — bump the first overflow down to activeRacers
          // (the next pass will continue collapsing).
          target = activeRacers
        }
        const [overflowLane] = overflow[0]
        lanesObj[overflowLane] = target
      }
    }

    set(ref(db, `${dbPath}/results/${heatIdx}`), {
      ...lanesObj,
      _by: scorekeeperName,
      _at: Date.now(),
    })
  }

  function exportXlsx() {
    const wb = XLSX.utils.book_new()
    const setupData = [['Car #', 'Name'], ...cars.map((c, i) => [i + 1, c.name])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(setupData), 'Setup')

    const heatsData = [['Heat', 'Lane', 'Car', 'Result']]
    schedule.forEach((heat, hi) => {
      heat.forEach(slot => {
        const car = cars.find(c => c.id === slot.carId)
        const r = results[hi]?.[slot.lane]
        heatsData.push([hi + 1, slot.lane + 1, car?.name || '?', r ?? ''])
      })
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(heatsData), 'Heats')

    const standings = calcStandings(cars, schedule, results)
    const standData = [
      ['Place', 'Car', 'Points', 'Races', '1sts', '2nds', '3rds', '4ths', 'DNFs'],
      ...standings.map(c => [
        c.place, c.name, c.points, c.races, c.firsts, c.seconds, c.thirds, c.fourths, c.dnfs,
      ]),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(standData), 'Standings')

    const fairData = [['Car', ...Array.from({ length: numLanes }, (_, i) => `Lane ${i + 1}`), 'Total']]
    cars.forEach(car => {
      const laneTotals = Array(numLanes).fill(0)
      schedule.forEach(heat => {
        heat.forEach(slot => {
          if (slot.carId === car.id) laneTotals[slot.lane]++
        })
      })
      fairData.push([car.name, ...laneTotals, laneTotals.reduce((a, b) => a + b, 0)])
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fairData), 'Lane Fairness')

    XLSX.writeFile(wb, `derby-${raceId}-${Date.now()}.xlsx`)
  }

  if (!connected) return (
    <div style={{ ...S.app, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: C.gold, fontSize: 22, fontFamily: '"Inter", system-ui, sans-serif', letterSpacing: '0.1em' }}>
        Connecting to race…
      </p>
    </div>
  )

  // Splash for brand-new races: no scorekeeper ever set, and this tab hasn't claimed yet.
  const showSplash = !ended && !hasEverHadScorekeeper && !iAmScorekeeper

  function submitSplash() {
    const name = splashName.trim()
    if (!name) return
    setMeta({ scorekeeper: name, everHadScorekeeper: true })
    setScorekeeperName(name)
    localStorage.setItem(lsKey, name)
    setSplashName('')
  }

  if (showSplash) return (
    <div style={{ ...S.app, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ ...S.modalDialog, maxWidth: 480 }}>
        <div style={{ textAlign: 'center', marginBottom: 12, fontSize: 56 }}>🏎️</div>
        <div style={{ ...S.modalTitle, textAlign: 'center', borderBottom: 'none', marginBottom: 8 }}>
          Welcome to your new race
        </div>
        <div style={{ fontSize: 14, color: C.inkDim, textAlign: 'center', marginBottom: 24, lineHeight: 1.5 }}>
          You're the scorekeeper. What's your name? It will be shown on results you record.
        </div>
        <input
          autoFocus
          style={S.modalInput}
          value={splashName}
          onChange={e => setSplashName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submitSplash()}
          placeholder="Your name"
        />
        <div style={{ ...S.modalActions, marginTop: 20 }}>
          <button
            style={{ ...S.modalConfirmBtn, opacity: splashName.trim() ? 1 : 0.4 }}
            disabled={!splashName.trim()}
            onClick={submitSplash}
          >
            Start race
          </button>
        </div>
      </div>
    </div>
  )

  const standings = calcStandings(cars, schedule, results)
  const completedHeats = schedule.filter((_, i) => {
    const r = results[i] || {}
    const laneKeys = Object.keys(r).filter(k => !k.startsWith('_'))
    return laneKeys.length >= (schedule[i]?.length || numLanes)
  }).length
  const completionPct = schedule.length > 0
    ? Math.round((completedHeats / schedule.length) * 100)
    : 0
  const hasSchedule = schedule.length > 0
  // Count individual lane results recorded (numbers + DNFs), excluding _by/_at audit fields.
  const recordedResultsCount = Object.values(results).reduce((sum, heatRes) => {
    if (!heatRes) return sum
    return sum + Object.entries(heatRes).filter(([k, v]) => !k.startsWith('_') && v != null).length
  }, 0)
  const hasAnyResults = recordedResultsCount > 0
  const totalHeats = numCars > 0 && numLanes > 0
    ? Math.ceil((numCars * runsPerCar) / numLanes)
    : 0
  const estMinutes = totalHeats * 3

  const syncStatus = connected ? 'live' : 'connecting'

  return (
    <div style={S.app}>
      <header style={{
        ...S.header,
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: isMobile ? 18 : 14,
        padding: isMobile ? '20px 16px 16px' : '24px 40px 20px',
      }}>
        {/* Row 1: brand back-link */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: isMobile ? 'center' : 'flex-start',
        }}>
          <a
            onClick={(e) => { e.preventDefault(); navigate('/') }}
            href="/"
            style={S.homeLink}
            title="Pinewood Derby — home"
          >
            <span style={S.homeLinkArrow} aria-hidden="true">←</span>
            <span style={S.homeLinkBrand}>Pinewood Derby</span>
          </a>
        </div>

        {/* Row 2: race name + share (left) and identity (right) on same horizontal line */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: isMobile ? 'center' : 'space-between',
          gap: isMobile ? 14 : 20,
          flexWrap: 'wrap',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? 10 : 14,
            flexWrap: 'wrap',
            justifyContent: isMobile ? 'center' : 'flex-start',
          }}>
            <h1 style={{ ...S.raceNameH1, ...(isMobile ? { fontSize: 22 } : {}) }}>{raceName}</h1>
            <button
              style={{ ...S.raceNameShareBtn, ...(isMobile ? { padding: '6px 10px', fontSize: 12 } : {}) }}
              onClick={() => setShareModal(true)}
              title="Share this race"
            >
              📤 Share
            </button>
          </div>
          <div style={S.identityGroup}>
            {iAmScorekeeper && (
              <button
                style={S.identityName}
                onClick={openRenameMe}
                title="Click to edit your name"
              >
                <span aria-hidden="true">👤</span>
                {scorekeeperName}
              </button>
            )}
            <span style={S.roleBadge(iAmScorekeeper ? 'scorekeeper' : 'viewer')}>
              {ended ? 'Race ended'
                : iAmScorekeeper ? 'Scorekeeper'
                  : 'Viewer'}
            </span>
            {!ended && iAmScorekeeper && (
              <button
                style={S.identityGroupBtn}
                onClick={stepDown}
                title="Switch to viewer"
              >
                Become a viewer
              </button>
            )}
            {!ended && !iAmScorekeeper && (
              <button style={S.identityGroupBtnPrimary} onClick={openClaimModal}>
                Become a Scorekeeper
              </button>
            )}
          </div>
        </div>
      </header>

      <nav style={{ ...S.tabStrip, ...(isMobile ? { padding: '0 8px' } : {}) }}>
        <button
          style={view === 'setup' ? S.tabBtnActive : S.tabBtn}
          onClick={() => setView('setup')}
        >Setup</button>
        {hasSchedule && (
          <>
            <button
              style={view === 'race' ? S.tabBtnActive : S.tabBtn}
              onClick={() => setView('race')}
            >Heats</button>
            <button
              style={view === 'cars' ? S.tabBtnActive : S.tabBtn}
              onClick={() => setView('cars')}
            >Cars</button>
            <button
              style={view === 'results' ? S.tabBtnActive : S.tabBtn}
              onClick={() => setView('results')}
            >Standings</button>
          </>
        )}
      </nav>

      {claimModal && (
        <div style={S.modalBackdrop} onClick={() => setClaimModal(false)}>
          <div style={S.modalDialog} onClick={e => e.stopPropagation()}>
            <div style={S.modalTitle}>Become a Scorekeeper</div>
            <div style={S.modalBody}>
              <label style={S.label}>Your name</label>
              <input
                autoFocus
                style={S.modalInput}
                value={claimNameInput}
                onChange={e => { setClaimNameInput(e.target.value); if (claimError) setClaimError('') }}
                onKeyDown={e => e.key === 'Enter' && submitClaim()}
                placeholder="e.g. Sarah"
              />
              {requirePasscode && hasEverHadScorekeeper && (
                <>
                  <label style={{ ...S.label, marginTop: 16 }}>Passcode</label>
                  <input
                    style={S.modalInput}
                    value={claimCodeInput}
                    onChange={e => setClaimCodeInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitClaim()}
                    placeholder="Ask the organizer"
                  />
                </>
              )}
              {requirePasscode && !hasEverHadScorekeeper && (
                <div style={{ ...S.hint, marginTop: 12 }}>
                  No passcode needed for the first scorekeeper. You'll set it up next.
                </div>
              )}
              {claimError && (
                <div style={{ marginTop: 12, color: C.red, fontWeight: 700, fontSize: 13 }}>
                  {claimError}
                </div>
              )}
            </div>
            <div style={S.modalActions}>
              <button style={S.modalCancelBtn} onClick={() => setClaimModal(false)}>
                Cancel
              </button>
              <button style={S.modalConfirmBtn} onClick={submitClaim}>
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {stepDownConfirm && (
        <div style={S.modalBackdrop} onClick={() => setStepDownConfirm(false)}>
          <div style={S.modalDialog} onClick={e => e.stopPropagation()}>
            <div style={S.modalTitle}>Become a viewer?</div>
            <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.5, marginBottom: 20 }}>
              {requirePasscode ? (
                <>
                  After you step down, anyone who wants to record results will need the passcode to claim the scorekeeper role.
                  <div style={{ marginTop: 12, padding: 12, background: 'rgba(253,185,19,0.12)', border: `1px solid ${C.gold}`, borderRadius: 2 }}>
                    <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.inkDim, fontWeight: 700, marginBottom: 4 }}>
                      Race passcode
                    </div>
                    <div style={{ fontSize: 18, fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontWeight: 700, color: C.navy }}>
                      {passcode || '—'}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: C.inkDim, lineHeight: 1.4 }}>
                      Make sure another helper still knows this, or that you can re-enter it yourself, before stepping down.
                    </div>
                  </div>
                </>
              ) : (
                <>
                  Anyone with the race link can claim the scorekeeper role. You can take it back any time by clicking "Become a Scorekeeper" again.
                </>
              )}
            </div>
            <div style={S.modalActions}>
              <button style={S.modalCancelBtn} onClick={() => setStepDownConfirm(false)}>
                Cancel — stay as scorekeeper
              </button>
              <button
                style={{ ...S.modalConfirmBtn, background: C.red, color: C.parchment, boxShadow: `0 2px 0 ${C.redDark}` }}
                onClick={() => { setStepDownConfirm(false); doStepDown() }}
              >
                Yes, become a viewer
              </button>
            </div>
          </div>
        </div>
      )}

      {regenConfirm && (
        <div style={S.modalBackdrop} onClick={() => setRegenConfirm(false)}>
          <div style={S.modalDialog} onClick={e => e.stopPropagation()}>
            <div style={S.modalTitle}>Regenerate the schedule?</div>
            <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.5, marginBottom: 20 }}>
              This race has <strong>{recordedResultsCount} recorded result{recordedResultsCount === 1 ? '' : 's'}</strong> across {schedule.length} heat{schedule.length === 1 ? '' : 's'}.
              <div style={{ marginTop: 12, padding: 12, background: 'rgba(168,50,42,0.08)', border: `1px solid ${C.red}`, borderRadius: 2 }}>
                <strong style={{ color: C.red }}>⚠ All recorded results will be erased.</strong>
                <div style={{ marginTop: 4, color: C.inkDim }}>
                  A new schedule will be built using your current settings: {numCars} car{numCars === 1 ? '' : 's'}, {numLanes} lane{numLanes === 1 ? '' : 's'}, {runsPerCar} runs per car. Existing car names are preserved.
                </div>
              </div>
            </div>
            <div style={S.modalActions}>
              <button style={S.modalCancelBtn} onClick={() => setRegenConfirm(false)}>
                Cancel — keep current results
              </button>
              <button
                style={{ ...S.modalConfirmBtn, background: C.red, color: C.parchment, boxShadow: `0 2px 0 ${C.redDark}` }}
                onClick={() => { setRegenConfirm(false); generateSchedule() }}
              >
                Proceed and erase results
              </button>
            </div>
          </div>
        </div>
      )}

      {addCarConfirm && (
        <div style={S.modalBackdrop} onClick={() => setAddCarConfirm(false)}>
          <div style={S.modalDialog} onClick={e => e.stopPropagation()}>
            <div style={S.modalTitle}>Add a car?</div>
            <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.5, marginBottom: 20 }}>
              Adding a car requires rebuilding the heat schedule. This race has <strong>{recordedResultsCount} recorded result{recordedResultsCount === 1 ? '' : 's'}</strong>.
              <div style={{ marginTop: 12, padding: 12, background: 'rgba(168,50,42,0.08)', border: `1px solid ${C.red}`, borderRadius: 2 }}>
                <strong style={{ color: C.red }}>⚠ All recorded results will be erased.</strong>
                <div style={{ marginTop: 4, color: C.inkDim }}>
                  A new schedule will be built. Existing car names are preserved.
                </div>
              </div>
            </div>
            <div style={S.modalActions}>
              <button style={S.modalCancelBtn} onClick={() => setAddCarConfirm(false)}>
                Cancel — keep current results
              </button>
              <button
                style={{ ...S.modalConfirmBtn, background: C.red, color: C.parchment, boxShadow: `0 2px 0 ${C.redDark}` }}
                onClick={() => { setAddCarConfirm(false); doAddCar() }}
              >
                Add car and erase results
              </button>
            </div>
          </div>
        </div>
      )}

      {shareModal && (
        <div style={S.modalBackdrop} onClick={() => setShareModal(false)}>
          <div style={{ ...S.modalDialog, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div style={S.modalTitle}>Share this race</div>
            <div style={{ fontSize: 14, color: C.inkDim, lineHeight: 1.5, marginBottom: 20 }}>
              Anyone who opens this link can follow along live. They can also become a scorekeeper{requirePasscode ? ' if they know the passcode' : ''}.
            </div>
            <div style={{
              display: 'flex', justifyContent: 'center', padding: 16,
              background: C.white, border: `2px solid ${C.navy}`, borderRadius: 2,
              marginBottom: 16,
            }}>
              <QRCodeSVG
                value={window.location.href}
                size={200}
                bgColor={C.white}
                fgColor={C.navy}
                level="M"
                includeMargin={false}
              />
            </div>
            <div style={{ fontSize: 12, color: C.inkLight, textAlign: 'center', marginBottom: 12 }}>
              Scan with a phone camera to open the race
            </div>
            <div
              onClick={copyShareLink}
              title="Click to copy"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: 10, marginBottom: 16, cursor: 'pointer',
                background: copied ? 'rgba(45,106,79,0.12)' : '#f0e6cf',
                border: `1px dashed ${copied ? C.green : C.parchmentEdge}`,
                borderRadius: 2,
                transition: 'background 0.15s, border-color 0.15s',
              }}
            >
              <div style={{
                flex: 1,
                fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 12,
                color: C.navy, wordBreak: 'break-all',
              }}>
                {window.location.href}
              </div>
              <div style={{
                flexShrink: 0, fontSize: 12, fontWeight: 700,
                fontFamily: '"Inter", system-ui, sans-serif',
                color: copied ? C.green : C.navy,
                letterSpacing: '0.01em',
              }}>
                {copied ? '✓ Copied' : 'Copy'}
              </div>
            </div>
            <div style={S.modalActions}>
              <button style={S.modalCancelBtn} onClick={() => setShareModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {renameMe && (
        <div style={S.modalBackdrop} onClick={() => setRenameMe(false)}>
          <div style={S.modalDialog} onClick={e => e.stopPropagation()}>
            <div style={S.modalTitle}>Edit your name</div>
            <div style={S.modalBody}>
              <label style={S.label}>Your name</label>
              <input
                autoFocus
                style={S.modalInput}
                value={renameMeInput}
                onChange={e => { setRenameMeInput(e.target.value); if (renameMeError) setRenameMeError('') }}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitRenameMe()
                  if (e.key === 'Escape') setRenameMe(false)
                }}
                placeholder="Your name"
              />
              {renameMeError && (
                <div style={{ marginTop: 12, color: C.red, fontWeight: 700, fontSize: 13 }}>
                  {renameMeError}
                </div>
              )}
              <div style={{ ...S.hint, marginTop: 8 }}>
                This is the name shown on results you record from now on.
              </div>
            </div>
            <div style={S.modalActions}>
              <button style={S.modalCancelBtn} onClick={() => setRenameMe(false)}>
                Cancel
              </button>
              <button style={S.modalConfirmBtn} onClick={submitRenameMe}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {renameCarId && (
        <div style={S.modalBackdrop} onClick={() => setRenameCarId(null)}>
          <div style={S.modalDialog} onClick={e => e.stopPropagation()}>
            <div style={S.modalTitle}>
              Rename Car {((cars.find(c => c.id === renameCarId)?.order) ?? 0) + 1}
            </div>
            <div style={S.modalBody}>
              <label style={S.label}>Owner's name</label>
              <input
                autoFocus
                style={S.modalInput}
                value={renameInput}
                onChange={e => setRenameInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitRename()
                  if (e.key === 'Escape') setRenameCarId(null)
                }}
                placeholder="Leave blank to keep the default name"
              />
              <div style={{ ...S.hint, marginTop: 8 }}>
                This name will appear on heat cards and the standings table.
              </div>
            </div>
            <div style={S.modalActions}>
              <button style={S.modalCancelBtn} onClick={() => setRenameCarId(null)}>
                Cancel
              </button>
              <button style={S.modalConfirmBtn} onClick={submitRename}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {view === 'setup' && !canEdit && (
        <main style={{ ...S.setup, ...(isMobile ? { padding: '0 12px', margin: '12px auto' } : {}) }}>
          <div style={{ ...S.card, textAlign: 'center', padding: '48px 32px' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
            <h2 style={{ ...S.h2, borderBottom: 'none', paddingBottom: 0, marginBottom: 8, color: C.navy }}>
              Setup is scorekeeper-only
            </h2>
            <div style={{ fontSize: 14, color: C.inkDim, lineHeight: 1.5, marginBottom: 24 }}>
              Only the scorekeeper can change race settings (lanes, cars, runs per car, or scorekeeping rules).
              {hasSchedule
                ? ' You can still view the heats, cars, and standings from the tabs above.'
                : ''}
            </div>
            {!ended && (
              <button style={S.modalConfirmBtn} onClick={openClaimModal}>
                Become a Scorekeeper
              </button>
            )}
            {hasSchedule && (
              <div style={{ marginTop: 16 }}>
                <button
                  style={{ ...S.navBtnGhost, color: C.navy, borderColor: C.navy }}
                  onClick={() => setView('race')}
                >
                  Go to Heats →
                </button>
              </div>
            )}
          </div>
        </main>
      )}

      {view === 'setup' && canEdit && (
        <main style={{ ...S.setup, ...(isMobile ? { padding: '0 12px', margin: '12px auto' } : {}) }}>
          <div style={{ ...S.setupGrid, ...(isMobile ? { gridTemplateColumns: '1fr', gap: 10 } : {}) }}>
            <div style={{ ...S.card, gridColumn: '1 / -1' }}>
              <label style={S.label}>Race name</label>
              <input
                type="text"
                value={meta.raceName || ''}
                disabled={!canEdit}
                onFocus={() => {
                  if ((meta.raceName || '').trim() === defaultRaceName) setMeta({ raceName: '' })
                  setRaceNameFocused(true)
                }}
                onBlur={() => setRaceNameFocused(false)}
                onChange={e => setMeta({ raceName: e.target.value })}
                placeholder={raceNameFocused ? '' : defaultRaceName}
                style={S.bigSelect}
              />
              <div style={S.hint}>Shown under the title and on the share screen. Leave blank to use “{defaultRaceName}”.</div>
            </div>

            <div style={S.card}>
              <label style={S.label}>Number of lanes</label>
              <input
                type="number"
                min="1"
                max="8"
                value={numLanesInput}
                disabled={!canEdit}
                onChange={e => {
                  const raw = e.target.value
                  setNumLanesInput(raw)
                  if (raw === '') return
                  const n = parseInt(raw)
                  if (!isNaN(n) && n >= 1 && n <= 8) setMeta({ numLanes: n })
                  else if (!isNaN(n) && n > 8) {
                    setMeta({ numLanes: 8 })
                    setNumLanesInput('8')
                  }
                }}
                onBlur={() => {
                  const n = parseInt(numLanesInput)
                  if (numLanesInput === '' || isNaN(n) || n < 1) {
                    setMeta({ numLanes: 1 })
                    setNumLanesInput('1')
                  } else if (n > 8) {
                    setMeta({ numLanes: 8 })
                    setNumLanesInput('8')
                  }
                }}
                style={S.bigSelect}
              />
              <div style={S.hint}>Cars that can race at once (max 8)</div>
            </div>

            <div style={S.card}>
              <label style={S.label}>Number of cars</label>
              <input
                type="number"
                min="0"
                max="200"
                value={numCarsInput}
                disabled={!canEdit}
                onChange={e => {
                  const raw = e.target.value
                  setNumCarsInput(raw)
                  if (raw === '') return
                  const n = parseInt(raw)
                  if (!isNaN(n) && n >= 0) setMeta({ numCars: n })
                }}
                onBlur={() => {
                  if (numCarsInput === '') {
                    setMeta({ numCars: 0 })
                    setNumCarsInput('0')
                  }
                }}
                style={S.bigSelect}
              />
              <div style={S.hint}>How many racers showed up — name them on the Cars tab after generating</div>
            </div>

            <div style={{ ...S.card, gridColumn: '1 / -1' }}>
              <label style={S.label}>Number of runs per car</label>
              <div style={{ ...S.presetGrid, ...(isMobile ? { gridTemplateColumns: 'repeat(2, 1fr)' } : {}) }}>
                {CONFIDENCE_PRESETS.map(p => (
                  <button
                    key={p.runs}
                    disabled={!canEdit}
                    onClick={() => setMeta({ runsPerCar: p.runs })}
                    style={{
                      ...S.preset,
                      ...(runsPerCar === p.runs ? S.presetActive : {}),
                      ...(!canEdit ? { cursor: 'not-allowed', opacity: 0.5 } : {}),
                    }}
                  >
                    <div style={S.presetRuns}>{p.runs}</div>
                    <div style={S.presetLabel}>{p.label}</div>
                    <div style={S.presetDesc}>{p.desc}</div>
                  </button>
                ))}
                {(() => {
                  const isCustom = !CONFIDENCE_PRESETS.some(p => p.runs === runsPerCar)
                  return (
                    <div
                      onClick={() => { if (canEdit) customRunsRef.current?.focus() }}
                      style={{
                        ...S.preset,
                        ...(isCustom ? S.presetActive : {}),
                        ...(!canEdit ? { cursor: 'not-allowed', opacity: 0.5 } : {}),
                      }}
                    >
                      <input
                        ref={customRunsRef}
                        type="number"
                        min="1"
                        max="20"
                        value={isCustom ? (customRunsInput || String(runsPerCar)) : customRunsInput}
                        disabled={!canEdit}
                        placeholder="#"
                        onFocus={e => e.target.select()}
                        onChange={e => {
                          const raw = e.target.value
                          setCustomRunsInput(raw)
                          if (raw === '') return
                          const n = parseInt(raw)
                          if (!isNaN(n) && n >= 1) setMeta({ runsPerCar: n })
                        }}
                        onBlur={() => {
                          if (customRunsInput === '' || parseInt(customRunsInput) < 1) {
                            setCustomRunsInput('')
                            setMeta({ runsPerCar: 1 })
                          }
                        }}
                        style={S.presetCustomInput}
                      />
                      <div style={S.presetLabel}>Custom</div>
                      <div style={S.presetDesc}>Type any number</div>
                    </div>
                  )
                })()}
              </div>
            </div>

            <div style={{ ...S.summary, ...(isMobile ? { padding: '10px 8px', gap: 6 } : {}) }}>
              <div style={S.summaryItem}>
                <div style={{ ...S.summaryNum, ...(isMobile ? { fontSize: 22 } : {}) }}>{totalHeats}</div>
                <div style={{ ...S.summaryLabel, ...(isMobile ? { fontSize: 10 } : {}) }}>Total heats</div>
              </div>
              <div style={S.summaryItem}>
                <div style={{ ...S.summaryNum, ...(isMobile ? { fontSize: 22 } : {}) }}>~{estMinutes}</div>
                <div style={{ ...S.summaryLabel, ...(isMobile ? { fontSize: 10 } : {}) }}>{isMobile ? 'Est. min.' : 'Estimated time (3 min. per run)'}</div>
              </div>
              <div style={{ ...S.summaryItem, borderRight: 'none' }}>
                <div style={{ ...S.summaryNum, ...(isMobile ? { fontSize: 22 } : {}) }}>{numCars * runsPerCar}</div>
                <div style={{ ...S.summaryLabel, ...(isMobile ? { fontSize: 10 } : {}) }}>Car-runs</div>
              </div>
            </div>

            <div style={{ ...S.card, gridColumn: '1 / -1' }}>
              <label style={S.label}>Require scorekeepers to input a passcode</label>
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  cursor: canEdit ? 'pointer' : 'not-allowed',
                  opacity: canEdit ? 1 : 0.6,
                }}
                onClick={() => canEdit && setMeta({ requirePasscode: !requirePasscode })}
              >
                <div style={{ ...S.toggleSwitch(requirePasscode), flexShrink: 0 }}>
                  <div style={S.toggleKnob(requirePasscode)} />
                </div>
                <span style={{
                  fontSize: 13, color: C.inkDim, lineHeight: 1.45,
                  fontFamily: '"Inter", system-ui, sans-serif',
                }}>
                  {requirePasscode
                    ? 'Only people who know the passcode can become a scorekeeper. Share the passcode with trusted helpers along with the race link.'
                    : 'Anyone who opens the race link can become a scorekeeper.'}
                </span>
              </div>
              {requirePasscode && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 12, marginLeft: 56, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={passcode}
                    disabled={!canEdit}
                    onChange={e => setMeta({ passcode: e.target.value })}
                    placeholder="e.g. derby"
                    style={{ ...S.modalInput, width: 240, flex: '0 0 auto' }}
                  />
                  {canEdit && (
                    <button
                      style={S.passcodeGenLink}
                      onClick={() => setMeta({ passcode: generatePasscode() })}
                    >Generate passcode</button>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={() => {
                if (hasSchedule && hasAnyResults) setRegenConfirm(true)
                else generateSchedule()
              }}
              style={{
                ...S.bigButton,
                ...(numCars < 2 || !canEdit ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
              }}
              disabled={numCars < 2 || !canEdit}
              title={!canEdit ? 'Only the scorekeeper can generate a schedule' : ''}
            >
              {!canEdit
                ? 'Read-only mode (take over scoring to edit)'
                : hasSchedule
                  ? 'Regenerate schedule →'
                  : 'Generate schedule →'}
            </button>
          </div>
        </main>
      )}

      {view === 'race' && hasSchedule && (
        <main style={{ ...S.raceMain, ...(isMobile ? { padding: '0 12px', margin: '12px auto' } : {}) }}>
          <div style={S.progressSticky}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  ...S.progressBar,
                  flex: 1,
                  ...(completionPct >= 100 ? { borderColor: C.green, cursor: 'pointer' } : {}),
                }}
                onClick={() => completionPct >= 100 && setView('results')}
                title={completionPct >= 100 ? 'See standings' : ''}
              >
                <div
                  style={{
                    ...S.progressFill,
                    width: `${completionPct}%`,
                    ...(completionPct >= 100 ? {
                      backgroundImage: `repeating-linear-gradient(45deg, ${C.green} 0, ${C.green} 8px, #1f4a37 8px, #1f4a37 16px)`,
                    } : {}),
                  }}
                />
                <div style={S.progressLabel}>
                  {completionPct >= 100
                    ? '🏆 All heats complete — See standings →'
                    : `${completedHeats} / ${schedule.length} heats · ${completionPct}%`}
                </div>
              </div>
              {iAmScorekeeper && (
                <button style={S.exportBtn} onClick={exportXlsx} title="Download .xlsx">
                  📥 Export .xlsx
                </button>
              )}
            </div>
          </div>

          <div style={{ ...S.heatList, ...(isMobile ? { gridTemplateColumns: '1fr', gap: 10 } : {}) }}>
            {schedule.map((heat, idx) => (
              <HeatCard
                key={idx}
                heat={heat}
                idx={idx}
                numLanes={numLanes}
                results={results}
                cars={cars}
                onUpdate={setResult}
                onRenameCar={openRename}
                readOnly={!canEdit}
                isMobile={isMobile}
              />
            ))}
          </div>
        </main>
      )}

      {view === 'cars' && hasSchedule && (
        <main style={{ ...S.setup, ...(isMobile ? { padding: '0 12px', margin: '12px auto' } : {}) }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h2 style={{ ...S.h2, margin: 0, borderBottom: 'none', paddingBottom: 0, ...(isMobile ? { fontSize: 22 } : {}) }}>Car owners</h2>
            {iAmScorekeeper && (
              <button style={S.exportBtn} onClick={exportXlsx} title="Download .xlsx">
                📥 Export .xlsx
              </button>
            )}
          </div>
          <div style={{ borderBottom: `3px double ${C.gold}`, marginBottom: 16, marginTop: 8 }} />
          <div style={S.carsCard}>
            {cars.length === 0 && (
              <div style={{ ...S.hint, marginTop: 0 }}>No cars yet.</div>
            )}
            {cars.map((car, i) => (
              <div key={car.id} style={S.carRow}>
                <span style={S.carNumBadge}>#{i + 1}</span>
                <CarNameInput
                  car={car}
                  order={i}
                  onChange={v => updateCarName(car.id, v)}
                  style={S.carNameInput}
                  disabled={!canEdit}
                />
              </div>
            ))}
          </div>
          {canEdit && (
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <button style={S.addCarLink} onClick={addCar}>+ Add a car</button>
            </div>
          )}
        </main>
      )}

      {view === 'race' && !hasSchedule && (
        <main style={{ ...S.setup, ...(isMobile ? { padding: '0 12px', margin: '12px auto' } : {}) }}>
          <div style={S.card}>
            <div style={{ fontFamily: '"Inter", system-ui, sans-serif', fontSize: 18, color: C.navy }}>
              No schedule yet. Head back to Setup to generate one.
            </div>
            <button style={{ ...S.bannerBtn, marginTop: 16 }} onClick={() => setView('setup')}>
              Go to Setup →
            </button>
          </div>
        </main>
      )}

      {view === 'results' && hasSchedule && (
        <main style={{ ...S.resultsMain, ...(isMobile ? { padding: '0 12px', margin: '12px auto' } : {}) }}>
          <div style={S.podiumWrap}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <h2 style={{ ...S.h2, margin: 0, borderBottom: 'none', paddingBottom: 0, ...(isMobile ? { fontSize: 22 } : {}) }}>Top 5</h2>
              {iAmScorekeeper && (
                <button style={S.exportBtn} onClick={exportXlsx} title="Download .xlsx">
                  📥 Export .xlsx
                </button>
              )}
            </div>
            <div style={{ borderBottom: `3px double ${C.gold}`, marginBottom: 16, marginTop: 8 }} />
            <div style={{ ...S.podium, ...(isMobile ? { gridTemplateColumns: '1fr 1fr', gap: 8 } : {}) }}>
              {standings.slice(0, 5).map((s, i) => {
                const carNum = (s.order ?? 0) + 1
                const trimmed = (s.name || '').trim()
                const isDefaultName = trimmed === '' || trimmed === `Car ${carNum}`
                const label = isDefaultName ? `Car ${carNum}` : `Car ${carNum}: ${trimmed}`
                return (
                <div key={s.id} style={{ ...S.podiumCard, ...(isMobile ? { padding: 12 } : {}), ...podiumStyles[i] }}>
                  <div style={{ ...S.podiumPlace, ...(isMobile ? { fontSize: 11, marginBottom: 4 } : {}) }}>{ordinalLabel(s.place)}</div>
                  <div
                    style={{
                      ...S.podiumCar,
                      ...(isMobile ? { fontSize: 18 } : {}),
                      cursor: canEdit ? 'pointer' : 'default',
                      opacity: isDefaultName ? 0.7 : 1,
                      fontStyle: isDefaultName ? 'italic' : 'normal',
                    }}
                    onDoubleClick={() => canEdit && openRename(s.id)}
                    title={canEdit ? 'Double-click to rename' : ''}
                  >{label}</div>
                  <div style={S.podiumPts}>{s.points} pts</div>
                  <div style={S.podiumDetail}>
                    {s.firsts} firsts, {s.seconds} seconds
                  </div>
                </div>
              )})}
            </div>
          </div>

          <div style={{ ...S.fullStandings, ...(isMobile ? { padding: 12 } : {}) }}>
            <h2 style={{ ...S.h2, ...(isMobile ? { fontSize: 22, marginBottom: 12 } : {}) }}>Full standings</h2>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Place</th>
                  <th style={S.th}>Car</th>
                  <th style={S.th}>Points</th>
                  <th style={S.th}>Races</th>
                  {!isMobile && <th style={S.th}>1sts</th>}
                  {!isMobile && <th style={S.th}>2nds</th>}
                  {!isMobile && <th style={S.th}>3rds</th>}
                  {!isMobile && <th style={S.th}>4ths</th>}
                  {!isMobile && <th style={S.th}>DNF</th>}
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => {
                  const carNum = (s.order ?? 0) + 1
                  const trimmed = (s.name || '').trim()
                  const isDefaultName = trimmed === '' || trimmed === `Car ${carNum}`
                  const label = isDefaultName ? `Car ${carNum}` : `Car ${carNum}: ${trimmed}`
                  return (
                  <tr key={s.id} style={i < 5 ? S.trTop : {}}>
                    <td style={S.td}>{s.place}</td>
                    <td style={S.td}>
                      <div
                        style={{
                          display: 'inline-block',
                          padding: '4px 10px',
                          border: `1px solid ${C.parchmentEdge}`,
                          borderRadius: 2,
                          color: C.navy,
                          fontFamily: '"Inter", system-ui, sans-serif',
                          fontWeight: 600,
                          fontSize: 14,
                          cursor: canEdit ? 'pointer' : 'default',
                          fontStyle: isDefaultName ? 'italic' : 'normal',
                          opacity: isDefaultName ? 0.7 : 1,
                        }}
                        onDoubleClick={() => canEdit && openRename(s.id)}
                        title={canEdit ? 'Double-click to rename' : ''}
                      >{label}</div>
                    </td>
                    <td style={S.td}><strong>{s.points}</strong></td>
                    <td style={S.td}>{s.races}</td>
                    {!isMobile && <td style={S.td}>{s.firsts}</td>}
                    {!isMobile && <td style={S.td}>{s.seconds}</td>}
                    {!isMobile && <td style={S.td}>{s.thirds}</td>}
                    {!isMobile && <td style={S.td}>{s.fourths}</td>}
                    {!isMobile && (
                      <td style={{
                        ...S.td,
                        color: s.dnfs > 0 ? C.red : C.inkLight,
                        fontWeight: s.dnfs > 0 ? 700 : 400,
                      }}>
                        {s.dnfs}
                      </td>
                    )}
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        </main>
      )}

    </div>
  )
}
