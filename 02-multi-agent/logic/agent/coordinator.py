"""
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
  - Coordinator reports partial results to the customer with clear status per concern
"""

import os
from concurrent.futures import ThreadPoolExecutor, as_completed

import anthropic
from dotenv import load_dotenv

from agent.subagents import (
    AGENT_REGISTRY,
    SubagentResult,
    run_subagent,
)
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
                "description": (
                    "ALL context the subagent needs. "
                    "Include: customer_id, customer_email, order_id, amounts, reason. "
                    "The subagent has NO access to this conversation — be complete."
                ),
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
  - Never let one failure block all other resolutions

## SYNTHESIS RULE
After all subagents complete, write a unified response that:
  - Addresses EVERY concern the customer raised
  - Confirms what was done (refund confirmation numbers, ticket IDs)
  - Reports any partial failures honestly with next steps
  - Is concise and action-oriented (no jargon, no apologies)
"""


def run_coordinator(user_message: str, session_id: str = "coordinator") -> str:
    """
    Run the multi-agent coordinator for a customer request with multiple concerns.

    EXAM CONCEPT (Task 1.2): The coordinator is the hub. It:
      1. Receives the full customer request
      2. Decomposes it into discrete concerns
      3. Delegates each concern to a specialized subagent
      4. Aggregates all results
      5. Synthesizes a unified response

    Args:
        user_message: The customer's full message (may contain multiple concerns)
        session_id: For scratchpad persistence

    Returns:
        Synthesized response addressing all concerns
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    scratchpad = Scratchpad(session_id)

    # Coordinator's messages — grows as subagents report back
    messages: list[dict] = [{"role": "user", "content": user_message}]

    # Collected subagent results for coordinator to synthesize
    all_results: dict[str, SubagentResult] = {}

    print(f"\n{'='*60}")
    print("COORDINATOR STARTING")
    print(f"Customer: {user_message[:100]}...")
    print(f"{'='*60}")

    iteration = 0

    while iteration < MAX_COORDINATOR_ITERATIONS:
        iteration += 1
        print(f"\n[Coordinator Iteration {iteration}] Calling Claude API...")

        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            system=COORDINATOR_SYSTEM_PROMPT,
            tools=[SPAWN_SUBAGENT_TOOL],
            messages=messages,
        )

        print(f"  stop_reason: {response.stop_reason}")

        # =============================================================
        # TERMINATION: Coordinator is done — synthesize final response
        # =============================================================
        if response.stop_reason == "end_turn":
            final_text = _extract_text(response)
            print(f"\n{'='*60}")
            print(f"COORDINATOR FINAL RESPONSE:\n{final_text}")
            print(f"{'='*60}")

            # Save coordinator state to scratchpad for crash recovery
            scratchpad.save_agent_state("coordinator", {
                "completed_agents": list(all_results.keys()),
                "iteration_count": iteration,
            })

            return final_text

        # =============================================================
        # CONTINUATION: Execute spawn_subagent calls
        # EXAM CONCEPT (Task 1.3): Multiple calls in ONE response → parallel
        # =============================================================
        if response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": response.content})

            spawn_calls = [b for b in response.content if b.type == "tool_use"]

            if len(spawn_calls) > 1:
                print(f"\n  [PARALLEL EXECUTION] {len(spawn_calls)} spawn_subagent calls in single response")
            else:
                print("\n  [SEQUENTIAL] 1 spawn_subagent call")

            # =================================================================
            # EXAM CONCEPT (Task 1.3): Parallel execution via ThreadPoolExecutor.
            # All spawn calls in a single coordinator response run concurrently.
            # =================================================================
            tool_results = []

            if len(spawn_calls) == 1:
                # Sequential — only one subagent to call
                call = spawn_calls[0]
                result = _dispatch_subagent(call.input, session_id)
                all_results[call.id] = result
                tool_results.append(_format_result_for_coordinator(call.id, result))
            else:
                # PARALLEL execution for multiple independent subagent calls
                with ThreadPoolExecutor(max_workers=len(spawn_calls)) as executor:
                    futures = {
                        executor.submit(_dispatch_subagent, call.input, session_id): call
                        for call in spawn_calls
                    }

                    # Collect results as they complete (order may differ from submission)
                    completed_results: dict[str, SubagentResult] = {}
                    for future in as_completed(futures):
                        call = futures[future]
                        result = future.result()
                        completed_results[call.id] = result
                        all_results[call.id] = result

                # Preserve original call order for coordinator message (important for coherence)
                for call in spawn_calls:
                    tool_results.append(_format_result_for_coordinator(call.id, completed_results[call.id]))

            # Append all results as a single user message
            messages.append({"role": "user", "content": tool_results})

        else:
            print(f"  Unexpected stop_reason: {response.stop_reason}")
            break

    return "Coordinator reached iteration limit. Please contact human support."


def _dispatch_subagent(spawn_input: dict, session_id: str) -> SubagentResult:
    """
    Dispatch a single subagent call from the coordinator's spawn_subagent tool use.

    EXAM CONCEPT (Task 1.3): This is what runs in parallel via ThreadPoolExecutor.
    Each call is isolated — they share no state except the scratchpad.
    """
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
            error_context={
                "failure_type": "ConfigurationError",
                "attempted_task": task_prompt,
                "error_detail": f"No agent registered as '{agent_type}'",
                "is_retryable": False,
                "alternatives": ["Check agent_type spelling"],
            },
        )

    print(f"  -> Spawning: {agent_type}")
    print(f"     Task: {task_prompt[:80]}...")

    return run_subagent(
        definition=definition,
        task_prompt=task_prompt,
        context_data=context_data,
        session_id=session_id,
    )


def _format_result_for_coordinator(tool_use_id: str, result: SubagentResult) -> dict:
    """
    EXAM CONCEPT (Task 5.3): Format subagent result for the coordinator's context.

    Keep this CONCISE — verbose subagent outputs accumulate in the coordinator's
    message history and can exhaust the context window in long multi-agent sessions.

    Success: short findings summary + key structured data
    Failure: structured error envelope so coordinator can decide what to do next
    """
    if result.success:
        content = (
            f"[{result.agent_name}] SUCCESS\n"
            f"Findings: {result.findings[:500]}\n"
        )
    else:
        error = result.error_context or {}
        content = (
            f"[{result.agent_name}] FAILED\n"
            f"Failure type: {error.get('failure_type', 'unknown')}\n"
            f"Is retryable: {error.get('is_retryable', False)}\n"
            f"Error detail: {error.get('error_detail', 'unknown')}\n"
            f"Alternatives: {error.get('alternatives', [])}\n"
        )

    return {
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": content,
    }


def _extract_text(response) -> str:
    """Extract text content from a Claude response."""
    for block in response.content:
        if hasattr(block, "type") and block.type == "text":
            return block.text
    return ""
