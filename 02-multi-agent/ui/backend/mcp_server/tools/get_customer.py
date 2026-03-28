"""
get_customer tool — Domain 2 exam focus areas:
  - Tool descriptions must clearly state: input format, example queries, edge cases,
    and boundaries vs similar tools (lookup_order).
  - Structured error responses: errorCategory, isRetryable, human-readable description.
  - Distinguishing access failures from valid empty results.
"""

from typing import Any

# Mock database of customers
CUSTOMERS_DB = {
    "C001": {
        "customer_id": "C001",
        "name": "Alice Johnson",
        "email": "alice@example.com",
        "account_status": "active",
        "tier": "gold",
        "phone": "+1-555-0101",
    },
    "C002": {
        "customer_id": "C002",
        "name": "Bob Smith",
        "email": "bob@example.com",
        "account_status": "active",
        "tier": "standard",
        "phone": "+1-555-0102",
    },
    "C003": {
        "customer_id": "C003",
        "name": "Carol White",
        "email": "carol@example.com",
        "account_status": "suspended",
        "tier": "standard",
        "phone": "+1-555-0103",
    },
}

EMAIL_INDEX = {c["email"]: c["customer_id"] for c in CUSTOMERS_DB.values()}


# EXAM CONCEPT: Tool description is the PRIMARY mechanism the LLM uses for tool selection.
# A minimal description ("Retrieves customer information") causes misrouting.
# This description clearly differentiates from lookup_order:
TOOL_DEFINITION = {
    "name": "get_customer",
    "description": (
        "Look up a customer account by customer ID (format: C###) or email address. "
        "Use this tool FIRST to verify who the customer is before performing any "
        "order operations or account changes. Returns account status, tier, and contact info. "
        "Do NOT use this for order details — use lookup_order for that. "
        "Example inputs: 'C001', 'alice@example.com'. "
        "Returns an error if the customer ID/email does not exist in the system. "
        "Returns a list when multiple accounts match (rare, requires disambiguation)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "identifier": {
                "type": "string",
                "description": "Customer ID (e.g. 'C001') or email address",
            }
        },
        "required": ["identifier"],
    },
}


def execute(identifier: str) -> dict[str, Any]:
    """
    Execute the get_customer tool.

    EXAM CONCEPT: Structured error responses with:
      - errorCategory: transient | validation | business | permission
      - isRetryable: bool — prevents wasted retry attempts on non-retryable errors
      - description: human-readable explanation the agent can relay to the customer
    """
    identifier = identifier.strip()

    # Validation error — wrong input format, not retryable
    if not identifier:
        return {
            "isError": True,
            "content": [
                {
                    "type": "text",
                    "text": (
                        "{'errorCategory': 'validation', "
                        "'isRetryable': False, "
                        "'description': 'Identifier cannot be empty. Provide a customer ID (C###) or email address.'}"
                    ),
                }
            ],
        }

    # Look up by customer ID
    if identifier.upper().startswith("C") and identifier[1:].isdigit():
        customer_id = identifier.upper()
        customer = CUSTOMERS_DB.get(customer_id)
        if not customer:
            return {
                "isError": True,
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "{'errorCategory': 'validation', "
                            "'isRetryable': False, "
                            "'description': 'No customer found with ID "
                            + customer_id
                            + ". Verify the ID or try searching by email.'}"
                        ),
                    }
                ],
            }
        return {"isError": False, "content": [{"type": "text", "text": str(customer)}]}

    # Look up by email
    if "@" in identifier:
        customer_id = EMAIL_INDEX.get(identifier.lower())
        if not customer_id:
            return {
                "isError": True,
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "{'errorCategory': 'validation', "
                            "'isRetryable': False, "
                            "'description': 'No customer found with email "
                            + identifier
                            + ". Check spelling or ask customer for their customer ID.'}"
                        ),
                    }
                ],
            }
        customer = CUSTOMERS_DB[customer_id]
        return {"isError": False, "content": [{"type": "text", "text": str(customer)}]}

    # Ambiguous identifier — not a valid ID or email format
    return {
        "isError": True,
        "content": [
            {
                "type": "text",
                "text": (
                    "{'errorCategory': 'validation', "
                    "'isRetryable': False, "
                    "'description': 'Unrecognized identifier format: "
                    + repr(identifier)
                    + ". Provide a customer ID like C001 or a full email address.'}"
                ),
            }
        ],
    }
