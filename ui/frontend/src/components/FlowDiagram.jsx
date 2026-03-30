import React, { useState, useEffect, useRef } from 'react'

// ─── Layout constants ─────────────────────────────────────────────────────────
// SVG viewBox: 500 × 190
const COORD = { x: 150, y: 12, w: 200, h: 44, cx: 250, cy: 34, label: 'COORDINATOR', sub: 'hub · orchestrator' }

const SUBAGENTS = [
  { id: 'customer-verification', x: 10,  y: 120, w: 148, h: 44, cx: 84,  cy: 142, label: 'Customer',     sub: 'Verification' },
  { id: 'order-investigation',   x: 176, y: 120, w: 148, h: 44, cx: 250, cy: 142, label: 'Order',         sub: 'Investigation' },
  { id: 'resolution',            x: 342, y: 120, w: 148, h: 44, cx: 416, cy: 142, label: 'Resolution',    sub: '' },
]

// Arrow endpoints: coordinator bottom-center → subagent top-center
const ARROWS = SUBAGENTS.map(s => ({
  id: s.id,
  x1: COORD.cx, y1: COORD.y + COORD.h,
  x2: s.cx,     y2: s.y,
}))

// ─── Color maps ───────────────────────────────────────────────────────────────
const NODE_COLORS = {
  default:  { fill: '#1a1e2e', stroke: '#2a2f45', text: '#94a3b8', glow: false },
  active:   { fill: 'rgba(124,58,237,0.15)', stroke: '#7c3aed', text: '#e2e8f0', glow: true },
  complete: { fill: 'rgba(16,185,129,0.12)', stroke: '#10b981', text: '#10b981', glow: false },
  error:    { fill: 'rgba(239,68,68,0.12)',  stroke: '#ef4444', text: '#ef4444', glow: false },
}

const ARROW_COLORS = {
  default:  '#2a2f45',
  active:   '#7c3aed',
  complete: '#10b981',
  error:    '#ef4444',
}

const INITIAL_STATES = () => ({
  coordinator: 'default',
  'customer-verification': 'default',
  'order-investigation': 'default',
  'resolution': 'default',
})

const INITIAL_ARROW_STATES = () => ({
  'customer-verification': 'default',
  'order-investigation': 'default',
  'resolution': 'default',
})

// ─── Main component ───────────────────────────────────────────────────────────

export default function FlowDiagram({ state, result }) {
  const [nodeStates, setNodeStates] = useState(INITIAL_STATES)
  const [arrowStates, setArrowStates] = useState(INITIAL_ARROW_STATES)
  const timeoutsRef = useRef([])

  // Clear animation timeouts on unmount or re-run
  function clearTimeouts() {
    timeoutsRef.current.forEach(clearTimeout)
    timeoutsRef.current = []
  }

  // Reset when state goes back to idle/running (new run started)
  useEffect(() => {
    if (state === 'idle') {
      clearTimeouts()
      setNodeStates(INITIAL_STATES())
      setArrowStates(INITIAL_ARROW_STATES())
    } else if (state === 'running') {
      clearTimeouts()
      setNodeStates({ ...INITIAL_STATES(), coordinator: 'active' })
      setArrowStates(INITIAL_ARROW_STATES())
    }
  }, [state])

  // Animate through trace when result arrives
  useEffect(() => {
    if (!result?.trace?.length) return
    clearTimeouts()

    const trace = result.trace
    const STEP_MS = 700

    trace.forEach((step, idx) => {
      const tid = setTimeout(() => {
        const { actor, action } = step
        setNodeStates(prev => {
          const next = { ...prev }
          if (actor === 'coordinator') {
            if (action === 'decompose') next.coordinator = 'active'
            else if (action === 'synthesize') next.coordinator = 'complete'
          } else {
            if (action === 'start')    next[actor] = 'active'
            if (action === 'complete') next[actor] = 'complete'
            if (action === 'error')    next[actor] = 'error'
          }
          return next
        })
        // Arrow activates when subagent starts
        if (action === 'start') {
          setArrowStates(prev => ({ ...prev, [actor]: 'active' }))
        }
        if (action === 'complete') {
          setArrowStates(prev => ({ ...prev, [actor]: 'complete' }))
        }
        if (action === 'error') {
          setArrowStates(prev => ({ ...prev, [actor]: 'error' }))
        }
      }, idx * STEP_MS)
      timeoutsRef.current.push(tid)
    })

    return clearTimeouts
  }, [result])

  return (
    <div style={{ padding: '12px 16px 8px', flexShrink: 0 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
        color: 'var(--text-muted)', marginBottom: 8,
      }}>
        AGENT FLOW DIAGRAM
      </div>

      <svg
        viewBox="0 0 500 190"
        style={{ width: '100%', maxHeight: 160, overflow: 'visible' }}
        aria-label="Multi-agent flow diagram"
      >
        {/* Arrow marker definitions */}
        <defs>
          {Object.entries(ARROW_COLORS).map(([state, color]) => (
            <marker
              key={state}
              id={`arrowhead-${state}`}
              markerWidth="8" markerHeight="6"
              refX="7" refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill={color} />
            </marker>
          ))}
        </defs>

        {/* Arrows */}
        {ARROWS.map(arrow => {
          const aState = arrowStates[arrow.id]
          const color = ARROW_COLORS[aState]
          const isAnimating = aState === 'active'
          return (
            <line
              key={arrow.id}
              x1={arrow.x1} y1={arrow.y1}
              x2={arrow.x2} y2={arrow.y2}
              stroke={color}
              strokeWidth={aState === 'default' ? 1.5 : 2}
              strokeDasharray={isAnimating ? '200' : 'none'}
              strokeDashoffset={isAnimating ? '0' : undefined}
              markerEnd={`url(#arrowhead-${aState})`}
              style={isAnimating ? { animation: 'drawLine 0.5s ease forwards' } : undefined}
              opacity={aState === 'default' ? 0.5 : 1}
            />
          )
        })}

        {/* Coordinator node */}
        <FlowNode node={COORD} nodeState={nodeStates.coordinator} isCoord />

        {/* Subagent nodes */}
        {SUBAGENTS.map(s => (
          <FlowNode key={s.id} node={s} nodeState={nodeStates[s.id]} />
        ))}
      </svg>

      {/* Legend */}
      <Legend nodeStates={nodeStates} />
    </div>
  )
}

