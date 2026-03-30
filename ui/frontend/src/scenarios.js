// ─── 01-agent-loop: Python SDK snippets + Track 2 config ──────────────────────
// Scenario metadata, code content, line highlights, and exam explanations.
// highlights: [{start, end, color}] — line numbers are 1-indexed, matching the code below.
// explanation: [{color, badge, title, body}] — colors match their highlight group.

// ─── Code snippets ────────────────────────────────────────────────────────────
// Each is written to a fixed line count so highlight ranges stay accurate.

const AGENT_LOOP_CODE = `\
MAX_ITERATIONS = 20  # Safety cap — NOT the primary stop mechanism

def run_agent(user_message, session_id="default"):
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    messages = [{"role": "user", "content": user_message}]
    iteration = 0

    # Loop control is based entirely on stop_reason, not text content
    while iteration < MAX_ITERATIONS:
        iteration += 1

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=system_prompt,
            tools=ALL_TOOLS,
            messages=messages,
        )

        # ✓ CORRECT termination: stop_reason == "end_turn"
        # ✗ WRONG: "if 'done' in response.text" — anti-pattern
        if response.stop_reason == "end_turn":
            return _extract_text(response)

        # ✓ CORRECT continuation: stop_reason == "tool_use"
        if response.stop_reason == "tool_use":
            # Append assistant turn (tool call requests) to history
            messages.append({
                "role": "assistant",
                "content": response.content,
            })
            tool_results = []

            for block in response.content:
                if block.type != "tool_use":
                    continue
                executor = TOOL_EXECUTORS.get(block.name)
                result = executor(block.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result["content"][0]["text"],
                })

            # Tool results appended → Claude reasons with full context next turn
            messages.append({"role": "user", "content": tool_results})`

// Line index: 1=MAX_ITERATIONS, 22-23=end_turn block, 26=tool_use, 28-31=append assistant,
//             33-43=tool loop, 45=append results

const HOOKS_CODE = `\
REFUND_THRESHOLD = 500.00

def pre_tool_use_hook(tool_name, tool_input):
    """
    Called BEFORE the tool executes.
    Hooks are deterministic — 100% compliance guarantee.
    Prompt instructions ("don't refund above $500") have a non-zero failure rate.
    """
    if tool_name == "process_refund":
        refund_amount = float(tool_input.get("refund_amount", 0))
        if refund_amount > REFUND_THRESHOLD:
            # Model NEVER executes the blocked call — intercepted before it runs
            return HookResult(
                allowed=False,
                message=f"Refund of \${refund_amount:.2f} blocked. Requires human approval.",
                redirect_tool="escalate_to_human",   # Redirect to alternate tool
                redirect_args={
                    "customer_id": tool_input.get("verified_customer_id"),
                    "escalation_reason": "refund_above_threshold",
                    "priority": "high",
                },
            )

    return HookResult(allowed=True)   # All other calls proceed normally


def post_tool_use_hook(tool_name, tool_result):
    """
    Called AFTER execution — transforms the result before the model sees it.
    Use cases: normalize date formats, trim verbose fields, inject metadata.
    """
    data = parse_result(tool_result)
    data = _normalize_dates(data)          # Unix ts / ISO 8601 / MM/DD → YYYY-MM-DD
    data = _inject_context(data, tool_name) # Add _today so agent can compare deadlines
    return {"isError": False, "content": [{"type": "text", "text": str(data)}]}`

// Line index: 1=threshold, 11-22=pre-tool block, 16=redirect_tool, 26-35=post-tool

const GET_CUSTOMER_CODE = `\
# EXAM CONCEPT: Tool description is the PRIMARY tool-selection mechanism.
# A thin description ("Retrieves customer info") causes the model to misroute.
# Good descriptions state: what, when, when NOT to use, input format, edge cases.

TOOL_DEFINITION = {
    "name": "get_customer",
    "description": (
        "Look up a customer account by customer ID (C###) or email. "
        "Use this FIRST — before any order operations or account changes. "
        "Returns: account status, tier, contact info. "
        "Do NOT use for order details — use lookup_order for that. "   # boundary
        "Example inputs: 'C001', 'alice@example.com'. "
        "Returns an error if the customer does not exist."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"identifier": {"type": "string"}},
        "required": ["identifier"],
    },
}

def execute(identifier: str):
    if "@" in identifier:
        customer_id = EMAIL_INDEX.get(identifier.lower())
        if not customer_id:
            return {
                "isError": True,
                "content": [{"type": "text", "text": str({
                    "errorCategory": "validation",  # transient | validation | business | permission
                    "isRetryable": False,           # Prevents wasted retries
                    "description": f"No customer found with email {identifier}.",
                })}]
            }
        return {"isError": False,
                "content": [{"type": "text", "text": str(CUSTOMERS_DB[customer_id])}]}`

// Line index: 7-14=description, 11=boundary comment, 27-29=structured error fields

const LOOKUP_ORDER_CODE = `\
# EXAM CONCEPT: Programmatic prerequisite enforcement.
# verified_customer_id is a REQUIRED parameter — the model cannot call this tool
# without first getting the customer ID from get_customer.
# This is deterministic. Prompt instructions have a ~12% skip rate (observed in Q1).

TOOL_DEFINITION = {
    "name": "lookup_order",
    "description": (
        "Retrieve order details by order ID (ORD-####). "
        "REQUIRES a verified customer ID from get_customer — call that first. "
        "Returns: status, items, total, delivery date, return eligibility. "
        "Do NOT use for customer account info — use get_customer for that."
    ),
    "input_schema": {
        "properties": {
            "order_id": {"type": "string"},
            "verified_customer_id": {
                "type": "string",
                "description": "Customer ID already confirmed by get_customer.",
            },
        },
        "required": ["order_id", "verified_customer_id"],  # Both required → sequence enforced
    },
}

def execute(order_id, verified_customer_id):
    order = ORDERS_DB.get(order_id)

    if order["customer_id"] != verified_customer_id:
        return {"isError": True, "content": [{"type": "text", "text": str({
            "errorCategory": "permission",
            "isRetryable": False,
            "description": f"Order {order_id} does not belong to {verified_customer_id}.",
        })}]}

    # Task 5.1: Trim verbose output — real records may have 40+ fields.
    # Return only the fields needed for the current task.
    trimmed = {k: order[k] for k in [
        "order_id", "status", "total", "items",
        "delivered_date", "return_eligible", "return_deadline",
    ]}
    return {"isError": False, "content": [{"type": "text", "text": str(trimmed)}]}`

// Line index: 20=required (sequence enforcement), 17-19=verified_customer_id,
//             28-32=permission error, 35-41=trim output

const PROCESS_REFUND_CODE = `\
REFUND_THRESHOLD = 500.00  # Hook in hooks.py intercepts before this runs

TOOL_DEFINITION = {
    "name": "process_refund",
    "description": (
        "Process a refund for a delivered, return-eligible order. "
        "Refunds above $500 require human approval and are auto-escalated. "
        "Requires: verified customer ID (get_customer) + order ID (lookup_order)."
    ),
}

def execute(order_id, verified_customer_id, refund_amount, reason):
    """
    Safety-net check — the pre_tool_use hook in hooks.py should catch large
    refunds before execute() is ever called. If this branch runs, the hook
    layer was bypassed, so we enforce the rule here too.
    """
    if refund_amount > REFUND_THRESHOLD:
        return {"isError": True, "content": [{"type": "text", "text": str({
            "errorCategory": "business",   # Policy violation — not a bug, not transient
            "isRetryable": False,          # Retrying will produce the same result
            "description": (
                f"Refund of \${refund_amount:.2f} exceeds \${REFUND_THRESHOLD} limit. "
                "Escalate to human for approval."
            ),
        })}]}

    # Refund approved — process it
    confirmation = f"REF-{uuid.uuid4().hex[:8].upper()}"
    return {"isError": False, "content": [{"type": "text", "text": str({
        "confirmation_number": confirmation,
        "refund_amount": refund_amount,
        "status": "approved",
        "processing_time": "3-5 business days",
    })}]}`

// Line index: 1=threshold, 18-25=business error block, 19=errorCategory, 20=isRetryable

const ESCALATE_CODE = `\
TOOL_DEFINITION = {
    "name": "escalate_to_human",
    "description": (
        "Escalate this case to a human support agent. "
        "Use when: (1) customer explicitly requests a human, "
        "(2) refund exceeds $500, (3) policy gap, or (4) unable to progress. "
        "Do NOT use as first response to complex-sounding requests — attempt resolution first. "
        "Provide a complete summary — the human agent has NO transcript access."
    ),
    "input_schema": {
        "properties": {
            "escalation_reason": {
                "type": "string",
                "enum": [
                    "customer_requested_human",  # (1) Explicit request
                    "refund_above_threshold",    # (2) Exceeds $500
                    "policy_gap",               # (3) Situation not covered
                    "unable_to_progress",       # (4) Can't resolve with available tools
                    "account_security_concern",
                ],
            },
            "case_summary": {
                "type": "string",
                # Human agent has NO transcript access. Summary must be self-contained:
                # customer need + what was attempted + why escalating + recommended action
                "description": (
                    "Complete self-contained summary for the human agent. "
                    "Must include: what the customer needs, what was attempted, "
                    "why escalation is needed, and recommended next action. "
                    "The human agent has NO access to the conversation transcript."
                ),
            },
            "priority": {
                "type": "string",
                "enum": ["low", "normal", "high", "urgent"],
            },
        },
        "required": ["customer_id", "escalation_reason", "case_summary", "priority"],
    },
}`

// Line index: 3-9=description w/ when/when-not, 14-20=reason enum, 22-32=case_summary

const SYSTEM_PROMPT_CODE = `\
def build_system_prompt(case_facts=None):
    # Task 5.1: Case facts injected at the START of the prompt.
    # Models reliably process the beginning and end of long inputs.
    # Middle sections may be missed — the "lost in the middle" effect.
    facts_block = _build_case_facts_block(case_facts or {})

    return f"""You are a customer support agent for TechCo.

{facts_block}

## ESCALATION CRITERIA — EXPLICIT, NOT VAGUE
# Task 4.1: Explicit criteria outperform vague instructions like "be conservative."

Escalate IMMEDIATELY when:
  ✓ Customer EXPLICITLY asks for a human agent
  ✓ Refund amount exceeds $500 (hook auto-escalates)
  ✓ Policy gap — situation not covered by guidelines

Do NOT escalate based on:
  ✗ How frustrated the customer sounds  (sentiment ≠ escalation trigger)
  ✗ Your own confidence level           ("I'm unsure, so I'll escalate")
  ✗ The case sounding complex           (attempt resolution first)

## FEW-SHOT EXAMPLES
# Task 4.2: Few-shot examples show reasoning, enabling generalization.
# Detailed instructions alone produce inconsistent results on novel cases.

### Example 1: Frustrated customer with simple request — RESOLVE
Customer: "I've been waiting 3 months and I'm furious! Order ORD-1001!"
Reasoning: High frustration but request is straightforward. Sentiment doesn't
           trigger escalation. Refund is $129.99 (<$500). Attempt resolution.
Action: get_customer → lookup_order → process_refund (if eligible)

### Example 2: Explicit human request — ESCALATE immediately
Customer: "Stop trying to help. I want a real person. NOW."
Reasoning: Explicit, unambiguous request. Do NOT try to resolve first.
           Do NOT ask "are you sure?" Honor the request immediately.
Action: escalate_to_human(reason=customer_requested_human, priority=high)"""`

// Line index: 2-5=facts injection, 12-16=correct triggers, 18-21=wrong triggers,
//             23-35=few-shot examples

const EXTRACTOR_CODE = `\
# EXAM CONCEPT: tool_choice controls whether a tool call is guaranteed.
#   "auto"                    → model MAY return plain text (unreliable for extraction)
#   "any"                     → model MUST call a tool — use this for extraction
#   {"type":"tool","name":"…"} → forces a specific tool (use to enforce order)

CASE_EXTRACTION_TOOL = {
    "name": "extract_support_case",
    "input_schema": {
        "properties": {
            # Required — information always present in a support conversation
            "customer_intent":   {"type": "string", "enum": ["refund_request", "return_request", ...]},
            "sentiment":         {"type": "string", "enum": ["positive", "neutral", "frustrated", "angry"]},
            "resolution_status": {"type": "string", "enum": ["resolved", "escalated_to_human", ...]},
            "confidence":        {"type": "number", "minimum": 0.0, "maximum": 1.0},

            # NULLABLE — may not appear in every conversation.
            # Without nullable, the model fabricates values for missing fields.
            "order_id":            {"type": ["string", "null"]},
            "refund_amount":       {"type": ["number", "null"]},
            "confirmation_number": {"type": ["string", "null"]},
        },
        "required": ["customer_intent", "sentiment", "resolution_status", "confidence"],
    },
}

def extract_case_summary(conversation_text, max_retries=2):
    attempt, last_extraction, last_error = 0, None, None

    while attempt <= max_retries:
        attempt += 1

        if attempt == 1:
            user_message = f"Extract structured info from:\n{conversation_text}"
        else:
            # EXAM CONCEPT: Retry includes the SPECIFIC error, not a generic "try again".
            # Generic retries are ineffective — the model doesn't know what to fix.
            user_message = (
                "Previous extraction failed validation. Fix this specific error:\n\n"
                f"ORIGINAL CONVERSATION:\n{conversation_text}\n\n"
                f"FAILED EXTRACTION:\n{json.dumps(last_extraction, indent=2)}\n\n"
                f"SPECIFIC ERROR:\n{last_error}"   # Targeted — not "please try again"
            )

        response = client.messages.create(
            tools=[CASE_EXTRACTION_TOOL],
            tool_choice={"type": "any"},   # Guarantees a tool call — no plain text
            messages=[{"role": "user", "content": user_message}],
        )

        extracted = response.content[0].input
        error = _validate_extraction(extracted)

        if not error:
            return extracted   # Valid!

        last_extraction, last_error = extracted, error  # Pass specific error to next attempt`

// Line index: 1-4=tool_choice options, 16-20=nullable fields, 44=tool_choice:"any",
//             33-39=retry with specific error

// ─── Claude Code config file contents (Track 2) ───────────────────────────────

