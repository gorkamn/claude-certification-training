"""
escalate_to_human tool — Domain 1 & 5 exam focus areas:
  - Task 1.4: Structured handoff summaries with customer ID, root cause, amount,
    recommended action — for human agents who lack transcript access.
  - Task 5.2: Escalation triggers: customer request, policy gaps, inability to progress.
  - EXAM CONCEPT: Escalation summaries must be self-contained; the human agent
    does NOT have access to the conversation transcript.
"""

from datetime import datetime
from typing import Any

TOOL_DEFINITION = {
    "name": "escalate_to_human",
    "description": (
        "Escalate this case to a human support agent. "
        "Use when: (1) the customer explicitly requests a human, "
        "(2) the required action exceeds your authorization (e.g. refunds over $500), "
        "(3) the situation involves a policy gap not covered by guidelines, or "
        "(4) you cannot make meaningful progress after attempting resolution. "
        "Do NOT use this as a first response to complex-sounding requests — "
        "attempt resolution first unless the customer explicitly demands it. "
        "Provide a complete summary; the human agent cannot access this conversation."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "customer_id": {
                "type": "string",
                "description": "Verified customer ID (e.g. 'C001')",
            },
            "escalation_reason": {
                "type": "string",
                "enum": [
                    "customer_requested_human",
                    "refund_above_threshold",
                    "policy_gap",
                    "unable_to_progress",
                    "account_security_concern",
                ],
                "description": "Category of escalation trigger",
            },
            "case_summary": {
                "type": "string",
                "description": (
                    "Complete self-contained summary for the human agent. Must include: "
                    "what the customer needs, what was attempted, why escalation is needed, "
                    "and recommended next action. The human agent has NO transcript access."
                ),
            },
            "order_id": {
                "type": "string",
                "description": "Relevant order ID if applicable",
            },
            "refund_amount": {
                "type": "number",
                "description": "Refund amount under review if applicable",
            },
            "priority": {
                "type": "string",
                "enum": ["low", "normal", "high", "urgent"],
                "description": "Case priority for queue routing",
            },
        },
        "required": [
            "customer_id",
            "escalation_reason",
            "case_summary",
            "priority",
        ],
    },
}

escalation_log: list[dict] = []


def execute(
    customer_id: str,
    escalation_reason: str,
    case_summary: str,
    priority: str,
    order_id: str | None = None,
    refund_amount: float | None = None,
) -> dict[str, Any]:
    """
    Execute the escalate_to_human tool.

    EXAM CONCEPT (Task 1.4): The case_summary must be a complete handoff document.
    Human agents who pick up this ticket have NO access to the conversation transcript.
    The summary must include: customer details, root cause, what was attempted,
    and recommended action — everything needed to resolve without re-asking the customer.
    """
    ticket_id = f"ESC-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

    escalation_record = {
        "ticket_id": ticket_id,
        "timestamp": datetime.now().isoformat(),
        "customer_id": customer_id,
        "escalation_reason": escalation_reason,
        "priority": priority,
        "order_id": order_id,
        "refund_amount": refund_amount,
        "case_summary": case_summary,
        "status": "queued",
        "assigned_to": None,
    }

    escalation_log.append(escalation_record)

    # In production: send to ticketing system, Slack, email, etc.
    print(f"\n[ESCALATION CREATED] Ticket: {ticket_id}, Priority: {priority}")
    print(f"  Customer: {customer_id}, Reason: {escalation_reason}")
    if order_id:
        print(f"  Order: {order_id}" + (f", Refund: ${refund_amount:.2f}" if refund_amount else ""))
    print(f"  Summary: {case_summary[:100]}...")

    return {
        "isError": False,
        "content": [
            {
                "type": "text",
                "text": str({
                    "ticket_id": ticket_id,
                    "status": "escalated",
                    "message": (
                        f"Case escalated to human support team. "
                        f"Ticket {ticket_id} created with {priority} priority. "
                        f"A human agent will contact the customer within "
                        f"{'1 hour' if priority in ('high', 'urgent') else '4 business hours'}."
                    ),
                }),
            }
        ],
    }
