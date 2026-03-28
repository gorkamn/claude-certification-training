"""
Structured data extraction pipeline — Domain 4, Tasks 4.3 & 4.4 exam focus areas.

Web variant adds extract_case_for_web() which returns JSON-serializable data
for the UI instead of printing to stdout.
"""

import os
import json
from typing import Any

import anthropic
from dotenv import load_dotenv

load_dotenv(override=True)

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
                    "Example: 'customer_mentioned_amount_before_intent'"
                ),
            },
        },
        "required": ["customer_intent", "sentiment", "resolution_status", "confidence"],
    },
}


def extract_case_for_web(conversation_text: str, max_retries: int = 2) -> dict:
    """
    Web variant: runs validation-retry loop and returns structured data
    with full attempt log for the UI to display.

    Returns:
        {
            "messages": [...],   # Extraction conversation turns
            "events": [...],     # Attempt log with validation results
            "final_response": str,
            "extracted": dict,   # Final extraction result
            "iterations": int,
        }
    """
    client = anthropic.AnthropicBedrock()

    messages = []
    events = []
    attempt = 0
    last_extraction = None
    last_error = None

    while attempt <= max_retries:
        attempt += 1
        events.append({"type": "extraction_attempt", "attempt": attempt})

        if attempt == 1:
            user_content = (
                "Extract structured information from this support conversation:\n\n"
                f"{conversation_text}"
            )
        else:
            user_content = (
                "The previous extraction had a validation error. "
                "Please re-extract from the original conversation, fixing the specific error.\n\n"
                f"ORIGINAL CONVERSATION:\n{conversation_text}\n\n"
                f"FAILED EXTRACTION:\n{json.dumps(last_extraction, indent=2)}\n\n"
                f"SPECIFIC VALIDATION ERROR:\n{last_error}\n\n"
                "Please provide a corrected extraction."
            )

        messages.append({"role": "user", "content": user_content})

        response = client.messages.create(
            model=os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6"),
            max_tokens=1024,
            tools=[CASE_EXTRACTION_TOOL],
            tool_choice={"type": "any"},
            messages=messages,
        )

        # Collect assistant response for conversation history
        assistant_content = []
        tool_use_block = None
        for block in response.content:
            if hasattr(block, "type"):
                if block.type == "text":
                    assistant_content.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    tool_use_block = block
                    assistant_content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })

        messages.append({"role": "assistant", "content": assistant_content})

        if not tool_use_block:
            last_error = "Model returned text instead of tool call despite tool_choice='any'"
            events.append({"type": "extraction_error", "attempt": attempt, "error": last_error})
            # Return empty tool result so conversation stays valid
            messages.append({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "unknown", "content": last_error, "is_error": True}
            ]})
            continue

        extracted = tool_use_block.input
        last_extraction = extracted

        # Return tool result to complete the conversation turn
        messages.append({"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": tool_use_block.id, "content": "Extraction received."}
        ]})

        validation_error = _validate_extraction(extracted)
        if validation_error:
            last_error = validation_error
            events.append({
                "type": "validation_failed",
                "attempt": attempt,
                "error": validation_error,
                "extraction": extracted,
            })
            continue

        events.append({
            "type": "extraction_success",
            "attempt": attempt,
            "confidence": extracted.get("confidence", 0),
            "extraction": extracted,
        })

        summary = _format_extraction_summary(extracted)
        return {
            "messages": messages,
            "events": events,
            "final_response": summary,
            "extracted": extracted,
            "iterations": attempt,
        }

    # Max retries exhausted
    events.append({"type": "max_retries_exhausted", "attempts": attempt})
    return {
        "messages": messages,
        "events": events,
        "final_response": "Extraction completed (max retries reached). Using best available result.",
        "extracted": last_extraction or {},
        "iterations": attempt,
    }


def _validate_extraction(extracted: dict) -> str | None:
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

    return None


def _format_extraction_summary(extracted: dict) -> str:
    lines = ["Extraction complete. Structured output:"]
    for key, value in extracted.items():
        if value is not None:
            lines.append(f"  {key}: {value}")
    return "\n".join(lines)
