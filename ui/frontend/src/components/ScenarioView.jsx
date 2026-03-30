import React, { useState, useCallback } from 'react'
import FlowDiagram from './FlowDiagram.jsx'
import ConversationPanel from './ConversationPanel.jsx'
import CodePanel from './CodePanel.jsx'
import ConfigPanel from './ConfigPanel.jsx'

export default function ScenarioView({ scenario, onBack }) {
  const isMultiAgent = scenario.type === 'multi-agent'

  const [state, setState] = useState('idle') // idle | running | done | error
  const [result, setResult] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [track, setTrack] = useState(0) // 0 = Track 1 (Python SDK), 1 = Track 2 (Claude Code CLI)

  const runScenario = useCallback(async () => {
    setState('running')
    setResult(null)
    setErrorMsg('')

    const apiBase = isMultiAgent
      ? (import.meta.env.VITE_MULTI_AGENT_API_URL || '/api-multi')
      : (import.meta.env.VITE_SINGLE_AGENT_API_URL || '/api-single')

    try {
      const res = await fetch(apiBase, {
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
  }, [scenario.id, isMultiAgent])

  const conversationLabel = isMultiAgent ? 'Coordinator Conversation' : 'Conversation'
  const gridCols = isMultiAgent ? '2fr 3fr' : '1fr 1fr'

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
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: gridCols,
        overflow: 'hidden',
      }}>
        {/* Left: [FlowDiagram if multi-agent] + Conversation */}
        <div style={{
          borderRight: '1px solid var(--border)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {isMultiAgent && (
            <div style={{
              background: 'var(--bg-panel)',
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
            }}>
              <FlowDiagram state={state} result={result} />
            </div>
          )}

          <PanelHeader label={conversationLabel} icon="💬" />
          <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
            <ConversationPanel
              state={state}
              result={result}
              errorMsg={errorMsg}
              scenario={scenario}
            />
          </div>
        </div>

        {/* Right: Track switcher + code/config panel */}
        <div style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <TrackTabs track={track} onTrack={setTrack} />
          <div style={{ flex: 1, overflow: 'auto' }}>
            {track === 0
              ? <CodePanel scenario={scenario} result={result} />
              : <ConfigPanel scenario={scenario} />
            }
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

function TrackTabs({ track, onTrack }) {
  const tabs = [
    { label: 'Track 1', sub: 'Python SDK', icon: '🐍' },
    { label: 'Track 2', sub: 'Claude Code CLI', icon: '⚙' },
  ]
  return (
    <div style={{
      display: 'flex',
      background: 'var(--bg-panel)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      {tabs.map((t, i) => {
        const active = track === i
        return (
          <button
            key={t.label}
            onClick={() => onTrack(i)}
            style={{
              flex: 1,
              background: active ? 'var(--bg-card)' : 'none',
              borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
              borderRight: i === 0 ? '1px solid var(--border)' : 'none',
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 600,
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>
              <span style={{ fontSize: 13 }}>{t.icon}</span>
              {t.label}
            </div>
            <div style={{ fontSize: 10, color: active ? 'var(--accent)' : 'var(--text-muted)', letterSpacing: '0.03em' }}>
              {t.sub}
            </div>
          </button>
        )
      })}
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
      onMouseLeave={e => { if (!isRunning) e.currentTarget.style.background = isRunning ? 'var(--bg-card)' : 'var(--accent)' }}
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
