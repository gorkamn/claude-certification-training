"""
PreToolUse / PostToolUse hooks — Domain 1, Task 1.5 exam focus areas:

EXAM CONCEPT: Hooks provide DETERMINISTIC enforcement of business rules.
Prompt instructions ("don't process refunds above $500") have a non-zero failure
rate because the LLM may not always comply. Hooks guarantee compliance.

Two hook patterns tested on the exam:
  1. PostToolUse: intercepts tool RESULTS and transforms them before the model sees them.
     Use case: normalizing heterogeneous data formats (Unix timestamps, ISO 8601, etc.)
  2. Tool call interception (PreToolUse): blocks policy-violating calls before execution.
     Use case: blocking refunds above threshold, redirecting to escalation.

Key exam distinction:
  - Hooks = deterministic (100% compliance)
  - Prompt instructions = probabilistic (non-zero failure rate)
  - Choose hooks when business rules require GUARANTEED compliance.
"""

from datetime import datetime
from typing import Any

REFUND_THRESHOLD = 500.00


class HookResult:
    """Result from a hook — either allow, block, or transform."""

    def __init__(
        self,
        allowed: bool,
        transformed_result: dict | None = None,
        redirect_tool: str | None = None,
        redirect_args: dict | None = None,
        message: str | None = None,
    ):
        self.allowed = allowed
        self.transformed_result = transformed_result
        self.redirect_tool = redirect_tool
        self.redirect_args = redirect_args
        self.message = message


def pre_tool_use_hook(tool_name: str, tool_input: dict[str, Any]) -> HookResult:
    """
    EXAM CONCEPT (Task 1.5): Tool call interception hook.
    Called BEFORE the tool executes. Can block or redirect policy-violating calls.

    This implements the $500 refund threshold gate:
    - Blocks process_refund calls above threshold
    - Redirects to escalate_to_human workflow
    - The LLM never executes the blocked call — deterministic enforcement
    """
    if tool_name == "process_refund":
        refund_amount = float(tool_input.get("refund_amount", 0))
        if refund_amount > REFUND_THRESHOLD:
            print(
                f"\n[HOOK INTERCEPTED] process_refund blocked: "
                f"${refund_amount:.2f} > ${REFUND_THRESHOLD:.2f} threshold"
            )
            return HookResult(
                allowed=False,
                message=(
                    f"Refund of ${refund_amount:.2f} blocked by policy. "
                    f"Refunds above ${REFUND_THRESHOLD:.2f} require human approval. "
                    f"Use escalate_to_human to route this case."
                ),
                redirect_tool="escalate_to_human",
                redirect_args={
                    "customer_id": tool_input.get("verified_customer_id", "unknown"),
                    "escalation_reason": "refund_above_threshold",
                    "case_summary": (
                        f"Customer requesting refund of ${refund_amount:.2f} for "
                        f"order {tool_input.get('order_id', 'unknown')}. "
                        f"Reason: {tool_input.get('reason', 'not specified')}. "
                        f"Refund exceeds ${REFUND_THRESHOLD:.2f} automatic approval limit. "
                        f"Recommend: review order history and approve/deny based on customer tier."
                    ),
                    "order_id": tool_input.get("order_id"),
                    "refund_amount": refund_amount,
                    "priority": "high",
                },
            )

    return HookResult(allowed=True)


def post_tool_use_hook(tool_name: str, tool_result: dict[str, Any]) -> dict[str, Any]:
    """
    EXAM CONCEPT (Task 1.5): PostToolUse hook.
    Called AFTER the tool executes. Transforms results before the model processes them.

    Use cases:
    1. Normalize heterogeneous data formats (dates, timestamps, status codes)
    2. Trim verbose results (remove fields irrelevant to the agent's task)
    3. Inject metadata the agent needs (e.g., current date for deadline comparisons)

    This hook normalizes date formats across tools that might return:
      - Unix timestamps: 1704844800
      - ISO 8601: "2024-01-10T00:00:00Z"
      - US format: "01/10/2024"
    All normalized to "YYYY-MM-DD" for consistent model reasoning.
    """
    if tool_result.get("isError"):
        return tool_result  # Don't transform error responses

    content = tool_result.get("content", [{}])
    if not content:
        return tool_result

    text = content[0].get("text", "")

    # Try to parse as dict and normalize dates
    try:
        data = eval(text)  # In production: use ast.literal_eval or json.loads
        if isinstance(data, dict):
            data = _normalize_dates(data)
            data = _inject_context(data, tool_name)
            return {
                "isError": False,
                "content": [{"type": "text", "text": str(data)}],
            }
    except Exception:
        pass  # Return original if transformation fails

    return tool_result


def _normalize_dates(data: dict) -> dict:
    """
    EXAM CONCEPT: PostToolUse normalization of heterogeneous formats.
    Different backend systems may return dates in different formats.
    Normalizing before the model sees the data prevents reasoning errors.
    """
    date_fields = ["delivered_date", "return_deadline", "created_at", "updated_at"]
    for field in date_fields:
        if field in data and data[field] is not None:
            raw = data[field]
            # Normalize Unix timestamp
            if isinstance(raw, int):
                data[field] = datetime.fromtimestamp(raw).strftime("%Y-%m-%d")
            # Normalize US date format (MM/DD/YYYY)
            elif isinstance(raw, str) and "/" in raw:
                try:
                    data[field] = datetime.strptime(raw, "%m/%d/%Y").strftime("%Y-%m-%d")
                except ValueError:
                    pass
    return data


def _inject_context(data: dict, tool_name: str) -> dict:
    """Inject today's date so the agent can reason about deadlines."""
    if tool_name == "lookup_order" and "return_deadline" in data:
        data["_today"] = datetime.now().strftime("%Y-%m-%d")
        data["_note"] = (
            "Compare return_deadline to _today to determine if return window is still open."
        )
    return data
