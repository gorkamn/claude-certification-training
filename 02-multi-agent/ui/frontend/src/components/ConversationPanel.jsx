import React from 'react'

export default function ConversationPanel({ state, result, errorMsg, scenario }) {
  if (state === 'idle') return <IdleState scenario={scenario} />
  if (state === 'running') return <RunningState />
  if (state === 'error') return <ErrorState message={errorMsg} />
  if (!result) return null

  const { messages = [], subagent_results = {}, trace = [] } = result

  const spawned = countSpawned(messages)
  const successCount = Object.values(subagent_results).filter(r => r.success).length
  const failCount = Object.values(subagent_results).filter(r => !r.success).length

  const turns = buildTurns(messages)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <StatsBar spawned={spawned} success={successCount} fail={failCount} steps={trace.length} />
      {turns.map((turn, i) => (
        <TurnBlock key={i} turn={turn} index={i} />
      ))}
      {Object.keys(subagent_results).length > 0 && (
        <SubagentResultsSection results={subagent_results} />
      )}
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function countSpawned(messages) {
  let count = 0
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      count += msg.content.filter(b => b.type === 'tool_use' && b.name === 'spawn_subagent').length
    }
  }
  return count
}

function buildTurns(messages) {
  const turns = []
  for (const msg of messages) {
    const content = msg.content
    if (msg.role === 'user') {
      if (typeof content === 'string') {
        turns.push({ type: 'user', text: content })
      } else if (Array.isArray(content)) {
        const toolResults = content.filter(b => b.type === 'tool_result')
        if (toolResults.length) {
          turns.push({ type: 'subagent_returns', results: toolResults })
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

// ─── Turn blocks ───────────────────────────────────────────────────────────────

function TurnBlock({ turn, index }) {
  const style = { animation: `fadeIn 0.3s ease ${index * 60}ms both` }

  if (turn.type === 'user') {
    return (
      <div style={style}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, justifyContent: 'flex-end' }}>
          <div style={{
            background: 'var(--blue-bg)',
            border: '1px solid rgba(59,130,246,0.25)',
            borderRadius: '12px 12px 2px 12px',
            padding: '9px 13px',
            maxWidth: '90%',
            fontSize: 12,
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
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <Avatar label="AI" color="var(--accent)" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {turn.toolCalls.map(tc => (
              <SpawnCard key={tc.id} toolCall={tc} />
            ))}
            {turn.textBlocks.map((b, i) => (
              <div key={i} style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: '2px 12px 12px 12px',
                padding: '9px 13px',
                fontSize: 12,
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

  if (turn.type === 'subagent_returns') {
    return (
      <div style={style}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, paddingLeft: 32 }}>
          {turn.results.map((r, i) => (
            <SubagentReturnCard key={i} result={r} />
          ))}
        </div>
      </div>
    )
  }

  return null
}

// ─── Spawn card (coordinator → subagent delegation) ───────────────────────────

function SpawnCard({ toolCall }) {
  const [expanded, setExpanded] = React.useState(false)
  const agentType = toolCall.input?.agent_type || 'unknown'
  const taskPrompt = toolCall.input?.task_prompt || ''
  const preview = taskPrompt.length > 70 ? taskPrompt.slice(0, 70) + '…' : taskPrompt

  // Map agent type to display name
  const displayName = {
    customer_verification_agent: 'customer-verification',
    order_investigation_agent: 'order-investigation',
    resolution_agent: 'resolution',
  }[agentType] || agentType

  return (
    <div style={{
      background: 'var(--bg-base)',
      border: '1px solid rgba(124,58,237,0.3)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%', background: 'none',
          padding: '7px 11px',
          display: 'flex', alignItems: 'center', gap: 8,
          cursor: 'pointer', color: 'var(--text-primary)',
        }}
      >
        <span style={{
          fontSize: 9, fontWeight: 700, color: 'var(--accent)',
          background: 'var(--accent-light)',
          border: '1px solid rgba(124,58,237,0.3)',
          padding: '1px 6px', borderRadius: 4,
          fontFamily: 'var(--font-mono)', letterSpacing: '0.05em',
          flexShrink: 0,
        }}>
          SPAWN
        </span>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--accent)' }}>
          {displayName}
        </span>
        {!expanded && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {preview}
          </span>
        )}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>
      {expanded && (
        <div style={{
          borderTop: '1px solid rgba(124,58,237,0.2)',
          padding: '8px 11px',
          background: 'var(--bg-panel)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          overflow: 'auto',
          maxHeight: 180,
        }}>
          <div style={{ marginBottom: 6, color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>TASK</div>
          <div style={{ marginBottom: 10 }}>{toolCall.input?.task_prompt}</div>
          {toolCall.input?.context_data && Object.keys(toolCall.input.context_data).length > 0 && (
            <>
              <div style={{ marginBottom: 4, color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>CONTEXT_DATA</div>
              {Object.entries(toolCall.input.context_data).map(([k, v]) => (
                <div key={k}><span style={{ color: 'var(--accent)' }}>{k}:</span> {String(v)}</div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Subagent return card ─────────────────────────────────────────────────────

function SubagentReturnCard({ result }) {
  const [expanded, setExpanded] = React.useState(false)
  const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
  const isSuccess = content.includes('SUCCESS')
  const isFailed = content.includes('FAILED')

  const color = isFailed ? 'var(--red)' : 'var(--green)'
  const bgColor = isFailed ? 'var(--red-bg)' : 'var(--green-bg)'
  const borderColor = isFailed ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'
  const label = isFailed ? 'FAILED' : 'SUCCESS'
  const preview = content.length > 80 ? content.slice(0, 80) + '…' : content

  return (
    <div style={{
      background: 'var(--bg-base)',
      border: `1px solid ${borderColor}`,
      borderRadius: 8, overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%', background: 'none',
          padding: '6px 11px',
          display: 'flex', alignItems: 'center', gap: 8,
          cursor: 'pointer', color: 'var(--text-secondary)',
        }}
      >
        <span style={{
          fontSize: 9, fontWeight: 700, color, background: bgColor,
          padding: '1px 6px', borderRadius: 4,
          fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', flexShrink: 0,
        }}>
          {label}
        </span>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {expanded ? '' : preview}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>
      {expanded && (
        <div style={{
          borderTop: `1px solid ${borderColor}`,
          padding: '8px 11px',
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 200,
        }}>
          {content}
        </div>
      )}
    </div>
  )
}

// ─── Subagent results section (after conversation) ────────────────────────────

function SubagentResultsSection({ results }) {
  const [open, setOpen] = React.useState(true)
  const entries = Object.entries(results)

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      overflow: 'hidden',
      marginTop: 4,
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', background: 'none', padding: '8px 12px',
          display: 'flex', alignItems: 'center', gap: 8,
          cursor: 'pointer', fontSize: 11, fontWeight: 700,
          color: 'var(--text-secondary)', letterSpacing: '0.05em',
        }}
      >
        SUBAGENT RESULTS
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 10 }}>
          {open ? '▼' : '▲'}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries.map(([actor, res]) => (
            <SubagentResultDetail key={actor} actor={actor} res={res} />
          ))}
        </div>
      )}
    </div>
  )
}

function SubagentResultDetail({ actor, res }) {
  const [open, setOpen] = React.useState(false)
  const color = res.success ? 'var(--green)' : 'var(--red)'
  const bg = res.success ? 'var(--green-bg)' : 'var(--red-bg)'

  return (
    <div style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', background: 'none', padding: '7px 10px',
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
        }}
      >
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: color, flexShrink: 0,
        }} />
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', flex: 1, textAlign: 'left' }}>
          {actor}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 700, color, background: bg,
          padding: '1px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)',
          letterSpacing: '0.05em', flexShrink: 0,
        }}>
          {res.success ? 'SUCCESS' : 'FAILED'}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          borderTop: '1px solid var(--border)', padding: '8px 10px',
          fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}>
          {res.findings}
        </div>
      )}
    </div>
  )
}

// ─── Supporting UI ────────────────────────────────────────────────────────────

function Avatar({ label, color }) {
  return (
    <div style={{
      width: 26, height: 26, borderRadius: '50%',
      background: `${color}22`, border: `1px solid ${color}44`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 9, fontWeight: 700, color,
      flexShrink: 0, fontFamily: 'var(--font-mono)',
    }}>
      {label}
    </div>
  )
}

function StatsBar({ spawned, success, fail, steps }) {
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '7px 11px',
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 8, marginBottom: 2,
    }}>
      <Stat label="Subagents" value={spawned} color="var(--accent)" />
      {success > 0 && <Stat label="Succeeded" value={success} color="var(--green)" />}
      {fail > 0 && <Stat label="Failed" value={fail} color="var(--red)" />}
      <Stat label="Trace steps" value={steps} color="var(--text-secondary)" />
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color, fontFamily: 'var(--font-mono)' }}>{value}</span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

function IdleState({ scenario }) {
  return (
    <div style={{
      height: '100%', minHeight: 120,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: 24, textAlign: 'center',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: '50%',
        background: `${scenario.domainColor}15`,
        border: `1px solid ${scenario.domainColor}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
      }}>▶</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          Ready to run
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: 220 }}>
          Hit <strong style={{ color: 'var(--text-primary)' }}>Run Scenario</strong> to execute live.
          The coordinator conversation will appear here.
        </div>
      </div>
    </div>
  )
}

function RunningState() {
  return (
    <div style={{
      minHeight: 120,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: 24,
    }}>
      <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
          Coordinator running…
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          Spawning subagents · parallel execution · synthesizing
        </div>
      </div>
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div style={{
      margin: '12px 0', padding: 14,
      background: 'var(--red-bg)',
      border: '1px solid rgba(239,68,68,0.3)',
      borderRadius: 10, fontSize: 12,
    }}>
      <div style={{ fontWeight: 600, color: 'var(--red)', marginBottom: 4 }}>Error running scenario</div>
      <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
        {message}
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
        Ensure the Lambda is deployed with a valid ANTHROPIC_API_KEY.
      </div>
    </div>
  )
}
