"""
Structured data extraction pipeline — Domain 4, Tasks 4.3 & 4.4 exam focus areas:

EXAM CONCEPT (Task 4.3): tool_use with JSON schemas is the MOST RELIABLE approach
for guaranteed schema-compliant structured output. It eliminates JSON syntax errors
(malformed brackets, missing quotes) that occur with prompt-only extraction.

tool_choice options (heavily tested on exam):
  - "auto": model MAY return text instead of calling a tool (not reliable for extraction)
  - "any": model MUST call a tool, but can choose which (use when doc type is unknown)
  - {"type": "tool", "name": "..."}: model MUST call this specific tool (use to enforce order)

EXAM CONCEPT (Task 4.4): Validation-retry loop:
  - On schema validation failure: append the original doc + failed extraction + specific error
  - Retry is effective for: format mismatches, wrong field placement, structural errors
  - Retry is NOT effective when: the required information simply doesn't exist in the document
  - Track detected_pattern field to analyze false positive dismissal patterns

EXAM CONCEPT (Task 4.3): Nullable fields prevent hallucination.
  When fields are required but info isn't in the doc, the model fabricates values.
  Making fields nullable/optional lets the model return null instead of inventing data.
"""

import os
import json
from typing import Any

import anthropic
from dotenv import load_dotenv

load_dotenv(override=True)

# =============================================================================
# EXTRACTION TOOL SCHEMA
# EXAM CONCEPT: Schema design principles:
#   - nullable fields for info that may not exist (prevents hallucination)
#   - enum + "other" pattern for extensible categories
#   - required vs optional field distinction
#   - "unclear" enum value for ambiguous cases
# =============================================================================
CASE_EXTRACTION_TOOL = {
    "name": "extract_support_case",
    "description": (
        "Extract structured information from a customer support conversation. "
        "Use null for fields where information is not present in the conversation — "
        "do not guess or infer values not explicitly stated."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            # Required fields — always extractable
            "customer_intent": {
                "type": "string",
                "enum": [
                    "refund_request",
                    "order_status",
                    "account_issue",
                    "billing_dispute",
                    "product_complaint",
                    "return_request",
                    "other",
                ],
                "description": "Primary reason for contacting support",
            },
            "customer_intent_detail": {
                "type": "string",
                "description": (
                    "Required when customer_intent is 'other'. "
                    "Brief description of the actual intent."
                ),
            },
            "sentiment": {
                "type": "string",
                "enum": ["positive", "neutral", "frustrated", "angry", "unclear"],
                "description": "Customer's emotional tone during the interaction",
            },
            "resolution_status": {
                "type": "string",
                "enum": [
                    "resolved",
                    "escalated_to_human",
                    "pending_customer_action",
                    "unresolved",
                ],
                "description": "Outcome of the support interaction",
            },

            # NULLABLE fields — may not be present in every conversation
            "order_id": {
                "type": ["string", "null"],
                "description": "Order ID mentioned (null if not applicable)",
            },
            "refund_amount": {
                "type": ["number", "null"],
                "description": "Specific refund amount in USD (null if not mentioned)",
            },
            "confirmation_number": {
                "type": ["string", "null"],
                "description": "Refund or escalation confirmation number (null if not issued)",
            },
            "escalation_ticket_id": {
                "type": ["string", "null"],
                "description": "Human escalation ticket ID (null if not escalated)",
            },

            # Confidence and pattern tracking
            "confidence": {
                "type": "number",
                "description": "Model confidence in extraction accuracy, 0.0 to 1.0",
                "minimum": 0.0,
                "maximum": 1.0,
            },
            "detected_pattern": {
                "type": ["string", "null"],
                "description": (
                    "Code pattern or conversation structure that led to this classification. "
                    "Used for analyzing false positive patterns when findings are dismissed. "
                    "Example: 'customer_mentioned_amount_before_intent', 'implicit_return_request'"
                ),
            },
        },
        "required": [
            "customer_intent",
            "sentiment",
            "resolution_status",
            "confidence",
        ],
        # Optional fields not in required list: order_id, refund_amount, etc.
    },
}


