# TechCo Customer Support Agent — Project Configuration

<!--
EXAM CONCEPT (Task 3.1): CLAUDE.md Configuration Hierarchy
  - User-level (~/.claude/CLAUDE.md): personal, NOT version-controlled, not shared with team
  - Project-level (this file): shared via git, applies to ALL team members
  - Directory-level (subdirectory CLAUDE.md): applies only to that subtree

This file is the PROJECT-LEVEL CLAUDE.md. Instructions here apply to all developers
who clone this repo — unlike user-level config which only affects that individual.

Use /memory in Claude Code to verify which memory files are loaded and diagnose
inconsistent behavior across sessions.

EXAM CONCEPT (Task 3.1): @import syntax for modular organization.
Use @import to reference external files rather than building a monolithic CLAUDE.md.
Each package imports only its relevant standards.
-->

## Project Overview
This is the TechCo Customer Support Agent — a production agentic system using the
Claude Agent SDK. It handles customer returns, refunds, order lookups, and escalations.

## Universal Standards (all code in this project)

### Tool Sequence Rule
Always call tools in this order: get_customer → lookup_order → process_refund.
Never skip customer verification. Prompt-based suggestions are probabilistic;
programmatic hooks enforce this at runtime, but prompts should reinforce it.

### Error Handling
All MCP tools return structured errors with:
- `errorCategory`: transient | validation | business | permission
- `isRetryable`: boolean
- `description`: human-readable message
Never write code that treats all errors as retryable.

### Testing Standards
@import .claude/rules/testing.md

### API Conventions
@import .claude/rules/api-conventions.md

## Architecture Notes
- `agent/agent_loop.py` — agentic loop (stop_reason-based, NOT content-based termination)
- `agent/hooks.py` — PostToolUse hooks for deterministic policy enforcement
- `mcp_server/tools/` — one file per tool, each with TOOL_DEFINITION and execute()
- `extraction/` — tool_use-based structured extraction with validation-retry loops
- `context/` — case facts persistence and scratchpad for long sessions

## Code Review Checklist
When reviewing PRs in this project:
1. Agentic loops must terminate on stop_reason == "end_turn", not on text content
2. Tool descriptions must include: input format, example queries, edge cases, boundary vs similar tools
3. New tools must use structured error responses (errorCategory + isRetryable)
4. Extraction schemas must mark optional fields as nullable to prevent hallucination
5. Never use the Batch API for blocking/synchronous workflows
