"""
Subagent definitions — Domain 1, Tasks 1.2, 1.3, 2.3, 5.3, 5.4 exam focus areas:

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

EXAM CONCEPT (Task 5.4): Scratchpad integration.
Each subagent writes its findings to the shared scratchpad after completing,
so the coordinator reads concise summaries rather than verbose tool outputs.
"""

import os
from dataclasses import dataclass, field
from typing import Any

import anthropic
from dotenv import load_dotenv

from agent.agent_loop import run_agent_loop
from context.scratchpad import Scratchpad
from mcp_server.tools import ALL_TOOLS, TOOL_EXECUTORS

load_dotenv(override=True)


# =============================================================================
# EXAM CONCEPT (Task 1.2): AgentDefinition — the Python SDK analog of
# Claude Code's internal AgentDefinition with allowedTools and system prompt.
# =============================================================================
@dataclass
class AgentDefinition:
    """
    Defines a specialized subagent role.

    EXAM CONCEPT: This mirrors Claude Code's internal AgentDefinition concept:
      - name: identifies the subagent type
      - allowed_tool_names: scoped tool access (exam Task 2.3)
      - system_prompt: role-specific instructions
    """
    name: str
    description: str
    system_prompt: str
    allowed_tool_names: list[str]


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
    structured_data: dict   # Machine-readable key facts (for coordinator logic)
    error_context: dict | None = None   # Structured error envelope if success=False
    partial_results: dict | None = None  # Any data recovered before failure


# =============================================================================
# EXAM CONCEPT (Task 2.3): Three specialized subagents with SCOPED tools.
# Each gets only what it needs — not the full ALL_TOOLS list.
# =============================================================================

CUSTOMER_VERIFICATION_AGENT = AgentDefinition(
    name="customer_verification_agent",
    description="Verifies customer identity by looking up their account.",
    allowed_tool_names=["get_customer"],  # ONLY get_customer — cannot call order tools
    system_prompt=(
        "You are a customer verification specialist. "
        "Your ONLY job: call get_customer with the identifier provided. "
        "Return a concise summary: customer ID, name, tier, account status. "
        "If the customer is not found or suspended, report this clearly. "
        "Do NOT call any other tools. Do NOT attempt order lookups."
    ),
)

ORDER_INVESTIGATION_AGENT = AgentDefinition(
    name="order_investigation_agent",
    description="Investigates a specific order's status and return eligibility.",
    allowed_tool_names=["lookup_order"],  # ONLY lookup_order — cannot call refund tools
    system_prompt=(
        "You are an order investigation specialist. "
        "Your ONLY job: call lookup_order with the order ID and verified customer ID provided. "
        "Return a concise summary: order status, return_eligible, total amount, return_deadline. "
        "Compare return_deadline to _today (injected by hook) to report if window is open. "
        "If the order is in transit, report clearly that it is not yet eligible for return. "
        "Do NOT call any other tools. Do NOT process refunds."
    ),
)

RESOLUTION_AGENT = AgentDefinition(
    name="resolution_agent",
    description="Executes resolutions: processes refunds or creates escalation tickets.",
    allowed_tool_names=["process_refund", "escalate_to_human"],  # NO lookup tools
    system_prompt=(
        "You are a resolution specialist. All context you need is provided. "
        "For refund requests: call process_refund with the verified customer ID, order ID, "
        "refund amount, and reason provided. "
        "For escalations: call escalate_to_human with a complete case_summary — "
        "the human agent has NO transcript access, so the summary must be self-contained. "
        "For policy gaps (e.g., price matching): use escalation_reason='policy_gap'. "
        "NEVER call get_customer or lookup_order — all facts are provided in your context."
    ),
)