const CLAUDE_MD_CONTENT = `\
<!--
EXAM CONCEPT (Task 3.1): CLAUDE.md Configuration Hierarchy
  - User-level (~/.claude/CLAUDE.md): personal, NOT version-controlled, not shared with team
  - Project-level (this file): shared via git, applies to ALL team members
  - Directory-level (subdirectory CLAUDE.md): applies only to that subtree

This file is the PROJECT-LEVEL CLAUDE.md. Instructions here apply to all developers
who clone this repo — unlike user-level config which only affects that individual.

EXAM CONCEPT (Task 3.1): @import syntax for modular organization.
Use @import to reference external files rather than building a monolithic CLAUDE.md.
Each package imports only its relevant standards.
-->

# TechCo Customer Support Agent — Project Configuration

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
- \`errorCategory\`: transient | validation | business | permission
- \`isRetryable\`: boolean
- \`description\`: human-readable message
Never write code that treats all errors as retryable.

### Testing Standards
@import .claude/rules/testing.md

### API Conventions
@import .claude/rules/api-conventions.md

## Architecture Notes
- \`agent/agent_loop.py\` — agentic loop (stop_reason-based, NOT content-based termination)
- \`agent/hooks.py\` — PostToolUse hooks for deterministic policy enforcement
- \`mcp_server/tools/\` — one file per tool, each with TOOL_DEFINITION and execute()
- \`extraction/\` — tool_use-based structured extraction with validation-retry loops
- \`context/\` — case facts persistence and scratchpad for long sessions

## Code Review Checklist
When reviewing PRs in this project:
1. Agentic loops must terminate on stop_reason == "end_turn", not on text content
2. Tool descriptions must include: input format, example queries, edge cases, boundary vs similar tools
3. New tools must use structured error responses (errorCategory + isRetryable)
4. Extraction schemas must mark optional fields as nullable to prevent hallucination
5. Never use the Batch API for blocking/synchronous workflows`

const MCP_JSON_CONTENT = `\
{
  "_comment": "EXAM CONCEPT (Task 2.4): MCP Server Configuration",
  "_concept1": "Project-scoped (.mcp.json in project root) = shared with team via version control",
  "_concept2": "User-scoped (~/.claude.json) = personal/experimental, NOT shared",
  "_concept3": "Environment variable expansion (\${VAR}) for credentials — never commit secrets",
  "_concept4": "All configured MCP servers are discovered at connection time and available simultaneously",

  "mcpServers": {
    "support-tools": {
      "_comment": "Custom MCP server for TechCo support tools (get_customer, lookup_order, etc.)",
      "command": "python",
      "args": ["-m", "mcp_server.server"],
      "env": {
        "ANTHROPIC_API_KEY": "\${ANTHROPIC_API_KEY}",
        "REFUND_THRESHOLD": "\${REFUND_THRESHOLD}",
        "HUMAN_ESCALATION_EMAIL": "\${HUMAN_ESCALATION_EMAIL}"
      }
    },

    "filesystem": {
      "_comment": "Community MCP server for file access — prefer existing community servers over custom ones",
      "_exam_note": "Choose existing community MCP servers for standard integrations; reserve custom servers for team-specific workflows",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "./",
        "./.scratch"
      ]
    }
  }
}`

const REVIEW_CASE_CONTENT = `\
<!--
EXAM CONCEPT (Task 3.2): Project-scoped slash commands in .claude/commands/
Commands here are version-controlled and available to ALL developers on clone/pull.
Personal commands go in ~/.claude/commands/ and are NOT shared.

Usage: /review-case ORD-1001
-->

# Review Support Case

Review the support case for the given order or customer ID. Check:

1. **Tool sequence compliance**: Was get_customer called before lookup_order?
2. **Error handling**: Were structured errors returned with errorCategory and isRetryable?
3. **Escalation logic**: Was escalation triggered by the correct criteria (not sentiment)?
4. **Context preservation**: Were case facts persisted outside summarized history?
5. **Hook enforcement**: For refunds > $500, was the pre-tool hook triggered?

Argument: $ARGUMENTS (order ID or customer ID to review)

If no argument provided, review the most recent case in the escalation log.`

const ANALYZE_TICKET_SKILL_CONTENT = `\
---
# EXAM CONCEPT (Task 3.2): Skill frontmatter options
#
# context: fork
#   Runs this skill in an ISOLATED sub-agent context.
#   Prevents verbose skill output from polluting the main conversation context.
#   Use when: skill produces lots of exploratory output you don't want in main session.
#
# allowed-tools
#   Restricts which tools are available during skill execution.
#   Prevents destructive actions; limits scope to what the skill actually needs.
#
# argument-hint
#   Shown to the developer when they invoke the skill without arguments.
#
# KEY EXAM DISTINCTION:
#   Skills (on-demand invocation) vs CLAUDE.md (always-loaded universal standards)
#   Use skills for task-specific, on-demand workflows.
#   Use CLAUDE.md for conventions that should always apply.

context: fork
allowed-tools: Read, Grep, Glob
argument-hint: "Provide a case transcript or conversation ID to analyze"
---

# Analyze Support Ticket

Analyze the provided support ticket transcript and produce a structured case review.

## Instructions

Given the transcript in $ARGUMENTS, extract and report:

### 1. Case Classification
- Primary intent (refund/return/order status/account/billing/other)
- Customer sentiment (positive/neutral/frustrated/angry)
- Resolution status (resolved/escalated/pending)

### 2. Tool Usage Audit
- Were tools called in the correct sequence? (get_customer → lookup_order → process_refund)
- Were any verification steps skipped?
- Were structured errors returned correctly?

### 3. Escalation Decision Audit
- Was the escalation trigger correct? (explicit request / policy gap / threshold / unable to progress)
- Was sentiment incorrectly used as the escalation trigger? (flag this as a defect)
- Was the escalation summary complete? (customer ID, root cause, recommended action)

### 4. Context Management
- Were case facts (amounts, order IDs) preserved in a structured block?
- Were tool outputs trimmed to relevant fields?

### 5. Recommendations
List any issues found and suggested improvements.

Note: This skill runs in isolated context (context: fork) so its output
does not accumulate in your main session.`

const API_CONVENTIONS_CONTENT = `\
---
# EXAM CONCEPT (Task 3.3): Path-specific rules.
# These conventions apply ONLY when editing files in the mcp_server/ or agent/ directories.
# Developers working on extraction/ or context/ won't see these rules — reducing noise.
paths:
  - "mcp_server/**/*"
  - "agent/**/*"
---

# API & MCP Tool Conventions

## Tool Definition Structure
Every tool file must export:
- \`TOOL_DEFINITION\` dict with: name, description, input_schema
- \`execute(**kwargs)\` function returning MCP-compatible response

## Tool Description Requirements (CRITICAL for tool selection reliability)
Tool descriptions MUST include:
1. What the tool does (1 sentence)
2. When to use it (specific trigger conditions)
3. When NOT to use it (distinguish from similar tools)
4. Input format with examples
5. What it returns
6. Edge cases and error conditions

## Error Response Format
All tool execute() functions must return this structure:
\`\`\`python
# Success
{"isError": False, "content": [{"type": "text", "text": str(result)}]}

# Error
{"isError": True, "content": [{"type": "text", "text": str({
    "errorCategory": "transient|validation|business|permission",
    "isRetryable": True|False,
    "description": "Human-readable explanation"
})}]}
\`\`\`

## tool_choice Configuration
- Use "auto" only when tool calling is optional
- Use "any" when the model MUST call a tool (structured output workflows)
- Use {"type": "tool", "name": "..."} to force a specific tool

## Agentic Loop Pattern
\`\`\`python
while True:
    response = client.messages.create(...)
    if response.stop_reason == "end_turn":
        break  # Correct termination
    if response.stop_reason == "tool_use":
        # execute tools, append results, continue
        ...
    # Do NOT check text content to decide termination
\`\`\``

const TESTING_MD_CONTENT = `\
---
# EXAM CONCEPT (Task 3.3): Path-specific rules with YAML frontmatter glob patterns.
# Rules here ONLY load when editing files matching these paths.
# This reduces irrelevant context and token usage when working on non-test files.
#
# WHY path-specific rules over directory-level CLAUDE.md:
# Test files are spread throughout the codebase alongside the code they test
# (e.g., tools/test_get_customer.py next to tools/get_customer.py).
# A glob pattern like **/*.test.py applies regardless of directory location,
# while a subdirectory CLAUDE.md only applies within that one directory.
paths:
  - "**/*test*.py"
  - "**/test_*.py"
  - "tests/**/*"
---

# Testing Conventions for TechCo Support Agent

## Test Structure
Each tool must have a corresponding test file: \`tests/test_{tool_name}.py\`

## Required Test Cases for Every Tool
1. Happy path — valid inputs, expected success response
2. Validation error — invalid input format, verify errorCategory == "validation"
3. Transient error simulation — verify isRetryable == True
4. Business rule error — verify isRetryable == False with clear description
5. Boundary conditions — e.g., refund exactly at $500 threshold

## Batch API Testing
- Never test batch workflows with real-time assertions
- Use custom_id to correlate results in test assertions
- Mock the 24-hour processing window in tests

## Agentic Loop Tests
- Verify the loop terminates on stop_reason == "end_turn"
- Verify the loop continues on stop_reason == "tool_use"
- Test hook interception: submit a $600 refund and verify it's blocked and redirected
- Never assert termination based on text content patterns`

// ─── Scenario definitions ─────────────────────────────────────────────────────

// ─── 02-multi-agent: Coordinator + subagent snippets + Track 2 config ──────────
// ─── Track 1: Python SDK code content ────────────────────────────────────────

const COORDINATOR_PY = `"""
Multi-Agent Coordinator — Domain 1, Tasks 1.2, 1.3, 5.3 exam focus areas:

EXAM CONCEPT (Task 1.2): Hub-and-spoke coordinator pattern.
  - Coordinator decomposes the customer's request into discrete concerns
  - Each concern is delegated to a specialized subagent
  - Subagents report results BACK TO THE COORDINATOR (never to each other)
  - Coordinator aggregates all results and synthesizes the final response

EXAM CONCEPT (Task 1.3): Spawning and parallel execution.
  - Coordinator calls spawn_subagent (the Python SDK analog of Claude Code's Task tool)
  - MULTIPLE spawn_subagent calls in a SINGLE coordinator response → parallel execution
  - ThreadPoolExecutor runs them concurrently — critical for performance
  - Context is passed explicitly per subagent — no automatic inheritance

EXAM CONCEPT (Task 5.3): Structured error handling.
  - SubagentResult.error_context tells coordinator: is_retryable, alternatives
  - Partial failures don't crash the whole workflow
"""

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
import anthropic
from dotenv import load_dotenv
from agent.subagents import AGENT_REGISTRY, SubagentResult, run_subagent
from context.scratchpad import Scratchpad

load_dotenv(override=True)

MAX_COORDINATOR_ITERATIONS = 15

# =============================================================================
# EXAM CONCEPT (Task 1.3): spawn_subagent is the Python SDK "Task tool" analog.
# In Claude Code, the built-in Task tool does this. In the Python SDK, we define
# it ourselves. The coordinator calls this tool to delegate to subagents.
# =============================================================================
SPAWN_SUBAGENT_TOOL = {
    "name": "spawn_subagent",
    "description": (
        "Delegate a specific task to a specialized subagent. "
        "The subagent has ISOLATED context — it does NOT see this conversation. "
        "You MUST pass ALL needed data in context_data explicitly. "
        "IMPORTANT: Emit MULTIPLE spawn_subagent calls in a SINGLE response to run them in PARALLEL."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "agent_type": {
                "type": "string",
                "enum": list(AGENT_REGISTRY.keys()),
            },
            "task_prompt": {"type": "string"},
            "context_data": {
                "type": "object",
                "description": "ALL context the subagent needs. Include: customer_id, order_id, amounts.",
            },
        },
        "required": ["agent_type", "task_prompt", "context_data"],
    },
}

COORDINATOR_SYSTEM_PROMPT = """You are a multi-agent customer support coordinator for TechCo.

## AVAILABLE SUBAGENTS
- customer_verification_agent: looks up customer by email or ID. Call this FIRST.
- order_investigation_agent: checks a specific order's status and return eligibility.
- resolution_agent: processes refunds or creates escalation tickets.

## SEQUENCING RULES
1. ALWAYS call customer_verification_agent FIRST — subagents need the verified customer ID.
2. After verification, spawn MULTIPLE subagents in ONE response for independent concerns.
   Example: if the customer has 3 orders to check, emit 3 spawn_subagent calls at once.
3. After investigation, spawn resolution subagents for actionable concerns.

## CONTEXT ISOLATION RULE
Subagents do NOT see this conversation. You MUST pass all needed data explicitly:
  - customer_id (from verification result)
  - order_id (from the customer's message)
  - refund_amount (from order investigation result)
  - reason (from the customer's message)

## ERROR HANDLING RULE
If a subagent returns success=false:
  - Check is_retryable in error_context
  - If retryable: spawn it again once with the same context
  - If not retryable: note the failure and proceed with remaining concerns
"""


def run_coordinator(user_message: str, session_id: str = "coordinator") -> str:
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    scratchpad = Scratchpad(session_id)

    messages: list[dict] = [{"role": "user", "content": user_message}]
    all_results: dict[str, SubagentResult] = {}

    iteration = 0

    while iteration < MAX_COORDINATOR_ITERATIONS:
        iteration += 1

        response = client.messages.create(
            model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
            max_tokens=4096,
            system=COORDINATOR_SYSTEM_PROMPT,
            tools=[SPAWN_SUBAGENT_TOOL],
            messages=messages,
        )

        # ── TERMINATION: coordinator synthesizes final response ────────────
        if response.stop_reason == "end_turn":
            return _extract_text(response)

        # ── CONTINUATION: execute spawn_subagent calls ────────────────────
        if response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": response.content})

            spawn_calls = [b for b in response.content if b.type == "tool_use"]
            tool_results = []

            if len(spawn_calls) == 1:
                # Sequential — only one subagent
                call = spawn_calls[0]
                result = _dispatch_subagent(call.input, session_id)
                all_results[call.id] = result
                tool_results.append(_format_result(call.id, result))

            else:
                # =============================================================
                # EXAM CONCEPT (Task 1.3): Parallel execution.
                # Multiple spawn_subagent calls in ONE response → ThreadPoolExecutor.
                # All independent subagents run concurrently.
                # =============================================================
                with ThreadPoolExecutor(max_workers=len(spawn_calls)) as executor:
                    futures = {
                        executor.submit(_dispatch_subagent, call.input, session_id): call
                        for call in spawn_calls
                    }
                    completed: dict[str, SubagentResult] = {}
                    for future in as_completed(futures):
                        call = futures[future]
                        result = future.result()
                        completed[call.id] = result
                        all_results[call.id] = result

                for call in spawn_calls:
                    tool_results.append(_format_result(call.id, completed[call.id]))

            messages.append({"role": "user", "content": tool_results})

    return "Coordinator reached iteration limit."
`

