# Claude Certification Training — TechCo Support Agent Demo

An interactive training app for the **Anthropic Claude Certification** exam. It runs live scenarios against the Claude API and shows the exact code and configuration behind each one, with highlighted exam concepts and explanations.

## What This Is

The app demonstrates a fictional **TechCo customer support agent** across two implementation tracks:

- **Track 1 — Python SDK**: A production-style agentic system built with the Anthropic Python SDK — agent loops, pre/post-tool hooks, MCP tools, structured extraction, and multi-agent coordination.
- **Track 2 — Claude Code CLI**: The equivalent patterns expressed as `CLAUDE.md` files, skills, slash commands, path-specific rules, and CI/CD integration.

Every scenario maps to specific exam domains and tasks. Clicking "Run Scenario" executes it live and streams the result into the UI alongside the annotated source code.

## Exam Domain Coverage

| Domain | Topics covered |
|--------|---------------|
| **Domain 1** | Agentic loop lifecycle (`stop_reason`), hooks, multi-concern decomposition, multi-agent coordinator/subagent pattern, parallel execution |
| **Domain 2** | Tool description best practices, structured error responses (`errorCategory` + `isRetryable`), programmatic prerequisite enforcement, scoped tool distribution |
| **Domain 3** | `CLAUDE.md` configuration hierarchy, `@import` and path-specific rules, skills and slash commands, CI/CD with `claude --print` |
| **Domain 4** | `tool_choice: "any"` for guaranteed extraction, nullable fields, validation-retry loops with specific error feedback |
| **Domain 5** | Case facts injection, escalation criteria (explicit triggers vs. sentiment), self-contained handoff summaries, context management |

## Repo Structure

```
01-agent-loop/
├── logic/              # Single-agent Python SDK implementation
│   ├── agent/          # agent_loop.py, hooks.py
│   ├── extraction/     # Structured case extraction
│   ├── mcp_server/     # MCP tools: get_customer, lookup_order, process_refund, escalate_to_human
│   ├── context/        # Case facts + scratchpad
│   ├── prompts/        # System prompt builder
│   ├── CLAUDE.md       # Project-level Claude Code config (Domain 3 demo)
│   └── demo.py         # Entry point
└── ui/
    └── backend/        # FastAPI Lambda handler for the single-agent scenarios

02-multi-agent/
├── logic/              # Multi-agent coordinator/subagent implementation
│   ├── agent/          # coordinator.py, subagents.py, agent_loop.py, hooks.py
│   ├── mcp_server/     # Same 4 MCP tools (shared design)
│   ├── context/        # Scratchpad with threading.Lock for parallel writes
│   ├── CLAUDE.md       # Multi-agent project config (Domain 3 demo)
│   └── demo.py         # Entry point
└── ui/
    └── backend/        # FastAPI Lambda handler for the multi-agent scenarios

ui/
├── frontend/           # Unified React app (Vite, port 5173)
│   └── src/
│       ├── scenarios.js          # All 7 scenarios with code, highlights, explanations
│       └── components/
│           ├── ScenarioSelector  # Landing page with domain legend
│           ├── ScenarioView      # Unified layout (FlowDiagram shown for multi-agent)
│           ├── ConversationPanel # Renders single-agent or multi-agent result shape
│           ├── CodePanel         # Syntax-highlighted code with exam annotations
│           ├── ConfigPanel       # Track 2 (Claude Code CLI) config files
│           └── FlowDiagram       # Animated coordinator → subagent flow (multi-agent only)
└── edge-signer/        # Lambda@Edge function: SigV4-signs browser POSTs to Lambda Function URL

.github/workflows/
├── ci.yml              # Python lint/test + frontend build + Claude Code review (Domain 3 demo)
└── deploy.yml          # SAM deploy pipeline
```

## Running Locally

### Prerequisites

- Python 3.11+
- Node.js 18+
- An Anthropic API key

### Frontend (UI only — no backend required)

```bash
cd ui/frontend
npm install
npm run dev
# → http://localhost:5173
```

The UI works without a backend — "Run Scenario" will show an error, but all the code panels, annotations, and explanations are fully interactive.

### Single-agent backend

```bash
cd 01-agent-loop/logic
cp .env.example .env          # add your ANTHROPIC_API_KEY
pip install -r requirements.txt
python demo.py                # runs a sample scenario in the terminal
```

To wire it to the frontend, run the FastAPI backend:

```bash
cd 01-agent-loop/ui/backend
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Then set `VITE_SINGLE_AGENT_API_URL=http://localhost:8000` before starting the dev server.

### Multi-agent backend

```bash
cd 02-multi-agent/logic
cp .env.example .env          # add your ANTHROPIC_API_KEY
pip install -r requirements.txt
python demo.py

# FastAPI backend:
cd 02-multi-agent/ui/backend
uvicorn main:app --port 8001
```

Set `VITE_MULTI_AGENT_API_URL=http://localhost:8001` before starting the dev server.

## Deploying to AWS

The UI backends are packaged as Lambda Function URLs behind CloudFront + Lambda@Edge (for SigV4 signing of browser POSTs). See [`01-agent-loop/ui/DEPLOYMENT.md`](01-agent-loop/ui/DEPLOYMENT.md) for the full deployment guide.

Architecture overview:

```
Browser → CloudFront
  ├── /*    → S3 (React static app)
  └── /api* → Lambda@Edge (SigV4 signer) → Lambda Function URL (AuthType: AWS_IAM)
```

## CI

Every pull request runs:

1. **Python lint & test** — `ruff check` + `pytest` across both logic projects
2. **Frontend build** — `npm ci && npm run build` for `ui/frontend`
3. **Claude Code review** — `claude --print` reviews changed Python files against the agentic loop conventions in `CLAUDE.md` (this is the Domain 3 CI/CD integration demo)

## Key Exam Concepts Demonstrated

| Concept | Where to find it |
|---------|-----------------|
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