# Registry of all subagent definitions — coordinator looks up by agent_type name
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

    EXAM CONCEPT (Task 1.2 & 1.3): Context isolation.
    The subagent gets a FRESH messages list — it does NOT inherit the coordinator's
    conversation history. All needed context is passed explicitly via context_data.

    EXAM CONCEPT (Task 2.3): Scoped tool distribution.
    Only tools in definition.allowed_tool_names are passed to the API and executor.

    EXAM CONCEPT (Task 5.3): Structured error propagation.
    On failure, return SubagentResult(success=False, error_context={...}) so the
    coordinator can decide what to do — not a bare exception that crashes everything.

    Args:
        definition: The subagent's role definition (name, tools, system prompt)
        task_prompt: Specific task for this subagent to complete
        context_data: All facts the subagent needs (no coordinator history access)
        session_id: For scratchpad scoping

    Returns:
        SubagentResult with findings (success) or error_context (failure)
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
        name: executor
        for name, executor in TOOL_EXECUTORS.items()
        if name in definition.allowed_tool_names
    }

    # =========================================================================
    # EXAM CONCEPT (Task 1.2 & 1.3): ISOLATED context — fresh messages list.
    # The coordinator's entire history is NOT passed here.
    # Only the explicitly provided context_data is available to the subagent.
    # =========================================================================
    context_lines = ["## Context Provided by Coordinator"]
    for key, value in context_data.items():
        context_lines.append(f"  {key}: {value}")
    context_block = "\n".join(context_lines)

    print(f"\n  [CONTEXT ISOLATION] {definition.name}: isolated messages, no coordinator history")
    print(f"    Allowed tools: {definition.allowed_tool_names}")

    messages = [
        {
            "role": "user",
            "content": f"{context_block}\n\n## Task\n{task_prompt}",
        }
    ]

    # =========================================================================
    # Run the subagent using the shared agentic loop
    # =========================================================================
    try:
        final_text = run_agent_loop(
            client=client,
            system_prompt=definition.system_prompt,
            messages=messages,
            tools=scoped_tools,
            tool_executors=scoped_executors,
            agent_label=definition.name,
        )

        # =====================================================================
        # EXAM CONCEPT (Task 5.4): Write findings to scratchpad.
        # Coordinator reads these summaries — not verbose tool outputs.
        # =====================================================================
        scratchpad = Scratchpad(session_id)
        scratchpad.add_finding(
            agent=definition.name,
            finding=final_text[:500],  # Trim to keep scratchpad concise
            metadata={"context_data": context_data, "task": task_prompt[:200]},
        )

        print(f"    [{definition.name}] completed -> {final_text[:100]}...")

        return SubagentResult(
            agent_name=definition.name,
            success=True,
            findings=final_text,
            structured_data=context_data,  # Include provided context for coordinator reference
        )

    except Exception as exc:
        # =====================================================================
        # EXAM CONCEPT (Task 5.3): Structured error propagation.
        # Never let a single subagent failure crash the entire coordinator loop.
        # Return structured error so coordinator can retry or use alternatives.
        # =====================================================================
        error_context = {
            "failure_type": type(exc).__name__,
            "attempted_task": task_prompt[:200],
            "error_detail": str(exc),
            "is_retryable": _is_retryable_error(exc),
            "alternatives": _get_alternatives(definition.name),
        }
        print(f"    [{definition.name}] FAILED: {error_context['failure_type']}: {str(exc)[:100]}")

        return SubagentResult(
            agent_name=definition.name,
            success=False,
            findings=f"[FAILED] {definition.name}: {str(exc)}",
            structured_data={},
            error_context=error_context,
        )


def _is_retryable_error(exc: Exception) -> bool:
    """Determine if the error is worth retrying."""
    retryable_types = ("ConnectionError", "TimeoutError", "RateLimitError")
    return type(exc).__name__ in retryable_types


def _get_alternatives(agent_name: str) -> list[str]:
    """Suggest alternative approaches if this subagent fails."""
    alternatives = {
        "customer_verification_agent": [
            "Ask the customer to confirm their customer ID manually",
            "Try alternate email format",
        ],
        "order_investigation_agent": [
            "Retry once (transient errors have 10% rate in mock DB)",
            "Ask customer to confirm order ID",
        ],
        "resolution_agent": [
            "Escalate to human if refund processing fails",
        ],
    }
    return alternatives.get(agent_name, ["Escalate to human agent"])
