---
# Path-specific rules — only loaded when editing test files.
# EXAM CONCEPT (Task 3.3): Glob patterns apply regardless of directory location.
paths:
  - "**/*test*.py"
  - "**/test_*.py"
  - "tests/**/*"
---

# Testing Conventions for TechCo Multi-Agent Support

## Test Structure
Each component must have a corresponding test file: `tests/test_{component}.py`

## Required Test Cases for the Coordinator
1. Happy path — 3-concern case resolves with correct subagent sequence
2. Parallel execution — verify ThreadPoolExecutor fires for 2+ independent calls
3. Sequential enforcement — verify customer_verification runs before order investigation
4. Partial failure — one subagent fails, coordinator continues with remaining
5. Structured error propagation — failed subagent returns is_retryable=True, coordinator retries

## Required Test Cases for Each Subagent
1. Happy path — valid context_data, expected tool call and success result
2. Context isolation — verify subagent messages list starts fresh (no coordinator history)
3. Tool scope enforcement — verify subagent cannot call out-of-scope tools
4. Structured error on failure — verify SubagentResult(success=False, error_context={...})

## Hook Tests (shared with customer-support-agent)
- Verify process_refund > $500 is intercepted by pre_tool_use_hook
- Verify redirect to escalate_to_human fires automatically
- Verify post_tool_use_hook normalizes Unix timestamps and injects _today

## Scratchpad Tests
- Verify threading.Lock prevents corruption under concurrent writes
- Verify add_finding() is called after each subagent completes
- Verify get_resume_context() includes all subagent findings

## Agentic Loop Tests
- Verify loop terminates on stop_reason == "end_turn"
- Verify loop continues on stop_reason == "tool_use"
- Never assert termination based on text content patterns