const SUBAGENTS_PY = `"""
Subagent definitions — Domain 1, Tasks 1.2, 2.3, 5.3 exam focus areas:

EXAM CONCEPT (Task 1.2): Hub-and-spoke architecture.
Each subagent has ISOLATED context — it never sees the coordinator's conversation
history. All context must be EXPLICITLY passed in the subagent's task prompt.

EXAM CONCEPT (Task 2.3): Scoped tool distribution.
Each subagent receives ONLY the tools needed for its specific role:
  - customer_verification_agent → [get_customer] only
  - order_investigation_agent → [lookup_order] only
  - resolution_agent → [process_refund, escalate_to_human] only
Giving an agent fewer tools improves tool selection reliability.

EXAM CONCEPT (Task 5.3): Structured error propagation.
When a subagent fails, it returns a structured error envelope (not a vague string)
so the coordinator can decide: retry, use alternative, or proceed with partial results.
"""

import os
from dataclasses import dataclass
import anthropic
from dotenv import load_dotenv
from agent.agent_loop import run_agent_loop
from context.scratchpad import Scratchpad
from mcp_server.tools import ALL_TOOLS, TOOL_EXECUTORS

load_dotenv(override=True)


# =============================================================================
# EXAM CONCEPT (Task 2.3): AgentDefinition — defines scoped tool access.
# This mirrors Claude Code's internal AgentDefinition with allowed-tools.
# =============================================================================
@dataclass
class AgentDefinition:
    name: str
    description: str
    system_prompt: str
    allowed_tool_names: list[str]   # ONLY these tools are passed to the subagent


@dataclass
class SubagentResult:
    """
    EXAM CONCEPT (Task 5.3): Structured result from a subagent.
    Coordinator uses this to decide: synthesize, retry, or escalate.

    Never return a plain string from a subagent — structured results
    allow the coordinator to handle partial failures gracefully.
    """
    agent_name: str
    success: bool
    findings: str           # Natural language summary for coordinator synthesis
    structured_data: dict   # Machine-readable key facts
    error_context: dict | None = None   # Structured error envelope if success=False


# =============================================================================
# EXAM CONCEPT (Task 2.3): Three specialized subagents with SCOPED tools.
# Each gets only what it needs — not the full ALL_TOOLS list.
# =============================================================================

CUSTOMER_VERIFICATION_AGENT = AgentDefinition(
    name="customer_verification_agent",
    allowed_tool_names=["get_customer"],  # ONLY get_customer
    system_prompt="Call get_customer with the identifier provided. Return: customer ID, name, tier, status.",
    description="Verifies customer identity.",
)

ORDER_INVESTIGATION_AGENT = AgentDefinition(
    name="order_investigation_agent",
    allowed_tool_names=["lookup_order"],  # ONLY lookup_order
    system_prompt="Call lookup_order with the order ID and verified customer ID. Return: status, return_eligible, deadline.",
    description="Investigates order status and return eligibility.",
)

RESOLUTION_AGENT = AgentDefinition(
    name="resolution_agent",
    allowed_tool_names=["process_refund", "escalate_to_human"],  # NO lookup tools
    system_prompt="Execute resolutions. For refunds: call process_refund. For escalations: call escalate_to_human.",
    description="Executes resolutions: refunds or escalations.",
)

AGENT_REGISTRY: dict[str, AgentDefinition] = {
    CUSTOMER_VERIFICATION_AGENT.name: CUSTOMER_VERIFICATION_AGENT,
    ORDER_INVESTIGATION_AGENT.name: ORDER_INVESTIGATION_AGENT,
    RESOLUTION_AGENT.name: RESOLUTION_AGENT,
}


def run_subagent(
    definition: AgentDefinition,
    task_prompt: str,
    context_data: dict,
    session_id: str = "default",
) -> SubagentResult:
    """
    Spawn and run a specialized subagent.

    EXAM CONCEPT (Task 1.2): Context isolation.
    The subagent gets a FRESH messages list — it does NOT inherit the coordinator's
    conversation history. All needed context is passed explicitly via context_data.

    EXAM CONCEPT (Task 2.3): Scoped tool distribution.
    Only tools in definition.allowed_tool_names are passed to the API and executor.
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    # =========================================================================
    # EXAM CONCEPT (Task 2.3): Filter tools to only this subagent's allowed set
    # =========================================================================
    scoped_tools = [
        t for t in ALL_TOOLS
        if t["name"] in definition.allowed_tool_names
    ]
    scoped_executors = {
        name: executor for name, executor in TOOL_EXECUTORS.items()
        if name in definition.allowed_tool_names
    }

    # =========================================================================
    # EXAM CONCEPT (Task 1.2): ISOLATED context — fresh messages list.
    # The coordinator's entire history is NOT passed here.
    # Only the explicitly provided context_data is available to the subagent.
    # =========================================================================
    context_block = "## Context Provided by Coordinator\\n" + "\\n".join(
        f"  {key}: {value}" for key, value in context_data.items()
    )

    messages = [{
        "role": "user",
        "content": f"{context_block}\\n\\n## Task\\n{task_prompt}",
    }]

    # Run the subagent using the shared agentic loop
    try:
        final_text = run_agent_loop(
            client=client,
            system_prompt=definition.system_prompt,
            messages=messages,
            tools=scoped_tools,
            tool_executors=scoped_executors,
            agent_label=definition.name,
        )

        # Write findings to scratchpad (Task 5.4)
        Scratchpad(session_id).add_finding(
            agent=definition.name, finding=final_text[:500],
        )

        return SubagentResult(
            agent_name=definition.name, success=True,
            findings=final_text, structured_data=context_data,
        )

    except Exception as exc:
        # =====================================================================
        # EXAM CONCEPT (Task 5.3): Structured error propagation.
        # Never let a single subagent failure crash the entire coordinator loop.
        # Return structured error so coordinator can retry or use alternatives.
        # =====================================================================
        error_context = {
            "failure_type": type(exc).__name__,
            "error_detail": str(exc),
            "is_retryable": type(exc).__name__ in ("ConnectionError", "TimeoutError"),
            "alternatives": _get_alternatives(definition.name),
        }
        return SubagentResult(
            agent_name=definition.name, success=False,
            findings=f"[FAILED] {definition.name}: {str(exc)}",
            structured_data={}, error_context=error_context,
        )


def _get_alternatives(agent_name: str) -> list[str]:
    alternatives = {
        "customer_verification_agent": ["Try alternate email format", "Ask customer to confirm ID"],
        "order_investigation_agent": ["Retry once (transient)", "Ask customer to confirm order ID"],
        "resolution_agent": ["Escalate to human if refund processing fails"],
    }
    return alternatives.get(agent_name, ["Escalate to human agent"])
`

const AGENT_LOOP_PY = `"""
Reusable agentic loop — Domain 1, Task 1.1 & 1.2 exam focus areas:

EXAM CONCEPT (Task 1.1): The agentic loop lifecycle:
  1. Send request to Claude → inspect stop_reason
  2. If stop_reason == "tool_use": execute requested tools, append results, loop
  3. If stop_reason == "end_turn": present final response, terminate loop
  4. Tool results are appended to conversation history so Claude can reason about
     the next action with full context.

Anti-patterns the exam tests (do NOT do these):
  - Parsing natural language signals to decide when to stop ("if 'done' in response...")
  - Setting arbitrary iteration caps as the PRIMARY stopping mechanism
  - Checking for assistant text content as a completion indicator

EXAM CONCEPT (Task 1.2): This function is reusable by both the coordinator AND all
subagents. Subagents pass scoped tools and executors, so the same loop logic serves
all agent types without code duplication.
"""

import anthropic
from agent.hooks import pre_tool_use_hook, post_tool_use_hook, HookResult

MAX_ITERATIONS = 20  # Safety cap — NOT the primary termination mechanism


def run_agent_loop(
    client: anthropic.Anthropic,
    system_prompt: str,
    messages: list[dict],
    tools: list[dict],
    tool_executors: dict,
    agent_label: str = "agent",
    max_iterations: int = MAX_ITERATIONS,
) -> str:
    """
    EXAM CONCEPT (Task 1.1 & 1.2): Reusable agentic loop.

    This single function serves both the coordinator AND all subagents.
    Subagents call it with scoped tools (Task 2.3 — scoped tool distribution).
    """
    iteration = 0

    # =========================================================================
    # THE AGENTIC LOOP
    # EXAM CONCEPT: Loop control is based on stop_reason, not on content analysis
    # =========================================================================
    while iteration < max_iterations:
        iteration += 1

        response = client.messages.create(
            model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
            max_tokens=4096,
            system=system_prompt,
            tools=tools,
            messages=messages,
        )

        # =====================================================================
        # TERMINATION CONDITION: stop_reason == "end_turn"
        # This is the correct way to detect completion — NOT parsing text content.
        # =====================================================================
        if response.stop_reason == "end_turn":
            return _extract_text(response)

        # =====================================================================
        # CONTINUATION CONDITION: stop_reason == "tool_use"
        # Execute all requested tools and append results to conversation history.
        # =====================================================================
        if response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": response.content})

            tool_results = []

            for block in response.content:
                if block.type != "tool_use":
                    continue

                tool_name = block.name
                tool_input = block.input
                tool_use_id = block.id

                # =============================================================
                # PRE-TOOL HOOK: Intercept and possibly block the tool call
                # EXAM CONCEPT (Task 1.5): Deterministic enforcement of business rules
                # =============================================================
                hook_result: HookResult = pre_tool_use_hook(tool_name, tool_input)

                if not hook_result.allowed:
                    # Hook blocked the call — redirect or return error
                    if hook_result.redirect_tool:
                        redirect_executor = tool_executors.get(hook_result.redirect_tool)
                        if redirect_executor:
                            redirect_result = redirect_executor(hook_result.redirect_args or {})
                            redirect_result = post_tool_use_hook(hook_result.redirect_tool, redirect_result)
                            tool_results.append({
                                "type": "tool_result", "tool_use_id": tool_use_id,
                                "content": f"[POLICY ENFORCEMENT] {tool_name} blocked. "
                                           f"Reason: {hook_result.message}\\n"
                                           f"Escalation result: {redirect_result['content'][0]['text']}",
                            })
                    else:
                        tool_results.append({
                            "type": "tool_result", "tool_use_id": tool_use_id,
                            "content": f"[POLICY ENFORCEMENT] {hook_result.message}",
                            "is_error": True,
                        })
                    continue

                # Execute the tool
                executor = tool_executors.get(tool_name)
                tool_result = executor(tool_input) if executor else {
                    "isError": True,
                    "content": [{"type": "text", "text": f"Unknown tool: {tool_name}"}],
                }

                # =============================================================
                # POST-TOOL HOOK: Transform results before the model sees them
                # EXAM CONCEPT (Task 1.5): Normalize formats, trim verbose output
                # =============================================================
                tool_result = post_tool_use_hook(tool_name, tool_result)

                is_error = tool_result.get("isError", False)
                result_text = tool_result.get("content", [{}])[0].get("text", "")

                tool_results.append({
                    "type": "tool_result", "tool_use_id": tool_use_id,
                    "content": result_text, "is_error": is_error,
                })

            # =================================================================
            # APPEND ALL TOOL RESULTS to conversation history
            # EXAM CONCEPT (Task 1.1): Tool results must be in the conversation
            # so the model can reason about the next action with full context.
            # =================================================================
            messages.append({"role": "user", "content": tool_results})

        else:
            break

    return "Agent reached iteration limit without completing the task."
`

// ─── Track 2: Claude Code CLI config content ──────────────────────────────────

const CLAUDE_MD = `# TechCo Multi-Agent Support — Project Configuration

## Project Overview
This is the TechCo Multi-Agent Support project — a multi-agent coordinator/subagent
pattern built on the Claude Agent SDK. It handles customers with multiple simultaneous
concerns by decomposing requests and delegating to specialized subagents in parallel.

Compare with: \`../../01-agent-loop/logic/\` (single-agent version of the same problem)

## Exam Concept Coverage
- Task 1.2: Hub-and-spoke coordinator pattern
- Task 1.3: Spawning subagents via Task tool (simulated as spawn_subagent)
- Task 2.3: Scoped tool distribution per subagent role
- Task 5.3: Structured error propagation from subagents
- Task 5.4: Scratchpad integration for coordinator synthesis

## Architecture

### Python SDK (Track 1)
\`\`\`
agent/coordinator.py        — run_coordinator(), SPAWN_SUBAGENT_TOOL, ThreadPoolExecutor
agent/subagents.py          — AgentDefinition, SubagentResult, run_subagent()
agent/agent_loop.py         — run_agent_loop() shared by coordinator and subagents
agent/hooks.py              — PreToolUse/PostToolUse hooks
mcp_server/tools/           — 4 tools: get_customer, lookup_order, process_refund, escalate_to_human
context/scratchpad.py       — threading.Lock added for parallel subagent writes
\`\`\`

### Claude Code CLI (Track 2)
\`\`\`
.claude/skills/multi-agent-coordinator/SKILL.md   — coordinator skill (allowed-tools: Task)
.claude/skills/customer-verification/SKILL.md     — subagent (allowed-tools: get_customer)
.claude/skills/order-investigation/SKILL.md       — subagent (allowed-tools: lookup_order)
.claude/skills/resolution/SKILL.md                — subagent (allowed-tools: process_refund, escalate)
\`\`\`

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
`

