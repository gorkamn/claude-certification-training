"""
Instrumented coordinator for the web UI.

Wraps run_coordinator to capture:
  - execution trace (for flow diagram animation)
  - full message history (for conversation panel)
  - per-subagent results (for detail panels)

The trace format drives the frontend animation:
  { "actor": str, "action": str, "t": int, "message"?: str, "result"?: str }

  actors:  "coordinator" | "customer-verification" | "order-investigation" | "resolution"
  actions: "decompose" | "start" | "complete" | "synthesize" | "error"
  t:       logical timestamp (increments per coordinator iteration)
"""

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field

import anthropic
from dotenv import load_dotenv

from agent.agent_loop import run_agent_loop
from agent.subagents import AGENT_REGISTRY, SubagentResult, run_subagent
from context.scratchpad import Scratchpad

load_dotenv(override=True)

MAX_COORDINATOR_ITERATIONS = 15

# Map agent_type names to short display names for the flow diagram
ACTOR_DISPLAY = {
    "customer_verification_agent": "customer-verification",
    "order_investigation_agent": "order-investigation",
    "resolution_agent": "resolution",
}

SPAWN_SUBAGENT_TOOL = {
    "name": "spawn_subagent",
    "description": (
        "Delegate a specific task to a specialized subagent. "
        "The subagent has ISOLATED context — it does NOT see this conversation. "
        "You MUST pass ALL needed data in context_data explicitly. "
        "IMPORTANT: Emit MULTIPLE spawn_subagent calls in a SINGLE response to run them in PARALLEL. "
        "Parallel execution is faster — use it for independent concerns. "
        "Sequential execution (one call per response) is required only when one task "
        "depends on the result of a previous one (e.g., customer verification before order lookup)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "agent_type": {
                "type": "string",
                "enum": list(AGENT_REGISTRY.keys()),
                "description": "The type of specialized subagent to spawn.",
            },
            "task_prompt": {
                "type": "string",
                "description": "Clear description of exactly what the subagent must do.",
            },
            "context_data": {
                "type": "object",
                "description": "ALL context the subagent needs. Include: customer_id, order_id, amounts, reason.",
            },
        },
        "required": ["agent_type", "task_prompt", "context_data"],
    },
}

COORDINATOR_SYSTEM_PROMPT = """You are a multi-agent customer support coordinator for TechCo.

Your job: decompose the customer's request into discrete concerns and delegate each to
the right specialized subagent using the spawn_subagent tool.

## AVAILABLE SUBAGENTS
- customer_verification_agent: looks up customer by email or ID. Call this FIRST.
- order_investigation_agent: checks a specific order's status and return eligibility.
- resolution_agent: processes refunds or creates escalation tickets.

## SEQUENCING RULES
1. ALWAYS call customer_verification_agent FIRST — subagents need the verified customer ID.
2. After verification, spawn MULTIPLE subagents in ONE response for independent concerns.
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

## SYNTHESIS RULE
After all subagents complete, write a unified response that:
  - Addresses EVERY concern the customer raised
  - Confirms what was done (refund confirmation numbers, ticket IDs)
  - Reports any partial failures honestly with next steps
  - Is concise and action-oriented
"""


@dataclass
class CoordinatorWebResult:
    """Full result returned by the Lambda handler."""
    final_response: str
    trace: list          # Animation steps for flow diagram
    messages: list       # Full coordinator message history
    subagent_results: dict  # agent_type -> SubagentResult


