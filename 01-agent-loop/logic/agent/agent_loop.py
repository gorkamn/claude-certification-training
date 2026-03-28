"""
Agentic loop — Domain 1, Tasks 1.1 & 1.2 exam focus areas:

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

EXAM CONCEPT (Task 1.2): Hub-and-spoke coordinator pattern:
  - Subagents have ISOLATED context — they do NOT inherit the coordinator's history.
  - All inter-agent communication routes through the coordinator.
  - Coordinator handles: task decomposition, delegation, result aggregation, error handling.
"""

import os
import sys
from typing import Any

# Force UTF-8 output on Windows to handle emoji/unicode in Claude responses
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import anthropic
from dotenv import load_dotenv

from mcp_server.tools import ALL_TOOLS, TOOL_EXECUTORS
from agent.hooks import pre_tool_use_hook, post_tool_use_hook, HookResult
from context.case_facts import extract_case_facts, format_case_facts_block
from context.scratchpad import Scratchpad

load_dotenv(override=True)

MAX_ITERATIONS = 20  # Safety cap — NOT the primary termination mechanism (exam anti-pattern)


def run_agent(
    user_message: str,
    session_id: str = "default",
    existing_facts: dict | None = None,
) -> str:
    """
    Run the customer support agent for a single customer interaction.

    EXAM CONCEPT: The loop continues while stop_reason == "tool_use"
    and terminates when stop_reason == "end_turn". This is the correct pattern.

    Args:
        user_message: The customer's request
        session_id: Used for scratchpad persistence across long sessions
        existing_facts: Previously extracted case facts (persisted outside summarized history)
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    # EXAM CONCEPT (Task 5.1): Case facts block — extracted transactional facts
    # (amounts, order IDs, statuses) persisted OUTSIDE summarized history.
    # This prevents progressive summarization from losing critical numbers.
    scratchpad = Scratchpad(session_id)
    case_facts = existing_facts or {}

    # Build the conversation — system prompt provides context, instructions, few-shot examples
    from prompts.system_prompt import build_system_prompt
    system_prompt = build_system_prompt(case_facts)

    messages: list[dict] = [{"role": "user", "content": user_message}]

    print(f"\n{'='*60}")
    print(f"CUSTOMER: {user_message}")
    print(f"{'='*60}")

    iteration = 0

    # =========================================================================
    # THE AGENTIC LOOP
    # EXAM CONCEPT: Loop control is based on stop_reason, not on content analysis
    # =========================================================================
    while iteration < MAX_ITERATIONS:
        iteration += 1
        print(f"\n[Iteration {iteration}] Calling Claude API...")

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=system_prompt,
            tools=ALL_TOOLS,
            messages=messages,
        )

        print(f"  stop_reason: {response.stop_reason}")

        # =====================================================================
        # TERMINATION CONDITION: stop_reason == "end_turn"
        # This is the correct way to detect completion — NOT parsing text content.
        # =====================================================================
        if response.stop_reason == "end_turn":
            final_text = _extract_text(response)
            print(f"\nAGENT: {final_text}")

            # Update case facts from the conversation
            updated_facts = extract_case_facts(messages, final_text)
            scratchpad.update(updated_facts)

            return final_text

        # =====================================================================
        # CONTINUATION CONDITION: stop_reason == "tool_use"
        # Execute all requested tools and append results to conversation history.
        # =====================================================================
        if response.stop_reason == "tool_use":
            # Append the assistant's response (which may include text + tool calls)
            messages.append({"role": "assistant", "content": response.content})

            # Collect all tool results to return in a single "tool" message
            tool_results = []

            for block in response.content:
                if block.type != "tool_use":
                    continue

                tool_name = block.name
                tool_input = block.input
                tool_use_id = block.id

                print(f"  Tool call: {tool_name}({tool_input})")

                # =============================================================
                # PRE-TOOL HOOK: Intercept and possibly block the tool call
                # EXAM CONCEPT (Task 1.5): Deterministic enforcement of business rules
                # =============================================================
                hook_result: HookResult = pre_tool_use_hook(tool_name, tool_input)

                if not hook_result.allowed:
                    print(f"  [HOOK BLOCKED] {hook_result.message}")

                    if hook_result.redirect_tool:
                        # Execute the redirect tool instead
                        print(f"  [HOOK REDIRECT] Executing {hook_result.redirect_tool}")
                        redirect_executor = TOOL_EXECUTORS.get(hook_result.redirect_tool)
                        if redirect_executor:
                            redirect_result = redirect_executor(hook_result.redirect_args or {})
                            redirect_result = post_tool_use_hook(
                                hook_result.redirect_tool, redirect_result
                            )
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": tool_use_id,
                                "content": (
                                    f"[POLICY ENFORCEMENT] Original {tool_name} call blocked. "
                                    f"Reason: {hook_result.message}\n"
                                    f"Escalation result: {redirect_result['content'][0]['text']}"
                                ),
                            })
                    else:
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": f"[POLICY ENFORCEMENT] {hook_result.message}",
                            "is_error": True,
                        })
                    continue

                # =============================================================
                # EXECUTE THE TOOL
                # =============================================================
                executor = TOOL_EXECUTORS.get(tool_name)
                if not executor:
                    tool_result = {
                        "isError": True,
                        "content": [{"type": "text", "text": f"Unknown tool: {tool_name}"}],
                    }
                else:
                    tool_result = executor(tool_input)

                # =============================================================
                # POST-TOOL HOOK: Transform results before the model sees them
                # EXAM CONCEPT (Task 1.5): Normalize formats, trim verbose output
                # =============================================================
                tool_result = post_tool_use_hook(tool_name, tool_result)

                is_error = tool_result.get("isError", False)
                result_text = tool_result.get("content", [{}])[0].get("text", "")

                print(f"  Result ({'ERROR' if is_error else 'OK'}): {result_text[:80]}...")

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": result_text,
                    "is_error": is_error,
                })

            # =================================================================
            # APPEND ALL TOOL RESULTS to conversation history
            # EXAM CONCEPT (Task 1.1): Tool results must be in the conversation
            # so the model can reason about the next action with full context.
            # =================================================================
            messages.append({"role": "user", "content": tool_results})

        else:
            # Unexpected stop_reason — log and break
            print(f"  Unexpected stop_reason: {response.stop_reason}")
            break

    # Safety cap reached — this should rarely happen with correct loop design
    return "I was unable to complete the request within the allowed steps. Please try again or contact support."


def _extract_text(response) -> str:
    """Extract text content from a Claude response."""
    for block in response.content:
        if hasattr(block, "type") and block.type == "text":
            return block.text
    return ""
