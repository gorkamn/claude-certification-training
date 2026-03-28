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
Each tool must have a corresponding test file: `tests/test_{tool_name}.py`

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
- Never assert termination based on text content patterns
