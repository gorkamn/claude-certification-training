import React, { useState } from 'react'
import { SCENARIOS } from '../scenarios.js'

export default function ScenarioSelector({ onSelect }) {
  return (
    <div style={{
      height: '100%',
      overflow: 'auto',
      padding: '32px 24px',
      maxWidth: 980,
      margin: '0 auto',
    }}>
      <div className="fade-in" style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          Choose a Scenario
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
          Each scenario exercises a specific exam domain. Select one to run it live against the Claude API
          and see the conversation side-by-side with the relevant code.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}>
        {SCENARIOS.map((scenario, i) => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            index={i}
            onClick={() => onSelect(scenario)}
          />
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
        borderRadius: 'var(--radius-lg)',
        padding: 20,
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        boxShadow: hovered ? 'var(--shadow)' : 'none',
        animationDelay: `${index * 60}ms`,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Domain badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: scenario.domainColor,
          background: `${scenario.domainColor}18`,
          border: `1px solid ${scenario.domainColor}30`,
          padding: '2px 8px',
          borderRadius: 20,
          fontFamily: 'var(--font-mono)',
        }}>
          {scenario.domain}
        </span>
        <span style={{
          color: 'var(--text-muted)',
          fontSize: 16,
          transition: 'transform 0.15s',
          transform: hovered ? 'translateX(3px)' : 'translateX(0)',
        }}>→</span>
      </div>

      {/* Title */}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
          {scenario.name}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {scenario.description}
        </p>
      </div>

      {/* Concepts */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {scenario.concepts.slice(0, 3).map(concept => (
          <span key={concept} style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            padding: '2px 7px',
            borderRadius: 4,
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
    { label: 'Domain 1', desc: 'Agentic loops, hooks, multi-concern', color: '#3b82f6' },
    { label: 'Domain 2', desc: 'Tool design & error handling', color: '#ef4444' },
    { label: 'Domain 4', desc: 'Structured extraction & few-shot', color: '#a855f7' },
    { label: 'Domain 5', desc: 'Context management & escalation', color: '#f59e0b' },
  ]

  return (
    <div style={{
      marginTop: 40,
      padding: 20,
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 14, letterSpacing: '0.05em' }}>
        EXAM DOMAIN COVERAGE
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {domains.map(d => (
          <div key={d.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{
              width: 3, height: 36, background: d.color,
              borderRadius: 2, flexShrink: 0, marginTop: 2,
            }} />
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