const COORDINATOR_SKILL = `---
# EXAM CONCEPT (Task 1.2, 1.3): Multi-agent coordinator skill.
#
# context: fork
#   Runs this skill in an ISOLATED sub-agent context.
#   The coordinator has its own fresh context — not the user's main session.
#
# allowed-tools: Task
#   The coordinator's ONLY tool is the Task tool (Claude Code's built-in subagent spawner).
#   This directly maps to the Python SDK's spawn_subagent custom tool.
#   Restricting to Task enforces that the coordinator delegates rather than acts directly.
#
# KEY EXAM DISTINCTION:
#   Python SDK: spawn_subagent = custom tool we defined in coordinator.py
#   Claude Code: Task = native built-in tool with the same semantics
#   Both: emit multiple calls in ONE response → parallel execution

context: fork
allowed-tools: Task
argument-hint: "Describe the customer's full message including all their concerns"
---

# Multi-Agent Customer Support Coordinator

You are a coordinator for TechCo customer support. Your job is to decompose the customer
request in $ARGUMENTS into discrete concerns and delegate each to a specialized subagent
using the Task tool.

## AVAILABLE SUBAGENTS (invoke via Task tool)

- **customer-verification**: looks up a customer by email or ID. Returns customer ID, name, tier.
- **order-investigation**: checks a specific order's status and return eligibility.
- **resolution**: processes refunds or creates escalation tickets.

## SEQUENCING RULES

1. **Always spawn customer-verification FIRST** (sequential — you need the customer ID).
2. After getting the customer ID, **spawn multiple subagents IN PARALLEL** in one response
   for independent concerns (e.g., check 3 orders simultaneously).
3. After investigation, spawn resolution subagents with confirmed facts.

## CONTEXT ISOLATION RULE

Subagents have NO access to this conversation. Pass all needed facts explicitly:
\`\`\`
Customer ID: C001
Customer email: alice@example.com
Order ID: ORD-1001
Refund amount: $129.99
Reason: arrived damaged
\`\`\`

## ERROR HANDLING RULE

If a subagent reports failure:
- Check if the error is retryable (transient errors) — retry once if so
- Otherwise: note the failure and continue with remaining concerns

---

## How this maps to the exam

| Claude Code CLI | Python SDK analog |
|---|---|
| Task tool | spawn_subagent custom tool |
| context: fork on each skill | Fresh messages = [...] list per subagent |
| allowed-tools per skill | allowed_tool_names in AgentDefinition |
| Multiple Task calls in one response | ThreadPoolExecutor in coordinator.py |
`

const CUSTOMER_VERIFICATION_SKILL = `---
# EXAM CONCEPT (Task 2.3): Scoped tool distribution.
# This subagent receives ONLY get_customer — it cannot touch orders or refunds.
# Restricting tools improves tool selection reliability and enforces role separation.
#
# context: fork
#   ISOLATED context — does not inherit coordinator's conversation history.
#   All needed data must be passed in $ARGUMENTS.

context: fork
allowed-tools: mcp__support-tools__get_customer
argument-hint: "Provide customer email or customer ID (format: C###)"
---

# Customer Verification Subagent

You are a customer verification specialist for TechCo.

## Your ONLY job

Call the \`get_customer\` tool with the identifier in $ARGUMENTS.

## What to return

A concise structured summary:
\`\`\`
Customer ID: C001
Name: Alice Johnson
Account Status: active
Tier: gold
Email: alice@example.com
\`\`\`

## Error cases

- If the customer is **not found**: report clearly — "No customer found for [identifier]"
- If the account is **suspended**: report the status — the coordinator needs to know before proceeding

## What NOT to do

- Do NOT call lookup_order
- Do NOT call process_refund
- Do NOT call escalate_to_human

---

## Exam concept note

This skill demonstrates \`allowed-tools\` scoping (Task 2.3).
In the Python SDK, this maps to \`AgentDefinition(allowed_tool_names=["get_customer"])\`.
The restriction is enforced at the tool list level — the model physically cannot call
other tools even if it tries.
`

const ORDER_INVESTIGATION_SKILL = `---
# EXAM CONCEPT (Task 2.3): Scoped tool distribution.
# This subagent receives ONLY lookup_order — it cannot verify customers or process refunds.
# The coordinator must pass the verified_customer_id explicitly (context isolation rule).
#
# context: fork
#   ISOLATED context — no coordinator history inherited.

context: fork
allowed-tools: mcp__support-tools__lookup_order
argument-hint: "Provide order ID (ORD-####) and verified customer ID (C###)"
---

# Order Investigation Subagent

You are an order investigation specialist for TechCo.

## Your ONLY job

Call the \`lookup_order\` tool with the order ID and verified customer ID from $ARGUMENTS.

## What to return

A concise structured summary:
\`\`\`
Order ID: ORD-1001
Status: delivered
Total: $129.99
Return Eligible: Yes
Return Deadline: 2024-02-10
Today: 2024-01-20
Window Status: OPEN (21 days remaining)
\`\`\`

## Key reasoning rule

The \`lookup_order\` tool injects \`_today\` and \`_note\` fields via a PostToolUse hook.
Use \`_today\` vs \`return_deadline\` to determine if the return window is still open.

## What NOT to do

- Do NOT call get_customer (the coordinator already verified the customer)
- Do NOT call process_refund (that is the resolution subagent's job)

---

## Exam concept note

This skill demonstrates \`allowed-tools\` scoping (Task 2.3) and PostToolUse hook context
injection (Task 1.5). The \`_today\` field in the tool result is injected by \`post_tool_use_hook\`
in \`agent/hooks.py\` — normalizing dates and adding context the model needs for deadline reasoning.
`

const RESOLUTION_SKILL = `---
# EXAM CONCEPT (Task 2.3): Scoped tool distribution.
# This subagent receives process_refund + escalate_to_human — but NOT lookup tools.
# All facts are provided by the coordinator. The subagent acts, not investigates.
#
# context: fork
#   ISOLATED context — no coordinator history inherited.
#   All order facts must be in $ARGUMENTS.

context: fork
allowed-tools: mcp__support-tools__process_refund, mcp__support-tools__escalate_to_human
argument-hint: "Provide: action type (refund|escalate), customer_id, order_id, amount, reason"
---

# Resolution Subagent

You are a resolution specialist for TechCo. All facts you need are provided in $ARGUMENTS.

## For refund requests

Call \`process_refund\` with:
- \`order_id\`: from arguments
- \`verified_customer_id\`: from arguments
- \`refund_amount\`: from arguments
- \`reason\`: from arguments

Return: "Refund processed. Confirmation: REF-XXXXXXXX. Amount: $X.XX. Processing: 3-5 business days."

## For escalation requests

Call \`escalate_to_human\` with a **complete, self-contained** \`case_summary\`.

The case_summary MUST include: who the customer is, what they need, what was already done,
why escalation is needed, and recommended next action.
The human agent has **NO transcript access** — the summary is their only context.

## Escalation reasons

- \`policy_gap\`: when TechCo policy doesn't cover the request (e.g., competitor price matching)
- \`refund_above_threshold\`: when refund > $500 (PreToolUse hook intercepts automatically)
- \`customer_requested_human\`: explicit human request

## What NOT to do

- Do NOT call get_customer — coordinator already verified the customer
- Do NOT call lookup_order — coordinator already investigated the order

---

## Exam concept note

This skill demonstrates (Task 5.2) escalation criteria and (Task 1.4) structured handoff
summaries. The \`case_summary\` requirement ensures the human agent has everything they need
even without transcript access.
`

const SETTINGS_LOCAL = `{
  "permissions": {
    "allow": [
      "Skill(customer-verification)",
      "Skill(order-investigation)"
    ]
  }
}`

const CI_YML = `# CI pipeline — runs on every pull request targeting main
#
# Domain 3 coverage:
#   - Python lint & test: validates agent code quality
#   - Frontend build: catches broken React builds early
#   - claude-code-review: Claude Code CLI running non-interactively (--print mode)
#     to review changed Python files against CLAUDE.md conventions
#
# The claude-code-review job is the key Domain 3 CI/CD demonstration:
# Claude Code CLI can run without a TTY using --print flag, making it
# suitable for automated pipelines.

name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  python-lint-test:
    name: Python lint & test
    runs-on: ubuntu-latest
    strategy:
      matrix:
        project: [01-agent-loop/logic, 02-multi-agent/logic]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
          cache: pip
      - name: Install dependencies
        run: pip install ruff pytest -r requirements.txt
        working-directory: \${{ matrix.project }}
      - name: Lint (ruff)
        run: ruff check .
        working-directory: \${{ matrix.project }}
      - name: Test (pytest)
        run: |
          if [ -d tests ]; then pytest tests/ -v; else echo "No tests/ yet"; fi
        working-directory: \${{ matrix.project }}

  frontend-build:
    name: Frontend build
    runs-on: ubuntu-latest
    strategy:
      matrix:
        project:
          - 01-agent-loop/ui/frontend
          - 02-multi-agent/ui/frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: \${{ matrix.project }}/package-lock.json
      - name: Install & build
        run: npm ci && npm run build
        working-directory: \${{ matrix.project }}

  # ── Claude Code review (Domain 3 — CI/CD integration) ──────────────────────
  #
  # Demonstrates: running Claude Code CLI non-interactively in a CI pipeline.
  #
  # How it works:
  #   1. \`claude --print "..."\` runs Claude WITHOUT a TTY — no interactive session
  #   2. Changed Python files are extracted with \`git diff --name-only\`
  #   3. Each changed file is reviewed against agentic loop conventions
  #   4. Results are appended to \$GITHUB_STEP_SUMMARY (visible in Actions UI)
  #
  # Key exam concepts demonstrated:
  #   - Non-interactive mode (--print flag): runs headlessly in CI
  #   - ANTHROPIC_API_KEY as a GitHub Actions secret
  #   - Scoped file targeting via git diff (only review what changed)
  claude-code-review:
    name: Claude Code review
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install Claude Code CLI
        run: npm install -g @anthropic-ai/claude-code

      - name: Review changed Python files
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          CHANGED_FILES=$(git diff origin/\${{ github.base_ref }}...HEAD \\
            --name-only --diff-filter=AM | grep '\\.py$' || true)

          if [ -z "$CHANGED_FILES" ]; then
            echo "## Claude Code Review" >> \$GITHUB_STEP_SUMMARY
            echo "No Python files changed in this PR." >> \$GITHUB_STEP_SUMMARY
            exit 0
          fi

          echo "## Claude Code Review" >> \$GITHUB_STEP_SUMMARY
          echo "" >> \$GITHUB_STEP_SUMMARY

          for FILE in $CHANGED_FILES; do
            if [ ! -f "$FILE" ]; then continue; fi
            echo "### \\\`$FILE\\\`" >> \$GITHUB_STEP_SUMMARY

            # --print flag: Claude Code runs non-interactively, outputs to stdout
            # No TTY required — perfect for CI environments
            claude --print "Review the following file for agentic loop best practices.
          Check for:
          1. Loops must terminate on stop_reason == 'end_turn', not on text content
          2. Tool errors must use structured responses with errorCategory and isRetryable
          3. Hooks (pre_tool_use / post_tool_use) used for deterministic policy enforcement
          4. Subagents must not inherit coordinator context — all context passed explicitly
          Be concise. Flag issues with severity (CRITICAL / WARNING / INFO).
          File: $FILE
          $(cat $FILE)" >> \$GITHUB_STEP_SUMMARY

            echo "" >> \$GITHUB_STEP_SUMMARY
          done
`

// ─── Color palette for highlights ────────────────────────────────────────────

