"""
lookup_order tool — Domain 2 exam focus areas:
  - Description clearly differentiates from get_customer (handles order IDs, not customer IDs).
  - EXAM CONCEPT: Programmatic prerequisite enforcement — this tool checks that
    a verified_customer_id is provided, enforcing the get_customer -> lookup_order
    sequence that prompt instructions alone cannot guarantee.
  - Structured error responses with errorCategory and isRetryable.
"""

import random
from datetime import datetime, timedelta
from typing import Any

# Mock orders database — only 5 relevant fields returned (exam: trim verbose tool outputs)
ORDERS_DB = {
    "ORD-1001": {
        "order_id": "ORD-1001",
        "customer_id": "C001",
        "status": "delivered",
        "total": 129.99,
        "items": [{"name": "Laptop Stand", "qty": 1, "price": 129.99}],
        "delivered_date": "2024-01-10",
        "return_eligible": True,
        "return_deadline": "2024-02-10",
    },
    "ORD-1002": {
        "order_id": "ORD-1002",
        "customer_id": "C001",
        "status": "in_transit",
        "total": 49.99,
        "items": [{"name": "USB-C Hub", "qty": 1, "price": 49.99}],
        "delivered_date": None,
        "return_eligible": False,
        "return_deadline": None,
    },
    "ORD-1003": {
        "order_id": "ORD-1003",
        "customer_id": "C002",
        "status": "delivered",
        "total": 799.99,
        "items": [{"name": "4K Monitor", "qty": 1, "price": 799.99}],
        "delivered_date": "2024-01-05",
        "return_eligible": True,
        "return_deadline": "2024-02-05",
    },
}

# EXAM CONCEPT: Well-differentiated description prevents misrouting to get_customer
TOOL_DEFINITION = {
    "name": "lookup_order",
    "description": (
        "Retrieve order details by order ID (format: ORD-####). "
        "REQUIRES a verified customer ID from get_customer first — do not call this "
        "without first verifying the customer's identity via get_customer. "
        "Returns order status, items, total, delivery date, and return eligibility. "
        "Do NOT use this to look up customer account info — use get_customer for that. "
        "Example inputs: 'ORD-1001'. "
        "If order ID does not match the verified customer, returns a permission error."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "order_id": {
                "type": "string",
                "description": "Order ID in format ORD-#### (e.g. 'ORD-1001')",
            },
            "verified_customer_id": {
                "type": "string",
                "description": (
                    "Customer ID already confirmed by get_customer (e.g. 'C001'). "
                    "Required to prevent misidentified account errors."
                ),
            },
        },
        "required": ["order_id", "verified_customer_id"],
    },
}


def execute(order_id: str, verified_customer_id: str) -> dict[str, Any]:
    """
    Execute the lookup_order tool.

    EXAM CONCEPT (Task 1.4): Programmatic prerequisite enforcement.
    The verified_customer_id parameter programmatically enforces that get_customer
    was called first. This is deterministic — unlike prompt instructions which have
    a non-zero failure rate even with few-shot examples.
    """
    order_id = order_id.strip().upper()
    verified_customer_id = verified_customer_id.strip().upper()

    # Simulate transient failure 10% of the time (for error handling demo)
    if random.random() < 0.1:
        return {
            "isError": True,
            "content": [
                {
                    "type": "text",
                    "text": (
                        "{'errorCategory': 'transient', "
                        "'isRetryable': True, "
                        "'description': 'Order lookup service temporarily unavailable. "
                        "Retry in a few seconds.'}"
                    ),
                }
            ],
        }

    order = ORDERS_DB.get(order_id)

    if not order:
        return {
            "isError": True,
            "content": [
                {
                    "type": "text",
                    "text": (
                        "{'errorCategory': 'validation', "
                        "'isRetryable': False, "
                        "'description': 'Order " + order_id + " not found in the system.'}"
                    ),
                }
            ],
        }

    # Permission error — order belongs to a different customer
    if order["customer_id"] != verified_customer_id:
        return {
            "isError": True,
            "content": [
                {
                    "type": "text",
                    "text": (
                        "{'errorCategory': 'permission', "
                        "'isRetryable': False, "
                        "'description': 'Order " + order_id + " does not belong to customer "
                        + verified_customer_id + ". Cannot access another customer order.'}"
                    ),
                }
            ],
        }

    # EXAM CONCEPT (Task 5.1): Trim verbose tool outputs to only relevant fields.
    trimmed_order = {
        "order_id": order["order_id"],
        "status": order["status"],
        "total": order["total"],
        "items": order["items"],
        "delivered_date": order["delivered_date"],
        "return_eligible": order["return_eligible"],
        "return_deadline": order["return_deadline"],
    }

    return {"isError": False, "content": [{"type": "text", "text": str(trimmed_order)}]}
