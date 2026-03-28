import React from 'react'

export default function ConversationPanel({ state, result, errorMsg, scenario }) {
  if (state === 'idle') {
    return <IdleState scenario={scenario} />
  }

  if (state === 'running') {
    return <RunningState />
  }

  if (state === 'error') {
    return <ErrorState message={errorMsg} />
  }

  if (!result) return null

  const { messages = [], events = [], iterations } = result
  const turns = buildTurns(messages, events)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <StatsBar iterations={iterations} events={events} />
      {turns.map((turn, i) => (
        <TurnBlock key={i} turn={turn} index={i} />
      ))}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildTurns(messages, events) {
  // Build enriched turns from message history + events log
  const turns = []
  const hookEvents = (events || []).filter(e => e.type === 'hook_blocked')

  for (const msg of messages) {
    const content = msg.content
    if (msg.role === 'user') {
      if (typeof content === 'string') {
        turns.push({ type: 'user', text: content })
      } else if (Array.isArray(content)) {
        // Could be tool results or the initial user message
        const toolResults = content.filter(b => b.type === 'tool_result')
        if (toolResults.length) {
          turns.push({ type: 'tool_results', results: toolResults, hookEvents })
        }
      }
    } else if (msg.role === 'assistant') {
      if (Array.isArray(content)) {
        const textBlocks = content.filter(b => b.type === 'text')
        const toolCalls = content.filter(b => b.type === 'tool_use')
        if (textBlocks.length || toolCalls.length) {
          turns.push({ type: 'assistant', textBlocks, toolCalls })
        }
      }
    }
  }
  return turns
}

// ─── Turn blocks ──────────────────────────────────────────────────────────────

function TurnBlock({ turn, index }) {
  const style = { animation: `fadeIn 0.3s ease ${index * 80}ms both` }

  if (turn.type === 'user') {
    return (
      <div style={style}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, justifyContent: 'flex-end' }}>
          <div style={{
            background: 'var(--blue-bg)',
            border: '1px solid rgba(59,130,246,0.25)',
            borderRadius: '12px 12px 2px 12px',
            padding: '10px 14px',
            maxWidth: '85%',
            fontSize: 13,
            color: 'var(--text-primary)',
            lineHeight: 1.6,
          }}>
            {turn.text}
          </div>
          <Avatar label="You" color="#3b82f6" />
        </div>
      </div>
    )
  }

  if (turn.type === 'assistant') {
    return (
      <div style={style}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <Avatar label="AI" color="var(--accent)" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {turn.toolCalls.map(tc => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}
            {turn.textBlocks.map((b, i) => (
              <div key={i} style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: '2px 12px 12px 12px',
                padding: '10px 14px',
                fontSize: 13,
                color: 'var(--text-primary)',
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
              }}>
                {b.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (turn.type === 'tool_results') {
    return (
      <div style={style}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 36 }}>
          {turn.results.map((r, i) => {
            const isBlocked = r._hook_blocked
            return (
              <ToolResultCard key={i} result={r} isBlocked={isBlocked} />
            )
          })}
        </div>
      </div>
    )
  }

  return null
}

function ToolCallCard({ toolCall }) {
  const [expanded, setExpanded] = React.useState(false)
  const inputStr = JSON.stringify(toolCall.input, null, 2)

  return (
    <div style={{
      background: 'var(--bg-base)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          background: 'none',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          color: 'var(--text-primary)',
        }}
      >
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--accent)',
          background: 'var(--accent-light)',
          border: '1px solid rgba(124,58,237,0.3)',
          padding: '1px 6px',
          borderRadius: 4,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.05em',
        }}>
          TOOL CALL
        </span>
        <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
          {toolCall.name}
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>
      {expanded && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '10px 12px',
          background: 'var(--bg-panel)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre',
          overflow: 'auto',
          maxHeight: 200,
        }}>
          {inputStr}
        </div>
      )}
    </div>
  )
}

function ToolResultCard({ result, isBlocked }) {
  const [expanded, setExpanded] = React.useState(false)
  const isError = result.is_error
  const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
  const preview = content.length > 80 ? content.slice(0, 80) + '…' : content

  const color = isBlocked ? 'var(--amber)' : isError ? 'var(--red)' : 'var(--green)'
  const bgColor = isBlocked ? 'var(--amber-bg)' : isError ? 'var(--red-bg)' : 'var(--green-bg)'
  const label = isBlocked ? 'HOOK BLOCKED' : isError ? 'ERROR' : 'RESULT'

  return (
    <div style={{
      background: 'var(--bg-base)',
      border: `1px solid ${isBlocked ? 'rgba(245,158,11,0.25)' : isError ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          background: 'none',
          padding: '7px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          color: 'var(--text-secondary)',
        }}
      >
        <span style={{
          fontSize: 10, fontWeight: 700, color,
          background: bgColor,
          padding: '1px 6px', borderRadius: 4,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.05em',
          flexShrink: 0,
        }}>
          {label}
        </span>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {expanded ? '' : preview}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>
      {expanded && (
        <div style={{
          borderTop: `1px solid ${isError ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)'}`,
          padding: '10px 12px',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          overflow: 'auto',
          maxHeight: 240,
        }}>
          {content}
        </div>
      )}
    </div>
  )
}

// ─── Supporting UI ────────────────────────────────────────────────────────────

function Avatar({ label, color }) {
  return (
    <div style={{
      width: 28, height: 28,
      borderRadius: '50%',
      background: `${color}22`,
      border: `1px solid ${color}44`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, fontWeight: 700, color,
      flexShrink: 0,
      fontFamily: 'var(--font-mono)',
    }}>
      {label}
    </div>
  )
}

function StatsBar({ iterations, events }) {
  const toolCalls = (events || []).filter(e => e.type === 'tool_call').length
  const hookBlocks = (events || []).filter(e => e.type === 'hook_blocked').length

  return (
    <div style={{
      display: 'flex',
      gap: 12,
      padding: '8px 12px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      marginBottom: 4,
    }}>
      <Stat label="Iterations" value={iterations} color="var(--accent)" />
      <Stat label="Tool Calls" value={toolCalls} color="var(--blue)" />
      {hookBlocks > 0 && <Stat label="Hook Blocks" value={hookBlocks} color="var(--amber)" />}
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 16, fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>
        {value}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

function IdleState({ scenario }) {
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      padding: 32,
      textAlign: 'center',
    }}>
      <div style={{
        width: 56, height: 56,
        borderRadius: '50%',
        background: `${scenario.domainColor}15`,
        border: `1px solid ${scenario.domainColor}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24,
      }}>▶</div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
          Ready to run
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 260 }}>
          Click <strong style={{ color: 'var(--text-primary)' }}>Run Scenario</strong> to execute
          this scenario live against the Claude API. The full conversation will appear here.
        </div>
      </div>
    </div>
  )
}

function RunningState() {
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      padding: 32,
    }}>
      <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
          Agent running…
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Calling Claude API · executing tools · awaiting end_turn
        </div>
      </div>
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div style={{
      margin: '16px 0',
      padding: 16,
      background: 'var(--red-bg)',
      border: '1px solid rgba(239,68,68,0.3)',
      borderRadius: 10,
      fontSize: 13,
    }}>
      <div style={{ fontWeight: 600, color: 'var(--red)', marginBottom: 6 }}>Error running scenario</div>
      <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
        {message}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
        Make sure VITE_API_URL is set and the Lambda is deployed with a valid ANTHROPIC_API_KEY.
      </div>
    </div>
  )
}
