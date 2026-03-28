import React, { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

const theme = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...vscDarkPlus['pre[class*="language-"]'],
    background: 'transparent',
    margin: 0,
    padding: '14px 16px',
    fontSize: '12px',
    lineHeight: '1.7',
  },
  'code[class*="language-"]': {
    ...vscDarkPlus['code[class*="language-"]'],
    background: 'transparent',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
  },
}

export default function CodePanel({ scenario, result }) {
  const [activeTab, setActiveTab] = useState(0)

  const tabs = scenario.codeTabs || []
  if (!tabs.length) return null

  const activeFile = tabs[activeTab]
  const lineColors = buildLineColors(activeFile.highlights || [])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        background: 'var(--bg-base)',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto',
        flexShrink: 0,
      }}>
        {tabs.map((tab, i) => (
          <TabButton
            key={tab.name}
            label={tab.name}
            active={activeTab === i}
            onClick={() => setActiveTab(i)}
          />
        ))}
      </div>

      {/* Explanation panel */}
      {activeFile.explanation?.length > 0 && (
        <ExplanationPanel points={activeFile.explanation} />
      )}

      {/* Code viewer */}
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg-panel)' }}>
        <SyntaxHighlighter
          language={activeFile.language}
          style={theme}
          showLineNumbers
          wrapLines
          lineProps={(lineNumber) => {
            const color = lineColors[lineNumber]
            return color
              ? {
                  style: {
                    display: 'block',
                    background: color,
                    borderLeft: `3px solid ${brighten(color)}`,
                    marginLeft: '-16px',
                    paddingLeft: '13px',
                    marginRight: '-16px',
                    paddingRight: '16px',
                  },
                }
              : { style: { display: 'block' } }
          }}
          lineNumberStyle={{
            color: 'var(--text-muted)',
            fontSize: 11,
            paddingRight: 16,
            userSelect: 'none',
            minWidth: 36,
          }}
          wrapLongLines={false}
        >
          {activeFile.content.trim()}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}

function buildLineColors(highlights) {
  const map = {}
  for (const h of highlights) {
    for (let ln = h.start; ln <= h.end; ln++) {
      map[ln] = h.color
    }
  }
  return map
}

function brighten(rgba) {
  return rgba.replace(/[\d.]+\)$/, (match) => {
    const alpha = parseFloat(match)
    return `${Math.min(alpha * 4, 0.9)})`
  })
}

function ExplanationPanel({ points }) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div style={{
      background: 'var(--bg-card)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
      maxHeight: collapsed ? 40 : 320,
      overflow: 'hidden',
      transition: 'max-height 0.25s ease',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          background: 'none', width: '100%', padding: '8px 14px',
          display: 'flex', alignItems: 'center', gap: 8,
          cursor: 'pointer',
          borderBottom: collapsed ? 'none' : '1px solid var(--border)',
          flexShrink: 0, color: 'var(--text-secondary)',
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          WHY IT'S BUILT THIS WAY
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {collapsed ? '▲ show' : '▼ hide'}
        </span>
      </button>

      {!collapsed && (
        <div style={{ overflowY: 'auto', padding: '10px 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {points.map((point, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{
                width: 3, minHeight: 40, borderRadius: 2,
                background: point.color, flexShrink: 0, marginTop: 2,
                boxShadow: `0 0 6px ${point.color}`,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ marginBottom: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                    color: point.color, background: `${point.color}18`,
                    border: `1px solid ${point.color}40`,
                    padding: '1px 7px', borderRadius: 4, fontFamily: 'var(--font-mono)',
                  }}>
                    {point.badge}
                  </span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, lineHeight: 1.4 }}>
                  {point.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                  {point.body}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TabButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none', padding: '8px 14px',
        fontSize: 12, fontFamily: 'var(--font-mono)',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        borderRadius: 0, whiteSpace: 'nowrap', transition: 'color 0.15s',
        display: 'flex', alignItems: 'center', gap: 6,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-muted)' }}
    >
      <span style={{ fontSize: 11, opacity: 0.6 }}>🐍</span>
      {label}
    </button>
  )
}
