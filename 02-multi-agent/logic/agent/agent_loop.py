"""
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

EXAM CONCEPT (Task 1.2): This function is reusable by both single agents and
subagents in the multi-agent pattern. Subagents pass scoped tools and executors,
so the same loop logic serves all agent types without code duplication.
"""

import sys

# Force UTF-8 output on Windows to handle emoji/unicode in Claude responses
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import anthropic

from agent.hooks import pre_tool_use_hook, post_tool_use_hook, HookResult

MAX_ITERATIONS = 20  # Safety cap — NOT the primary termination mechanism (exam anti-pattern)


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
    The coordinator calls it with only the spawn_subagent tool.

    Args:
        client: Anthropic API client
        system_prompt: System prompt for this agent
        messages: Initial conversation messages (ISOLATED per subagent — Task 1.2)
        tools: Tool definitions scoped to this agent's role
        tool_executors: Executor map scoped to this agent's role
        agent_label: Label for log output (e.g. "customer_verification_agent")
        max_iterations: Safety cap — loop terminates on stop_reason, not iteration count

    Returns:
        Final text response from the agent
    """
    iteration = 0

    # =========================================================================
    # THE AGENTIC LOOP
    # EXAM CONCEPT: Loop control is based on stop_reason, not on content analysis
    # =========================================================================
    while iteration < max_iterations:
        iteration += 1
        print(f"  [{agent_label} Iteration {iteration}] Calling Claude API...")

        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            system=system_prompt,
            tools=tools,
            messages=messages,
        )

        print(f"    stop_reason: {response.stop_reason}")

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

                print(f"    Tool call: {tool_name}({tool_input})")

                # =============================================================
                # PRE-TOOL HOOK: Intercept and possibly block the tool call
                # EXAM CONCEPT (Task 1.5): Deterministic enforcement of business rules
                # =============================================================
                hook_result: HookResult = pre_tool_use_hook(tool_name, tool_input)

                if not hook_result.allowed:
                    print(f"    [HOOK BLOCKED] {hook_result.message}")

                    if hook_result.redirect_tool:
                        print(f"    [HOOK REDIRECT] Executing {hook_result.redirect_tool}")
                        redirect_executor = tool_executors.get(hook_result.redirect_tool)
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
                executor = tool_executors.get(tool_name)
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

                print(f"    Result ({'ERROR' if is_error else 'OK'}): {result_text[:80]}...")

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
            print(f"    Unexpected stop_reason: {response.stop_reason}")
            break

    # Safety cap reached — this should rarely happen with correct loop design
    return "Agent reached iteration limit without completing the task."


def _extract_text(response) -> str:
    """Extract text content from a Claude response."""
    for block in response.content:
        if hasattr(block, "type") and block.type == "text":
            return block.text
    return ""
