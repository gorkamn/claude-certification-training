"""
Agentic loop — web variant.

This file is identical in logic to the original customer-support-agent version
but returns structured JSON instead of printing to stdout, so the web UI can
render the full conversation with tool calls, hook events, and iterations.

EXAM CONCEPTS DEMONSTRATED (same as original):
  Task 1.1 — Stop-reason-based loop termination
  Task 1.2 — Hub-and-spoke coordinator pattern
  Task 1.5 — Pre/post tool hooks for deterministic enforcement
"""

import os
from typing import Any

import anthropic
from dotenv import load_dotenv

from mcp_server.tools import ALL_TOOLS, TOOL_EXECUTORS
from agent.hooks import pre_tool_use_hook, post_tool_use_hook, HookResult
from context.case_facts import extract_case_facts

load_dotenv(override=True)

MAX_ITERATIONS = 20


def run_agent_for_web(
    user_message: str,
    session_id: str = "default",
    existing_facts: dict | None = None,
) -> dict:
    """
    Run the customer support agent and return the full conversation as
    JSON-serializable data for the web UI.

    Returns:
        {
            "messages": [...],      # Full conversation history
            "events": [...],        # Hook events, iterations, tool calls
            "final_response": str,  # Agent's last text response
            "iterations": int,
        }
    """
    client = anthropic.AnthropicBedrock()

    from prompts.system_prompt import build_system_prompt
    system_prompt = build_system_prompt(existing_facts or {})

    messages: list[dict] = [{"role": "user", "content": user_message}]
    events: list[dict] = []
    iteration = 0

    while iteration < MAX_ITERATIONS:
        iteration += 1
        events.append({"type": "iteration_start", "iteration": iteration})

        response = client.messages.create(
            model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
            max_tokens=4096,
            system=system_prompt,
            tools=ALL_TOOLS,
            messages=messages,
        )

        events.append({"type": "stop_reason", "value": response.stop_reason, "iteration": iteration})

        # =====================================================================
        # TERMINATION: stop_reason == "end_turn"
        # =====================================================================
        if response.stop_reason == "end_turn":
            final_text = _extract_text(response)
            messages.append({"role": "assistant", "content": _serialize_content(response.content)})

            # Extract transactional facts from the conversation
            extract_case_facts(messages, final_text)

            return {
                "messages": messages,
                "events": events,
                "final_response": final_text,
                "iterations": iteration,
            }

        # =====================================================================
        # CONTINUATION: stop_reason == "tool_use"
        # =====================================================================
        if response.stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": _serialize_content(response.content)})

            tool_results = []

            for block in response.content:
                if block.type != "tool_use":
                    continue

                tool_name = block.name
                tool_input = block.input
                tool_use_id = block.id

                # --- PRE-TOOL HOOK -------------------------------------------
                hook_result: HookResult = pre_tool_use_hook(tool_name, tool_input)

                if not hook_result.allowed:
                    events.append({
                        "type": "hook_blocked",
                        "tool": tool_name,
                        "message": hook_result.message,
                        "redirect_to": hook_result.redirect_tool,
                    })

                    if hook_result.redirect_tool:
                        redirect_executor = TOOL_EXECUTORS.get(hook_result.redirect_tool)
                        if redirect_executor:
                            redirect_result = redirect_executor(hook_result.redirect_args or {})
                            redirect_result = post_tool_use_hook(
                                hook_result.redirect_tool, redirect_result
                            )
                            redirect_text = redirect_result["content"][0]["text"]
                            events.append({
                                "type": "hook_redirect_result",
                                "tool": hook_result.redirect_tool,
                                "result_preview": redirect_text[:120],
                            })
                            tool_results.append({
                                "type": "tool_result",
                                "tool_use_id": tool_use_id,
                                "content": (
                                    f"[POLICY ENFORCEMENT] Original {tool_name} call blocked. "
                                    f"Reason: {hook_result.message}\n"
                                    f"Escalation result: {redirect_text}"
                                ),
                                "_hook_blocked": True,
                                "_redirect_to": hook_result.redirect_tool,
                            })
                    else:
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_use_id,
                            "content": f"[POLICY ENFORCEMENT] {hook_result.message}",
                            "is_error": True,
                            "_hook_blocked": True,
                        })
                    continue

                # --- EXECUTE TOOL --------------------------------------------
                executor = TOOL_EXECUTORS.get(tool_name)
                if not executor:
                    tool_result = {
                        "isError": True,
                        "content": [{"type": "text", "text": f"Unknown tool: {tool_name}"}],
                    }
                else:
                    tool_result = executor(tool_input)

                # --- POST-TOOL HOOK ------------------------------------------
                tool_result = post_tool_use_hook(tool_name, tool_result)

                is_error = tool_result.get("isError", False)
                result_text = tool_result.get("content", [{}])[0].get("text", "")

                events.append({
                    "type": "tool_call",
                    "tool": tool_name,
                    "input": tool_input,
                    "result_preview": result_text[:150],
                    "is_error": is_error,
                })

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": result_text,
                    "is_error": is_error,
                })

            messages.append({"role": "user", "content": tool_results})

        else:
            events.append({"type": "unexpected_stop_reason", "value": response.stop_reason})
            break

    return {
        "messages": messages,
        "events": events,
        "final_response": "Agent loop reached safety cap without completing.",
        "iterations": iteration,
    }


def _extract_text(response) -> str:
    for block in response.content:
        if hasattr(block, "type") and block.type == "text":
            return block.text
    return ""


def _serialize_content(content) -> list[dict]:
    """Convert Anthropic SDK objects to JSON-serializable dicts."""
    result = []
    for block in content:
        if hasattr(block, "type"):
            if block.type == "text":
                result.append({"type": "text", "text": block.text})
            elif block.type == "tool_use":
                result.append({
                    "type": "tool_use",
                    "id": block.id,
                    "name": block.name,
                    "input": block.input,
                })
        elif isinstance(block, dict):
            result.append(block)
    return result
