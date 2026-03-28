"""
Case facts extraction — Domain 5, Task 5.1 exam focus areas:

EXAM CONCEPT: Progressive summarization loses critical transactional data.
When a long conversation is summarized, specific numbers (amounts, dates, order IDs)
get compressed into vague phrases like "the customer's refund" or "a recent order."

The solution: Extract critical facts into a SEPARATE persistent layer that:
  1. Is NOT summarized with the conversation history
  2. Is injected at the BEGINNING of each new prompt (most reliably processed position)
  3. Contains only atomic, verified facts — not interpretations

EXAM CONCEPT (Task 5.1): "Lost in the middle" effect.
Models reliably process information at the BEGINNING and END of long inputs,
but may omit findings from middle sections. Key findings → beginning of prompt.

EXAM CONCEPT (Task 5.1): Trim verbose tool outputs.
A 40-field order record contains mostly irrelevant data. Extract only the 5-6
fields needed for the current task before appending to conversation context.
"""

import re
from typing import Any


# Fields to extract and persist across context boundaries
FACT_PATTERNS = {
    "verified_customer_id": r"'customer_id':\s*'([^']+)'",
    "customer_name": r"'name':\s*'([^']+)'",
    "account_status": r"'account_status':\s*'([^']+)'",
    "customer_tier": r"'tier':\s*'([^']+)'",
    "order_id": r"'order_id':\s*'([^']+)'",
    "order_status": r"'status':\s*'([^']+)'",
    "order_total": r"'total':\s*([\d.]+)",
    "return_eligible": r"'return_eligible':\s*(True|False)",
    "return_deadline": r"'return_deadline':\s*'([^']+)'",
    "refund_confirmation": r"'confirmation_number':\s*'([^']+)'",
    "escalation_ticket": r"'ticket_id':\s*'([^']+)'",
}


def extract_case_facts(
    messages: list[dict],
    final_response: str = "",
) -> dict[str, Any]:
    """
    Extract critical facts from the conversation and tool results.

    EXAM CONCEPT: These facts are extracted from tool results (not from summaries)
    to ensure they are the raw, verified values — not paraphrases.

    Args:
        messages: Full conversation history including tool results
        final_response: The agent's final response text

    Returns:
        Dict of verified facts to persist across context boundaries
    """
    facts: dict[str, Any] = {}

    # Scan all tool results for structured data
    for message in messages:
        content = message.get("content", "")

        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    text = block.get("content", "") or block.get("text", "")
                    _extract_from_text(text, facts)
        elif isinstance(content, str):
            _extract_from_text(content, facts)

    # Also scan the final response for confirmation numbers
    if final_response:
        _extract_from_text(final_response, facts)

    return facts


def _extract_from_text(text: str, facts: dict) -> None:
    """Extract fact patterns from a text string."""
    if not text or not isinstance(text, str):
        return

    for fact_key, pattern in FACT_PATTERNS.items():
        match = re.search(pattern, text)
        if match:
            value = match.group(1)
            # Don't overwrite already-extracted facts (first occurrence wins)
            if fact_key not in facts:
                facts[fact_key] = value


def format_case_facts_block(facts: dict) -> str:
    """
    Format facts for injection into the system prompt.
    Placed at the beginning for maximum attention (mitigates lost-in-the-middle).
    """
    if not facts:
        return ""

    readable_names = {
        "verified_customer_id": "Verified Customer ID",
        "customer_name": "Customer Name",
        "account_status": "Account Status",
        "customer_tier": "Account Tier",
        "order_id": "Order ID",
        "order_status": "Order Status",
        "order_total": "Order Total ($)",
        "return_eligible": "Return Eligible",
        "return_deadline": "Return Deadline",
        "refund_confirmation": "Refund Confirmation #",
        "escalation_ticket": "Escalation Ticket",
    }

    lines = ["[VERIFIED CASE FACTS — do not re-verify unless customer disputes them]"]
    for key, value in facts.items():
        label = readable_names.get(key, key)
        lines.append(f"  {label}: {value}")

    return "\n".join(lines)


def trim_tool_output(raw_output: dict, relevant_fields: list[str]) -> dict:
    """
    EXAM CONCEPT (Task 5.1): Trim verbose tool outputs.

    A real order lookup might return 40+ fields. Only keep the ones
    relevant to the current task so they don't accumulate tokens in context.

    Example: For a return eligibility check, we only need:
      order_id, status, total, return_eligible, return_deadline
    Not: billing_address, ip_address, warehouse_id, carrier_tracking, etc.
    """
    if not isinstance(raw_output, dict):
        return raw_output
    return {k: v for k, v in raw_output.items() if k in relevant_fields}
