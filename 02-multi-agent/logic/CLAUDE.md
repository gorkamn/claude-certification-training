# TechCo Multi-Agent Support — Project Configuration

## Project Overview
This is the TechCo Multi-Agent Support project — a multi-agent coordinator/subagent
pattern built on the Claude Agent SDK. It handles customers with multiple simultaneous
concerns by decomposing requests and delegating to specialized subagents in parallel.

Compare with: `../../01-agent-loop/logic/` (single-agent version of the same problem)

## Exam Concept Coverage
- Task 1.2: Hub-and-spoke coordinator pattern
- Task 1.3: Spawning subagents via Task tool (simulated as spawn_subagent)
- Task 2.3: Scoped tool distribution per subagent role
- Task 5.3: Structured error propagation from subagents
- Task 5.4: Scratchpad integration for coordinator synthesis

## Architecture

### Python SDK (Track 1)
```
agent/coordinator.py        — run_coordinator(), SPAWN_SUBAGENT_TOOL, ThreadPoolExecutor
agent/subagents.py          — AgentDefinition, SubagentResult, run_subagent()
agent/agent_loop.py         — run_agent_loop() shared by coordinator and subagents
agent/hooks.py              — PreToolUse/PostToolUse hooks (same as customer-support-agent)
mcp_server/tools/           — 4 tools: get_customer, lookup_order, process_refund, escalate_to_human
context/scratchpad.py       — threading.Lock added for parallel subagent writes
```

### Claude Code CLI (Track 2)
```
.claude/skills/multi-agent-coordinator/SKILL.md   — coordinator skill (allowed-tools: Task)
.claude/skills/customer-verification/SKILL.md     — subagent (allowed-tools: get_customer)
.claude/skills/order-investigation/SKILL.md       — subagent (allowed-tools: lookup_order)
.claude/skills/resolution/SKILL.md                — subagent (allowed-tools: process_refund, escalate)
```

## Key Architecture Rules

### Context Isolation (CRITICAL)
Subagents do NOT inherit coordinator context. All facts must be passed explicitly.
This is the core exam concept for Task 1.2 and 1.3.

### Tool Scope (Task 2.3)
- customer_verification_agent → ONLY get_customer
- order_investigation_agent → ONLY lookup_order
- resolution_agent → ONLY process_refund + escalate_to_human
Never give a subagent tools it doesn't need — degrades tool selection reliability.

### Error Handling (Task 5.3)
Subagent failures return SubagentResult(success=False, error_context={...}).
Coordinator checks is_retryable before deciding to retry or proceed.
Never let one failed subagent crash the whole coordinator loop.

### Parallel vs Sequential (Task 1.3)
- Customer verification: ALWAYS sequential first (need customer ID before anything)
- Independent order lookups: PARALLEL (emit multiple spawn_subagent calls in one response)
- Resolution actions: depend on investigation results, so sequential after investigation

## Testing Conventions
@import .claude/rules/testing.md

## Running the Demo

### Track 1 (Python SDK)
```bash
python demo.py
```

### Track 2 (Claude Code CLI)
```bash
claude
/multi-agent-coordinator Hi, I'm Alice Johnson (alice@example.com). I have three issues:
1) ORD-1001 arrived damaged - refund please.
2) ORD-1002 in transit 2 weeks - status check.
3) Competitor selling 4K Monitor $50 cheaper - price match?
```
