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

export const SCENARIOS = [
  {
    id: 'multi_concern',
    name: 'Multi-Concern: Parallel Subagents',
    description: 'Alice has three simultaneous issues: a damaged item refund, an order status check, and a price-match request. Coordinator spawns multiple subagents in parallel.',
    domain: 'Domain 1 + 2',
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
    name: 'Single Refund: Error Propagation',
    description: 'Bob has one damaged item. Exercises structured error propagation: SubagentResult(success=False, error_context={is_retryable}) and the coordinator retry logic.',
    domain: 'Domain 5',
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
