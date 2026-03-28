import React, { useState, useCallback } from 'react'
import ConversationPanel from './ConversationPanel.jsx'
import CodePanel from './CodePanel.jsx'

export default function ScenarioView({ scenario, onBack }) {
  const [state, setState] = useState('idle') // idle | running | done | error
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

  const runScenario = useCallback(async () => {
    setState('running')
    setResult(null)
    setErrorMsg('')

    try {
      const res = await fetch('/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: scenario.id }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      setResult(data)
      setState('done')
    } catch (err) {
      setErrorMsg(err.message)
      setState('error')
    }
  }, [scenario.id])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Scenario header bar */}
      <div style={{
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border)',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexShrink: 0,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: scenario.domainColor,
              background: `${scenario.domainColor}18`,
              border: `1px solid ${scenario.domainColor}30`,
              padding: '2px 8px',
              borderRadius: 20,
              fontFamily: 'var(--font-mono)',
            }}>
              {scenario.domain}
            </span>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              {scenario.name}
            </h2>
          </div>
          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {scenario.concepts.map(c => (
              <span key={c} style={{
                fontSize: 11, color: 'var(--text-muted)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                padding: '1px 7px', borderRadius: 4,
              }}>{c}</span>
            ))}
          </div>
        </div>

        <RunButton state={state} onClick={runScenario} />
      </div>

      {/* Split panel body */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden' }}>
        {/* Left: Conversation */}
        <div style={{
          borderRight: '1px solid var(--border)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <PanelHeader label="Conversation" icon="💬" />
          <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
            <ConversationPanel
              state={state}
              result={result}
              errorMsg={errorMsg}
              scenario={scenario}
            />
          </div>
        </div>

        {/* Right: Code */}
        <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <PanelHeader label="Code" icon="⌨" />
          <div style={{ flex: 1, overflow: 'auto' }}>
            <CodePanel scenario={scenario} result={result} />
          </div>
        </div>
      </div>
    </div>
  )
}

function PanelHeader({ label, icon }) {
  return (
    <div style={{
      padding: '8px 16px',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexShrink: 0,
      background: 'var(--bg-panel)',
    }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>
        {label.toUpperCase()}
      </span>
    </div>
  )
}

function RunButton({ state, onClick }) {
  const isRunning = state === 'running'

  return (
    <button
      onClick={onClick}
      disabled={isRunning}
      style={{
        background: isRunning ? 'var(--bg-card)' : 'var(--accent)',
        color: isRunning ? 'var(--text-secondary)' : '#fff',
        border: isRunning ? '1px solid var(--border)' : 'none',
        borderRadius: 'var(--radius)',
        padding: '8px 20px',
        fontSize: 13,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        cursor: isRunning ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={e => { if (!isRunning) e.currentTarget.style.background = 'var(--accent-hover)' }}
      onMouseLeave={e => { if (!isRunning) e.currentTarget.style.background = 'var(--accent)' }}
    >
      {isRunning ? (
        <><span className="spinner" style={{ width: 14, height: 14 }} /> Running…</>
      ) : state === 'done' ? (
        <>↺ Run Again</>
      ) : (
        <>▶ Run Scenario</>
      )}
    </button>
  )
}
