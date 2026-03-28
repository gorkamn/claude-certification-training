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
- `TOOL_DEFINITION` dict with: name, description, input_schema
- `execute(**kwargs)` function returning MCP-compatible response

## Tool Description Requirements (CRITICAL for tool selection reliability)
Tool descriptions MUST include:
1. What the tool does (1 sentence)
2. When to use it (specific trigger conditions)
3. When NOT to use it (distinguish from similar tools)
4. Input format with examples
5. What it returns
6. Edge cases and error conditions

BAD description: "Retrieves customer information"
GOOD description: See get_customer.py for the full pattern

## Error Response Format
All tool execute() functions must return this structure:
```python
# Success
{"isError": False, "content": [{"type": "text", "text": str(result)}]}

# Error
{"isError": True, "content": [{"type": "text", "text": str({
    "errorCategory": "transient|validation|business|permission",
    "isRetryable": True|False,
    "description": "Human-readable explanation"
})}]}
```

## tool_choice Configuration
- Use "auto" only when tool calling is optional
- Use "any" when the model MUST call a tool (structured output workflows)
- Use {"type": "tool", "name": "..."} to force a specific tool (e.g., extract_metadata first)

## Agentic Loop Pattern
```python
while True:
    response = client.messages.create(...)
    if response.stop_reason == "end_turn":
        break  # Correct termination
    if response.stop_reason == "tool_use":
        # execute tools, append results, continue
        ...
    # Do NOT check text content to decide termination
```
