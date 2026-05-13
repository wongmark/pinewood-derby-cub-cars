import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from './firebase'
import { ref, set } from 'firebase/database'

const defaultRaceName = () => `Derby · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`

export default function LandingPage() {
  const [loading, setLoading] = useState(false)
  const [raceName, setRaceName] = useState('')
  const navigate = useNavigate()
  const placeholder = defaultRaceName()

  async function startRace() {
    setLoading(true)
    const id = crypto.randomUUID()
    const trimmed = raceName.trim()
    await set(ref(db, `races/${id}/meta`), {
      created: Date.now(),
      phase: 'setup',
      raceName: trimmed || placeholder,
    })
    navigate(`/r/${id}`)
  }

  const features = [
    {
      icon: '🆓',
      title: 'Free, no signup',
      body: 'No accounts, no credit cards, no trials. Just open the page and start a race.',
    },
    {
      icon: '🔗',
      title: 'Your race has its own URL',
      body: 'Every race lives at a private link. Bookmark it, close the tab, come back tomorrow — your heats and results are still there.',
    },
    {
      icon: '📱',
      title: 'Parents follow along live',
      body: 'Share the link in your group chat. Anyone with the URL sees heats and standings update in real time on their phone.',
    },
    {
      icon: '👥',
      title: 'Tag-team scorekeeping',
      body: 'Hand off scorekeeping between volunteers mid-race with an optional passcode. Every result is stamped with who recorded it.',
    },
    {
      icon: '🎯',
      title: 'Tune speed vs. confidence',
      body: 'Pick how many runs each car gets — fewer for a quick night, more for tighter standings. We schedule lanes fairly either way.',
    },
    {
      icon: '📥',
      title: 'Download the results',
      body: 'Export the schedule, heat-by-heat results, standings, and lane-fairness check as a single .xlsx for your records.',
    },
  ]

  return (
    <div style={{
      minHeight: '100vh', background: '#1a2744',
      fontFamily: '"Inter", system-ui, sans-serif', color: '#f5e6c8',
    }}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '60px 20px 40px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 64, marginBottom: 8 }}>🏎️</div>
        <h1 style={{ fontSize: 42, margin: '0 0 8px', color: '#ffd700', letterSpacing: 2 }}>
          PINEWOOD DERBY
        </h1>
        <p style={{ fontSize: 18, marginBottom: 32, opacity: 0.75 }}>
          Fair heats. Live scoring. Multi-device sync.
        </p>
        <div style={{ width: '100%', maxWidth: 420, marginBottom: 20, textAlign: 'left' }}>
          <label style={{
            display: 'block', fontSize: 11, letterSpacing: '0.15em',
            textTransform: 'uppercase', color: '#c9b78a', marginBottom: 8, fontWeight: 600,
          }}>
            Race name
          </label>
          <input
            autoFocus
            value={raceName}
            onChange={e => setRaceName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !loading) startRace() }}
            placeholder={placeholder}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: '#0f1a30', border: '2px solid #ffd700', color: '#f5e6c8',
              padding: '12px 14px', fontSize: 16,
              fontFamily: '"Inter", system-ui, sans-serif', borderRadius: 4,
            }}
          />
          <p style={{ marginTop: 8, fontSize: 12, opacity: 0.55 }}>
            Leave blank to use “{placeholder}”. You can rename it later in Setup.
          </p>
        </div>
        <button
          onClick={startRace}
          disabled={loading}
          style={{
            background: '#ffd700', color: '#1a2744', border: 'none',
            padding: '16px 40px', fontSize: 22, fontFamily: '"Inter", system-ui, sans-serif',
            fontWeight: 700, borderRadius: 8, cursor: 'pointer',
            letterSpacing: 1, opacity: loading ? 0.6 : 1,
            boxShadow: '0 4px 0 #b89400',
          }}
        >
          {loading ? 'Starting…' : '🚀 Start a New Race'}
        </button>
        <p style={{ marginTop: 24, fontSize: 13, opacity: 0.45 }}>
          Each race gets its own private URL you can share with scorekeepers.
        </p>
      </div>

      <section style={{
        maxWidth: 920, margin: '0 auto', padding: '32px 20px 64px',
      }}>
        <div style={{
          textAlign: 'center', marginBottom: 32,
          borderTop: '1px solid rgba(255,215,0,0.25)', paddingTop: 40,
        }}>
          <div style={{
            fontSize: 11, letterSpacing: '0.25em', color: '#ffd700',
            textTransform: 'uppercase', fontWeight: 700, marginBottom: 10,
          }}>
            Built for pack volunteers
          </div>
          <h2 style={{
            fontSize: 28, margin: '0 0 10px', color: '#f5e6c8',
            fontWeight: 700, letterSpacing: '0.01em',
          }}>
            Everything you need to run race night.
          </h2>
          <p style={{ fontSize: 15, opacity: 0.7, maxWidth: 580, margin: '0 auto', lineHeight: 1.55 }}>
            Generate a fair schedule, score heats from any phone or tablet, and let every parent follow along — no apps to install, no fees, no logins.
          </p>
        </div>

        <div style={{
          display: 'grid', gap: 16,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}>
          {features.map(f => (
            <div
              key={f.title}
              style={{
                background: '#0f1a30',
                border: '1px solid rgba(255,215,0,0.35)',
                borderRadius: 8, padding: '20px 18px',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8, lineHeight: 1 }} aria-hidden="true">{f.icon}</div>
              <div style={{
                fontSize: 15, fontWeight: 700, color: '#ffd700',
                marginBottom: 6, letterSpacing: '0.01em',
              }}>
                {f.title}
              </div>
              <div style={{ fontSize: 13.5, color: '#d6c89a', lineHeight: 1.5 }}>
                {f.body}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          textAlign: 'center', marginTop: 40, paddingTop: 28,
          borderTop: '1px solid rgba(255,215,0,0.18)',
        }}>
          <p style={{
            fontSize: 13, color: '#d6c89a', lineHeight: 1.6,
            maxWidth: 540, margin: '0 auto 12px',
          }}>
            Open source and free forever. Remix it for your pack, troop, colony, or unit.
          </p>
          <p style={{ fontSize: 13, margin: '0 0 12px' }}>
            <a
              href="https://github.com/wongmark/pinewood-derby-cub-cars"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#ffd700', fontWeight: 700, textDecoration: 'underline',
                textDecorationStyle: 'dotted', textUnderlineOffset: 3,
                letterSpacing: '0.02em',
              }}
            >
              View source on GitHub →
            </a>
          </p>
          <p style={{
            fontSize: 11, color: '#c9b78a', opacity: 0.6,
            letterSpacing: '0.05em', margin: 0,
          }}>
            Licensed under{' '}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#c9b78a', textDecoration: 'underline' }}
            >
              AGPL-3.0-or-later
            </a>
            {' '}· No accounts · No tracking · Just a clean race night
          </p>
        </div>
      </section>
    </div>
  )
}
