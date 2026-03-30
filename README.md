# Claude Certification Study Guide — TechCo Support Agent Demo

An interactive study companion for the **Anthropic Claude Certification** exam. Run live scenarios against the Claude API and see the exact code, configuration, and exam concepts behind each one — with inline annotations explaining what the API is doing and why it matters for the exam.

## How to Use This as a Study Tool

The app covers all five exam domains through a fictional **TechCo customer support agent**. Each scenario:

1. **Runs live** — click "Run Scenario" to execute against the Claude API and see real output
2. **Shows the code** — the Code panel displays the exact implementation with highlighted exam concepts
3. **Explains the concepts** — annotations call out what each pattern demonstrates and why it matters
4. **Covers both tracks** — Track 1 shows the Python SDK implementation; Track 2 shows the equivalent Claude Code CLI configuration

Start with Domain 1 (agent loop) and work through the domains in order, or jump directly to the domain you're preparing for using the domain badges on the scenario cards.

---

## Exam Domain Coverage

### Domain 1 — Agentic Systems

| Scenario | What it demonstrates |
|----------|---------------------|
| Standard Refund | `stop_reason`-based loop termination — how the agent loop knows when to stop vs. continue tool calls |
| Large Refund | Pre/post-tool hooks — deterministic enforcement before and after tool execution |
| Multi-Concern Request | Decomposing a single user message into multiple concerns and handling them in sequence |
| Multi-Agent Parallel | Hub-and-spoke coordinator dispatching parallel subagents; context isolation per subagent |

Key files: `01-agent-loop/logic/agent/agent_loop.py`, `01-agent-loop/logic/agent/hooks.py`, `02-multi-agent/logic/agent/coordinator.py`

### Domain 2 — Tool Design

| Scenario | What it demonstrates |
|----------|---------------------|
| Standard Refund | Tool description best practices — boundary clarity, what the tool does vs. doesn't do |
| Large Refund | Structured error responses with `errorCategory` and `isRetryable` fields |
| Standard Refund | `verified_customer_id` as a programmatic prerequisite — enforcing call order without instructions |
| Multi-Agent Parallel | Scoped tool distribution — each subagent receives only the tools it needs for its role |

Key files: `*/logic/mcp_server/tools/get_customer.py`, `*/logic/mcp_server/tools/lookup_order.py`, `02-multi-agent/logic/agent/subagents.py`

### Domain 3 — Claude Code CLI

Every scenario includes a **Track 2** tab showing the Claude Code CLI equivalent. This covers:

- `CLAUDE.md` configuration hierarchy — project-level, imported rules, path-specific rules
- `@import` directives and rule composition
- Skills and slash commands with `context: fork` and `allowed-tools`
- `claude --print` in CI for automated code review (see `.github/workflows/ci.yml`)

Key files: `*/logic/CLAUDE.md`, `*/logic/.claude/rules/`, `*/logic/.claude/skills/`, `*/logic/.claude/commands/`

### Domain 4 — Structured Extraction

| Scenario | What it demonstrates |
|----------|---------------------|
| Structured Extraction | `tool_choice: "any"` for guaranteed tool use; nullable fields for optional data; validation-retry loops with specific error feedback |

Key file: `01-agent-loop/logic/extraction/case_extractor.py`

### Domain 5 — Context Management & Escalation

| Scenario | What it demonstrates |
|----------|---------------------|
| Explicit Escalation | Explicit escalation triggers vs. sentiment-based escalation; self-contained handoff summaries |
| Single-Issue Refund | Case facts injection; context management for long conversations |

Key files: `01-agent-loop/logic/context/`, `01-agent-loop/logic/prompts/`

---

## Quick Reference: Key Exam Concepts

| Concept | File |
|---------|------|
| `stop_reason`-based loop termination | `01-agent-loop/logic/agent/agent_loop.py` |
| Pre/post-tool hooks (deterministic enforcement) | `01-agent-loop/logic/agent/hooks.py` |
| Structured error responses (`errorCategory`, `isRetryable`) | `*/logic/mcp_server/tools/` |
| Tool description best practices + boundary clarity | `*/logic/mcp_server/tools/get_customer.py` |
| `verified_customer_id` as programmatic prerequisite | `*/logic/mcp_server/tools/lookup_order.py` |
| Hub-and-spoke coordinator + parallel subagents | `02-multi-agent/logic/agent/coordinator.py` |
| Context isolation (fresh messages list per subagent) | `02-multi-agent/logic/agent/subagents.py` |
| Scoped tool distribution per subagent role | `02-multi-agent/logic/agent/subagents.py` |
| `tool_choice: "any"` + nullable fields + retry loop | `01-agent-loop/logic/extraction/case_extractor.py` |
| `CLAUDE.md` hierarchy + `@import` + path-specific rules | `*/logic/CLAUDE.md`, `*/logic/.claude/rules/` |
| Skills, slash commands, `context: fork`, `allowed-tools` | `*/logic/.claude/skills/`, `*/logic/.claude/commands/` |
| `claude --print` in CI | `.github/workflows/ci.yml` |

