"""
process_refund tool — Domain 1 & 2 exam focus areas:
  - Business error responses (policy violations) with isRetryable: False.
  - EXAM CONCEPT (Task 1.5): This tool is intercepted by a PostToolUse hook
    that blocks refunds above $500 — deterministic enforcement vs prompt instructions.
  - Structured handoff summaries when escalation is triggered.
"""

from typing import Any

REFUND_THRESHOLD = 500.00  # Hook intercepts above this amount

TOOL_DEFINITION = {
    "name": "process_refund",
    "description": (
        "Process a refund for a delivered order. "
        "Requires: verified customer ID (from get_customer) and order ID (from lookup_order). "
        "Only works on orders with return_eligible=True. "
        "Refunds above $500 require human approval and will be automatically escalated. "
        "Do NOT use for orders still in transit — those require a different process. "
        "Returns confirmation number on success."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "order_id": {
                "type": "string",
                "description": "Order ID confirmed via lookup_order (e.g. 'ORD-1001')",
            },
            "verified_customer_id": {
                "type": "string",
                "description": "Customer ID confirmed via get_customer (e.g. 'C001')",
            },
            "refund_amount": {
                "type": "number",
                "description": "Amount to refund in USD",
            },
            "reason": {
                "type": "string",
                "description": "Reason for refund (e.g. 'damaged item', 'wrong item received')",
            },
        },
        "required": ["order_id", "verified_customer_id", "refund_amount", "reason"],
    },
}

# Mock processed refunds (in-memory for demo)
processed_refunds: list[dict] = []


def execute(
    order_id: str,
    verified_customer_id: str,
    refund_amount: float,
    reason: str,
) -> dict[str, Any]:
    """
    Execute the process_refund tool.

    EXAM CONCEPT (Task 1.5 + Task 2.2):
    Refunds above REFUND_THRESHOLD are blocked by the PostToolUse hook in hooks.py
    BEFORE this function is called. If this function receives a large refund request,
    it means the hook layer was bypassed — we add a safety check here too.

    Business errors include isRetryable: False so the agent doesn't retry futilely.
    """
    order_id = order_id.strip().upper()
    verified_customer_id = verified_customer_id.strip().upper()
    refund_amount = float(refund_amount)

    # Safety net: business rule violation (hook should catch this first)
    if refund_amount > REFUND_THRESHOLD:
        return {
            "isError": True,
            "content": [
                {
                    "type": "text",
                    "text": (
                        "{'errorCategory': 'business', "
                        "'isRetryable': False, "
                        "'description': 'Refund of $"
                        + f"{refund_amount:.2f}"
                        + " exceeds the $"
                        + f"{REFUND_THRESHOLD:.2f}"
                        + " automatic approval limit. "
                        + "This case must be escalated to a human agent for approval.'}"
                    ),
                }
            ],
        }

    # Validation: negative refund amount
    if refund_amount <= 0:
        return {
            "isError": True,
            "content": [
                {
                    "type": "text",
                    "text": (
                        "{'errorCategory': 'validation', "
                        "'isRetryable': False, "
                        "'description': 'Refund amount must be greater than $0.'}"
                    ),
                }
            ],
        }

    # Process the refund (mock)
    import uuid
    confirmation = f"REF-{uuid.uuid4().hex[:8].upper()}"
    processed_refunds.append({
        "confirmation": confirmation,
        "order_id": order_id,
        "customer_id": verified_customer_id,
        "amount": refund_amount,
        "reason": reason,
    })

    return {
        "isError": False,
        "content": [
            {
                "type": "text",
                "text": str({
                    "confirmation_number": confirmation,
                    "refund_amount": refund_amount,
                    "order_id": order_id,
                    "status": "approved",
                    "processing_time": "3-5 business days",
                }),
            }
        ],
    }