// ─── FlowNode ─────────────────────────────────────────────────────────────────

function FlowNode({ node, nodeState, isCoord }) {
  const c = NODE_COLORS[nodeState] || NODE_COLORS.default
  const rx = isCoord ? 8 : 6

  return (
    <g style={c.glow ? { animation: 'nodeGlow 1.2s ease-in-out infinite' } : undefined}>
      <rect
        x={node.x} y={node.y}
        width={node.w} height={node.h}
        rx={rx} ry={rx}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={nodeState === 'default' ? 1 : 1.5}
      />
      {/* Status icon for non-default states */}
      {nodeState === 'complete' && (
        <text x={node.cx - 30} y={node.cy - 6} textAnchor="middle" fontSize="10" fill={c.text}>✓</text>
      )}
      {nodeState === 'error' && (
        <text x={node.cx - 30} y={node.cy - 6} textAnchor="middle" fontSize="10" fill={c.text}>✗</text>
      )}
      {nodeState === 'active' && (
        <text x={node.cx - 30} y={node.cy - 6} textAnchor="middle" fontSize="10" fill={c.text}>⟳</text>
      )}
      {/* Main label */}
      <text
        x={node.cx} y={node.cy - (node.sub ? 4 : 0)}
        textAnchor="middle"
        fontSize={isCoord ? 11 : 10}
        fontWeight="700"
        fill={c.text}
        fontFamily="'Inter', sans-serif"
        letterSpacing="0.04em"
      >
        {node.label}
      </text>
      {/* Sub-label */}
      {node.sub && (
        <text
          x={node.cx} y={node.cy + 11}
          textAnchor="middle"
          fontSize="9"
          fill={c.text}
          fontFamily="'Inter', sans-serif"
          opacity={nodeState === 'default' ? 0.6 : 0.8}
        >
          {node.sub}
        </text>
      )}
    </g>
  )
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend({ nodeStates }) {
  const active  = Object.values(nodeStates).filter(s => s === 'active').length
  const complete = Object.values(nodeStates).filter(s => s === 'complete').length
  const error   = Object.values(nodeStates).filter(s => s === 'error').length

  if (active === 0 && complete === 0 && error === 0) return null

  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
      {active > 0 && <LegendDot color="var(--accent)" label={`${active} running`} />}
      {complete > 0 && <LegendDot color="var(--green)" label={`${complete} complete`} />}
      {error > 0 && <LegendDot color="var(--red)" label={`${error} failed`} />}
    </div>
  )
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}
