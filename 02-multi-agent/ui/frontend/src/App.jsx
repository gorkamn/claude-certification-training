import React, { useState } from 'react'
import { SCENARIOS } from './scenarios.js'
import MultiAgentScenarioView from './components/MultiAgentScenarioView.jsx'

export default function App() {
  const [activeScenario, setActiveScenario] = useState(null)

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Header onHome={() => setActiveScenario(null)} showBack={!!activeScenario} />
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {activeScenario
          ? <MultiAgentScenarioView scenario={activeScenario} onBack={() => setActiveScenario(null)} />
          : <ScenarioSelector onSelect={setActiveScenario} />}
      </main>
    </div>
  )
}

// ─── Header ────────────────────────────────────────────────────────────────────

function Header({ onHome, showBack }) {
  return (
    <header style={{
      background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border)',
      padding: '0 24px',
      height: 56,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {showBack && (
          <button
            onClick={onHome}
            style={{
              background: 'none', color: 'var(--text-secondary)',
              fontSize: 13, padding: '4px 8px', borderRadius: 'var(--radius-sm)',
              display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.15s',
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
              TechCo Multi-Agent Support
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -2 }}>
              Claude Certification Training — Multi-Agent Demo
            </div>
          </div>
        </div>
      </div>
      <div style={{
        fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        padding: '3px 10px', borderRadius: 20,
      }}>
        claude-sonnet-4-6
      </div>
    </header>
  )
}

// ─── Scenario selector ─────────────────────────────────────────────────────────

function ScenarioSelector({ onSelect }) {
  return (
    <div style={{
      height: '100%', overflow: 'auto',
      padding: '32px 24px', maxWidth: 900, margin: '0 auto',
    }}>
      <div className="fade-in" style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          Multi-Agent Scenarios
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
          Each scenario runs the hub-and-spoke coordinator with up to 3 parallel subagents.
          The animated flow diagram shows real-time agent orchestration.
          Track 2 shows the Claude Code CLI equivalents (skills, context:fork, allowed-tools).
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 16, marginBottom: 40,
      }}>
        {SCENARIOS.map((scenario, i) => (
          <ScenarioCard key={scenario.id} scenario={scenario} index={i} onClick={() => onSelect(scenario)} />
        ))}
      </div>

      <DomainLegend />
    </div>
  )
}

function ScenarioCard({ scenario, index, onClick }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      className="fade-in"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'var(--bg-card-hover)' : 'var(--bg-card)',
        border: `1px solid ${hovered ? 'var(--border-light)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)', padding: 20, textAlign: 'left',
        cursor: 'pointer', transition: 'all 0.15s ease',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: hovered ? 'var(--shadow)' : 'none',
        animationDelay: `${index * 80}ms`,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
          color: scenario.domainColor,
          background: `${scenario.domainColor}18`,
          border: `1px solid ${scenario.domainColor}30`,
          padding: '2px 8px', borderRadius: 20, fontFamily: 'var(--font-mono)',
        }}>
          {scenario.domain}
        </span>
        <span style={{
          color: 'var(--text-muted)', fontSize: 16, transition: 'transform 0.15s',
          transform: hovered ? 'translateX(3px)' : 'translateX(0)',
        }}>→</span>
      </div>
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
          {scenario.name}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {scenario.description}
        </p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {scenario.concepts.slice(0, 4).map(concept => (
          <span key={concept} style={{
            fontSize: 11, color: 'var(--text-muted)',
            background: 'var(--bg-base)', border: '1px solid var(--border)',
            padding: '2px 7px', borderRadius: 4,
          }}>
            {concept}
          </span>
        ))}
      </div>
    </button>
  )
}

function DomainLegend() {
  const domains = [
    { label: 'Domain 1', desc: 'Hub-and-spoke, parallel execution, context isolation', color: '#3b82f6' },
    { label: 'Domain 2', desc: 'Scoped tool distribution per subagent role', color: '#ef4444' },
    { label: 'Domain 3', desc: 'Claude Code skills, context:fork, CI/CD integration', color: '#10b981' },
    { label: 'Domain 5', desc: 'Structured error propagation, scratchpad', color: '#f59e0b' },
  ]
  return (
    <div style={{
      padding: 20, background: 'var(--bg-card)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 14, letterSpacing: '0.05em' }}>
        EXAM DOMAIN COVERAGE
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {domains.map(d => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ width: 3, height: 36, background: d.color, borderRadius: 2, flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{d.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{d.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