const C = {
  purple: 'rgba(124, 58, 237, 0.18)',
  blue:   'rgba(59, 130, 246, 0.18)',
  amber:  'rgba(245, 158, 11, 0.18)',
  green:  'rgba(16, 185, 129, 0.18)',
  red:    'rgba(239, 68, 68, 0.18)',
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

// ─── Combined Scenarios ────────────────────────────────────────────────────────
export const SCENARIOS = [
{
    id: 'standard_refund',
    type: 'single-agent',
    name: 'Standard Refund Request',
    domain: 'Domain 1 + 2 + 3',
    domainColor: '#3b82f6',
    description: 'Happy-path tool sequence: get_customer → lookup_order → process_refund.',
    concepts: ['Agentic loop lifecycle (stop_reason)', 'Tool sequence enforcement', 'Structured error responses', 'Tool description best practices'],
    codeTabs: [
      {
        name: 'agent_loop.py',
        language: 'python',
        content: AGENT_LOOP_CODE,
        highlights: [
          { start: 1,  end: 1,  color: 'rgba(245,158,11,0.22)'  },   // amber: MAX_ITERATIONS
          { start: 20, end: 23, color: 'rgba(16,185,129,0.22)'  },   // green: end_turn termination
          { start: 26, end: 31, color: 'rgba(59,130,246,0.18)'  },   // blue: append assistant
          { start: 44, end: 45, color: 'rgba(124,58,237,0.22)'  },   // purple: append results
        ],
        explanation: [
          {
            color: '#f59e0b',
            badge: 'Anti-pattern (Task 1.1)',
            title: 'MAX_ITERATIONS is a safety cap, not the stop condition',
            body: 'Using the iteration count as the primary termination mechanism is an exam anti-pattern. A correct agent loop runs as long as Claude keeps requesting tool calls and stops only when Claude returns end_turn — regardless of how many iterations that takes.',
          },
          {
            color: '#10b981',
            badge: 'Task 1.1 — Correct termination',
            title: 'stop_reason == "end_turn" is the only valid exit condition',
            body: 'The exam tests that you check response.stop_reason, not text content. Checking whether "done" or "finished" appears in the response text is an anti-pattern — the model might say that mid-task, or never say it at all.',
          },
          {
            color: '#3b82f6',
            badge: 'Task 1.1 — Continuation',
            title: 'Append assistant message before tool results',
            body: 'When stop_reason == "tool_use", the assistant turn (containing the tool call requests) must be appended to the message history before adding tool results. Skipping this breaks the alternating user/assistant structure the API requires.',
          },
          {
            color: '#7c3aed',
            badge: 'Task 1.1 — Full context',
            title: 'Tool results go back into messages so Claude has full context',
            body: 'Tool results are appended as a "user" message. This is how Claude learns what the tool returned and decides its next action. Missing this step causes the agent to loop endlessly or hallucinate results.',
          },
        ],
      },
      {
        name: 'get_customer.py',
        language: 'python',
        content: GET_CUSTOMER_CODE,
        highlights: [
          { start: 7,  end: 14, color: 'rgba(124,58,237,0.22)' },  // purple: full description
          { start: 11, end: 11, color: 'rgba(59,130,246,0.25)'  },  // blue: boundary line
          { start: 27, end: 29, color: 'rgba(239,68,68,0.2)'    },  // red: error fields
        ],
        explanation: [
          {
            color: '#7c3aed',
            badge: 'Task 2.1 — Tool descriptions',
            title: 'The description is the primary tool-selection mechanism',
            body: 'The model chooses which tool to call based almost entirely on the description field. A minimal description like "Retrieves customer information" causes misrouting — the model may call lookup_order instead. Good descriptions state what the tool does, when to use it, when NOT to use it, input format, and edge cases.',
          },
          {
            color: '#3b82f6',
            badge: 'Task 2.1 — Boundary clarity',
            title: '"Do NOT use for order details — use lookup_order for that"',
            body: 'Explicitly stating the boundary between similar tools is critical. Without this, the model may use get_customer to fetch order information (or vice versa), especially for ambiguous requests like "look up order ORD-1001 for alice@example.com".',
          },
          {
            color: '#ef4444',
            badge: 'Task 2.2 — Structured errors',
            title: 'errorCategory + isRetryable prevent wasted retries',
            body: 'All tools return structured errors with errorCategory (transient | validation | business | permission) and isRetryable. This lets the coordinator decide: retry on transient failures, don\'t retry on validation or business errors. Without isRetryable, a naive agent retries a "customer not found" error indefinitely.',
          },
        ],
      },
      {
        name: 'lookup_order.py',
        language: 'python',
        content: LOOKUP_ORDER_CODE,
        highlights: [
          { start: 17, end: 20, color: 'rgba(16,185,129,0.22)'  },  // green: verified_customer_id param
          { start: 21, end: 21, color: 'rgba(16,185,129,0.35)'  },  // green strong: required line
          { start: 28, end: 32, color: 'rgba(239,68,68,0.2)'    },  // red: permission error
          { start: 35, end: 41, color: 'rgba(124,58,237,0.18)'  },  // purple: trim output
        ],
        explanation: [
          {
            color: '#10b981',
            badge: 'Task 1.4 — Programmatic prerequisites',
            title: 'verified_customer_id enforces the tool sequence deterministically',
            body: 'By making verified_customer_id a required parameter, the model literally cannot call lookup_order without first obtaining a customer ID from get_customer. This is deterministic enforcement. A prompt instruction ("call get_customer first") has a ~12% skip rate even with few-shot examples — the parameter requirement has a 0% skip rate.',
          },
          {
            color: '#ef4444',
            badge: 'Task 2.2 — Permission errors',
            title: 'Returning a permission error prevents cross-customer data access',
            body: 'If the order\'s customer_id doesn\'t match the verified_customer_id, a permission error is returned (not a 404). The distinction matters: a 404 ("not found") might prompt the agent to try a different order ID, while "permission" tells it to stop — the user is accessing someone else\'s order.',
          },
          {
            color: '#7c3aed',
            badge: 'Task 5.1 — Verbose output trimming',
            title: 'Real order records have 40+ fields — only return the 7 that matter',
            body: 'Returning the full record floods the context window with irrelevant data (billing address, warehouse ID, carrier tracking, etc.). Each extra field takes up tokens that could be used for reasoning. Trimming to only the fields needed for the current task keeps the agent focused and reduces cost.',
          },
        ],
      },
    ],
    configFiles: [
      {
        name: 'CLAUDE.md',
        path: 'logic/CLAUDE.md',
        language: 'markdown',
        content: CLAUDE_MD_CONTENT,
        highlights: [
          { start: 1,  end: 14, color: 'rgba(59,130,246,0.15)'  },  // blue: exam concept comment
          { start: 34, end: 35, color: 'rgba(245,158,11,0.25)'  },  // amber: @import lines
          { start: 36, end: 36, color: 'rgba(245,158,11,0.25)'  },
        ],
        explanation: [
          {
            color: '#3b82f6',
            badge: 'Task 3.1 — Configuration hierarchy',
            title: 'Project-level CLAUDE.md is version-controlled and shared with the whole team',
            body: 'There are three CLAUDE.md scopes: user-level (~/.claude/CLAUDE.md, personal, not in git), project-level (this file, committed to repo, applies to everyone who clones), and directory-level (applies only to that subtree). The exam tests that you know which scope is appropriate: team conventions go in project-level; personal preferences go in user-level.',
          },
          {
            color: '#f59e0b',
            badge: 'Task 3.1 — @import syntax',
            title: '@import keeps the main CLAUDE.md concise and modular',
            body: 'Instead of one 500-line CLAUDE.md, @import lets you split conventions by domain: testing rules in .claude/rules/testing.md, API conventions in .claude/rules/api-conventions.md. Each developer\'s session only loads the files relevant to what they\'re editing (if path-specific rules are used). This reduces token usage and keeps each rules file focused on a single concern.',
          },
        ],
      },
      {
        name: '.mcp.json',
        path: 'logic/.mcp.json',
        language: 'json',
        content: MCP_JSON_CONTENT,
        highlights: [
          { start: 2,  end: 5,  color: 'rgba(59,130,246,0.18)'  },  // blue: concept comments
          { start: 12, end: 21, color: 'rgba(16,185,129,0.18)'  },  // green: custom MCP server
          { start: 17, end: 20, color: 'rgba(245,158,11,0.25)'  },  // amber: env var expansion
          { start: 23, end: 35, color: 'rgba(124,58,237,0.15)'  },  // purple: community server
        ],
        explanation: [
          {
            color: '#3b82f6',
            badge: 'Task 2.4 — MCP scoping',
            title: 'Project-scoped .mcp.json is committed to git; user-scoped ~/.claude.json is personal',
            body: 'The MCP server configuration lives in .mcp.json at the project root. When committed to git, every developer who clones the repo automatically gets the same MCP server configuration. Personal/experimental MCP servers (ones you don\'t want to share with the team) go in the user-scoped file.',
          },
          {
            color: '#f59e0b',
            badge: 'Task 2.4 — Credential handling',
            title: '${VAR} expansion — credentials never live in the config file',
            body: 'MCP server env blocks use ${VARIABLE_NAME} expansion. The actual values come from the shell environment or .env files (which are .gitignored). This pattern means the config file can be committed safely while secrets stay out of version control. The exam tests this: credentials in .mcp.json directly is an anti-pattern.',
          },
          {
            color: '#7c3aed',
            badge: 'Task 2.4 — Custom vs community servers',
            title: 'Use community MCP servers for standard integrations; reserve custom for team-specific logic',
            body: 'The filesystem server is from the @modelcontextprotocol/server-filesystem community package — no custom code needed. The support-tools server is custom (python -m mcp_server.server) because it wraps business-specific tools. The exam principle: don\'t build custom MCP servers when a community one exists; invest custom development only in workflows that are unique to your team or product.',
          },
        ],
      },
      {
        name: 'review-case.md',
        path: 'logic/.claude/commands/review-case.md',
        language: 'markdown',
        content: REVIEW_CASE_CONTENT,
        highlights: [
          { start: 1,  end: 7,  color: 'rgba(59,130,246,0.15)'  },  // blue: exam concept comment
          { start: 17, end: 17, color: 'rgba(245,158,11,0.25)'  },  // amber: $ARGUMENTS line
        ],
        explanation: [
          {
            color: '#3b82f6',
            badge: 'Task 3.2 — Slash commands',
            title: 'Project-scoped commands in .claude/commands/ are available to every team member',
            body: 'Any .md file in .claude/commands/ becomes a /slash-command in Claude Code. Project-scoped commands are version-controlled — when a developer pulls the latest code, they automatically get the team\'s latest commands. Personal commands (experiments, personal shortcuts) go in ~/.claude/commands/ and are not shared.',
          },
          {
            color: '#f59e0b',
            badge: 'Task 3.2 — $ARGUMENTS',
            title: '$ARGUMENTS passes the command\'s argument into the prompt template',
            body: 'When a developer runs /review-case ORD-1001, the string "ORD-1001" is injected wherever $ARGUMENTS appears in the markdown. This makes commands reusable across different inputs without duplicating the prompt. The command is invoked as a slash command in the Claude Code conversation.',
          },
        ],
      },
    ],
  },

  {
    id: 'large_refund',
    type: 'single-agent',
    name: 'Large Refund — Hook Interception',
    domain: 'Domain 1 + 3',
    domainColor: '#ef4444',
    description: 'Pre-tool hook intercepts process_refund ($799.99 > $500 threshold) and redirects to escalate_to_human.',
    concepts: ['PreToolUse hook (deterministic enforcement)', 'Hooks vs prompt instructions', 'Policy enforcement before execution', 'Redirect-to-tool on block'],
    codeTabs: [
      {
        name: 'hooks.py',
        language: 'python',
        content: HOOKS_CODE,
        highlights: [
          { start: 1,  end: 1,  color: 'rgba(245,158,11,0.22)'  },  // amber: threshold constant
          { start: 11, end: 22, color: 'rgba(239,68,68,0.18)'   },  // red: pre-tool block
          { start: 16, end: 16, color: 'rgba(245,158,11,0.30)'  },  // amber: redirect line
          { start: 26, end: 35, color: 'rgba(59,130,246,0.18)'  },  // blue: post-tool hook
        ],
        explanation: [
          {
            color: '#ef4444',
            badge: 'Task 1.5 — Deterministic enforcement',
            title: 'The hook fires BEFORE the tool runs — the model never sees a blocked call succeed',
            body: 'Pre-tool hooks intercept the tool call before execution. When the refund is $799.99, the hook returns allowed=False and the agent loop never calls process_refund.execute(). The model receives a policy enforcement message instead. This is fundamentally different from prompt instructions, which the model may choose to ignore.',
          },
          {
            color: '#f59e0b',
            badge: 'Task 1.5 — Redirect pattern',
            title: 'Instead of just blocking, the hook redirects to escalate_to_human',
            body: 'A simple block leaves the agent stuck — it knows it can\'t refund but doesn\'t know what to do next. By specifying redirect_tool="escalate_to_human" and providing pre-filled redirect_args, the hook also handles the recovery path. The agent receives an escalation confirmation as the tool result.',
          },
          {
            color: '#3b82f6',
            badge: 'Task 1.5 — PostToolUse',
            title: 'Post-tool hook normalizes data formats before the model reasons about them',
            body: 'Different backend services return dates in different formats (Unix timestamps, ISO 8601, "01/10/2024"). If the model sees mixed formats, it may calculate deadlines incorrectly. The post-tool hook normalizes everything to YYYY-MM-DD and injects _today so the model can do reliable deadline arithmetic without knowing what format the tool originally returned.',
          },
        ],
      },
      {
        name: 'process_refund.py',
        language: 'python',
        content: PROCESS_REFUND_CODE,
        highlights: [
          { start: 1,  end: 1,  color: 'rgba(245,158,11,0.22)' },  // amber: threshold
          { start: 18, end: 25, color: 'rgba(239,68,68,0.18)'  },  // red: safety-net block
          { start: 19, end: 20, color: 'rgba(239,68,68,0.32)'  },  // red strong: errorCategory + isRetryable
        ],
        explanation: [
          {
            color: '#f59e0b',
            badge: 'Task 1.5 — Defense in depth',
            title: 'The threshold check here is a safety net — the hook fires first',
            body: 'In a correctly wired system, the pre_tool_use hook intercepts large refunds before execute() is ever called. This in-function check exists as a second layer of defense. This is the defense-in-depth pattern: don\'t rely on a single enforcement point. If the hook is accidentally bypassed or misconfigured, the tool itself still enforces the rule.',
          },
          {
            color: '#ef4444',
            badge: 'Task 2.2 — Error categories',
            title: '"business" errorCategory signals a policy violation, not a technical failure',
            body: 'The four error categories map to different coordinator behaviors: transient (retry after delay), validation (fix input and retry), business (policy violation — don\'t retry, escalate), permission (access denied — don\'t retry). Using "business" here tells the coordinator this isn\'t a bug or temporary failure — retrying the exact same call will always produce the same result.',
          },
        ],
      },
    ],
    configFiles: [
      {
        name: 'CLAUDE.md',
        path: 'logic/CLAUDE.md',
        language: 'markdown',
        content: CLAUDE_MD_CONTENT,
        highlights: [
          { start: 24, end: 27, color: 'rgba(239,68,68,0.20)'   },  // red: tool sequence rule
          { start: 28, end: 33, color: 'rgba(245,158,11,0.20)'  },  // amber: error handling
          { start: 50, end: 55, color: 'rgba(59,130,246,0.18)'  },  // blue: code review checklist
        ],
        explanation: [
          {
            color: '#ef4444',
            badge: 'Task 3.1 — Prompt reinforcement',
            title: 'CLAUDE.md reinforces the tool sequence rule — hooks enforce it deterministically',
            body: 'Hooks enforce tool sequence at runtime with 100% reliability. But CLAUDE.md still includes the rule because it shapes the model\'s reasoning during code generation and review. When Claude helps a developer write a new tool, this rule in CLAUDE.md makes it less likely to accidentally generate code that skips customer verification.',
          },
          {
            color: '#f59e0b',
            badge: 'Task 3.1 — Shared standards',
            title: 'Error handling standards in CLAUDE.md apply to every tool file in the project',
            body: 'Without the error handling standard in CLAUDE.md, each developer invents their own error format. One returns {"error": "not found"}, another raises an exception, a third returns an empty result. The model then gets inconsistent signals across tools. A shared standard in CLAUDE.md means every new tool follows the same errorCategory + isRetryable pattern without the developer having to remember it.',
          },
        ],
      },
      {
        name: 'api-conventions.md',
        path: 'logic/.claude/rules/api-conventions.md',
        language: 'markdown',
        content: API_CONVENTIONS_CONTENT,
        highlights: [
          { start: 1,  end: 8,  color: 'rgba(59,130,246,0.15)'  },  // blue: frontmatter (path-specific)
          { start: 30, end: 41, color: 'rgba(239,68,68,0.18)'   },  // red: error response format
          { start: 43, end: 46, color: 'rgba(245,158,11,0.22)'  },  // amber: hook pattern in loop
          { start: 48, end: 55, color: 'rgba(16,185,129,0.18)'  },  // green: agentic loop pattern
        ],
        explanation: [
          {
            color: '#3b82f6',
            badge: 'Task 3.3 — Path-specific rules',
            title: 'The paths: frontmatter means these rules ONLY load for mcp_server/ and agent/ files',
            body: 'Path-specific rules (YAML frontmatter with paths: globs) reduce context noise. A developer editing extraction/case_extractor.py doesn\'t need to see MCP tool conventions. One editing agent/agent_loop.py does. Claude Code loads these rules only when the active file matches a glob pattern, keeping each session\'s context focused and reducing token usage.',
          },
          {
            color: '#ef4444',
            badge: 'Task 3.3 — Enforced conventions',
            title: 'The error response format here is the same standard as in CLAUDE.md — both reinforce it',
            body: 'The error format appears both in CLAUDE.md (project-wide) and in api-conventions.md (tool-file-specific). Redundancy is intentional: CLAUDE.md is always loaded, api-conventions.md loads when editing tool files. When a developer is inside get_customer.py, they see the exact format they need immediately — no need to scroll through a long CLAUDE.md.',
          },
        ],
      },
    ],
  },

  {
    id: 'explicit_escalation',
    type: 'single-agent',
    name: 'Explicit Human Request',
    domain: 'Domain 3 + 5',
    domainColor: '#f59e0b',
    description: 'Customer demands a human agent. Agent escalates immediately without attempting resolution first.',
    concepts: ['Correct escalation triggers', 'Sentiment ≠ escalation trigger', 'Self-contained escalation summaries', 'Few-shot examples in system prompt'],
    codeTabs: [
      {
        name: 'system_prompt.py',
        language: 'python',
        content: SYSTEM_PROMPT_CODE,
        highlights: [
          { start: 2,  end: 5,  color: 'rgba(245,158,11,0.22)'  },  // amber: facts at start
          { start: 13, end: 16, color: 'rgba(16,185,129,0.22)'  },  // green: correct triggers
          { start: 18, end: 21, color: 'rgba(239,68,68,0.22)'   },  // red: wrong triggers
          { start: 26, end: 35, color: 'rgba(59,130,246,0.15)'  },  // blue: few-shot examples
        ],
        explanation: [
          {
            color: '#f59e0b',
            badge: 'Task 5.1 — Lost in the middle',
            title: 'Case facts are injected at the START of the system prompt, not the end',
            body: 'Research shows models reliably process the beginning and end of long prompts but can miss content in the middle — the "lost in the middle" effect. Critical transactional facts (amounts, order IDs, deadlines) go at the beginning of the system prompt, outside the conversation history that gets progressively summarized.',
          },
          {
            color: '#10b981',
            badge: 'Task 5.2 — Explicit criteria',
            title: 'Escalation triggers are explicit conditions, not judgment calls',
            body: 'Vague instructions like "escalate when appropriate" or "be conservative" produce inconsistent behavior — the model interprets "appropriate" differently each time. Explicit criteria (customer explicitly requests human / refund > $500 / policy gap / unable to progress) give the model unambiguous rules that generalize correctly to novel cases.',
          },
          {
            color: '#ef4444',
            badge: 'Task 5.2 — Anti-patterns',
            title: 'Sentiment-based escalation is an exam anti-pattern',
            body: 'The exam explicitly tests this: a frustrated or angry customer is NOT a trigger for escalation. Frustration tells you nothing about case complexity. A customer yelling about a $50 refund has a simple case; a polite customer with a policy gap has a complex one. Escalating on sentiment reduces first-contact resolution rate without improving outcomes.',
          },
          {
            color: '#3b82f6',
            badge: 'Task 4.2 — Few-shot examples',
            title: 'Examples show reasoning, not just answers — enabling generalization',
            body: 'Few-shot examples are the most effective technique when detailed instructions still produce inconsistent results on novel cases. The key is including the Reasoning field that explains WHY the decision was made. "Resolve Example 1 because sentiment doesn\'t trigger escalation" teaches the model the principle, so it can apply it to cases not in the examples.',
          },
        ],
      },
      {
        name: 'escalate_to_human.py',
        language: 'python',
        content: ESCALATE_CODE,
        highlights: [
          { start: 3,  end: 9,  color: 'rgba(124,58,237,0.18)' },  // purple: when/when-not description
          { start: 14, end: 21, color: 'rgba(59,130,246,0.2)'  },  // blue: reason enum
          { start: 25, end: 32, color: 'rgba(245,158,11,0.22)' },  // amber: self-contained summary
        ],
        explanation: [
          {
            color: '#7c3aed',
            badge: 'Task 2.1 — Tool description',
            title: '"Do NOT use as first response to complex-sounding requests"',
            body: 'Without this explicit instruction in the description, the model may preemptively escalate cases it could resolve — especially if the system prompt has taught it that "complex-sounding = escalate." Including the boundary condition in the tool description itself catches the anti-pattern at the tool-selection layer, before any prompt instruction even runs.',
          },
          {
            color: '#3b82f6',
            badge: 'Task 5.2 — Escalation categories',
            title: 'The escalation_reason enum encodes all four valid triggers',
            body: 'Forcing the model to select from a fixed enum (customer_requested_human, refund_above_threshold, policy_gap, unable_to_progress, account_security_concern) serves two purposes: it prevents the model from inventing new escalation reasons, and it routes the ticket to the right human queue automatically based on reason.',
          },
          {
            color: '#f59e0b',
            badge: 'Task 1.4 — Self-contained handoff',
            title: 'The human agent has NO transcript access — the summary must be complete',
            body: 'This is one of the most commonly missed exam concepts. The human who picks up the escalation ticket cannot see the chat history. If the case_summary just says "customer wants a refund," the human agent has to call the customer back and start over. The summary must include: what the customer needs, what was already attempted, why it requires human escalation, and the recommended next action.',
          },
        ],
      },
    ],
    configFiles: [
      {
        name: 'SKILL.md',
        path: 'logic/.claude/skills/analyze-ticket/SKILL.md',
        language: 'markdown',
        content: ANALYZE_TICKET_SKILL_CONTENT,
        highlights: [
          { start: 1,  end: 19, color: 'rgba(59,130,246,0.12)'  },  // blue: frontmatter comments
          { start: 20, end: 20, color: 'rgba(245,158,11,0.30)'  },  // amber: context: fork
          { start: 21, end: 21, color: 'rgba(16,185,129,0.28)'  },  // green: allowed-tools
          { start: 22, end: 22, color: 'rgba(124,58,237,0.28)'  },  // purple: argument-hint
          { start: 44, end: 46, color: 'rgba(239,68,68,0.20)'   },  // red: escalation audit section
        ],
        explanation: [
          {
            color: '#f59e0b',
            badge: 'Task 3.2 — context: fork',
            title: 'context: fork runs the skill in an isolated sub-agent — output doesn\'t pollute your session',
            body: 'Without context: fork, a skill that produces a 200-line analysis report adds all of that to your main conversation context. On a long session, this can push earlier tool results out of the context window. Fork mode runs the skill in a separate agent context; only the final output (if any) returns to the main session. Use it for skills that generate lots of exploratory output.',
          },
          {
            color: '#10b981',
            badge: 'Task 3.2 — allowed-tools',
            title: 'allowed-tools: Read, Grep, Glob — this skill can read but not write or call APIs',
            body: 'Restricting tools to Read, Grep, Glob means this skill can analyze the codebase but cannot modify files or call external services. This is the principle of least privilege applied to skills: give the skill only what it needs. If a skill later needs write access, an explicit change to allowed-tools makes the expanded scope visible in code review.',
          },
          {
            color: '#ef4444',
            badge: 'Task 3.2 — Skills vs CLAUDE.md',
            title: 'Skills are on-demand; CLAUDE.md is always-loaded — different tools for different jobs',
            body: 'The exam tests this distinction explicitly. CLAUDE.md is for standards that should shape every interaction: tool sequence rules, error format conventions, code review criteria. Skills are for specific, invocable workflows: /analyze-ticket, /generate-report, /review-case. A skill that runs always would just be CLAUDE.md content. A CLAUDE.md instruction that requires explicit invocation should be a skill.',
          },
        ],
      },
      {
        name: 'CLAUDE.md',
        path: 'logic/CLAUDE.md',
        language: 'markdown',
        content: CLAUDE_MD_CONTENT,
        highlights: [
          { start: 42, end: 48, color: 'rgba(245,158,11,0.22)'  },  // amber: architecture notes
          { start: 50, end: 55, color: 'rgba(16,185,129,0.18)'  },  // green: code review checklist
        ],
        explanation: [
          {
            color: '#f59e0b',
            badge: 'Task 3.1 — Architecture in CLAUDE.md',
            title: 'Architecture notes let Claude navigate the codebase without repeated file searches',
            body: 'When a developer asks Claude to modify the escalation flow, the Architecture Notes section immediately tells Claude where to look: agent/hooks.py for hook logic, mcp_server/tools/escalate_to_human.py for the tool, prompts/system_prompt.py for the escalation criteria. Without this, Claude would spend tokens doing file searches before it could help.',
          },
        ],
      },
    ],
  },

  {
    id: 'multi_concern',
    type: 'single-agent',
    name: 'Multi-Concern Request',
    domain: 'Domain 1 + 3',
    domainColor: '#10b981',
    description: 'Two issues in one message: damaged item refund + wrong email on account. Agent identifies, investigates, and synthesizes.',
    concepts: ['Multi-concern decomposition', 'Parallel investigation', 'Unified response synthesis', 'Hub-and-spoke coordinator pattern'],
    codeTabs: [
      {
        name: 'agent_loop.py',
        language: 'python',
        content: AGENT_LOOP_CODE,
        highlights: [
          { start: 9,  end: 9,  color: 'rgba(16,185,129,0.22)'  },  // green: the while loop
          { start: 20, end: 23, color: 'rgba(16,185,129,0.22)'  },  // green: end_turn
          { start: 33, end: 43, color: 'rgba(124,58,237,0.18)'  },  // purple: tool execution loop
          { start: 44, end: 45, color: 'rgba(59,130,246,0.22)'  },  // blue: append results
        ],
        explanation: [
          {
            color: '#10b981',
            badge: 'Task 1.4 — Multi-concern',
            title: 'The agent loop naturally handles multi-concern requests via multiple iterations',
            body: 'The agent doesn\'t need special multi-concern logic. Because it loops until end_turn, Claude can use multiple tool calls across multiple iterations — get_customer, lookup_order for the damaged item, then follow-up calls for the email issue — and synthesize a unified response in its final end_turn message. The loop architecture handles this automatically.',
          },
          {
            color: '#7c3aed',
            badge: 'Task 1.2 — Hub-and-spoke',
            title: 'Each tool call goes through the coordinator — no direct agent-to-agent communication',
            body: 'In the hub-and-spoke pattern, the coordinator (this loop) handles all tool calls and aggregates results. Subagents (if used) have isolated context — they don\'t see each other\'s results or the coordinator\'s full history. All information flows through the coordinator, which decides what to delegate and how to combine results into the final response.',
          },
          {
            color: '#3b82f6',
            badge: 'Task 1.1 — Context accumulation',
            title: 'Multi-concern resolution depends on tool results accumulating in messages[]',
            body: 'By the time Claude writes the final response, messages[] contains the tool results from investigating both concerns. Claude has: the customer profile, the order status, the refund eligibility, and anything discovered about the email discrepancy — all in context. This is why appending every tool result to messages[] is essential, not optional.',
          },
        ],
      },
      {
        name: 'system_prompt.py',
        language: 'python',
        content: SYSTEM_PROMPT_CODE,
        highlights: [
          { start: 2,  end: 5,  color: 'rgba(245,158,11,0.22)'  },  // amber: facts injection
          { start: 13, end: 16, color: 'rgba(16,185,129,0.22)'  },  // green: correct triggers
          { start: 18, end: 21, color: 'rgba(239,68,68,0.22)'   },  // red: wrong triggers
          { start: 26, end: 35, color: 'rgba(59,130,246,0.15)'  },  // blue: examples
        ],
        explanation: [
          {
            color: '#10b981',
            badge: 'Task 1.4 — System prompt guidance',
            title: 'The system prompt instructs: identify each concern, investigate all, synthesize',
            body: 'The MULTI-CONCERN REQUESTS section tells Claude explicitly: (1) identify each distinct issue, (2) investigate all of them in the current session, (3) produce a unified response. Without this, Claude might address only the first concern mentioned, or ask the customer to submit a separate ticket for each issue — both of which hurt first-contact resolution rate.',
          },
          {
            color: '#f59e0b',
            badge: 'Task 5.1 — Case facts',
            title: 'Multi-concern sessions are where progressive summarization hurts most',
            body: 'A multi-concern session generates more tool calls and a longer conversation. Without a case facts block, progressive summarization might compress "order ORD-1001 for $129.99, return eligible" into "the customer\'s order" — losing the specific values needed to process the refund. The facts block keeps these numbers outside the summarized history.',
          },
        ],
      },
    ],
    configFiles: [
      {
        name: 'testing.md',
        path: 'logic/.claude/rules/testing.md',
        language: 'markdown',
        content: TESTING_MD_CONTENT,
        highlights: [
          { start: 1,  end: 12, color: 'rgba(59,130,246,0.12)'  },  // blue: path-specific frontmatter
          { start: 5,  end: 10, color: 'rgba(245,158,11,0.22)'  },  // amber: paths globs
          { start: 27, end: 32, color: 'rgba(16,185,129,0.18)'  },  // green: required test cases
          { start: 37, end: 41, color: 'rgba(239,68,68,0.18)'   },  // red: agentic loop tests
        ],
        explanation: [
          {
            color: '#3b82f6',
            badge: 'Task 3.3 — Why path-specific beats directory CLAUDE.md',
            title: 'Glob patterns load rules wherever test files live, not just in a tests/ directory',
            body: 'A directory-level CLAUDE.md in tests/ only applies to files in that directory. But this project co-locates test files with source (tools/test_get_customer.py next to tools/get_customer.py). The paths: globs **/*test*.py and **/test_*.py match test files wherever they live in the tree. This is one of the key advantages path-specific rules have over directory-level CLAUDE.md.',
          },
          {
            color: '#10b981',
            badge: 'Task 3.3 — Required test coverage',
            title: 'Defining required test cases in rules means Claude generates them automatically',
            body: 'When a developer asks Claude to write tests for a new tool, these rules are loaded because the test file matches the path globs. Claude sees: "5 required test cases: happy path, validation error, transient error, business rule error, boundary conditions." It generates all five without being asked. Without this rule file, Claude would write a single happy-path test and call it done.',
          },
          {
            color: '#ef4444',
            badge: 'Task 1.5 — Agentic loop tests',
            title: 'Rules require explicit hook interception tests — catches the defense-in-depth pattern',
            body: 'The testing rules explicitly require: "Test hook interception: submit a $600 refund and verify it\'s blocked." Without this rule, developers might test the process_refund tool in isolation (where the hook doesn\'t fire) and miss that the hook + tool together are what implement the threshold. The rule enforces end-to-end testing of the hook → redirect → escalation flow.',
          },
        ],
      },
      {
        name: 'CLAUDE.md',
        path: 'logic/CLAUDE.md',
        language: 'markdown',
        content: CLAUDE_MD_CONTENT,
        highlights: [
          { start: 42, end: 48, color: 'rgba(16,185,129,0.18)'  },  // green: architecture
          { start: 34, end: 36, color: 'rgba(245,158,11,0.25)'  },  // amber: @imports
        ],
        explanation: [
          {
            color: '#f59e0b',
            badge: 'Task 3.1 — @import in action',
            title: 'This CLAUDE.md imports testing.md — so test file edits load both',
            body: 'When a developer edits a test file, Claude Code loads the project CLAUDE.md (via @import) AND the path-specific testing.md (via glob match). Both sets of rules are active. CLAUDE.md provides project-wide context; testing.md provides test-specific guidance. The @import in CLAUDE.md means developers don\'t have to know about .claude/rules/ — they just work in the project and the right rules load.',
          },
        ],
      },
    ],
  },

  {
    id: 'structured_extraction',
    type: 'single-agent',
    name: 'Structured Extraction',
    domain: 'Domain 3 + 4',
    domainColor: '#a855f7',
    description: 'Extracts a structured case record from a conversation using tool_use JSON schemas with a validation-retry loop.',
    concepts: ['tool_choice: "any" (forces tool call)', 'Nullable fields prevent hallucination', 'Validation-retry with specific error feedback', 'tool_use vs prompt-only extraction'],
    codeTabs: [
      {
        name: 'case_extractor.py',
        language: 'python',
        content: EXTRACTOR_CODE,
        highlights: [
          { start: 1,  end: 4,  color: 'rgba(245,158,11,0.22)'  },  // amber: tool_choice options
          { start: 16, end: 20, color: 'rgba(16,185,129,0.22)'  },  // green: nullable fields
          { start: 33, end: 39, color: 'rgba(59,130,246,0.22)'  },  // blue: specific-error retry
          { start: 44, end: 44, color: 'rgba(124,58,237,0.35)'  },  // purple: tool_choice:"any" line
        ],
        explanation: [
          {
            color: '#f59e0b',
            badge: 'Task 4.3 — tool_choice',
            title: 'tool_choice: "auto" is unreliable for extraction — use "any"',
            body: 'With tool_choice: "auto", Claude may decide the conversational response is better than calling the tool — especially for short or simple inputs. This means your extraction sometimes gets a JSON string in a text message and sometimes gets a proper tool_use block. tool_choice: "any" guarantees the model calls a tool, eliminating this inconsistency entirely.',
          },
          {
            color: '#10b981',
            badge: 'Task 4.3 — Nullable fields',
            title: 'Making optional fields nullable prevents the model from fabricating values',
            body: 'If order_id is required but not mentioned in the conversation, the model will invent a plausible-looking order ID rather than fail schema validation. Marking it {"type": ["string", "null"]} lets the model return null for genuinely absent information. The exam specifically tests this: required fields with missing info → hallucination; nullable fields → honest null.',
          },
          {
            color: '#3b82f6',
            badge: 'Task 4.4 — Validation-retry',
            title: 'The retry message includes the specific error — not a generic "try again"',
            body: 'Generic retry messages are ineffective because the model doesn\'t know what changed. "Please try again" produces the same output with random variation. Including the FAILED EXTRACTION and the SPECIFIC VALIDATION ERROR (e.g., "customer_intent is \'other\' but customer_intent_detail is missing") gives the model exactly what it needs to make a targeted correction on the next attempt.',
          },
          {
            color: '#7c3aed',
            badge: 'Task 4.3 — Why tool_use beats prompt-only',
            title: 'tool_use with JSON schema eliminates syntax errors; validation catches semantic errors',
            body: 'Prompt-only extraction asks Claude to produce a JSON string in a text message. This introduces JSON syntax errors (missing commas, unmatched brackets) that require string parsing and error handling. tool_use with input_schema means the API validates the structure before returning it — you get a Python dict, not a string to parse. Semantic errors (wrong values, constraint violations) still require your own validation layer, which is what _validate_extraction() provides.',
          },
        ],
      },
    ],
    configFiles: [
      {
        name: 'api-conventions.md',
        path: 'logic/.claude/rules/api-conventions.md',
        language: 'markdown',
        content: API_CONVENTIONS_CONTENT,
        highlights: [
          { start: 1,  end: 8,  color: 'rgba(59,130,246,0.15)'  },  // blue: path-specific frontmatter
          { start: 43, end: 47, color: 'rgba(245,158,11,0.28)'  },  // amber: tool_choice section
          { start: 44, end: 44, color: 'rgba(239,68,68,0.30)'   },  // red: "auto only optional"
          { start: 45, end: 45, color: 'rgba(16,185,129,0.35)'  },  // green: "any when MUST call"
        ],
        explanation: [
          {
            color: '#f59e0b',
            badge: 'Task 3.3 — tool_choice in rules',
            title: 'The tool_choice guidance lives in api-conventions.md — loads whenever editing tool files',
            body: 'Because api-conventions.md loads whenever a developer edits anything in mcp_server/ or agent/, the tool_choice guidance is always visible when building extraction tools. When Claude helps write a new extractor, it sees: "use \'any\' when the model MUST call a tool (structured output workflows)" and automatically applies the correct setting — the developer doesn\'t need to remember this distinction.',
          },
          {
            color: '#ef4444',
            badge: 'Task 4.3 — Codified guidance',
            title: '"auto" is unreliable for extraction — this rule makes that explicit in the codebase',
            body: 'Putting the tool_choice guidance in a rules file (not just in developer memory or a README) means it survives team turnover. A new engineer who\'s never heard of the tool_choice issue will have Claude tell them "use \'any\' for structured extraction" because the rules file loads in their session. The convention becomes self-documenting.',
          },
        ],
      },
      {
        name: 'CLAUDE.md',
        path: 'logic/CLAUDE.md',
        language: 'markdown',
        content: CLAUDE_MD_CONTENT,
        highlights: [
          { start: 50, end: 55, color: 'rgba(124,58,237,0.18)'  },  // purple: checklist item 4 (nullable)
          { start: 53, end: 53, color: 'rgba(124,58,237,0.35)'  },  // purple strong: nullable rule
        ],
        explanation: [
          {
            color: '#7c3aed',
            badge: 'Task 3.1 — Review checklist',
            title: 'Code review checklist item 4: "mark optional fields nullable to prevent hallucination"',
            body: 'The CLAUDE.md code review checklist includes the nullable field rule. When a PR adds a new extraction schema, Claude Code\'s review (triggered by the /review-case command or the CI job) checks whether optional fields are nullable. A reviewer who forgets this exam concept will still catch it because CLAUDE.md includes it as a required review criterion.',
          },
        ],
      },
    ],
  },,

{
    id: 'multi_concern_parallel',
    type: 'multi-agent',
    name: 'Multi-Concern: Parallel Subagents',
    description: 'Alice has three simultaneous issues: a damaged item refund, an order status check, and a price-match request. Coordinator spawns multiple subagents in parallel.',
    domain: 'Domain 1 + 2 + 3',
    domainColor: '#3b82f6',
    concepts: ['hub-and-spoke', 'parallel execution', 'context isolation', 'scoped tools', 'structured errors'],

    codeTabs: [
      {
        name: 'coordinator.py',
        language: 'python',
        content: COORDINATOR_PY,
        highlights: [
          // spawn_subagent tool definition — Task 1.3
          { start: 34, end: 57, color: C.purple },
          // System prompt sequencing rules — Task 1.2
          { start: 59, end: 81, color: C.blue },
          // end_turn termination — Task 1.1
          { start: 107, end: 108, color: C.green },
          // Parallel execution with ThreadPoolExecutor — Task 1.3
          { start: 118, end: 133, color: C.amber },
        ],
        explanation: [
          {
            color: '#7c3aed', badge: 'Task 1.3',
            title: 'spawn_subagent = Python SDK analog of Claude Code\'s Task tool',
            body: 'In Claude Code, the built-in Task tool spawns subagents. In the Python SDK, we define spawn_subagent ourselves with the same semantics. The coordinator emits multiple tool calls in a SINGLE response to trigger parallel execution.',
          },
          {
            color: '#3b82f6', badge: 'Task 1.2',
            title: 'Context isolation rule in the system prompt',
            body: 'The CONTEXT ISOLATION RULE in the coordinator\'s system prompt explicitly tells it: subagents have no access to this conversation. Every data point must be passed in context_data — customer_id, order_id, refund_amount, reason.',
          },
          {
            color: '#f59e0b', badge: 'Task 1.3',
            title: 'ThreadPoolExecutor for parallel subagent execution',
            body: 'When the coordinator emits multiple spawn_subagent calls in one response, Python\'s ThreadPoolExecutor runs them concurrently. This is the direct equivalent of Claude Code emitting multiple Task tool calls in one response.',
          },
          {
            color: '#10b981', badge: 'Task 1.1',
            title: 'stop_reason == "end_turn" is the only correct termination signal',
            body: 'The loop terminates ONLY when stop_reason is "end_turn". Never parse text content or check for phrases like "I have completed all tasks". The API contract guarantees end_turn means the model has nothing left to do.',
          },
        ],
      },
      {
        name: 'subagents.py',
        language: 'python',
        content: SUBAGENTS_PY,
        highlights: [
          // AgentDefinition + SubagentResult dataclasses — Task 2.3 + 5.3
          { start: 34, end: 57, color: C.amber },
          { start: 59, end: 75, color: C.red },
          // Three scoped agent definitions — Task 2.3
          { start: 78, end: 101, color: C.amber },
          // scoped_tools filter — Task 2.3
          { start: 115, end: 124, color: C.amber },
          // fresh messages list — Task 1.2
          { start: 126, end: 141, color: C.blue },
          // Error propagation — Task 5.3
          { start: 160, end: 176, color: C.red },
        ],
        explanation: [
          {
            color: '#f59e0b', badge: 'Task 2.3',
            title: 'AgentDefinition.allowed_tool_names enforces scoped tool access',
            body: 'Each subagent definition lists ONLY the tools it needs. customer_verification_agent gets [get_customer], order_investigation gets [lookup_order], resolution gets [process_refund, escalate_to_human]. Fewer tools = better tool selection reliability.',
          },
          {
            color: '#3b82f6', badge: 'Task 1.2',
            title: 'Fresh messages list per subagent = context isolation',
            body: 'run_subagent creates a NEW messages list with only the context_data passed by the coordinator. The subagent has zero access to the coordinator\'s conversation history — it only sees what is explicitly provided.',
          },
          {
            color: '#ef4444', badge: 'Task 5.3',
            title: 'Structured error envelope lets coordinator reason about failures',
            body: 'On failure, SubagentResult(success=False, error_context={is_retryable, failure_type, alternatives}) is returned. The coordinator can check is_retryable and decide: retry, use alternative, or report partial failure to the customer.',
          },
        ],
      },
      {
        name: 'agent_loop.py',
        language: 'python',
        content: AGENT_LOOP_PY,
        highlights: [
          // end_turn termination — Task 1.1
          { start: 62, end: 63, color: C.green },
          // tool_use continuation — Task 1.1
          { start: 66, end: 67, color: C.blue },
          // pre_tool_use_hook — Task 1.5
          { start: 78, end: 86, color: C.purple },
          // post_tool_use_hook — Task 1.5
          { start: 107, end: 108, color: C.amber },
          // append tool results — Task 1.1
          { start: 119, end: 122, color: C.blue },
        ],
        explanation: [
          {
            color: '#10b981', badge: 'Task 1.1',
            title: 'The agentic loop: stop_reason drives all control flow',
            body: 'Only two stop_reason values matter: "end_turn" (done) and "tool_use" (continue). All other logic — tool execution, result formatting, history appending — exists to support these two branches.',
          },
          {
            color: '#7c3aed', badge: 'Task 1.5',
            title: 'PreToolUse hook enforces policy deterministically',
            body: 'pre_tool_use_hook runs BEFORE the tool executes. It can block the call (refund > threshold), redirect it (auto-escalate), or allow it. This is deterministic enforcement — not relying on the model to self-police.',
          },
          {
            color: '#f59e0b', badge: 'Task 1.5',
            title: 'PostToolUse hook normalizes output before the model sees it',
            body: 'post_tool_use_hook runs AFTER the tool returns. It can normalize timestamps, inject context (_today, _note), or trim verbose output. The model only ever sees the normalized version.',
          },
        ],
      },
    ],

    configFiles: [
      {
        name: 'CLAUDE.md',
        path: '02-multi-agent/logic/CLAUDE.md',
        language: 'markdown',
        content: CLAUDE_MD,
        highlights: [
          // Context Isolation section — Task 1.2
          { start: 40, end: 43, color: C.blue },
          // Tool Scope section — Task 2.3
          { start: 45, end: 50, color: C.amber },
          // Error Handling — Task 5.3
          { start: 52, end: 55, color: C.red },
          // Parallel vs Sequential — Task 1.3
          { start: 57, end: 61, color: C.green },
        ],
        explanation: [
          {
            color: '#3b82f6', badge: 'Task 1.2',
            title: 'CLAUDE.md enforces context isolation as a project rule',
            body: 'The "Context Isolation (CRITICAL)" section is a CLAUDE.md rule, not just a comment. When Claude Code works in this directory, it always has this constraint active — subagents must never inherit coordinator context.',
          },
          {
            color: '#f59e0b', badge: 'Task 2.3',
            title: 'Tool scope rules are codified per subagent role',
            body: 'The Tool Scope section maps each agent to its allowed tools. This serves as both documentation and an exam-facing statement of the design intent — each entry corresponds to an allowed-tools: line in the respective SKILL.md.',
          },
          {
            color: '#10b981', badge: 'Task 1.3',
            title: '@import for path-specific rules (testing.md)',
            body: '@import .claude/rules/testing.md loads a glob-scoped rule file. The testing.md rules only activate when editing test files (paths: "**/*test*.py"), not all files — this is CLAUDE.md\'s path-specific rule targeting.',
          },
        ],
      },
      {
        name: 'coordinator/SKILL.md',
        path: '02-multi-agent/logic/.claude/skills/multi-agent-coordinator/SKILL.md',
        language: 'markdown',
        content: COORDINATOR_SKILL,
        highlights: [
          // context: fork + allowed-tools: Task (frontmatter)
          { start: 18, end: 20, color: C.purple },
          // Multiple Task calls → parallel
          { start: 36, end: 39, color: C.amber },
          // Context isolation rule
          { start: 41, end: 49, color: C.blue },
          // Mapping table
          { start: 63, end: 69, color: C.green },
        ],
        explanation: [
          {
            color: '#7c3aed', badge: 'Task 1.3',
            title: 'context: fork + allowed-tools: Task = coordinator pattern in Claude Code',
            body: 'context: fork runs the skill in a fresh isolated context (not the user\'s session). allowed-tools: Task restricts the coordinator to ONLY the Task tool — forcing delegation rather than direct tool use. This is the Claude Code equivalent of SPAWN_SUBAGENT_TOOL.',
          },
          {
            color: '#f59e0b', badge: 'Task 1.3',
            title: 'Multiple Task calls in one response = parallel execution',
            body: 'The SEQUENCING RULES section explicitly instructs: spawn multiple subagents IN PARALLEL in one response. Claude Code translates this to multiple concurrent Task tool invocations — the same ThreadPoolExecutor pattern as the Python SDK.',
          },
          {
            color: '#10b981', badge: 'Exam',
            title: 'Mapping table: Claude Code CLI ↔ Python SDK analogs',
            body: 'The table at the bottom makes the exam connection explicit: Task tool ↔ spawn_subagent, context:fork ↔ fresh messages list, allowed-tools ↔ allowed_tool_names in AgentDefinition, multiple calls ↔ ThreadPoolExecutor.',
          },
        ],
      },
      {
        name: 'customer-verification/SKILL.md',
        path: '02-multi-agent/logic/.claude/skills/customer-verification/SKILL.md',
        language: 'markdown',
        content: CUSTOMER_VERIFICATION_SKILL,
        highlights: [
          // context: fork + allowed-tools (frontmatter)
          { start: 10, end: 12, color: C.amber },
          // What NOT to do section
          { start: 40, end: 45, color: C.red },
          // Exam concept note
          { start: 47, end: 53, color: C.green },
        ],
        explanation: [
          {
            color: '#f59e0b', badge: 'Task 2.3',
            title: 'allowed-tools: mcp__support-tools__get_customer — single tool only',
            body: 'The MCP tool name format is mcp__<server>__<tool>. This subagent is physically incapable of calling lookup_order or process_refund — they are not in its tool list. This is enforced at the API level, not just by instruction.',
          },
          {
            color: '#ef4444', badge: 'Task 2.3',
            title: '"What NOT to do" is enforced by allowed-tools, not just by instruction',
            body: 'Even if the subagent tried to call lookup_order, the API would reject it — the tool isn\'t in the list. The "What NOT to do" section exists for clarity, but allowed-tools makes the restriction structural.',
          },
        ],
      },
      {
        name: 'order-investigation/SKILL.md',
        path: '02-multi-agent/logic/.claude/skills/order-investigation/SKILL.md',
        language: 'markdown',
        content: ORDER_INVESTIGATION_SKILL,
        highlights: [
          // context: fork + allowed-tools (frontmatter)
          { start: 9, end: 11, color: C.amber },
          // PostToolUse hook note
          { start: 49, end: 52, color: C.purple },
          // Exam concept note
          { start: 54, end: 59, color: C.green },
        ],
        explanation: [
          {
            color: '#7c3aed', badge: 'Task 1.5',
            title: 'PostToolUse hook injects _today into lookup_order results',
            body: 'The lookup_order tool returns raw order data. The PostToolUse hook in hooks.py injects _today (normalized date) and _note (deadline comparison). The subagent\'s "Key reasoning rule" section tells it to use this injected context — a clean example of Task 1.5.',
          },
          {
            color: '#f59e0b', badge: 'Task 2.3',
            title: 'Coordinator must pass verified_customer_id explicitly',
            body: 'The argument-hint says "Provide order ID and verified customer ID" — both must come from the coordinator. The subagent cannot look up the customer itself (lookup_order requires both). This enforces the context isolation pattern.',
          },
        ],
      },
      {
        name: 'resolution/SKILL.md',
        path: '02-multi-agent/logic/.claude/skills/resolution/SKILL.md',
        language: 'markdown',
        content: RESOLUTION_SKILL,
        highlights: [
          // context: fork + allowed-tools: two tools
          { start: 10, end: 12, color: C.amber },
          // Escalation reasons
          { start: 45, end: 49, color: C.blue },
          // Exam concept note
          { start: 55, end: 61, color: C.green },
        ],
        explanation: [
          {
            color: '#f59e0b', badge: 'Task 2.3',
            title: 'Resolution gets two tools: process_refund + escalate_to_human',
            body: 'Unlike the other subagents which have one tool, resolution needs two — one for refunds, one for escalations. It still has NO lookup tools: it cannot call get_customer or lookup_order because all facts must come from the coordinator.',
          },
          {
            color: '#3b82f6', badge: 'Task 5.2',
            title: 'Escalation reasons are explicitly codified',
            body: 'Task 5.2 tests knowledge of WHEN to escalate. The four escalation reasons (policy_gap, refund_above_threshold, customer_requested_human, unable_to_progress) match the exam\'s escalation decision framework.',
          },
        ],
      },
      {
        name: 'settings.local.json',
        path: '02-multi-agent/logic/.claude/settings.local.json',
        language: 'json',
        content: SETTINGS_LOCAL,
        highlights: [
          { start: 1, end: 8, color: C.purple },
        ],
        explanation: [
          {
            color: '#7c3aed', badge: 'Domain 3',
            title: 'settings.local.json pre-approves specific skills',
            body: 'Skill(customer-verification) and Skill(order-investigation) are pre-approved — Claude Code won\'t prompt for permission each time. Note that multi-agent-coordinator and resolution are NOT pre-approved: they require explicit confirmation because they trigger more consequential actions.',
          },
          {
            color: '#3b82f6', badge: 'Domain 3',
            title: 'settings.local.json vs CLAUDE.md: different layers',
            body: 'settings.local.json controls TOOL PERMISSIONS (what Claude can do without asking). CLAUDE.md controls BEHAVIOR (how Claude should think and act). They are complementary: permissions say what is allowed, CLAUDE.md says how to use those permissions.',
          },
        ],
      },
      {
        name: 'ci.yml',
        path: '.github/workflows/ci.yml',
        language: 'yaml',
        content: CI_YML,
        highlights: [
          // frontend-build matrix including 02-multi-agent
          { start: 40, end: 49, color: C.green },
          // claude-code-review job header + explanation comments
          { start: 52, end: 67, color: C.purple },
          // Install Claude Code CLI step
          { start: 72, end: 73, color: C.amber },
          // claude --print invocation
          { start: 89, end: 103, color: C.purple },
        ],
        explanation: [
          {
            color: '#7c3aed', badge: 'Domain 3B',
            title: 'claude --print runs Claude Code non-interactively in CI',
            body: 'The --print flag makes Claude Code output results to stdout without a TTY. This is Domain 3\'s CI/CD integration pattern: the same Claude Code CLI that developers use interactively can run headlessly in GitHub Actions, CircleCI, or any pipeline.',
          },
          {
            color: '#f59e0b', badge: 'Domain 3B',
            title: 'ANTHROPIC_API_KEY as a GitHub Actions secret',
            body: 'The key is stored in GitHub Secrets (never in the repo) and injected as an env var. Claude Code CLI picks it up automatically — same as a developer\'s local .env. This pattern is exactly what the exam tests for Domain 3 CI/CD questions.',
          },
          {
            color: '#10b981', badge: 'Domain 3B',
            title: 'Scoped targeting: only review Python files that changed in this PR',
            body: 'git diff --name-only finds only files changed in this PR. Combined with grep \\.py$, only Python files are reviewed. This avoids reviewing unchanged code and keeps the review focused — a best practice for Claude Code in CI.',
          },
        ],
      },
    ],
  },

  {
    id: 'single_refund',
    type: 'multi-agent',
    name: 'Single Refund: Error Propagation',
    description: 'Bob has one damaged item. Exercises structured error propagation: SubagentResult(success=False, error_context={is_retryable}) and the coordinator retry logic.',
    domain: 'Domain 3 + 5',
    domainColor: '#f59e0b',
    concepts: ['SubagentResult', 'error_context', 'is_retryable', 'partial failure', 'scratchpad'],

    codeTabs: [
      {
        name: 'coordinator.py',
        language: 'python',
        content: COORDINATOR_PY,
        highlights: [
          // Error handling rule in system prompt — Task 5.3
          { start: 71, end: 78, color: C.red },
          // Sequential single subagent path — Task 1.3
          { start: 111, end: 115, color: C.blue },
          // end_turn check
          { start: 107, end: 108, color: C.green },
        ],
        explanation: [
          {
            color: '#ef4444', badge: 'Task 5.3',
            title: 'ERROR HANDLING RULE in system prompt: retry then proceed',
            body: 'The coordinator\'s system prompt tells it: check is_retryable. If True, retry once. If False, proceed with remaining concerns. This prevents a single transient failure from blocking the whole workflow.',
          },
          {
            color: '#3b82f6', badge: 'Task 1.3',
            title: 'Sequential path for single subagent (no ThreadPoolExecutor needed)',
            body: 'When the coordinator emits only one spawn_subagent call, we take the sequential path — no executor overhead. The parallel path (ThreadPoolExecutor) only activates for 2+ concurrent calls, keeping single-concern cases efficient.',
          },
        ],
      },
      {
        name: 'subagents.py',
        language: 'python',
        content: SUBAGENTS_PY,
        highlights: [
          // SubagentResult with error_context — Task 5.3
          { start: 59, end: 75, color: C.red },
          // Error propagation in except block — Task 5.3
          { start: 160, end: 176, color: C.red },
          // Scratchpad write — Task 5.4
          { start: 151, end: 157, color: C.amber },
        ],
        explanation: [
          {
            color: '#ef4444', badge: 'Task 5.3',
            title: 'SubagentResult.error_context is a structured error envelope',
            body: 'failure_type, error_detail, is_retryable, alternatives — the coordinator reads these fields to make retry decisions. Never return just a string on failure. Structured errors make the coordinator intelligent about partial failures.',
          },
          {
            color: '#f59e0b', badge: 'Task 5.4',
            title: 'Scratchpad.add_finding() writes results for coordinator synthesis',
            body: 'After each subagent completes, it writes a finding to the scratchpad. The coordinator reads these concise summaries during synthesis rather than verbose tool outputs. The scratchpad uses threading.Lock for concurrent write safety.',
          },
        ],
      },
      {
        name: 'agent_loop.py',
        language: 'python',
        content: AGENT_LOOP_PY,
        highlights: [
          // end_turn + tool_use checks
          { start: 62, end: 67, color: C.green },
          // pre_tool_use_hook intercepts refund
          { start: 78, end: 95, color: C.purple },
          // post_tool_use_hook normalizes
          { start: 107, end: 108, color: C.amber },
        ],
        explanation: [
          {
            color: '#7c3aed', badge: 'Task 1.5',
            title: 'PreToolUse hook intercepts process_refund calls above threshold',
            body: 'For single refunds, the PreToolUse hook checks: is this refund > $500? If so, it blocks the call and redirects to escalate_to_human automatically. The model doesn\'t need to decide — deterministic hook enforces the policy.',
          },
          {
            color: '#f59e0b', badge: 'Task 1.5',
            title: 'PostToolUse hook adds _today to lookup_order results',
            body: 'When lookup_order runs, PostToolUse injects _today and _note fields. The order investigation subagent then uses _today vs return_deadline to determine if the return window is still open — context that would otherwise require a separate lookup.',
          },
        ],
      },
    ],

    configFiles: [
      {
        name: 'CLAUDE.md',
        path: '02-multi-agent/logic/CLAUDE.md',
        language: 'markdown',
        content: CLAUDE_MD,
        highlights: [
          // Error Handling section — Task 5.3
          { start: 52, end: 55, color: C.red },
          // Parallel vs Sequential — for context on single-concern
          { start: 57, end: 61, color: C.blue },
          // Testing conventions
          { start: 63, end: 64, color: C.amber },
        ],
        explanation: [
          {
            color: '#ef4444', badge: 'Task 5.3',
            title: 'Error handling rule is a project-level CLAUDE.md contract',
            body: 'The Error Handling rule says: check is_retryable, retry once if True, proceed otherwise. This is not just a code comment — it\'s a CLAUDE.md behavioral rule that Claude Code enforces when running in this project directory.',
          },
          {
            color: '#f59e0b', badge: 'Domain 3',
            title: '@import testing.md is a glob-scoped path-specific rule',
            body: 'The @import directive loads testing.md, which has paths: ["**/*test*.py", "tests/**/*"]. These rules ONLY activate when Claude is editing test files — not all files. This is CLAUDE.md\'s most advanced feature: targeted, scoped rule loading.',
          },
        ],
      },
      {
        name: 'resolution/SKILL.md',
        path: '02-multi-agent/logic/.claude/skills/resolution/SKILL.md',
        language: 'markdown',
        content: RESOLUTION_SKILL,
        highlights: [
          // refund processing instructions
          { start: 19, end: 26, color: C.green },
          // escalation criteria — Task 5.2
          { start: 45, end: 49, color: C.amber },
          // self-contained case summary
          { start: 30, end: 39, color: C.blue },
        ],
        explanation: [
          {
            color: '#10b981', badge: 'Task 5.2',
            title: 'Resolution SKILL.md handles both refund and escalation paths',
            body: 'For a single refund, the resolution subagent calls process_refund directly. If the PreToolUse hook blocks it (amount > threshold), the hook auto-redirects to escalate_to_human — the resolution agent may not even need to make that choice itself.',
          },
          {
            color: '#3b82f6', badge: 'Task 1.4',
            title: 'Self-contained case_summary for human agents (Task 1.4)',
            body: 'Task 1.4 tests: when handing off to a human, the summary must be fully self-contained — the human has no transcript access. The case_summary requirement in escalate_to_human enforces this: who, what, what was done, why escalating, recommended action.',
          },
        ],
      },
      {
        name: 'coordinator/SKILL.md',
        path: '02-multi-agent/logic/.claude/skills/multi-agent-coordinator/SKILL.md',
        language: 'markdown',
        content: COORDINATOR_SKILL,
        highlights: [
          // Error handling rule
          { start: 51, end: 56, color: C.red },
          // Sequential first rule
          { start: 32, end: 35, color: C.blue },
        ],
        explanation: [
          {
            color: '#ef4444', badge: 'Task 5.3',
            title: 'Error handling rule mirrors SubagentResult.is_retryable logic',
            body: 'The SKILL.md error handling rule says the same thing as the Python code\'s error_context.is_retryable check: if transient, retry; if not, continue. The skill makes this decision rule visible to Claude Code without it needing to infer it from code.',
          },
        ],
      },
      {
        name: 'ci.yml',
        path: '.github/workflows/ci.yml',
        language: 'yaml',
        content: CI_YML,
        highlights: [
          // claude-code-review job
          { start: 52, end: 103, color: C.purple },
          // --print flag usage
          { start: 89, end: 92, color: C.amber },
        ],
        explanation: [
          {
            color: '#7c3aed', badge: 'Domain 3B',
            title: '--print mode: the key to non-interactive Claude Code in CI',
            body: 'claude --print "prompt" outputs the response to stdout and exits. No session, no TTY, no interactive prompts. This single flag is what makes Claude Code usable in any CI system. The exam tests whether you know this flag exists and what it enables.',
          },
          {
            color: '#f59e0b', badge: 'Domain 3B',
            title: '$GITHUB_STEP_SUMMARY posts results to the PR review',
            body: 'Appending to $GITHUB_STEP_SUMMARY makes the Claude review visible directly in the GitHub Actions UI — on the PR checks page. This turns Claude Code into a code review bot that posts structured findings per changed file, per PR.',
          },
        ],
      },
    ],
  },
]