---

## Repo Structure

```
01-agent-loop/
├── logic/              # Single-agent Python SDK implementation
│   ├── agent/          # agent_loop.py, hooks.py
│   ├── extraction/     # Structured case extraction (Domain 4)
│   ├── mcp_server/     # MCP tools: get_customer, lookup_order, process_refund, escalate_to_human
│   ├── context/        # Case facts + scratchpad (Domain 5)
│   ├── prompts/        # System prompt builder
│   ├── CLAUDE.md       # Project-level Claude Code config (Domain 3)
│   └── demo.py         # Terminal entry point
└── ui/
    └── backend/        # FastAPI Lambda handler for single-agent scenarios

02-multi-agent/
├── logic/              # Multi-agent coordinator/subagent implementation
│   ├── agent/          # coordinator.py, subagents.py, agent_loop.py, hooks.py
│   ├── mcp_server/     # Same 4 MCP tools (shared design)
│   ├── context/        # Scratchpad with threading.Lock for parallel writes
│   ├── CLAUDE.md       # Multi-agent project config (Domain 3)
│   └── demo.py         # Terminal entry point
└── ui/
    └── backend/        # FastAPI Lambda handler for multi-agent scenarios

ui/
├── frontend/           # Unified React app (Vite, port 5173)
│   └── src/
│       ├── scenarios.js          # All 7 scenarios — code, highlights, explanations
│       └── components/
│           ├── ScenarioSelector  # Landing page with domain legend
│           ├── ScenarioView      # Unified layout (FlowDiagram shown for multi-agent)
│           ├── ConversationPanel # Renders single-agent or multi-agent result shape
│           ├── CodePanel         # Syntax-highlighted code with exam annotations
│           ├── ConfigPanel       # Track 2 (Claude Code CLI) config files
│           └── FlowDiagram       # Animated coordinator → subagent flow (multi-agent only)
├── edge-signer/        # Lambda@Edge: SigV4-signs browser POSTs to Lambda Function URL
├── template.yaml       # SAM template — single-agent stack
├── template-multi.yaml # SAM template — multi-agent stack
├── samconfig.toml      # SAM config — single-agent and multi-agent environments
└── DEPLOYMENT.md       # Full AWS deployment guide

.github/workflows/
├── ci.yml              # Python lint/test + frontend build + Claude Code review (Domain 3 demo)
└── deploy.yml          # SAM deploy pipeline (manual trigger)
```

---

## Running the App Locally

### Frontend only (no API key needed)

```bash
cd ui/frontend
npm install
npm run dev
# → http://localhost:5173
```

The UI works without a backend. "Run Scenario" will show a connection error, but all the code panels, annotations, and explanations are fully interactive — good enough for studying the concepts.

### With the single-agent backend

```bash
cd 01-agent-loop/logic
cp .env.example .env          # add your ANTHROPIC_API_KEY
pip install -r requirements.txt
python demo.py                # smoke test in the terminal
```

Then start the API server:

```bash
cd 01-agent-loop/ui/backend
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Start the frontend with the backend URL:

```bash
cd ui/frontend
VITE_SINGLE_AGENT_API_URL=http://localhost:8000 npm run dev
```

### With the multi-agent backend

```bash
cd 02-multi-agent/logic
cp .env.example .env
pip install -r requirements.txt
python demo.py

# API server:
cd 02-multi-agent/ui/backend
uvicorn main:app --port 8001
```

```bash
cd ui/frontend
VITE_MULTI_AGENT_API_URL=http://localhost:8001 npm run dev
```

---

## CI

Every pull request runs:

1. **Python lint & test** — `ruff check` + `pytest` across both logic projects
2. **Frontend build** — `npm ci && npm run build` for `ui/frontend`
3. **Claude Code review** — `claude --print` reviews changed Python files against the agentic loop conventions in `CLAUDE.md` (this is the Domain 3 CI/CD integration demo)

See `.github/workflows/ci.yml` for the implementation.