def run_coordinator_for_web(user_message: str, session_id: str = "web_demo") -> CoordinatorWebResult:
    """
    Run the multi-agent coordinator with trace instrumentation for the web UI.

    Returns CoordinatorWebResult containing the trace (for animation), the full
    message history (for conversation panel), and subagent results (for detail).
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    scratchpad = Scratchpad(session_id)

    messages: list[dict] = [{"role": "user", "content": user_message}]
    all_results: dict[str, SubagentResult] = {}  # tool_use_id -> result
    all_results_by_type: dict[str, SubagentResult] = {}  # agent_type -> result

    trace: list[dict] = []
    logical_t = 0

    # ── t=0: coordinator starts decomposing ──────────────────────────────────
    trace.append({
        "actor": "coordinator",
        "action": "decompose",
        "t": logical_t,
        "message": "Received request. Analyzing concerns...",
    })

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

        # ── TERMINATION: coordinator synthesizes final response ────────────────
        if response.stop_reason == "end_turn":
            final_text = _extract_text(response)
            logical_t += 1
            trace.append({
                "actor": "coordinator",
                "action": "synthesize",
                "t": logical_t,
                "message": final_text[:300],
            })

            # Serialize subagent results for JSON
            serialized_results = {}
            for agent_type, result in all_results_by_type.items():
                actor = ACTOR_DISPLAY.get(result.agent_name, result.agent_name)
                serialized_results[actor] = {
                    "success": result.success,
                    "findings": result.findings[:500],
                    "error_context": result.error_context,
                }

            return CoordinatorWebResult(
                final_response=final_text,
                trace=trace,
                messages=_serialize_messages(messages),
                subagent_results=serialized_results,
            )

        # ── CONTINUATION: execute spawn_subagent calls ────────────────────────
        if response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": response.content})

            spawn_calls = [b for b in response.content if b.type == "tool_use"]
            logical_t += 1

            # Emit start events for each spawned subagent
            for call in spawn_calls:
                agent_type = call.input.get("agent_type", "unknown")
                actor = ACTOR_DISPLAY.get(agent_type, agent_type)
                trace.append({
                    "actor": actor,
                    "action": "start",
                    "t": logical_t,
                    "task": call.input.get("task_prompt", "")[:150],
                })

            tool_results = []

            if len(spawn_calls) == 1:
                call = spawn_calls[0]
                result = _dispatch_subagent_traced(call.input, session_id)
                all_results[call.id] = result
                all_results_by_type[call.input.get("agent_type", "")] = result
                tool_results.append(_format_result(call.id, result))

                actor = ACTOR_DISPLAY.get(call.input.get("agent_type", ""), "unknown")
                trace.append({
                    "actor": actor,
                    "action": "complete" if result.success else "error",
                    "t": logical_t,
                    "result": result.findings[:200] if result.success else str(result.error_context),
                })

            else:
                # Parallel execution
                with ThreadPoolExecutor(max_workers=len(spawn_calls)) as executor:
                    futures = {
                        executor.submit(_dispatch_subagent_traced, call.input, session_id): call
                        for call in spawn_calls
                    }
                    completed_results: dict[str, SubagentResult] = {}
                    for future in as_completed(futures):
                        call = futures[future]
                        result = future.result()
                        completed_results[call.id] = result
                        all_results[call.id] = result
                        all_results_by_type[call.input.get("agent_type", "")] = result

                        # Emit complete event as each parallel subagent finishes
                        actor = ACTOR_DISPLAY.get(call.input.get("agent_type", ""), "unknown")
                        trace.append({
                            "actor": actor,
                            "action": "complete" if result.success else "error",
                            "t": logical_t,
                            "result": result.findings[:200] if result.success else str(result.error_context),
                        })

                for call in spawn_calls:
                    tool_results.append(_format_result(call.id, completed_results[call.id]))

            messages.append({"role": "user", "content": tool_results})

        else:
            break

    return CoordinatorWebResult(
        final_response="Coordinator reached iteration limit.",
        trace=trace,
        messages=_serialize_messages(messages),
        subagent_results={},
    )


def _dispatch_subagent_traced(spawn_input: dict, session_id: str) -> SubagentResult:
    agent_type = spawn_input.get("agent_type", "")
    task_prompt = spawn_input.get("task_prompt", "")
    context_data = spawn_input.get("context_data", {})

    definition = AGENT_REGISTRY.get(agent_type)
    if not definition:
        return SubagentResult(
            agent_name=agent_type,
            success=False,
            findings=f"Unknown agent type: {agent_type}",
            structured_data={},
            error_context={"failure_type": "ConfigurationError", "is_retryable": False},
        )

    return run_subagent(
        definition=definition,
        task_prompt=task_prompt,
        context_data=context_data,
        session_id=session_id,
    )


def _format_result(tool_use_id: str, result: SubagentResult) -> dict:
    if result.success:
        content = f"[{result.agent_name}] SUCCESS\nFindings: {result.findings[:500]}"
    else:
        error = result.error_context or {}
        content = (
            f"[{result.agent_name}] FAILED\n"
            f"Failure type: {error.get('failure_type', 'unknown')}\n"
            f"Is retryable: {error.get('is_retryable', False)}\n"
            f"Error detail: {error.get('error_detail', 'unknown')}\n"
        )
    return {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}


def _serialize_messages(messages: list) -> list:
    """Convert anthropic message objects to JSON-serializable dicts."""
    result = []
    for msg in messages:
        role = msg.get("role", "")
        content = msg.get("content", "")

        if isinstance(content, str):
            result.append({"role": role, "content": content})
        elif isinstance(content, list):
            blocks = []
            for block in content:
                if hasattr(block, "type"):
                    if block.type == "text":
                        blocks.append({"type": "text", "text": block.text})
                    elif block.type == "tool_use":
                        blocks.append({
                            "type": "tool_use",
                            "id": block.id,
                            "name": block.name,
                            "input": block.input,
                        })
                elif isinstance(block, dict):
                    blocks.append(block)
            result.append({"role": role, "content": blocks})
    return result


def _extract_text(response) -> str:
    for block in response.content:
        if hasattr(block, "type") and block.type == "text":
            return block.text
    return ""