def extract_case_summary(conversation_text: str, max_retries: int = 2) -> dict[str, Any]:
    """
    Extract structured case summary from a conversation using tool_use.

    EXAM CONCEPT (Task 4.4): Validation-retry loop implementation.
    On validation failure, the follow-up request includes:
      1. The original conversation
      2. The failed extraction
      3. The SPECIFIC validation error (not a generic "try again")
    This targeted feedback guides the model toward correction.
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    attempt = 0
    last_extraction = None
    last_error = None

    while attempt <= max_retries:
        attempt += 1

        # Build the prompt — on retry, include the failed extraction + specific error
        if attempt == 1:
            user_message = (
                "Extract structured information from this support conversation:\n\n"
                f"{conversation_text}"
            )
        else:
            # EXAM CONCEPT (Task 4.4): Retry-with-error-feedback
            # Include the original doc, failed extraction, AND the specific error.
            # Generic "try again" messages are ineffective.
            user_message = (
                "The previous extraction had a validation error. "
                "Please re-extract from the original conversation, fixing the specific error.\n\n"
                f"ORIGINAL CONVERSATION:\n{conversation_text}\n\n"
                f"FAILED EXTRACTION:\n{json.dumps(last_extraction, indent=2)}\n\n"
                f"SPECIFIC VALIDATION ERROR:\n{last_error}\n\n"
                "Please provide a corrected extraction."
            )

        print(f"\n[Extraction attempt {attempt}]")

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            tools=[CASE_EXTRACTION_TOOL],
            # EXAM CONCEPT: tool_choice "any" guarantees a tool is called
            # (prevents model from returning conversational text instead of structured data)
            tool_choice={"type": "any"},
            messages=[{"role": "user", "content": user_message}],
        )

        # Extract the tool_use block from the response
        tool_use_block = None
        for block in response.content:
            if hasattr(block, "type") and block.type == "tool_use":
                tool_use_block = block
                break

        if not tool_use_block:
            last_error = "Model returned text instead of tool call despite tool_choice='any'"
            print(f"  ERROR: {last_error}")
            continue

        extracted = tool_use_block.input
        last_extraction = extracted
        print(f"  Extracted: {json.dumps(extracted, indent=2)}")

        # =====================================================================
        # VALIDATION (Pydantic/schema validation)
        # EXAM CONCEPT (Task 4.3): tool_use eliminates SYNTAX errors.
        # But SEMANTIC errors still require validation:
        #   - Values that don't sum correctly
        #   - "other" intent without detail field
        #   - Confidence outside [0, 1]
        # =====================================================================
        validation_error = _validate_extraction(extracted)
        if validation_error:
            last_error = validation_error
            print(f"  VALIDATION FAILED: {validation_error}")
            if attempt <= max_retries:
                print("  Retrying with specific error feedback...")
            continue

        print(f"  Validation passed (confidence: {extracted.get('confidence', 0):.0%})")
        return extracted

    # Max retries exhausted
    print(f"  Max retries ({max_retries}) exhausted. Returning best available extraction.")
    return last_extraction or {}


def _validate_extraction(extracted: dict) -> str | None:
    """
    Validate the extraction for semantic errors.
    Returns a specific error message, or None if valid.

    EXAM CONCEPT: Semantic validation catches errors that schema syntax validation misses:
      - Intent is "other" but no detail provided
      - Confidence value out of range
      - Escalated resolution but no ticket ID
    """
    intent = extracted.get("customer_intent")
    if intent == "other" and not extracted.get("customer_intent_detail"):
        return (
            "customer_intent is 'other' but customer_intent_detail is missing. "
            "When intent is 'other', you must provide a brief description in customer_intent_detail."
        )

    confidence = extracted.get("confidence")
    if confidence is not None and not (0.0 <= confidence <= 1.0):
        return (
            f"confidence value {confidence} is outside valid range [0.0, 1.0]. "
            f"Use a decimal between 0 and 1 (e.g., 0.85 for 85% confidence)."
        )

    resolution = extracted.get("resolution_status")
    if resolution == "escalated_to_human" and not extracted.get("escalation_ticket_id"):
        # This is a warning, not a hard error — the ticket ID might not be in the conversation
        print(
            "  WARNING: resolution_status is 'escalated_to_human' but no escalation_ticket_id found. "
            "This is acceptable if the ticket wasn't mentioned in the conversation."
        )

    return None  # Valid


# =============================================================================
# BATCH PROCESSING STRATEGY
# EXAM CONCEPT (Task 4.5): Message Batches API
#   - 50% cost savings, up to 24-hour processing window
#   - NO guaranteed latency SLA → NOT suitable for blocking pre-merge checks
#   - Suitable for: overnight reports, weekly audits, nightly analysis
#   - custom_id correlates request/response pairs
#   - Batch API does NOT support multi-turn tool calling within a single request
# =============================================================================

def submit_batch_extractions(conversations: list[dict]) -> str:
    """
    Submit multiple conversations for batch extraction.

    EXAM CONCEPT: Use the Message Batches API for latency-tolerant workloads only.
    This function demonstrates the custom_id pattern for result correlation.

    Args:
        conversations: List of {"id": str, "text": str} dicts
    Returns:
        batch_id for polling
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    requests = []
    for conv in conversations:
        requests.append({
            # EXAM CONCEPT: custom_id correlates batch request/response pairs
            # On failure, resubmit only failed items by their custom_id
            "custom_id": conv["id"],
            "params": {
                "model": "claude-haiku-4-5-20251001",  # Use cheaper model for batch
                "max_tokens": 1024,
                "tools": [CASE_EXTRACTION_TOOL],
                "tool_choice": {"type": "any"},
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Extract structured information from this support conversation:\n\n"
                            f"{conv['text']}"
                        ),
                    }
                ],
            },
        })

    print(f"\n[Batch] Submitting {len(requests)} extraction requests...")
    print("NOTE: Batch API has up to 24-hour processing window. ")
    print("      Do NOT use for blocking/real-time workflows.")

    batch = client.messages.batches.create(requests=requests)
    print(f"[Batch] Submitted. Batch ID: {batch.id}")
    print(f"[Batch] Poll for results using: client.messages.batches.retrieve('{batch.id}')")

    return batch.id
