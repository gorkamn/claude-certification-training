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

export const SCENARIOS = [
  {
    id: 'standard_refund',
    name: 'Standard Refund Request',
    domain: 'Domain 1 + 2',
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
    name: 'Large Refund — Hook Interception',
    domain: 'Domain 1 · Task 1.5',
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
    name: 'Explicit Human Request',
    domain: 'Domain 5 · Task 5.2',
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
    name: 'Multi-Concern Request',
    domain: 'Domain 1 · Task 1.4',
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
    name: 'Structured Extraction',
    domain: 'Domain 4 · Tasks 4.3 & 4.4',
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
  },
]
