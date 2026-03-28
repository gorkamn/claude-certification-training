import React, { useState } from 'react'
import ScenarioSelector from './components/ScenarioSelector.jsx'
import ScenarioView from './components/ScenarioView.jsx'

export default function App() {
  const [activeScenario, setActiveScenario] = useState(null)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Header onHome={() => setActiveScenario(null)} showBack={!!activeScenario} />
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {activeScenario
          ? <ScenarioView scenario={activeScenario} onBack={() => setActiveScenario(null)} />
          : <ScenarioSelector onSelect={setActiveScenario} />}
      </main>
    </div>
  )
}

function Header({ onHome, showBack }) {
  return (
    <header style={{
      background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border)',
      padding: '0 24px',
      height: 56,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {showBack && (
          <button
            onClick={onHome}
            style={{
              background: 'none',
              color: 'var(--text-secondary)',
              fontSize: 13,
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
          >
            ← All Scenarios
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'linear-gradient(135deg, var(--accent), #a855f7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14,
          }}>✦</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
              TechCo Support Agent
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -2 }}>
              Claude Certification Training Demo
            </div>
          </div>
        </div>
      </div>
      <div style={{
        fontSize: 11,
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        padding: '3px 10px',
        borderRadius: 20,
      }}>
        claude-sonnet-4-6
      </div>
    </header>
  )
}
